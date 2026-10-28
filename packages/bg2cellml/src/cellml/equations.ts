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
 * With `sections` (`convert()`), they come in sections by their role instead,
 * with no comments (a host lays them out, as PhLynx does in a sidecar):
 * potentials, port potentials, element flows, junction flows, any other
 * relations, then the ODEs (`EQUATION_SECTIONS`). Empty sections are left out.
 *
 * Differences from Python, on purpose:
 * - A number given units in BG-RDF's MathML (a UCUM code in `bgf:units`, or
 *   `cellml:units`; see `numberUnits`) keeps them, which Python ignores. One
 *   with none is `dimensionless`, CellML 2.0's built-in, rather than Python's
 *   `dim`. Bond graphs should be dimensionally consistent, so numbers that
 *   aren't dimensionless need units.
 * - An equation using a name that isn't one of the model's variables, such as
 *   the template potential of a resistor's unbonded port, is reported rather
 *   than written into CellML that can't be valid.
 * - Numbers are written as given (`50 * 2`), where sympy folds them (`100`).
 */

import { UcumError } from '@physiomelinks/cellml-units'
import { toMathML, variables, type AstNode, type Equation, type NumberNode } from '@physiomelinks/math-ast'

import type { IssueLog } from '../issues.js'
import type { ModelVariable } from '../model/elements.js'
import type { EquationProvenance, ModelEquation } from '../model/equations.js'
import type { BondgraphModel } from '../model/model.js'
import { elementRoles, junctionKind, junctionRoles, type VariableRole } from './manifest.js'
import type { CellMLModelBuild } from './model.js'

/** The groups equations are written in, in order, with their comments. */
export const EQUATION_GROUPS = [
  { group: 'elementODEs', description: 'Element ODEs' },
  { group: 'elementAlgebraics', description: 'Element algebraics' },
  { group: 'junctionAlgebraics', description: 'Junction algebraics' },
] as const

export type EquationGroup = (typeof EQUATION_GROUPS)[number]['group']

/**
 * `convert()`'s sections, in order, by an equation's role: an element's
 * constitutive relation for a potential or a flow, a junction's (or an
 * element's acting as one) for a potential or a flow, anything else, then
 * the ODEs. Titles are chemical when every element is.
 */
export const EQUATION_SECTIONS = [
  { section: 'potentials', title: 'Potentials', chemical: 'Chemical potentials' },
  { section: 'portPotentials', title: 'Port potentials', chemical: 'Reaction affinities' },
  { section: 'elementFlows', title: 'Element flows', chemical: 'Reaction flux' },
  { section: 'junctionFlows', title: 'Junction flows', chemical: 'Species flux' },
  { section: 'other', title: 'Other relations', chemical: 'Other relations' },
  { section: 'conservation', title: 'Conservation', chemical: 'Mass conservation' },
] as const

export type EquationSectionKind = (typeof EQUATION_SECTIONS)[number]['section']

/** A section of `convert()`'s equations: its title, and each equation's left-side variable (an ODE's state), in order. */
export interface EquationSection {
  readonly title: string
  readonly variables: readonly string[]
}

export interface AddEquationOptions {
  /** Write the equations in sections by role (`EQUATION_SECTIONS`), with no comments, rather than in Python's groups. */
  sections?: boolean
}

