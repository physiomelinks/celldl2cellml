/**
 * A model's own names for its variables in the CellML: BG-RDF's
 * `bgf:NamingRule` and `bgf:VariableName`, as physiomelinks/BG-RDF defines
 * them. Ported from Finbar Argus's `bg2cellml/variable_names.py` (BG-Tools
 * feat/constitutive-laws), whose rules the CellDL Editor's Variables panel
 * previews (`src/plugins/bondgraph/naming.ts`).
 *
 * By default a variable is named after its element: `q_G6P_c`, `u_q_G6P_c`,
 * `v_Re_HK_c`. A rule names one variable (`bgf:forVariable`, the template's
 * name for it: q, u, v, u_f, K, kappa, ...) of the elements of one class
 * (`bgf:forElementClass`, such as `bgf:QuantityStore`; every class without
 * one) in one domain (`bgf:forDomain`; every domain without one) by a pattern
 * (`bgf:namePattern`). An element may name one of its variables explicitly
 * (`bgf:hasVariableName`), which wins over any rule. Of the rules for a
 * variable, the one for the element's class and domain wins, then its class,
 * then its domain, then neither.
 *
 * A pattern's placeholders are `{species}`, `{location}`, `{name}` (the
 * species, else the element's identifier), `{element}` (the bond graph's name
 * for the element, such as `q_G6P_c`), `{label}` (its symbol, such as `q`) and
 * `{var}`; an unknown one is left out. A name keeps letters, digits and `_`
 * (anything else becomes `_`), drops repeated and surrounding `_`, and starts
 * with `{var}_` if it would start with a digit.
 *
 * Differences from `variable_names.py`:
 * - Only renamed variables are numbered. Python claims every variable's name
 *   in the order of the elements' identifiers, so a variable no rule names
 *   could become `_2` because an earlier one was renamed to its name; here a
 *   renamed variable gets `_2`, `_3`, ... instead, and that is reported.
 * - An explicit name that isn't a CellML name as given, a rule naming a
 *   variable its element doesn't have, and every clash are reported, with the
 *   element's `elementId`.
 * - A variable two elements share (one element's value given as another's
 *   intrinsic variable) is named by its own element's rules.
 */

import { substitute, type Equation } from '@physiomelinks/math-ast'

import { VOI_NAME } from '../framework/templates.js'
import type { IssueLog } from '../issues.js'
import type { RdfGraph } from '../rdf/graph.js'
import { curie, fragment } from '../rdf/namespaces.js'
import { iri } from '../rdf/queries.js'
import type { BondgraphElement, ModelVariable } from './elements.js'
import type { BondgraphJunction } from './junctions.js'
import type { ModelEquation } from './equations.js'
import { prettyName } from './names.js'

export interface NamingRule {
  /** The element class's IRI, such as `bgf:QuantityStore`'s; every class when absent. */
  readonly elementClass?: string
  /** The physical domain's IRI; every domain when absent. */
  readonly domain?: string
  /** The template's name for the variable: q, u, v, u_f, K, kappa, ... */
  readonly variable: string
  readonly pattern: string
}

/** What a pattern's placeholders are filled with. */
export interface PatternValues {
  readonly var: string
  readonly element: string
  readonly label: string
  readonly species: string
  readonly location: string
  readonly name: string
}

/** A name as CellML allows it: letters, digits and `_`, no repeated or surrounding `_`, not starting with a digit. */
export function validName(name: string, variable: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned === '') return variable
  return /^[0-9]/.test(cleaned) ? `${variable}_${cleaned}` : cleaned
}

/** A pattern with its placeholders filled, as a valid name. */
export function renderPattern(pattern: string, values: PatternValues): string {
  const filled = pattern.replace(/\{(\w+)\}/g, (_, key: string) => (values as unknown as Record<string, string>)[key] ?? '')
  return validName(filled, values.var)
}

/** The most specific rule for a variable: for the element's class and domain, its class, its domain, or neither. */
export function ruleFor(rules: readonly NamingRule[], elementClass: string, domain: string, variable: string): NamingRule | undefined {
  const rank = (rule: NamingRule): number => (rule.elementClass === undefined ? 0 : 2) + (rule.domain === undefined ? 0 : 1)
  let best: NamingRule | undefined
  for (const rule of rules) {
    if (rule.variable !== variable) continue
    if (rule.elementClass !== undefined && rule.elementClass !== elementClass) continue
    if (rule.domain !== undefined && rule.domain !== domain) continue
    if (best === undefined || rank(rule) > rank(best)) best = rule
  }
  return best
}

//==============================================================================

