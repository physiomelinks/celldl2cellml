/**
 * The equations of a model, from Python's `build_expressions` (for elements
 * that act as junctions: sources and composites) and `build_equations` (for
 * junctions) in `model_support.py`.
 *
 * Differences from Python:
 * - A port with only outputs gets the negated sum of its outputs. Python
 *   uses the empty inputs, so the expression is 0 (bug 4).
 * - Bond counts are read (bug 3), so a term can be `n * x`. Where Python
 *   would then make `n * x` an equation's left side, which isn't valid
 *   CellML, the equation is written `x = ... / n`.
 * - Every equation built here is canonicalised, as sympy tidies Python's.
 */

import {
  canonicalise,
  ci,
  cn,
  divide,
  eq,
  equals,
  minus,
  plus,
  substitute,
  times,
  variables,
  type AstNode,
  type Equation,
  type IdentifierNode,
} from '@physiomelinks/math-ast'

import type { IssueLog } from '../issues.js'
import { BGF } from '../rdf/namespaces.js'
import type { NetworkNode } from './bonds.js'
import type { BondgraphElement } from './elements.js'
import { TRANSFORM_RATIO_NAME, type BondgraphJunction } from './junctions.js'
import { prettyUri } from './names.js'
import type { BondNetwork } from './network.js'

/** Where an equation comes from: an element's constitutive relation, an element acting as a junction, or a junction. */
export type EquationProvenance = 'cr' | 'be' | 'js'

export interface ModelEquation {
  readonly equation: Equation
  readonly provenance: EquationProvenance
  /** The IRI of the element or junction it comes from. */
  readonly source: string
}

interface EquationContext {
  readonly log: IssueLog
  readonly network: BondNetwork<NetworkNode>
  readonly elements: ReadonlyMap<string, BondgraphElement>
  readonly junctions: ReadonlyMap<string, BondgraphJunction>
}

export interface EquationOptions {
  /**
   * Write an element acting as a junction (a source, a composite store or
   * reaction) in terms of its neighbours' flow and potential variables, such
   * as `v_q_S1_c = -v_Rx_R1_c`, rather than their constitutive relations'
   * right sides, as Python does (`-(kappa_Rx_R1_c * (...))`), which computes
   * each rate twice. Each neighbour's relation defines the variable, so the
   * equations are equivalent. `convert()` does; `celldl2cellml()` doesn't.
   */
  readonly flowVariables?: boolean
  /**
   * Solve a transform node's equation for its own port variable where its
   * left side is a neighbour's variable that another equation already
   * defines, as Finbar Argus's BG-Tools (feat/constitutive-laws) does: a
   * transformer `u_C_m = TF * u_TF_0` beside a capacitor, whose relation
   * defines `u_C_m`, becomes `u_TF_0 = u_C_m / TF`, so each variable is
   * defined once and the model is an ODE rather than a DAE. Python 0.11.2
   * doesn't; `convert()` does.
   */
  readonly solveTransforms?: boolean
}

/**
 * Every equation, in Python's order: for each element its constitutive
 * relation then its own equations, then each junction's.
 */
export function buildEquations(context: EquationContext, options: EquationOptions = {}): ModelEquation[] {
  const terms = new NodeTerms(context, options.flowVariables ?? false)
  for (const element of context.elements.values()) element.equations.push(...elementEquations(element, terms, context))
  for (const junction of context.junctions.values()) junction.equations.push(...junctionEquations(junction, terms, context))
  if (options.solveTransforms) solveTransforms(context)

  const equations: ModelEquation[] = []
  for (const element of context.elements.values()) {
    for (const equation of element.constitutiveRelation ?? []) equations.push({ equation, provenance: 'cr', source: element.iri })
    for (const equation of element.equations) equations.push({ equation, provenance: 'be', source: element.iri })
  }
  for (const junction of context.junctions.values()) {
    for (const equation of junction.equations) equations.push({ equation, provenance: 'js', source: junction.iri })
  }
  return equations
}

//==============================================================================

/**
 * The flow and potential at a network node, as Python's `flow_symbol`,
 * `flow_expression`, `potential_symbol` and `potential_expression`.
 */
class NodeTerms {
  readonly #context: EquationContext
  readonly #variables: boolean
  readonly #reported = new Set<string>()

  constructor(context: EquationContext, variables: boolean) {
    this.#context = context
    this.#variables = variables
  }

