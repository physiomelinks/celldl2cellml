/**
 * Assigning element variables once the bond network exists, from
 * `BondgraphElement.assign_variables` in Python's `model_support.py`: unused
 * ports are dropped, the model's values and symbols are given to variables,
 * a variable can be another element's intrinsic variable, and the
 * constitutive relation is rewritten in the variables' symbols.
 *
 * Unlike Python, values are converted into their variable's units (`1000 uF`
 * for a capacitance in `C2/J` is `0.001`); Python only checks the units are
 * compatible, and writes 1000.
 */

import { substitute, variables as namesIn, type Equation } from '@physiomelinks/math-ast'

import type { CompatibleUnits, Value } from '../framework/variables.js'
import { VOI_NAME } from '../framework/templates.js'
import type { IssueLog } from '../issues.js'
import { BGF } from '../rdf/namespaces.js'
import type { NetworkNode } from './bonds.js'
import type { BondgraphElement, ModelVariable } from './elements.js'
import type { BondgraphJunction } from './junctions.js'
import type { BondNetwork } from './network.js'

/** Converts a value between two compatible UCUM codes, such as `convertValue` from cellml-units. */
export type ConvertUnits = (value: number, from: string, to: string) => number

export interface VariableAssignmentContext {
  readonly log: IssueLog
  readonly compatible: CompatibleUnits
  readonly convert: ConvertUnits
  readonly elements: ReadonlyMap<string, BondgraphElement>
  readonly junctions: ReadonlyMap<string, BondgraphJunction>
  readonly network: BondNetwork<NetworkNode>
}

const DISSIPATORS = new Set<string>([BGF.Resistance, BGF.Reaction])
const SOURCES = new Set<string>([BGF.FlowSource, BGF.PotentialSource])

/** Python's `__assign_element_variables_and_equations`, as far as `assign_variables`. */
export function assignElementVariables(context: VariableAssignmentContext): void {
  for (const element of context.elements.values()) assignVariables(element, context)
}

/**
 * `value` in `units`: converted if it has compatible units of its own, or
 * given them if it has none. `undefined`, with the issue reported, if its
 * units aren't compatible.
 */
export function valueInUnits(
  value: Value,
  variable: Pick<ModelVariable, 'name' | 'units'>,
  context: Pick<VariableAssignmentContext, 'log' | 'compatible' | 'convert'>,
  subject: string,
  report = true,
): Value | undefined {
  const { units } = variable
  if (value.units === undefined || value.units === units) return { magnitude: value.magnitude, units }
  if (!compatibleUnits(context, units, value.units)) {
    if (report) {
      context.log.reportIssue({ message: `Value for variable ${variable.name} has incompatible units (${units} != ${value.units})`, stage: 'units', subject })
    }
    return undefined
  }
  return { magnitude: context.convert(value.magnitude, value.units, units), units }
}

function compatibleUnits(context: Pick<VariableAssignmentContext, 'compatible'>, a: string, b: string): boolean {
  try {
    return a === b || context.compatible(a, b)
  } catch {
    return false
  }
}

/** The same units, so one variable can stand for the other: compatible, and with no scaling between them. */
function equivalentUnits(context: VariableAssignmentContext, a: string, b: string): boolean {
  if (a === b) return true
  try {
    return context.compatible(a, b) && context.convert(1, a, b) === 1
  } catch {
    return false
  }
}

function assignVariables(element: BondgraphElement, context: VariableAssignmentContext): void {
  const { log, network } = context
  const iri = element.iri
  const name = element.prettyName

  // A port with no bonds is dropped; a dissipator's potential there goes with it
  for (const [id, port] of [...element.ports]) {
    if (network.degree(id) > 0) continue
    if (DISSIPATORS.has(element.elementClass)) {
      element.variables.delete(port.template.potential.name)
      element.portVariableNames.delete(port.template.potential.name)
    }
    element.ports.delete(id)
  }

  // A store's or source's own value, already checked for compatible units when read
  const intrinsic = element.intrinsicVariable
  if (intrinsic?.value !== undefined) {
    const value = valueInUnits(intrinsic.value, intrinsic, context, iri, false)
    if (value === undefined) delete intrinsic.value
    else intrinsic.value = value
  }

  // Unknown names were reported when the values were read
  for (const [variableName, assignment] of element.values) {
    const variable = element.variables.get(variableName)
    if (variable === undefined) continue
    if (assignment.symbol !== undefined) variable.symbol = assignment.symbol
    if (assignment.value !== undefined) {
      const value = valueInUnits(assignment.value, variable, context, iri)
      if (value !== undefined) variable.value = value
      continue
    }
    const target = assignment.element
    const other = context.elements.get(target)
    if (other === undefined) {
      log.report(
        context.junctions.has(target)
          ? `Value for ${name} is not a bond element: <${target}>`
          : `Value for ${name} refers to unknown element: <${target}>`,
        iri,
      )
    } else if (other.intrinsicVariable === undefined) {
      log.report(`Value for ${name} is an element with no intrinsic variable: <${target}>`, iri)
    } else if (!equivalentUnits(context, variable.units, other.intrinsicVariable.units)) {
      log.reportIssue({ message: `Units incompatible for ${name} value: <${target}>`, stage: 'units', subject: iri })
    } else {
      element.variables.set(variableName, other.intrinsicVariable)
    }
  }

  if (element.constitutiveRelation !== undefined) substituteSymbols(element, context)
}

/**
 * The relation in the element's symbols: each name becomes its variable's
 * symbol. Python renames one name at a time, failing if a symbol is already
 * in the relation; here all are renamed at once, and two names that would
 * end up as one symbol are reported.
 */
function substituteSymbols(element: BondgraphElement, context: VariableAssignmentContext): void {
  const { log } = context
  const relation = element.constitutiveRelation!
  const used = namesIn(...relation)
  const fixed = new Set([VOI_NAME, ...element.domain.constants.map((constant) => constant.name)])

  // A source's relation is the model's own MathML, which no template has checked.
  // (A dissipator's relation keeps the potential of a port with no bonds, as in Python.)
  const unknown = SOURCES.has(element.elementClass) ? used.filter((n) => !element.variables.has(n) && !fixed.has(n)) : []
  if (unknown.length > 0) {
    log.report(`Constitutive relation of element ${element.prettyName} has undeclared name ${unknown.join(', ')}`, element.iri)
    return
  }

  const renames = new Map<string, string>()
  const owners = new Map<string, ModelVariable>()
  for (const n of used) {
    const variable = element.variables.get(n)
    const symbol = variable?.symbol ?? n
    const owner = owners.get(symbol)
    if ((owner !== undefined && owner !== variable) || (variable !== undefined && fixed.has(symbol))) {
      log.report(`Element ${element.prettyName} has more than one name for the symbol ${symbol}`, element.iri)
      return
    }
    if (variable !== undefined) owners.set(symbol, variable)
    if (symbol !== n) renames.set(n, symbol)
  }

  const substituted = relation.map((equation) => substitute(equation, renames) as Equation)
  element.constitutiveRelation = substituted
  for (const equation of substituted) {
    if (equation.left.type !== 'Identifier') continue
    if (element.flow !== undefined && equation.left.name === element.flow.symbol) element.flowExpression = equation.right
    else if (element.potential !== undefined && equation.left.name === element.potential.symbol) element.potentialExpression = equation.right
  }
}