const namingRulesQuery = (model: string): string => `
    SELECT DISTINCT ?rule ?class ?domain ?variable ?pattern
    WHERE {
        ${iri(model)} bgf:hasNamingRule ?rule .
        ?rule bgf:forVariable ?variable ;
              bgf:namePattern ?pattern .
        OPTIONAL { ?rule bgf:forElementClass ?class }
        OPTIONAL { ?rule bgf:forDomain ?domain }
    }`

const variableNamesQuery = (model: string): string => `
    SELECT DISTINCT ?element ?variable ?name
    WHERE {
        ${iri(model)} bgf:hasBondElement ?element .
        ?element bgf:hasVariableName ?given .
        ?given bgf:forVariable ?variable ;
               bgf:cellmlName ?name .
    }`

const elementPartsQuery = (model: string): string => `
    SELECT DISTINCT ?uri ?symbol ?species ?location
    WHERE {
        ${iri(model)} bgf:hasBondElement ?uri .
        OPTIONAL { ?uri bgf:hasSymbol ?symbol }
        OPTIONAL { ?uri bgf:hasSpecies ?species }
        OPTIONAL { ?uri bgf:hasLocation ?location }
    }`

/** The model's naming rules, in a stable order. */
export function namingRules(graph: RdfGraph, model: string): NamingRule[] {
  return graph
    .select(namingRulesQuery(model))
    .map((row): NamingRule => {
      const elementClass = row.get('class')?.value
      const domain = row.get('domain')?.value
      return {
        ...(elementClass === undefined ? {} : { elementClass }),
        ...(domain === undefined ? {} : { domain }),
        variable: row.get('variable')!.value,
        pattern: row.get('pattern')!.value,
      }
    })
    .sort((a, b) => key(a).localeCompare(key(b)))
}

const key = (rule: NamingRule): string => `${rule.elementClass ?? ''}|${rule.domain ?? ''}|${rule.variable}|${rule.pattern}`

interface NamingContext {
  readonly graph: RdfGraph
  readonly log: IssueLog
  readonly elements: ReadonlyMap<string, BondgraphElement>
  readonly junctions: ReadonlyMap<string, BondgraphJunction>
  readonly equations: ModelEquation[]
}

/** One variable's naming: whose it is, what it was called, and what the model wants it called. */
interface Wanted {
  readonly element: BondgraphElement
  readonly variable: ModelVariable
  /** The template's name for it. */
  readonly name: string
  readonly old: string
  readonly wanted: string
  readonly how: string
}

/**
 * Rename the model's element variables by its naming rules and explicit
 * names, once its equations are built: each variable's `symbol`, and every
 * equation using it. Returns each renamed variable's bond graph name and its
 * new name; empty when the model names nothing its own way.
 */
