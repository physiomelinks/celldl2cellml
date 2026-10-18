/**
 * The model's equations as MathML in the `main` component, from
 * `CellMLModel.__equations_to_mathml` in `cellml/__init__.py`.
 *
 * As in Python, they come in three groups, each after a comment: element
 * ODEs (constitutive relations with a derivative on the left), element
 * algebraics (other constitutive relations, and the equations of elements
 * acting as junctions), then junction algebraics. Within a group they're
 * sorted by the text sympy gives the left side (`q_1`, `Derivative(q_1, t)`).
 * Each equation is its own `<math>`.
 *
 * Differences from Python, on purpose:
 * - A number with no units of its own is `dimensionless`, CellML 2.0's
 *   built-in, rather than Python's `dim`. A number given `cellml:units` in a
 *   source's MathML keeps them, read as a UCUM code.
 * - An equation using a name that isn't one of the model's variables, such as
 *   the template potential of a resistor's unbonded port, is reported rather
 *   than written into CellML that can't be valid.
 * - Numbers are written as given (`50 * 2`), where sympy folds them (`100`).
 */

import { UcumError } from '@physiomelinks/cellml-units'
import { toMathML, variables, type AstNode, type Equation, type NumberNode } from '@physiomelinks/math-ast'

import type { IssueLog } from '../issues.js'
import type { EquationProvenance, ModelEquation } from '../model/equations.js'
import type { BondgraphModel } from '../model/model.js'
import type { CellMLModelBuild } from './model.js'

/** The groups equations are written in, in order, with their comments. */
export const EQUATION_GROUPS = [
  { group: 'elementODEs', description: 'Element ODEs' },
  { group: 'elementAlgebraics', description: 'Element algebraics' },
  { group: 'junctionAlgebraics', description: 'Junction algebraics' },
] as const

export type EquationGroup = (typeof EQUATION_GROUPS)[number]['group']

/** An equation as written into the CellML model. */
export interface CellMLEquation {
  readonly equation: Equation
  readonly provenance: EquationProvenance
  /** The IRI of the element or junction it comes from. */
  readonly source: string
  readonly group: EquationGroup
}

/** The units of numbers with none of their own. */
export const NUMBER_UNITS = 'dimensionless'

/**
 * The text sympy's `str()` gives an equation's left side, which Python sorts
 * by: a variable's name, or `Derivative(q_1, t)`.
 */
export function leftSideKey(left: AstNode): string {
  switch (left.type) {
    case 'Identifier':
      return left.name
    case 'Derivative':
      return `Derivative(${leftSideKey(left.expression)}, ${leftSideKey(left.variable)})`
    default:
      return ''
  }
}

const byLeftSide = (a: CellMLEquation, b: CellMLEquation): number => {
  const [ka, kb] = [leftSideKey(a.equation.left), leftSideKey(b.equation.left)]
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/** Python's grouping; `undefined` for a constitutive relation whose left side is neither a variable nor a derivative. */
function groupOf(equation: ModelEquation): EquationGroup | undefined {
  if (equation.provenance === 'js') return 'junctionAlgebraics'
  if (equation.provenance === 'be') return 'elementAlgebraics'
  const left = equation.equation.left.type
  return left === 'Derivative' ? 'elementODEs' : left === 'Identifier' ? 'elementAlgebraics' : undefined
}

/**
 * Write the model's equations into the build's `main` component (plan chunk
 * 6.2), returning them as written, in order. Problems are reported in `log`;
 * an equation with one is left out.
 */
export function addEquations(build: CellMLModelBuild, model: BondgraphModel, log: IssueLog): CellMLEquation[] {
  const known = new Set(build.variables.map((variable) => variable.name))
  const nameOf = (iri: string): string => (model.elements.get(iri) ?? model.junctions.get(iri))?.prettyName ?? iri

  const groups = new Map<EquationGroup, CellMLEquation[]>(EQUATION_GROUPS.map(({ group }) => [group, []]))
  for (const equation of model.equations) {
    const group = groupOf(equation)
    if (group === undefined) {
      log.report(`An equation of ${nameOf(equation.source)} has neither a variable nor a derivative on its left side`, equation.source)
      continue
    }
    const unknown = variables(equation.equation).filter((name) => !known.has(name))
    if (unknown.length > 0) {
      const names = unknown.join(', ')
      const which = unknown.length === 1 ? "isn't a variable" : "aren't variables"
      log.report(`An equation of ${nameOf(equation.source)} uses ${names}, which ${which} of the model`, equation.source)
      continue
    }
    groups.get(group)!.push({ ...equation, group })
  }

  const written: CellMLEquation[] = []
  for (const { group, description } of EQUATION_GROUPS) {
    const equations = groups.get(group)!.sort(byLeftSide)
    const mathml: string[] = []
    for (const equation of equations) {
      const text = writeEquation(build, equation, nameOf, log)
      if (text === undefined) continue
      mathml.push(text)
      written.push(equation)
    }
    if (mathml.length === 0) continue
    build.component.appendMath(`<!-- ${description} -->\n`)
    for (const text of mathml) build.component.appendMath(`${text}\n`)
  }
  build.model.linkUnits()
  return written
}

/** One equation as a `<math>` element, every number with `cellml:units`. */
function writeEquation(
  build: CellMLModelBuild,
  equation: CellMLEquation,
  nameOf: (iri: string) => string,
  log: IssueLog,
): string | undefined {
  let problem: string | undefined
  const cnUnits = (cn: NumberNode): string => {
    if (cn.units === undefined) return NUMBER_UNITS
    try {
      return build.units.unitsFor(cn.units)
    } catch (error) {
      problem ??= error instanceof UcumError ? error.message : String(error)
      return NUMBER_UNITS
    }
  }
  const text = toMathML([equation.equation], { cnUnits })
  if (problem !== undefined) {
    log.report(`An equation of ${nameOf(equation.source)} has a number in units CellML can't use: ${problem}`, equation.source)
    return undefined
  }
  return text
}
