/**
 * Element templates: what a kind of bond element has, and how it behaves.
 * Ported from `ElementTemplate` in `bondgraph/framework_support.py`.
 */

import { MathMLError, parseMathML, toEquations, variables, type Equation, type ParseOptions } from '@physiomelinks/math-ast'

import type { RdfGraph, ResultRow, Term } from '../rdf/graph.js'
import { BGF, xsd } from '../rdf/namespaces.js'
import { templateParametersQuery, templatePortBondsQuery, templateVariablesQuery } from '../rdf/queries.js'
import type { Domain } from './framework.js'
import { DeclarationError, copyVariable, makeVariable, type CompatibleUnits, type VariableDefinition } from './variables.js'

/** The variable of integration, `t`, which every constitutive relation may use. */
export const VOI_NAME = 't'

/** A port of an element template, through which it bonds to the rest of the model. */
export interface PortTemplate {
  /** `bgf:portId`; `''` for the single port of a template that declares none. */
  readonly id: string
  /** The template's IRI, with `_` and the id appended if there is one. */
  readonly iri: string
  /** `bgf:InwardPort` or `bgf:OutwardPort`; absent for the default port. */
  readonly direction?: string
  readonly bondCount: number
  /** The domain's flow, such as `v`. Ports share it, as in a reaction. */
  readonly flow: VariableDefinition
  /** The domain's potential, with the port id appended if there is one, such as `u_f`. */
  readonly potential: VariableDefinition
}

export interface ElementTemplate {
  readonly iri: string
  /** One of the `BGF` element classes, such as `bgf:Resistance`. */
  readonly elementClass: string
  /**
   * The template's `rdfs:label`. The Python version holds this as the
   * template's symbol, and has no label.
   */
  readonly label?: string
  readonly domain: Domain
  /** By id, in id order. */
  readonly ports: ReadonlyMap<string, PortTemplate>
  /** By name as declared. */
  readonly parameters: ReadonlyMap<string, VariableDefinition>
  readonly variables: ReadonlyMap<string, VariableDefinition>
  /** The domain variable a store or source holds: a quantity store's `q`, a potential source's `u`. */
  readonly intrinsicVariable?: VariableDefinition
  /** Absent for flow and potential sources. */
  readonly constitutiveRelation?: readonly Equation[]
}

/** What reading templates needs: libCellML's compatibility check, and an XML parser where there's no `DOMParser`. */
export interface TemplateOptions {
  readonly compatible: CompatibleUnits
  readonly domParser?: ParseOptions['domParser']
}

const SOURCES = new Set<string>([BGF.FlowSource, BGF.PotentialSource])

/**
 * A template from a row of `ELEMENT_TEMPLATE_DEFINITIONS`. Throws a
 * `DeclarationError` with the Python version's message for a bad template.
 */
export function elementTemplateFromRow(graph: RdfGraph, row: ResultRow, domain: Domain, options: TemplateOptions): ElementTemplate {
  const iri = row.get('uri')!.value
  const elementClass = row.get('element_class')!.value
  const label = row.get('label')?.value
  const constitutiveRelation = SOURCES.has(elementClass) ? undefined : readRelation(iri, row.get('relation'), options)

  const ports = readPorts(graph, iri, domain)
  const parameters = readVariables(graph, templateParametersQuery(iri), iri, domain, options)
  const declared = readVariables(graph, templateVariablesQuery(iri), iri, domain, options)
  const intrinsic = intrinsicVariable(elementClass, domain)

  const template: ElementTemplate = {
    iri,
    elementClass,
    ...(label === undefined ? {} : { label }),
    domain,
    ports,
    parameters,
    variables: declared,
    ...(intrinsic === undefined ? {} : { intrinsicVariable: intrinsic }),
    ...(constitutiveRelation === undefined ? {} : { constitutiveRelation }),
  }
  checkNames(template)
  return template
}

//==============================================================================

/**
 * The constitutive relation, from a `bgf:mathml` literal (or any literal, as
 * in Python). Each equation's left side must be a variable or a derivative.
 */
function readRelation(iri: string, relation: Term | undefined, options: TemplateOptions): Equation[] {
  if (relation === undefined || relation.termType !== 'Literal') {
    throw new DeclarationError(`BondElement ${iri} has no constitutive relation`)
  }
  try {
    const equations = toEquations(parseMathML(relation.value, options.domParser === undefined ? {} : { domParser: options.domParser }))
    for (const equation of equations) {
      if (equation.left.type !== 'Identifier' && equation.left.type !== 'Derivative') {
        throw new MathMLError([{ expression: equations.indexOf(equation), message: 'Unsupported form of equation: its left side must be a variable or a derivative' }])
      }
    }
    return equations
  } catch (error) {
    if (error instanceof MathMLError) throw new DeclarationError(`<${iri}>: ${error.message}`)
    throw error
  }
}