export function applyNaming(model: string, context: NamingContext): Map<string, string> {
  const { graph, log, elements, junctions } = context
  const rules = namingRules(graph, model)
  const given = new Map<string, Map<string, string>>()
  for (const row of graph.select(variableNamesQuery(model))) {
    const element = row.get('element')!.value
    const variable = row.get('variable')!.value
    const names = given.get(element) ?? new Map<string, string>()
    const name = row.get('name')!.value
    if (names.has(variable) && names.get(variable) !== name) {
      log.reportIssue({ message: `Element ${prettyName(elements.get(element)?.symbol ?? fragment(element), element)} has more than one bgf:cellmlName for ${variable}`, severity: 'warning', subject: element })
      continue
    }
    given.set(element, names.set(variable, name))
  }
  if (rules.length === 0 && given.size === 0) return new Map()

  const parts = new Map<string, { label: string; species: string; location: string }>()
  for (const row of graph.select(elementPartsQuery(model))) {
    parts.set(row.get('uri')!.value, {
      label: row.get('symbol')?.value ?? '',
      species: row.get('species')?.value ?? '',
      location: row.get('location')?.value ?? '',
    })
  }

  // Each variable is named by its own element: a store's q, even where another element's value is it
  const owners = new Map<ModelVariable, BondgraphElement>()
  for (const element of elements.values()) if (element.intrinsicVariable !== undefined) owners.set(element.intrinsicVariable, element)
  for (const element of elements.values()) for (const variable of element.variables.values()) if (!owners.has(variable)) owners.set(variable, element)

  // In the order of the elements' identifiers, as Python and the editor go
  const ordered = [...elements.values()].sort((a, b) => compare(fragment(a.iri), fragment(b.iri)) || compare(a.iri, b.iri))
  const wanted: Wanted[] = []
  for (const element of ordered) {
    const identifier = fragment(element.iri)
    const ownNames = given.get(element.iri)
    for (const name of ownNames?.keys() ?? []) {
      if (!element.variables.has(name)) {
        log.reportIssue({ message: `Element ${element.prettyName} has no variable ${name} to give the name ${ownNames!.get(name)}`, severity: 'warning', subject: element.iri })
      }
    }
    for (const [name, variable] of element.variables) {
      if (owners.get(variable) !== element) continue
      const explicit = ownNames?.get(name)
      let chosen: string
      let how: string
      if (explicit !== undefined) {
        chosen = validName(explicit, name)
        how = `its bgf:cellmlName ${JSON.stringify(explicit)}`
        if (chosen !== explicit) {
          log.reportIssue({
            message: `Element ${element.prettyName} names ${name} ${JSON.stringify(explicit)}, which isn't a CellML name: it is named ${chosen}`,
            severity: 'warning',
            subject: element.iri,
          })
        }
      } else {
        const rule = ruleFor(rules, element.elementClass, element.domain.iri, name)
        if (rule === undefined) continue
        const { label, species, location } = parts.get(element.iri) ?? { label: '', species: '', location: '' }
        chosen = renderPattern(rule.pattern, { var: name, element: element.symbol, label, species, location, name: species || identifier })
        how = `the rule ${JSON.stringify(rule.pattern)}`
      }
      wanted.push({ element, variable, name, old: variable.symbol, wanted: chosen, how })
    }
  }

  // Names that stay: time, the domains' constants, junctions' variables, and the variables not renamed
  const renamedVariables = new Set(wanted.filter((w) => w.wanted !== w.old).map((w) => w.variable))
  const taken = new Map<string, string>([[VOI_NAME, `the variable of integration`]])
  for (const element of elements.values()) {
    for (const constant of element.domain.constants) taken.set(constant.name, `the constant ${constant.name} of ${curie(element.domain.iri)}`)
  }
  for (const element of ordered) {
    for (const variable of element.variables.values()) {
      if (!renamedVariables.has(variable) && !taken.has(variable.symbol)) taken.set(variable.symbol, `variable ${variable.symbol} of ${element.prettyName}`)
    }
  }
  for (const junction of junctions.values()) {
    for (const variable of junction.variables.values()) {
      if (!renamedVariables.has(variable) && !taken.has(variable.symbol)) taken.set(variable.symbol, `variable ${variable.symbol} of junction ${junction.prettyName}`)
    }
  }

  const renamed = new Map<string, string>()
  for (const { element, variable, name, old, wanted: want, how } of wanted) {
    if (want === old) continue
    // A symbol two variables share is renamed once, by the first to want it
    if (renamed.has(old)) {
      if (renamed.get(old) !== want) {
        log.reportIssue({
          message: `Variable ${name} of element ${element.prettyName} is named ${renamed.get(old)}, not ${want} (by ${how}), as it is ${old}, which is already renamed`,
          severity: 'warning',
          subject: element.iri,
        })
      }
      continue
    }
    let final = want
    for (let n = 2; taken.has(final); n += 1) final = `${want}_${n}`
    if (final !== want) {
      log.reportIssue({
        message: `Variable ${name} of element ${element.prettyName} is named ${final}, not ${want} (by ${how}), as ${want} is taken by ${taken.get(want)}`,
        severity: 'warning',
        subject: element.iri,
      })
    }
    taken.set(final, `variable ${name} of ${element.prettyName}`)
    renamed.set(old, final)
  }
  if (renamed.size === 0) return renamed

  // Every variable with a renamed symbol, as they are one variable in the CellML
  const renameVariable = (variable: ModelVariable): void => {
    const final = renamed.get(variable.symbol)
    if (final !== undefined) variable.symbol = final
  }
  const seen = new Set<ModelVariable>()
  for (const holder of [...elements.values(), ...junctions.values()]) {
    for (const variable of holder.variables.values()) {
      if (!seen.has(variable)) renameVariable(variable)
      seen.add(variable)
    }
  }
  for (const element of elements.values()) {
    for (const port of element.ports.values()) {
      for (const variable of [port.flow, port.potential]) {
        if (!seen.has(variable)) renameVariable(variable)
        seen.add(variable)
      }
    }
  }

  // Equations hold symbols; rename them all at once, so names can be swapped
  const rename = (equation: Equation): Equation => substitute(equation, renamed) as Equation
  for (const element of elements.values()) {
    if (element.constitutiveRelation !== undefined) element.constitutiveRelation = element.constitutiveRelation.map(rename)
    element.equations.splice(0, element.equations.length, ...element.equations.map(rename))
  }
  for (const junction of junctions.values()) junction.equations.splice(0, junction.equations.length, ...junction.equations.map(rename))
  context.equations.splice(0, context.equations.length, ...context.equations.map((entry) => ({ ...entry, equation: rename(entry.equation) })))
  return renamed
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
