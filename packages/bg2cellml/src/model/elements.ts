/**
 * The bond elements of a model, as `BondgraphElement` in Python's
 * `model_support.py` builds them, before the bond network exists. Values are
 * read here; assigning them to variables, converting their units and
 * substituting symbols into the constitutive relation come once the network
 * is built.
 */

import type { Equation, ParseOptions } from '@physiomelinks/math-ast'

import {
  elementTemplateOf,
  isCompositeTemplate,
  type BondgraphElementTemplate,
  type BondgraphFramework,
  type Domain,
  type ElementTemplate,
  type PortTemplate,
} from '../framework/framework.js'
import { readEquations } from '../framework/templates.js'
import { DeclarationError, readValue, type CompatibleUnits, type Value, type VariableDefinition } from '../framework/variables.js'
import type { IssueLog } from '../issues.js'
import type { RdfGraph, ResultRow, Term } from '../rdf/graph.js'
import { BGF, NAMESPACES, curie } from '../rdf/namespaces.js'
import {
  elementParameterValuesQuery,
  elementStateValueQuery,
  elementVariableValuesQuery,
  modelElementsQuery,
} from '../rdf/queries.js'
import { elementVariableName, makeSymbolicName, prettyName } from './names.js'
import { groupRows } from './rows.js'

/**
 * A variable of a model element or junction. Its `name` is fixed when it is
 * made; its symbol, the name used in equations and CellML, can be given by
 * the model (`bgf:hasSymbol`) and defaults to the name.
 */
export class ModelVariable {
  readonly name: string
  readonly units: string
  readonly type?: string
  value?: Value
  #symbol: string | undefined

  constructor(definition: VariableDefinition, name: string = definition.name) {
    this.name = name
    this.units = definition.units
    if (definition.type !== undefined) this.type = definition.type
    if (definition.value !== undefined) this.value = definition.value
  }

  get symbol(): string {
    return this.#symbol ?? this.name
  }

  set symbol(symbol: string) {
    this.#symbol = symbol
  }
}

/** A port of an element, by which bonds connect to it. */
export interface ElementPort {
  /** The port's id in the bond network: the element's IRI, with `_` and the port id if the template names its ports. */
  readonly iri: string
  readonly template: PortTemplate
  /** The port's flow. A flow source's is its intrinsic variable. */
  flow: ModelVariable
  /** The port's potential. A potential source's is its intrinsic variable. */
  potential: ModelVariable
}

/**
 * A value the model gives a parameter or variable, as read: a number with
 * any units it was given, or another element whose intrinsic variable to
 * use. Either may give the variable a symbol.
 */
export type ValueAssignment =
  | { readonly value: Value; readonly element?: never; readonly symbol?: string }
  | { readonly element: string; readonly value?: never; readonly symbol?: string }

/** What making elements needs from the model. */
export interface ElementContext {
  readonly framework: BondgraphFramework
  readonly graph: RdfGraph
  readonly log: IssueLog
  readonly compatible: CompatibleUnits
  readonly domParser?: ParseOptions['domParser']
}

const SOURCES = new Set<string>([BGF.FlowSource, BGF.PotentialSource])

export class BondgraphElement {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
  /** The template the element's type gave: an element template or a composite of one. */
  readonly template: BondgraphElementTemplate
  /** The element template itself; for a composite, the one it wraps. */
  readonly elementTemplate: ElementTemplate
  readonly elementClass: string
  readonly domain: Domain
  /**
   * The junction a source or composite element acts as: a potential source
   * or a composite store a zero node, a flow source or a composite resistance
   * or reaction a one node.
   */
  readonly impliedJunction?: string
  /** By the port's id in the bond network. */
  readonly ports = new Map<string, ElementPort>()
  /** By name as the template declares it: the ports' flow and potentials, parameters, variables and intrinsic variable. */
  readonly variables = new Map<string, ModelVariable>()
  /** Names in `variables` that belong to ports. */
  readonly portVariableNames = new Set<string>()
  /** Parameter and variable values, as read. */
  readonly values = new Map<string, ValueAssignment>()
  /** A store's or source's own variable: a capacitor's `q`, a voltage source's `u`. */
  readonly intrinsicVariable?: ModelVariable
  /** The domain's flow among `variables`, if the element has one. */
  readonly flow?: ModelVariable
  /** The domain's potential among `variables`, if the element has one. */
  readonly potential?: ModelVariable
  /**
   * The template's, or for a source, the MathML the model gives as its value.
   * Its names are still the template's.
   */
  readonly constitutiveRelation?: readonly Equation[]

