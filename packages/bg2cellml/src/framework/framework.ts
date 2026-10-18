/**
 * The BG-RDF framework: physical domains, element templates, junction
 * structures and composite templates, read from the BG-RDF ontology and
 * templates. Ported from `bondgraph/framework.py` and `framework_support.py`.
 */

import { compatible, type LibCellML } from '@physiomelinks/cellml-units'
import type { ParseOptions } from '@physiomelinks/math-ast'

import { IssueLog } from '../issues.js'
import type { RdfGraph, ResultRow } from '../rdf/graph.js'
import { BGF, fragment } from '../rdf/namespaces.js'
import { DECLARED_DOMAINS, DOMAIN_QUERY, ELEMENT_TEMPLATE_DEFINITIONS, domainConstantsQuery } from '../rdf/queries.js'
import { elementTemplateFromRow, type ElementTemplate, type TemplateOptions } from './templates.js'
import { DeclarationError, makeVariable, type VariableDefinition } from './variables.js'

export type { ElementTemplate, PortTemplate } from './templates.js'
export type { Value, VariableDefinition } from './variables.js'

/** What loading the framework needs from the host: libCellML, and an XML parser where there's no `DOMParser`. */
export interface FrameworkRuntime {
  readonly libcellml: LibCellML
  readonly domParser?: ParseOptions['domParser']
}

export interface Domain {
  readonly iri: string
  /** The IRI's fragment, such as `Chemical`; Python's `Domain.name`. */
  readonly name: string
  readonly label?: string
  readonly flow: VariableDefinition
  readonly potential: VariableDefinition
  readonly quantity: VariableDefinition
  readonly constants: readonly VariableDefinition[]
  /** The flow, potential and quantity names, such as `v`, `u` and `q`. */
  readonly intrinsicSymbols: readonly string[]
}

export interface CompositeTemplate {
  readonly iri: string
  readonly label?: string
  readonly template: ElementTemplate
}

export interface JunctionStructure {
  readonly iri: string
  readonly label?: string
}

export class BondgraphFramework {
  readonly log = new IssueLog()
  readonly domains = new Map<string, Domain>()
  readonly elementTemplates = new Map<string, ElementTemplate>()
  readonly compositeTemplates = new Map<string, CompositeTemplate>()
  readonly junctions = new Map<string, JunctionStructure>()

  /**
   * Build the framework from a graph holding the ontology and templates.
   * Problems are reported in `log` rather than thrown.
   *
   * Junctions and composites are to come (chunk 4.3).
   */
  static fromGraph(graph: RdfGraph, runtime: FrameworkRuntime): BondgraphFramework {
    const framework = new BondgraphFramework()
    framework.#loadDomains(graph)
    framework.#loadElementTemplates(graph, {
      compatible: (a, b) => compatible(runtime.libcellml, a, b),
      ...(runtime.domParser === undefined ? {} : { domParser: runtime.domParser }),
    })
    return framework
  }

  /**
   * Each domain's flow, potential and quantity, and its constants. A domain
   * with a problem is reported and left out, rather than failing the whole
   * framework as in Python.
   */
  #loadDomains(graph: RdfGraph): void {
    const rows = new Map<string, ResultRow[]>()
    for (const row of graph.select(DOMAIN_QUERY)) {
      const iri = row.get('domain')!.value
      rows.set(iri, [...(rows.get(iri) ?? []), row])
    }

    for (const [iri, [row, ...others]] of rows) {
      if (others.length > 0) {
        this.log.report(`Domain <${iri}> has more than one flow, potential, quantity or label`, iri)
        continue
      }
      try {
        this.domains.set(iri, domainFromRow(graph, iri, row!))
      } catch (error) {
        if (!(error instanceof DeclarationError)) throw error
        this.log.report(error.message, iri)
      }
    }

    for (const declared of graph.select(DECLARED_DOMAINS)) {
      const iri = declared.get('domain')!.value
      if (!rows.has(iri)) {
        this.log.report(`Domain <${iri}> needs a flow, a potential and a quantity, each with a bgf:varName and bgf:hasUnits`, iri)
      }
    }
  }

  /**
   * Each element template with its ports, parameters, variables and
   * constitutive relation. As with domains, a template with a problem is
   * reported and left out.
   */
  #loadElementTemplates(graph: RdfGraph, options: TemplateOptions): void {
    const rows = new Map<string, ResultRow[]>()
    for (const row of graph.select(ELEMENT_TEMPLATE_DEFINITIONS)) {
      const iri = row.get('uri')!.value
      rows.set(iri, [...(rows.get(iri) ?? []), row])
    }

    for (const [iri, [row, ...others]] of rows) {
      if (others.length > 0) {
        this.log.report(`<${iri}> has more than one element class, domain, constitutive relation or label`, iri)
        continue
      }
      const domainIri = row!.get('domain')!.value
      const domain = this.domains.get(domainIri)
      if (domain === undefined) {
        this.log.report(`Unknown domain <${domainIri}> for <${iri}> element`, iri)
        continue
      }
      try {
        this.elementTemplates.set(iri, elementTemplateFromRow(graph, row!, domain, options))
      } catch (error) {
        if (!(error instanceof DeclarationError)) throw error
        this.log.report(error.message, iri)
      }
    }
  }

  /** The template for an element's type, in its domain if one is given. Composite templates are checked first. */
  elementTemplate(_elementType: string, _domain?: string): ElementTemplate | CompositeTemplate | undefined {
    throw new Error('BondgraphFramework.elementTemplate() is not implemented yet')
  }
}

//==============================================================================

/** A domain from a row of `DOMAIN_QUERY`, with its constants. Throws a `DeclarationError` for a bad declaration. */
function domainFromRow(graph: RdfGraph, iri: string, row: ResultRow): Domain {
  const variable = (kind: 'flow' | 'potential' | 'quantity', type: string): VariableDefinition =>
    makeVariable(iri, row.get(`${kind}Name`)!.value, { units: row.get(`${kind}Units`)!, type })
  const flow = variable('flow', BGF.FlowVariable)
  const potential = variable('potential', BGF.PotentialVariable)
  const quantity = variable('quantity', BGF.QuantityVariable)

  const constants: VariableDefinition[] = []
  for (const constant of graph.select(domainConstantsQuery(iri))) {
    const defined = makeVariable(iri, constant.get('name')!.value, { value: constant.get('value')! })
    if (constants.some((other) => other.name === defined.name)) {
      throw new DeclarationError(`Domain <${iri}> has more than one constant named ${defined.name}`)
    }
    constants.push(defined)
  }

  const label = row.get('label')?.value
  return {
    iri,
    name: fragment(iri),
    ...(label === undefined ? {} : { label }),
    flow,
    potential,
    quantity,
    constants,
    intrinsicSymbols: [flow.name, potential.name, quantity.name],
  }
}

