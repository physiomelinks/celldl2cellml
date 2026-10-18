/** Namespaces used by BG-RDF. Ported from `bg2cellml/bondgraph/namespaces.py`. */
export const NAMESPACES = {
  bgf: 'https://bg-rdf.org/ontologies/bondgraph-framework#',
  cdt: 'https://w3id.org/cdt/',
  owl: 'http://www.w3.org/2002/07/owl#',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
} as const

export const BGF_ONTOLOGY_IRI = 'https://bg-rdf.org/ontologies/bondgraph-framework'
export const BGF_TEMPLATE_IRI_PREFIX = 'https://bg-rdf.org/templates/'
export const BGF_TEMPLATE_NAMES = ['chemical.ttl', 'electrical.ttl', 'hydraulic.ttl', 'mechanical.ttl'] as const

export const bgf = (local: string): string => `${NAMESPACES.bgf}${local}`
export const cdt = (local: string): string => `${NAMESPACES.cdt}${local}`
export const xsd = (local: string): string => `${NAMESPACES.xsd}${local}`

/** IRIs of the BG-RDF element and junction classes that the converter handles specially. */
export const BGF = {
  // Element classes
  FlowSource: bgf('FlowSource'),
  FlowStore: bgf('FlowStore'),
  PotentialSource: bgf('PotentialSource'),
  QuantityStore: bgf('QuantityStore'),
  Reaction: bgf('Reaction'),
  Resistance: bgf('Resistance'),
  // Junctions
  OneNode: bgf('OneNode'),
  ZeroNode: bgf('ZeroNode'),
  TransformNode: bgf('TransformNode'),
  // Variable types
  FlowVariable: bgf('FlowVariable'),
  PotentialVariable: bgf('PotentialVariable'),
  QuantityVariable: bgf('QuantityVariable'),
  // Ports
  InwardPort: bgf('InwardPort'),
  OutwardPort: bgf('OutwardPort'),
  // Model structure
  hasBondElement: bgf('hasBondElement'),
  hasJunctionStructure: bgf('hasJunctionStructure'),
  hasPowerBond: bgf('hasPowerBond'),
  // Datatypes
  mathml: bgf('mathml'),
} as const

export const CDT = {
  ucum: cdt('ucum'),
  ucumunit: cdt('ucumunit'),
} as const

/** SPARQL PREFIX lines for every namespace above. */
export const SPARQL_PREFIXES = Object.entries(NAMESPACES)
  .map(([prefix, iri]) => `PREFIX ${prefix}: <${iri}>`)
  .join('\n')

/** Shorten an IRI to a CURIE such as `bgf:OneNode`, for messages. */
export function curie(iri: string): string {
  for (const [prefix, ns] of Object.entries(NAMESPACES)) {
    if (iri.startsWith(ns)) return `${prefix}:${iri.slice(ns.length)}`
  }
  return iri
}

/** The part of an IRI after the last `#` or `/`. */
export function fragment(iri: string): string {
  const hash = iri.lastIndexOf('#')
  return hash >= 0 ? iri.slice(hash + 1) : iri.slice(iri.lastIndexOf('/') + 1)
}
