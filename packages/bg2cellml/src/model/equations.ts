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

/**
 * Every equation, in Python's order: for each element its constitutive
 * relation then its own equations, then each junction's.
 */
export function buildEquations(context: EquationContext): ModelEquation[] {
  const terms = new NodeTerms(context)
  for (const element of context.elements.values()) element.equations.push(...elementEquations(element, terms, context))
  for (const junction of context.junctions.values()) junction.equations.push(...junctionEquations(junction, terms, context))

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
  readonly #reported = new Set<string>()

  constructor(context: EquationContext) {
    this.#context = context
  }

  /** The element's flow expression from its relation, if the node is an element's port and it has one; otherwise the flow. */
  flowExpression(id: string): AstNode | undefined {
    const node = this.#context.network.node(id)!
    return (node.port !== undefined ? node.element?.flowExpression : undefined) ?? this.flow(id)
  }

  /** The potential expression, likewise. */
  potentialExpression(id: string): AstNode | undefined {
    const node = this.#context.network.node(id)!
    return (node.port !== undefined ? node.element?.potentialExpression : undefined) ?? this.potential(id)
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
 * Python's `build_equations`. A transform node gives its transformer or
 * gyrator relation in its variables' symbols. A one node joined to several
 * nodes balances their potentials, and a zero node their flows, solved for a
 * resistance's or reaction's potential if one is beside a one node, or else
 * the last output, or input. An element beside it that isn't acting as a
 * junction shares its flow (one node) or potential (zero node).
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
  const equalValues: string[] = []
  let left: AstNode | undefined

  const update = (id: string, input: boolean): void => {
    const node = network.node(id)!
    const bondCount = (input ? network.bondCount(id, junction.iri) : network.bondCount(junction.iri, id)) ?? 1
    const symbol = oneNode ? terms.potential(id) : terms.flow(id)
    if (symbol !== undefined) (input ? inputs : outputs).push(scaled(bondCount, symbol))
    if (node.element !== undefined && node.element.impliedJunction === undefined && node.port !== undefined) {
      equalValues.push(oneNode ? node.port.flow.symbol : node.port.potential.symbol)
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
    for (const value of equalValues) if (value !== own.symbol) equations.push(equation(ci(own.symbol), ci(value)))
  }
  return equations
}