/** An equation as written into the CellML model. */
export interface CellMLEquation {
  readonly equation: Equation
  readonly provenance: EquationProvenance
  /** The IRI of the element or junction it comes from. */
  readonly source: string
  readonly group: EquationGroup
  /** Its section, when written in sections. */
  readonly section?: EquationSectionKind
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
 * Write the model's equations into the build's component (plan chunk
 * 6.2), returning them as written, in order. Problems are reported in `log`;
 * an equation with one is left out.
 */
export function addEquations(build: CellMLModelBuild, model: BondgraphModel, log: IssueLog, options: AddEquationOptions = {}): CellMLEquation[] {
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

  if (options.sections) return writeSections(build, model, [...groups.values()].flat(), nameOf, log)

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

/** Write the equations in sections, each sorted as Python sorts a group, with no comments. */
function writeSections(
  build: CellMLModelBuild,
  model: BondgraphModel,
  equations: readonly CellMLEquation[],
  nameOf: (iri: string) => string,
  log: IssueLog,
): CellMLEquation[] {
  const roles = variableRoles(model)
  const sections = new Map<EquationSectionKind, CellMLEquation[]>(EQUATION_SECTIONS.map(({ section }) => [section, []]))
  for (const equation of equations) {
    const section = sectionOf(equation, roles)
    sections.get(section)!.push({ ...equation, section })
  }
  const written: CellMLEquation[] = []
  for (const sectioned of sections.values()) {
    for (const equation of sectioned.sort(byLeftSide)) {
      const text = writeEquation(build, equation, nameOf, log)
      if (text === undefined) continue
      build.component.appendMath(`${text}\n`)
      written.push(equation)
    }
  }
  build.model.linkUnits()
  return written
}

/** Each variable's role, by its symbol: as the element manifest gives it, elements' first. */
function variableRoles(model: BondgraphModel): Map<string, VariableRole> {
  const roles = new Map<string, VariableRole>()
  const add = (pairs: Iterable<[ModelVariable, VariableRole]>): void => {
    for (const [variable, role] of pairs) if (!roles.has(variable.symbol)) roles.set(variable.symbol, role)
  }
  for (const element of model.elements.values()) add(elementRoles(element))
  for (const junction of model.junctions.values()) {
    const kind = junctionKind(junction.type)
    if (kind !== undefined) add(junctionRoles(junction, kind))
  }
  return roles
}

/** An equation's section, by its role: what writes it, and what its left side is. */
function sectionOf(equation: CellMLEquation, roles: ReadonlyMap<string, VariableRole>): EquationSectionKind {
  const left = equation.equation.left
  if (left.type === 'Derivative') return 'conservation'
  const role = left.type === 'Identifier' ? roles.get(left.name) : undefined
  const relation = equation.provenance === 'cr'
  if (role === 'potential') return relation ? 'potentials' : 'portPotentials'
  if (role === 'flow') return relation ? 'elementFlows' : 'junctionFlows'
  return 'other'
}

/** An equation's left-side variable: the variable, or an ODE's state. */
export function leftSideVariable(left: AstNode): string | undefined {
  if (left.type === 'Identifier') return left.name
  if (left.type === 'Derivative') return leftSideVariable(left.expression)
  return undefined
}

/** The titled sections of equations written in sections, empty ones left out. Titles are chemical when every element of the model is. */
export function equationSections(equations: readonly CellMLEquation[], model: BondgraphModel): EquationSection[] {
  const elements = [...model.elements.values()]
  const chemical = elements.length > 0 && elements.every((element) => element.domain.name === 'Chemical')
  return EQUATION_SECTIONS.map(({ section, title, chemical: chemicalTitle }) => ({
    title: chemical ? chemicalTitle : title,
    variables: equations.filter((equation) => equation.section === section).map((equation) => leftSideVariable(equation.equation.left) ?? ''),
  })).filter((section) => section.variables.length > 0)
}

/** One equation as a `<math>` element, every number with `cellml:units`. */
function writeEquation(
  build: CellMLModelBuild,
  equation: CellMLEquation,
  nameOf: (iri: string) => string,
  log: IssueLog,
): string | undefined {
  let problem: unknown
  const cnUnits = (cn: NumberNode): string => {
    if (cn.units === undefined) return NUMBER_UNITS
    try {
      return build.units.unitsFor(cn.units)
    } catch (error) {
      problem ??= error
      return NUMBER_UNITS
    }
  }
  const text = toMathML([equation.equation], { cnUnits })
  const failure = problem
  if (failure !== undefined) {
    const units = failure instanceof UcumError
    log.reportIssue({
      message: `An equation of ${nameOf(equation.source)} has a number in units CellML can't use: ${units ? failure.message : String(failure)}`,
      ...(units ? { stage: 'units' } : {}),
      subject: equation.source,
      cause: failure,
    })
    return undefined
  }
  return text
}
