import * as oxigraph from 'oxigraph'
import { describe, expect, it } from 'vitest'

import { BGF, RdfGraph, curie, fragment } from '../src/index.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX } from '../src/rdf/namespaces.js'
import { DOMAIN_QUERY, ELEMENT_TEMPLATE_DEFINITIONS, iri, modelBondsQuery } from '../src/rdf/queries.js'
import { frameworkSource } from './reference.js'

const RC_FRAGMENT = `
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix : <#> .

:RC_circuit
    a bgf:BondgraphModel ;
    bgf:hasJunctionStructure :I_R, :V_C .

:I_R a bgf:OneNode .
:V_C a bgf:ZeroNode .
`

describe('RdfGraph', () => {
  it('loads Turtle and runs SELECT queries with the BG-RDF prefixes', () => {
    const graph = new RdfGraph(oxigraph)
    graph.load(RC_FRAGMENT, 'https://example.org/rc.ttl')
    const rows = graph.select('SELECT ?uri WHERE { ?uri a bgf:BondgraphModel }')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.get('uri')!.value).toBe('https://example.org/rc.ttl#RC_circuit')
  })

  it('compares terms by value, not identity', () => {
    const graph = new RdfGraph(oxigraph)
    graph.load(RC_FRAGMENT, 'https://example.org/rc.ttl')
    const [row] = graph.select('SELECT ?type WHERE { <https://example.org/rc.ttl#I_R> a ?type }')
    const type = row!.get('type')!
    expect(type === oxigraph.namedNode(BGF.OneNode)).toBe(false)
    expect(type.equals(oxigraph.namedNode(BGF.OneNode))).toBe(true)
  })
})

describe('queries', () => {
  it('rejects IRIs that would break a query', () => {
    expect(() => iri('https://example.org/x> } DROP ALL #')).toThrow(TypeError)
    expect(modelBondsQuery('https://example.org/rc.ttl#RC_circuit')).toContain('<https://example.org/rc.ttl#RC_circuit>')
  })
})

describe('namespaces', () => {
  it('shortens IRIs for messages', () => {
    expect(curie(BGF.OneNode)).toBe('bgf:OneNode')
    expect(fragment('https://example.org/rc.ttl#I_R')).toBe('I_R')
  })
})

describe('BG-RDF framework queries', () => {
  it('run over the ontology and templates in the bg-rdf submodule', () => {
    const { ontology, templates } = frameworkSource()
    const graph = new RdfGraph(oxigraph)
    graph.load(ontology, BGF_ONTOLOGY_IRI)
    for (const [name, turtle] of Object.entries(templates)) graph.load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)

    const domains = graph.select(DOMAIN_QUERY).map((row) => fragment(row.get('domain')!.value))
    expect(domains).toEqual(['Chemical', 'Electrical', 'Hydraulic', 'Mechanical'])
    // 22 in CellDL/BG-RDF, and the fork's 3
    expect(graph.select(ELEMENT_TEMPLATE_DEFINITIONS)).toHaveLength(25)
  })
})