  /**
   * The element's flow expression from its relation, if the node is an
   * element's port and it has one (or with `flowVariables`, the flow variable
   * the relation defines); otherwise the flow.
   */
  flowExpression(id: string): AstNode | undefined {
    const node = this.#context.network.node(id)!
    const element = node.port !== undefined ? node.element : undefined
    if (element?.flowExpression !== undefined && this.#variables) return ci(element.flow!.symbol)
    return element?.flowExpression ?? this.flow(id)
  }

  /** The potential expression, likewise. */
  potentialExpression(id: string): AstNode | undefined {
    const node = this.#context.network.node(id)!
    const element = node.port !== undefined ? node.element : undefined
    if (element?.potentialExpression !== undefined && this.#variables) return ci(element.potential!.symbol)
    return element?.potentialExpression ?? this.potential(id)
  }

  /** A port's flow, or a one node's. */
  flow(id: string): IdentifierNode | undefined {
    return this.#variable(id, 'flow', BGF.OneNode, BGF.ZeroNode, 'Zero')
  }

  /** A port's potential, or a zero node's. */
  potential(id: string): IdentifierNode | undefined {
    return this.#variable(id, 'potential', BGF.ZeroNode, BGF.OneNode, 'One')
  }

  #variable(id: string, kind: 'flow' | 'potential', has: string, adjacent: string, adjacentName: string): IdentifierNode | undefined {
    const node = this.#context.network.node(id)!
    if (node.port !== undefined) return ci(node.port[kind].symbol)
    const junction = node.junction
    if (junction?.type === has) {
      const variable = junction.variables.get('')
      return variable === undefined ? undefined : ci(variable.symbol)
    }
    // A transform node's port without variables has been reported
    if (junction?.type === BGF.TransformNode) return undefined
    if (junction?.type === adjacent) {
      this.#report(`Adjacent ${adjacentName} Nodes to junction ${junction.prettyName} must be merged`, junction.iri)
    } else {
      this.#report(`Unexpected bond graph node ${prettyUri(id)}, cannot get its ${kind}`, id)
    }
    return undefined
  }

  #report(message: string, subject: string): void {
    if (this.#reported.has(message)) return
    this.#reported.add(message)
    this.#context.log.report(message, subject)
  }
}

/** `n * x`, or `x` when `n` is 1. */
function scaled(bondCount: number, term: AstNode): AstNode {
  return bondCount === 1 ? term : times(cn(bondCount), term)
}

/** sympy's `Add(*terms)`: 0, the one term, or their sum. */
function sum(terms: readonly AstNode[]): AstNode {
  return terms.length === 0 ? cn(0) : terms.length === 1 ? terms[0]! : plus(...terms)
}

/** sympy's `Add(*plus, Mul(-1, Add(*less)))`. */
function difference(add: readonly AstNode[], subtract: readonly AstNode[]): AstNode {
  return subtract.length === 0 ? sum(add) : add.length === 0 ? minus(sum(subtract)) : minus(sum(add), sum(subtract))
}

/**
 * `left = right`, tidied. A left side `n * x`, from a bond count, becomes
 * `x = right / n`.
 */
function equation(left: AstNode, right: AstNode): Equation {
  if (left.type === 'Multiply' && left.children.length === 2 && left.children[0]!.type === 'Number' && left.children[1]!.type === 'Identifier') {
    return canonicalise(eq(left.children[1]!, divide(right, left.children[0]!))) as Equation
  }
  return canonicalise(eq(left, right)) as Equation
}

/** Remove the first term equal to `term`, as Python's `list.remove`; whether there was one. */
function removeTerm(terms: AstNode[], term: AstNode): boolean {
  const index = terms.findIndex((other) => equals(other, term))
  if (index < 0) return false
  terms.splice(index, 1)
  return true
}

//==============================================================================

/**
 * Python's `build_expressions`: an element that acts as a one node (a flow
 * source, a composite resistance or reaction) has its potential, and a
 * reaction each port's potential, from the potentials beside it; one that
 * acts as a zero node (a potential source, a composite store) has its flow,
 * and a store with several ports each port's flow, from the flows beside it.
 */
function elementEquations(element: BondgraphElement, terms: NodeTerms, context: EquationContext): Equation[] {
  const { network } = context
  const implied = element.impliedJunction
  if (implied === undefined) return []
  const several = element.ports.size > 1
  const equations: Equation[] = []

  for (const [id, port] of element.ports) {
    const bondInputs: AstNode[] = []
    const bondOutputs: AstNode[] = []
    const portInputs: AstNode[] = []
    const portOutputs: AstNode[] = []
    const direction = port.template.direction

    const update = (node: string, input: boolean): void => {
      const bondCount = (input ? network.bondCount(node, id) : network.bondCount(id, node)) ?? 1
      const forward = direction !== undefined && (input ? direction === BGF.InwardPort : direction === BGF.OutwardPort)
      const oneNode = implied === BGF.OneNode
      const expression = oneNode ? terms.potentialExpression(node) : terms.flowExpression(node)
      if (expression !== undefined) (input ? bondInputs : bondOutputs).push(scaled(bondCount, expression))
      if (several && element.elementClass === (oneNode ? BGF.Reaction : BGF.QuantityStore)) {
        const symbol = oneNode ? terms.potential(node) : terms.flow(node)
        if (symbol !== undefined) (forward ? portInputs : portOutputs).push(scaled(bondCount, symbol))
      }
    }
    for (const node of network.predecessors(id)) update(node, true)
    for (const node of network.successors(id)) update(node, false)
    equations.push(...sharedValues(element, id, context))

    const bondExpression = difference(bondInputs, bondOutputs)
    let portExpression: AstNode | undefined
    if (portOutputs.length > 0) {
      // Python negates the (empty) inputs here, giving 0
      portExpression = portInputs.length > 0 ? difference(portInputs, portOutputs) : minus(sum(portOutputs))
    } else if (portInputs.length > 0) {
      portExpression = sum(portInputs)
    }

    if (implied === BGF.OneNode) {
      if (element.potential !== undefined) equations.push(equation(ci(element.potential.symbol), bondExpression))
      if (portExpression !== undefined) equations.push(equation(ci(port.potential.symbol), portExpression))
    } else {
      if (element.flow !== undefined) equations.push(equation(ci(element.flow.symbol), bondExpression))
      if (portExpression !== undefined) equations.push(equation(ci(port.flow.symbol), portExpression))
    }
  }
  return equations
}

/**
 * A port of an element that isn't acting as a junction, bonded straight to a
 * port of one that is, shares its potential (zero node) or flow (one node),
 * as it would through a zero or one node between them: a reaction bonded
 * straight to a composite store takes the store's potential, and a store
 * bonded straight to a composite reaction the reaction's flow. A bond count
 * `n` scales it, `n` times the shared value, as the junction's balance
 * counts the port `n` times. Python gives no such equation, so the port's
 * variable is left without one.
 */
function sharedValues(element: BondgraphElement, id: string, context: EquationContext): Equation[] {
  const { network } = context
  const zeroNode = element.impliedJunction === BGF.ZeroNode
  const own = zeroNode ? element.potential : element.flow
  if (own === undefined) return []
  const equations: Equation[] = []
  for (const neighbour of network.neighbours(id)) {
    const node = network.node(neighbour)!
    if (node.element === undefined || node.element.impliedJunction !== undefined || node.port === undefined) continue
    const shared = zeroNode ? node.port.potential : node.port.flow
    const intoNeighbour = network.bondCount(id, neighbour) !== undefined
    const bondCount = (intoNeighbour ? network.bondCount(id, neighbour) : network.bondCount(neighbour, id)) ?? 1
    const sign = zeroNode ? 1 : flowSign(node, neighbour, intoNeighbour)
    if (shared.symbol !== own.symbol || sign !== 1) {
      equations.push(equation(ci(shared.symbol), signed(sign, scaled(bondCount, ci(own.symbol)))))
    }
  }
  return equations
}

/**
 * -1 if a bond runs against the way an element's port counts its flow: out
 * of an inward or undirected port, such as a store's, or into an outward
 * one. A store drawn as a reaction's substrate, bonded from the store to the
 * reaction, loses what the reaction's flow carries away.
 */
function flowSign(node: NetworkNode, id: string, intoElement: boolean): 1 | -1 {
  const inward = node.element?.ports.get(id)?.template.direction !== BGF.OutwardPort
  return intoElement === inward ? 1 : -1
}

/** `-x`, or `x` when `sign` is 1. */
function signed(sign: 1 | -1, term: AstNode): AstNode {
  return sign === 1 ? term : minus(term)
}

/**
 * Python's `build_equations`. A transform node gives its transformer or
 * gyrator relation in its variables' symbols. A one node joined to several
 * nodes balances their potentials, and a zero node their flows, solved for a
 * resistance's or reaction's potential if one is beside a one node, or else
 * the last output, or input. An element beside it that isn't acting as a
 * junction shares its flow (one node) or potential (zero node), times its
 * bond's count, and a flow is negated where the bond runs against the port
 * (`flowSign`). (Python ignores both, so a port bonded `n` times carries the
 * junction's flow, not `n` times it, and a store bonded out to a one node
 * gains what it should lose.)
 */
function junctionEquations(junction: BondgraphJunction, terms: NodeTerms, context: EquationContext): Equation[] {
  const { network } = context
  if (junction.type === BGF.TransformNode) {
    const names = [TRANSFORM_RATIO_NAME, 'v_0', 'u_0', 'v_1', 'u_1']
    // A transform node missing any of these has been reported
    if (junction.relation === undefined || names.some((name) => !junction.variables.has(name))) return []
    const symbols = new Map(names.map((name) => [name, junction.variables.get(name)!.symbol]))
    return junction.relation.map((relation) => canonicalise(substitute(relation, symbols)) as Equation)
  }
  if (network.degree(junction.iri) <= 1) return []

  const oneNode = junction.type === BGF.OneNode
  const inputs: AstNode[] = []
  const outputs: AstNode[] = []
  const equalValues: [string, number, 1 | -1][] = []
  let left: AstNode | undefined

  const update = (id: string, input: boolean): void => {
    const node = network.node(id)!
    const bondCount = (input ? network.bondCount(id, junction.iri) : network.bondCount(junction.iri, id)) ?? 1
    const symbol = oneNode ? terms.potential(id) : terms.flow(id)
    if (symbol !== undefined) (input ? inputs : outputs).push(scaled(bondCount, symbol))
    if (node.element !== undefined && node.element.impliedJunction === undefined && node.port !== undefined) {
      equalValues.push([oneNode ? node.port.flow.symbol : node.port.potential.symbol, bondCount, oneNode ? flowSign(node, id, !input) : 1])
    }
    if (left === undefined && node.port !== undefined && oneNode && (node.portType === BGF.Resistance || node.portType === BGF.Reaction)) {
      left = ci(node.port.potential.symbol)
    }
  }
  for (const id of network.predecessors(junction.iri)) update(id, true)
  for (const id of network.successors(junction.iri)) update(id, false)

  const equations: Equation[] = []
  if (outputs.length > 0) {
    if (left !== undefined && removeTerm(inputs, left)) {
      equations.push(equation(left, inputs.length > 0 ? difference(outputs, inputs) : sum(outputs)))
    } else {
      if (left === undefined || !removeTerm(outputs, left)) left = outputs.pop()!
      equations.push(equation(left, outputs.length > 0 ? difference(inputs, outputs) : sum(inputs)))
    }
  } else if (inputs.length > 1) {
    if (left === undefined || !removeTerm(inputs, left)) left = inputs.pop()!
    equations.push(equation(left, minus(sum(inputs))))
  }

  const own = junction.variables.get('')
  if (own !== undefined) {
    for (const [value, bondCount, sign] of equalValues) {
      // A port bonded `n` times carries `n` times the junction's flow (one node) or potential (zero node)
      if (bondCount !== 1 || sign !== 1) equations.push(equation(ci(value), signed(sign, scaled(bondCount, ci(own.symbol)))))
      else if (value !== own.symbol) equations.push(equation(ci(own.symbol), ci(value)))
    }
  }
  return equations
}

//==============================================================================

/** `EquationOptions.solveTransforms`: each transform node's equations solved for its own variables where they must be. */
function solveTransforms(context: EquationContext): void {
  const definedBy = new Map<string, number>()
  const define = (equation: Equation): void => {
    if (equation.left.type === 'Identifier') definedBy.set(equation.left.name, (definedBy.get(equation.left.name) ?? 0) + 1)
  }
  for (const element of context.elements.values()) {
    for (const equation of [...(element.constitutiveRelation ?? []), ...element.equations]) define(equation)
  }
  for (const junction of context.junctions.values()) junction.equations.forEach(define)

  for (const junction of context.junctions.values()) {
    if (junction.type !== BGF.TransformNode || junction.ownVariables.size === 0) continue
    const own = new Set([...junction.ownVariables].map((variable) => variable.symbol))
    junction.equations.forEach((equation, index) => {
      const left = equation.left
      // Only a neighbour's variable that something else defines too
      if (left.type !== 'Identifier' || own.has(left.name) || (definedBy.get(left.name) ?? 0) < 2) return
      const unknowns = variables(equation.right).filter((name) => own.has(name))
      if (unknowns.length !== 1 || (definedBy.get(unknowns[0]!) ?? 0) > 0) return
      const solved = solveFor(equation, unknowns[0]!)
      if (solved === undefined) return
      junction.equations[index] = solved
      definedBy.set(left.name, definedBy.get(left.name)! - 1)
      definedBy.set(unknowns[0]!, 1)
    })
  }
}

/** `x = a * y` or `x = y / a` or `x = a / y` solved for `y`, which appears once; `undefined` for other forms. */
function solveFor(equation: Equation, name: string): Equation | undefined {
  const { left, right } = equation
  const isName = (node: AstNode): boolean => node.type === 'Identifier' && node.name === name
  if (right.type === 'Multiply') {
    const index = right.children.findIndex(isName)
    const others = right.children.filter((_, i) => i !== index)
    if (index < 0 || others.some((child) => variables(child).includes(name))) return undefined
    return canonicalise(eq(ci(name), divide(left, others.length === 1 ? others[0]! : times(...others)))) as Equation
  }
  if (right.type === 'Divide') {
    if (isName(right.numerator) && !variables(right.denominator).includes(name)) {
      return canonicalise(eq(ci(name), times(left, right.denominator))) as Equation
    }
    if (isName(right.denominator) && !variables(right.numerator).includes(name)) {
      return canonicalise(eq(ci(name), divide(right.numerator, left))) as Equation
    }
  }
  return undefined
}