/**
 * Ports with a `bgf:portId` and `bgf:direction`, or a single port with id `''`
 * if there are none. A port's potential is the domain's with `_` and the id
 * appended; its flow is the domain's, shared by all ports.
 */
function readPorts(graph: RdfGraph, iri: string, domain: Domain): Map<string, PortTemplate> {
  const ports = new Map<string, PortTemplate>()
  let portNodes = 0
  for (const row of graph.select(templatePortBondsQuery(iri))) {
    const portId = row.get('portId')!
    // The query's first branch matches the port nodes themselves
    if (portId.termType !== 'Literal') {
      portNodes += 1
      continue
    }
    const id = portId.value
    if (ports.has(id)) throw new DeclarationError(`<${iri}> has more than one port with id ${id}`)
    const direction = row.get('direction')?.value
    ports.set(id, {
      id,
      iri: `${iri}_${id}`,
      ...(direction === undefined ? {} : { direction }),
      bondCount: bondCount(row.get('bondCount')),
      flow: copyVariable(domain.flow),
      potential: copyVariable(domain.potential, `${domain.potential.name}_${id}`),
    })
  }
  // Python silently drops a port with no id or direction
  if (portNodes > ports.size) throw new DeclarationError(`<${iri}> has a port without both a bgf:portId and a bgf:direction`)
  if (ports.size === 0) {
    ports.set('', { id: '', iri, bondCount: 1, flow: copyVariable(domain.flow), potential: copyVariable(domain.potential) })
  }
  return ports
}

/** `bgf:bondCount`, if it is an `xsd:integer`, otherwise 1, as Python's `optional_integer`. */
function bondCount(term: Term | undefined): number {
  return term?.termType === 'Literal' && term.datatype.value === xsd('integer') ? Number.parseInt(term.value, 10) : 1
}

/** Parameters or variables, by name as declared. None may reuse a domain's flow, potential or quantity name. */
function readVariables(
  graph: RdfGraph,
  query: string,
  iri: string,
  domain: Domain,
  options: TemplateOptions,
): Map<string, VariableDefinition> {
  const result = new Map<string, VariableDefinition>()
  for (const row of graph.select(query)) {
    const name = row.get('name')!.value
    if (domain.intrinsicSymbols.includes(name)) {
      throw new DeclarationError(`Cannot specify domain symbol ${name} as a variable for <${iri}>`)
    }
    if (result.has(name)) throw new DeclarationError(`Duplicate name \`${name}\` for <${iri}>`)
    const units = row.get('units')
    const value = row.get('value')
    result.set(
      name,
      makeVariable(iri, name, { ...(units === undefined ? {} : { units }), ...(value === undefined ? {} : { value }) }, options.compatible),
    )
  }
  return result
}

/** The domain variable a store or source holds. */
function intrinsicVariable(elementClass: string, domain: Domain): VariableDefinition | undefined {
  switch (elementClass) {
    case BGF.QuantityStore:
      return copyVariable(domain.quantity)
    case BGF.FlowStore:
    case BGF.FlowSource:
      return copyVariable(domain.flow)
    case BGF.PotentialSource:
      return copyVariable(domain.potential)
    default:
      return undefined
  }
}

/**
 * Python's `__check_names`: parameters and variables have distinct names, and
 * all appear in the constitutive relation, whose every name is declared by
 * the template, its ports or its domain, or is `t`.
 *
 * Python only checks that there are no more declared names than names in the
 * relation, so it can miss a parameter that isn't used. This checks each one.
 */
function checkNames(template: ElementTemplate): void {
  const declared: string[] = []
  for (const name of [...template.parameters.keys(), ...template.variables.keys()]) {
    if (declared.includes(name)) throw new DeclarationError(`Duplicate name \`${name}\` for <${template.iri}>`)
    declared.push(name)
  }

  const relation = template.constitutiveRelation ?? []
  const used = variables(...relation)
  const unused = declared.filter((name) => !used.includes(name))
  if (unused.length > 0) {
    throw new DeclarationError(`<${template.iri}> has variables that are not in its constitutive relation: ${unused.join(', ')}`)
  }

  const known = new Set([
    ...declared,
    ...[...template.ports.values()].flatMap((port) => [port.flow.name, port.potential.name]),
    ...template.domain.constants.map((constant) => constant.name),
    ...template.domain.intrinsicSymbols,
    VOI_NAME,
  ])
  const undeclared = used.find((name) => !known.has(name))
  if (undeclared !== undefined) {
    throw new DeclarationError(`Constitutive relation of <${template.iri}> has undeclared name ${undeclared}`)
  }
}
