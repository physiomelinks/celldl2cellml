/**
 * The BG-RDF framework: physical domains, element templates, junction
 * structures and composite templates, read from the BG-RDF ontology and
 * templates. Ported from `bondgraph/framework.py` and `framework_support.py`.
 */

import type { Equation } from '@physiomelinks/math-ast'

import { IssueLog } from '../issues.js'
import type { RdfGraph, ResultRow } from '../rdf/graph.js'
import { BGF, fragment } from '../rdf/namespaces.js'
import { DECLARED_DOMAINS, DOMAIN_QUERY, domainConstantsQuery } from '../rdf/queries.js'
import { DeclarationError, makeVariable, type VariableDefinition } from './variables.js'

export type { Value, VariableDefinition } from './variables.js'

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

export interface PortTemplate {
  readonly id: string
  readonly direction?: 'inward' | 'outward'
  readonly bondCount: number
}

export interface ElementTemplate {
  readonly iri: string
  /** One of the `BGF` element classes, such as `bgf:Resistance`. */
  readonly elementClass: string
  readonly label?: string
  readonly domain: Domain
  readonly ports: readonly PortTemplate[]
  readonly parameters: readonly VariableDefinition[]
  readonly variables: readonly VariableDefinition[]
  /** Absent for flow and potential sources. */
  readonly constitutiveRelation?: readonly Equation[]
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
   * Element templates, junctions and composites are to come (chunks 4.2 and 4.3).
   */
  static fromGraph(graph: RdfGraph): BondgraphFramework {
    const framework = new BondgraphFramework()
    framework.#loadDomains(graph)
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