  constructor(
    iri: string,
    template: BondgraphElementTemplate,
    options: { symbol: string; label?: string; values?: ReadonlyMap<string, ValueAssignment>; state?: Value; relation?: readonly Equation[] },
  ) {
    this.iri = iri
    this.symbol = options.symbol
    if (options.label !== undefined) this.label = options.label
    this.template = template
    this.elementTemplate = elementTemplateOf(template)
    this.elementClass = this.elementTemplate.elementClass
    this.domain = this.elementTemplate.domain
    const implied = impliedJunction(this.elementClass, isCompositeTemplate(template))
    if (implied !== undefined) this.impliedJunction = implied

    const relation = SOURCES.has(this.elementClass) ? options.relation : this.elementTemplate.constitutiveRelation
    if (relation !== undefined) this.constitutiveRelation = relation

    // Python copies the flow for each port; here ports share it, as they share its name
    for (const [id, port] of this.elementTemplate.ports) {
      const iri = id === '' ? this.iri : `${this.iri}_${id}`
      this.ports.set(iri, { iri, template: port, flow: this.#portVariable(port.flow), potential: this.#portVariable(port.potential) })
    }
    for (const definitions of [this.elementTemplate.parameters, this.elementTemplate.variables]) {
      for (const [name, definition] of definitions) this.variables.set(name, this.#copy(definition))
    }
    if (options.values !== undefined) for (const [name, value] of options.values) this.values.set(name, value)

    const intrinsic = this.elementTemplate.intrinsicVariable
    if (intrinsic !== undefined) {
      this.intrinsicVariable = this.#copy(intrinsic)
      this.variables.set(intrinsic.name, this.intrinsicVariable)
      const port = this.ports.get(this.iri)
      if (port !== undefined && this.elementClass === BGF.FlowSource) port.flow = this.intrinsicVariable
      if (port !== undefined && this.elementClass === BGF.PotentialSource) port.potential = this.intrinsicVariable
      // A value with no units takes the variable's
      if (options.state !== undefined) this.intrinsicVariable.value = { units: this.intrinsicVariable.units, ...options.state }
    }

    const flow = this.variables.get(this.domain.flow.name)
    if (flow !== undefined) this.flow = flow
    const potential = this.variables.get(this.domain.potential.name)
    if (potential !== undefined) this.potential = potential
  }

  /** `symbol (#fragment)`, for messages. */
  get prettyName(): string {
    return prettyName(this.symbol, this.iri)
  }

  #copy(definition: VariableDefinition): ModelVariable {
    return new ModelVariable(definition, elementVariableName(definition.name, this.symbol, this.domain))
  }

  #portVariable(definition: VariableDefinition): ModelVariable {
    let variable = this.variables.get(definition.name)
    if (variable === undefined) {
      variable = this.#copy(definition)
      this.variables.set(definition.name, variable)
      this.portVariableNames.add(definition.name)
    }
    return variable
  }
}

function impliedJunction(elementClass: string, composite: boolean): string | undefined {
  if (composite) {
    if (elementClass === BGF.QuantityStore || elementClass === BGF.FlowStore) return BGF.ZeroNode
    if (elementClass === BGF.Resistance || elementClass === BGF.Reaction) return BGF.OneNode
    return undefined
  }
  if (elementClass === BGF.PotentialSource) return BGF.ZeroNode
  if (elementClass === BGF.FlowSource) return BGF.OneNode
  return undefined
}

//==============================================================================

/**
 * The model's bond elements, by IRI in IRI order, as Python's `__initialise`
 * finds them. Each element's `bgf:` type, with its `bgf:hasDomain` if it has
 * one, must give exactly one template. Problems are reported in the log.
 */
export function loadElements(model: string, context: ElementContext): Map<string, BondgraphElement> {
  const elements = new Map<string, BondgraphElement>()
  for (const [iri, rows] of groupRows(context.graph.select(modelElementsQuery(model)), 'uri')) {
    const element = elementFromRows(iri, rows, context)
    if (element !== undefined) elements.set(iri, element)
  }
  return elements
}

/** The single value of `name` in a group of rows; throws if there are several. */
function single(iri: string, rows: readonly ResultRow[], name: string, what: string): string | undefined {
  const values = [...new Set(rows.flatMap((row) => (row.has(name) ? [row.get(name)!.value] : [])))]
  if (values.length > 1) throw new DeclarationError(`Element <${iri}> has more than one ${what}`)
  return values[0]
}

function elementFromRows(iri: string, rows: readonly ResultRow[], context: ElementContext): BondgraphElement | undefined {
  const { framework, log } = context
  let symbol: string
  let label: string | undefined
  let domain: string | undefined
  try {
    const given = single(iri, rows, 'symbol', 'bgf:hasSymbol')
    const species = single(iri, rows, 'species', 'bgf:hasSpecies')
    const location = single(iri, rows, 'location', 'bgf:hasLocation')
    symbol = makeSymbolicName({
      iri,
      ...(given === undefined ? {} : { symbol: given }),
      ...(species === undefined ? {} : { species }),
      ...(location === undefined ? {} : { location }),
    })
    label = single(iri, rows, 'label', 'rdfs:label')
    domain = single(iri, rows, 'domain', 'bgf:hasDomain')
  } catch (error) {
    if (!(error instanceof DeclarationError)) throw error
    log.report(error.message, iri)
    return undefined
  }
  const name = prettyName(symbol, iri)

  // Python ignores types outside bgf:, such as owl:NamedIndividual
  const types = [...new Set(rows.map((row) => row.get('type')!.value))].filter((type) => type.startsWith(NAMESPACES.bgf)).sort()
  const templates = new Map<string, BondgraphElementTemplate>()
  for (const type of types) {
    const template = framework.elementTemplate(type, domain)
    if (template !== undefined) templates.set(template.iri, template)
  }
  if (templates.size === 0) {
    const ambiguous = domain === undefined ? undefined : types.find((type) => framework.templatesOfClass(type, domain).length > 1)
    if (ambiguous !== undefined) {
      log.report(`Element ${name}: ${framework.templateIssue(ambiguous, domain!)}`, iri)
    } else if (types.length === 0) {
      log.report(`Element ${name} has no bgf: type`, iri)
    } else {
      const inDomain = domain === undefined ? '' : ` in ${curie(domain)}`
      log.report(`${types.map(curie).join(', ')} element ${name} is not instantiated: there is no template for it${inDomain}`, iri)
    }
    return undefined
  }
  if (templates.size > 1) {
    log.report(`Element ${name} has more than one template: ${[...templates.keys()].map(curie).join(', ')}`, iri)
    return undefined
  }
  const template = [...templates.values()][0]!
  return makeElement(iri, template, { symbol, ...(label === undefined ? {} : { label }) }, context)
}

/** An element and its values, as Python's `BondgraphElement.for_model`. */
function makeElement(
  iri: string,
  template: BondgraphElementTemplate,
  naming: { symbol: string; label?: string },
  context: ElementContext,
): BondgraphElement {
  const { graph, log } = context
  const elementTemplate = elementTemplateOf(template)
  const name = prettyName(naming.symbol, iri)

  const parameterValues = readAssignments(graph.select(elementParameterValuesQuery(iri)), iri, name, log)
  const variableValues = readAssignments(graph.select(elementVariableValuesQuery(iri)), iri, name, log)
  const { state, relation } = readState(graph.select(elementStateValueQuery(iri)), iri, name, elementTemplate, context)

  const element = new BondgraphElement(iri, template, {
    ...naming,
    // A variable value overrides a parameter value of the same name, as in Python
    values: new Map([...parameterValues, ...variableValues]),
    ...(state === undefined ? {} : { state }),
    ...(relation === undefined ? {} : { relation }),
  })

  for (const parameter of elementTemplate.parameters.keys()) {
    if (!parameterValues.has(parameter)) log.report(`Missing value for parameter ${parameter} of element ${name}`, iri)
  }
  // Python means to check variable values (`name not in name not in ...` never fires); this also checks parameter values
  for (const variable of variableValues.keys()) {
    if (!element.variables.has(variable)) log.report(`Unknown variable ${variable} for element ${name}`, iri)
  }
  for (const variable of parameterValues.keys()) {
    if (!element.variables.has(variable)) log.report(`Element ${name} has unknown name ${variable} for ${elementTemplate.iri}`, iri)
  }

  const intrinsic = element.intrinsicVariable
  if (state !== undefined && intrinsic !== undefined && state.units !== undefined && !compatible(context, intrinsic.units, state.units)) {
    log.report(`Value for variable ${intrinsic.name} has incompatible units (${intrinsic.units} != ${state.units})`, iri)
  }
  return element
}

function compatible(context: ElementContext, a: string, b: string): boolean {
  try {
    return a === b || context.compatible(a, b)
  } catch {
    return false
  }
}

/** `bgf:parameterValue`s or `bgf:variableValue`s, by name. Each name may have only one value and symbol. */
function readAssignments(rows: readonly ResultRow[], iri: string, element: string, log: IssueLog): Map<string, ValueAssignment> {
  const assignments = new Map<string, ValueAssignment>()
  const repeated = new Set<string>()
  for (const row of rows) {
    const name = row.get('name')!.value
    if (assignments.has(name) || repeated.has(name)) {
      if (!repeated.has(name)) log.report(`Element ${element} has more than one value or symbol for ${name}`, iri)
      repeated.add(name)
      assignments.delete(name)
      continue
    }
    const symbol = row.get('symbol')?.value
    const assignment = readAssignment(row.get('value')!, symbol, `${name} of element ${element}`)
    if (typeof assignment === 'string') log.report(assignment, iri)
    else assignments.set(name, assignment)
  }
  return assignments
}

/** A value, or the issue to report about it. */
function readAssignment(term: Term, symbol: string | undefined, context: string): ValueAssignment | string {
  const symbolPart = symbol === undefined ? {} : { symbol }
  if (term.termType === 'NamedNode') return { element: term.value, ...symbolPart }
  try {
    return { value: readValue(term), ...symbolPart }
  } catch (error) {
    if (error instanceof DeclarationError) return `${error.message}, for ${context}`
    throw error
  }
}

/**
 * The element's own `bgf:hasValue`: for a store or source, its intrinsic
 * variable's value, or for a source, MathML giving its constitutive relation.
 * Python takes the first literal and ignores any others, and ignores a value
 * an element has no use for; here both are reported.
 */
function readState(
  rows: readonly ResultRow[],
  iri: string,
  element: string,
  template: ElementTemplate,
  context: ElementContext,
): { state?: Value; relation?: readonly Equation[] } {
  const { log } = context
  if (rows.length === 0) return {}
  if (rows.length > 1) {
    log.report(`Element ${element} has more than one bgf:hasValue`, iri)
    return {}
  }
  const term = rows[0]!.get('value')!
  if (term.termType !== 'Literal') {
    log.report(`The bgf:hasValue of element ${element} must be a literal`, iri)
    return {}
  }
  if (term.datatype.value === BGF.mathml) {
    if (!SOURCES.has(template.elementClass)) {
      log.report(`Element ${element} has MathML as its value, but only a source can`, iri)
      return {}
    }
    try {
      return { relation: readEquations(term.value, `The value of element ${element}`, context.domParser === undefined ? {} : { domParser: context.domParser }) }
    } catch (error) {
      if (!(error instanceof DeclarationError)) throw error
      log.report(error.message, iri)
      return {}
    }
  }
  if (template.intrinsicVariable === undefined) {
    log.report(`Element ${element} has a value, but ${curie(template.iri)} has no intrinsic variable to give it to`, iri)
    return {}
  }
  const assignment = readAssignment(term, undefined, `element ${element}`)
  if (typeof assignment === 'string') {
    log.report(assignment, iri)
    return {}
  }
  return { state: assignment.value! }
}
