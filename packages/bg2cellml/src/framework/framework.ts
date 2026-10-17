/**
 * The BG-RDF framework: physical domains, element templates, junction
 * structures and composite templates, read from the BG-RDF ontology and
 * templates. Ported from `bondgraph/framework.py` and `framework_support.py`.
 */

import type { Equation } from '@physiomelinks/math-ast'

import { IssueLog } from '../issues.js'
import type { RdfGraph } from '../rdf/graph.js'

/** A variable declared by a domain or template. `units` and `value` are UCUM. */
export interface VariableDefinition {
  readonly name: string
  readonly units?: string
  readonly value?: { readonly magnitude: number; readonly units: string }
  readonly type?: string
}

export interface Domain {
  readonly iri: string
  readonly label?: string
  readonly flow: VariableDefinition
  readonly potential: VariableDefinition
  readonly quantity: VariableDefinition
  readonly constants: readonly VariableDefinition[]
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
   * To do: port `__load_templates`, `Domain.from_rdf_graph` and `ElementTemplate.from_rdf_graph`.
   */
  static fromGraph(_graph: RdfGraph): BondgraphFramework {
    throw new Error('BondgraphFramework.fromGraph() is not implemented yet')
  }

  /** The template for an element's type, in its domain if one is given. Composite templates are checked first. */
  elementTemplate(_elementType: string, _domain?: string): ElementTemplate | CompositeTemplate | undefined {
    throw new Error('BondgraphFramework.elementTemplate() is not implemented yet')
  }
}
