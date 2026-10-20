/**
 * The BG-RDF framework: physical domains, element templates, junction
 * structures and composite templates, read from the BG-RDF ontology and
 * templates. Ported from `bondgraph/framework.py` and `framework_support.py`.
 */

import { compatible, type LibCellML } from '@physiomelinks/cellml-units'
import type { ParseOptions } from '@physiomelinks/math-ast'

import { IssueLog } from '../issues.js'
import type { RdfGraph, ResultRow } from '../rdf/graph.js'
import { BGF, curie, fragment } from '../rdf/namespaces.js'
import {
  COMPOSITE_TEMPLATE_DEFINITIONS,
  DECLARED_DOMAINS,
  DOMAIN_QUERY,
  ELEMENT_TEMPLATE_DEFINITIONS,
  FRAMEWORK_VERSION,
  JUNCTION_STRUCTURES,
  domainConstantsQuery,
} from '../rdf/queries.js'
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

/**
 * An element template combined with the junction an element of it implies,
 * such as `bgf:ChemicalStorageNode`: a `bgf:ChemicalConcentration` with a
 * zero node.
 */
export interface CompositeTemplate {
  readonly iri: string
  readonly label?: string
  readonly template: ElementTemplate
}

/**
 * A class of junction: `bgf:OneNode`, `bgf:ZeroNode`, `bgf:TransformNode`,
 * or anything else under `bgf:JunctionStructure`, as in Python.
 */
export interface JunctionStructure {
  readonly iri: string
  readonly label?: string
}

/** A template that `elementTemplate()` found: an element template, or a composite of one. */
export type BondgraphElementTemplate = ElementTemplate | CompositeTemplate

export function isCompositeTemplate(template: BondgraphElementTemplate): template is CompositeTemplate {
  return 'template' in template
}

/** The element template itself, for a composite or not. */
export function elementTemplateOf(template: BondgraphElementTemplate): ElementTemplate {
  return isCompositeTemplate(template) ? template.template : template
}

export class BondgraphFramework {
  readonly log = new IssueLog('framework')
  readonly domains = new Map<string, Domain>()
  readonly elementTemplates = new Map<string, ElementTemplate>()
  readonly compositeTemplates = new Map<string, CompositeTemplate>()
  readonly junctions = new Map<string, JunctionStructure>()
  /** The ontology's `owl:versionInfo`, such as `2026-04-12`, if it has one. */
  version?: string
  /** Element templates by element class and domain, as `${class} ${domain}`, in IRI order. */
  readonly #byClassAndDomain = new Map<string, ElementTemplate[]>()

  /**
   * Build the framework from a graph holding the ontology and templates.
   * Problems are reported in `log` rather than thrown.
   */
  static fromGraph(graph: RdfGraph, runtime: FrameworkRuntime): BondgraphFramework {
    const framework = new BondgraphFramework()
    const version = graph.select(FRAMEWORK_VERSION)[0]?.get('version')?.value
    if (version !== undefined) framework.version = version
    framework.#loadDomains(graph)
    framework.#loadElementTemplates(graph, {
      compatible: (a, b) => compatible(runtime.libcellml, a, b),
      ...(runtime.domParser === undefined ? {} : { domParser: runtime.domParser }),
    })
    framework.#loadJunctions(graph)
    framework.#loadCompositeTemplates(graph)
    return framework
  }

  /**
   * Each domain's flow, potential and quantity, and its constants. A domain
   * with a problem is reported and left out, rather than failing the whole
   * framework as in Python.
   */
  #loadDomains(graph: RdfGraph): void {
    const rows = groupRows(graph.select(DOMAIN_QUERY), 'domain')

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
    for (const [iri, [row, ...others]] of groupRows(graph.select(ELEMENT_TEMPLATE_DEFINITIONS), 'uri')) {
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
    for (const template of this.elementTemplates.values()) {
      const key = `${template.elementClass} ${template.domain.iri}`
      this.#byClassAndDomain.set(key, [...(this.#byClassAndDomain.get(key) ?? []), template])
    }
  }

  /**
   * Every class under `bgf:JunctionStructure`. As in Python, that includes
   * `bgf:JunctionStructure` itself and the composites' junction classes, such
   * as `bgf:ZeroStorageNode`, as well as one, zero and transform nodes.
   */
  #loadJunctions(graph: RdfGraph): void {
    for (const [iri, [row, ...others]] of groupRows(graph.select(JUNCTION_STRUCTURES), 'junction')) {
      if (others.length > 0) {
        this.log.report(`Junction <${iri}> has more than one label`, iri)
        continue
      }
      const label = row!.get('label')?.value
      this.junctions.set(iri, { iri, ...(label === undefined ? {} : { label }) })
    }
  }

  /** Composite templates, each with the element template it is a subclass of. */
  #loadCompositeTemplates(graph: RdfGraph): void {
    for (const [iri, [row, ...others]] of groupRows(graph.select(COMPOSITE_TEMPLATE_DEFINITIONS), 'uri')) {
      if (others.length > 0) {
        this.log.report(`Composite <${iri}> has more than one element template or label`, iri)
        continue
      }
      const templateIri = row!.get('template')!.value
      const template = this.elementTemplates.get(templateIri)
      if (template === undefined) {
        this.log.report(`Unknown BondElement <${templateIri}> for composite <${iri}>`, iri)
        continue
      }
      const label = row!.get('label')?.value
      this.compositeTemplates.set(iri, { iri, ...(label === undefined ? {} : { label }), template })
    }
  }

  /**
   * The template for an element's type, as Python's `element_template()`:
   *
   * - With no domain, `elementType` is a composite or an element template,
   *   such as `bgf:ChemicalStorageNode` or `bgf:ElectricalResistor`.
   *   Composites are checked first.
   * - With a domain, `elementType` is an element class, such as
   *   `bgf:Resistance` in `bgf:Electrical`. Where the domain has more than one
   *   template of that class, such as a `bgf:Reaction` in `bgf:Chemical`,
   *   nothing is found: `templatesOfClass()` gives the choices, for reporting.
   *   Python uses the last by IRI instead (here `bgf:NKETransporter`).
   */
  elementTemplate(elementType: string, domain?: string): BondgraphElementTemplate | undefined {
    if (domain !== undefined) {
      const templates = this.templatesOfClass(elementType, domain)
      return templates.length === 1 ? templates[0] : undefined
    }
    return this.compositeTemplates.get(elementType) ?? this.elementTemplates.get(elementType)
  }

  /** Every element template of a class in a domain, in IRI order. More than one makes `elementTemplate(class, domain)` ambiguous. */
  templatesOfClass(elementClass: string, domain: string): readonly ElementTemplate[] {
    return this.#byClassAndDomain.get(`${elementClass} ${domain}`) ?? []
  }

  /**
   * The issue to report when `elementTemplate(class, domain)` finds nothing:
   * that the class has no template in the domain, or more than one.
   * `undefined` when it finds one.
   */
  templateIssue(elementClass: string, domain: string): string | undefined {
    const templates = this.templatesOfClass(elementClass, domain)
    if (templates.length === 1) return undefined
    if (templates.length > 1) {
      const choices = templates.map((template) => curie(template.iri)).join(', ')
      return `${curie(elementClass)} in ${curie(domain)} is ambiguous: it could be ${choices}. Give the template instead.`
    }
    return `${curie(elementClass)} has no template in ${curie(domain)}`
  }

  /** A junction structure by IRI, such as `bgf:OneNode`. */
  junction(iri: string): JunctionStructure | undefined {
    return this.junctions.get(iri)
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

/** Query rows grouped by the IRI in `key`, in query order. */
function groupRows(rows: readonly ResultRow[], key: string): Map<string, ResultRow[]> {
  const groups = new Map<string, ResultRow[]>()
  for (const row of rows) {
    const iri = row.get(key)!.value
    groups.set(iri, [...(groups.get(iri) ?? []), row])
  }
  return groups
}

