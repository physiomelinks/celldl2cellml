import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import { Converter, RdfGraph, type BondgraphFramework, type QuadLike, type Runtime, type TermLike } from '../src/index.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX } from '../src/rdf/namespaces.js'
import { frameworkRuntime } from './framework-fixtures.js'
import { frameworkSource } from './reference.js'

let runtime: Runtime

beforeAll(async () => {
  const { libcellml, domParser } = await frameworkRuntime()
  runtime = { libcellml, oxigraph, domParser: domParser as NonNullable<Runtime['domParser']> }
})

/** The ontology and templates in a store, each file in a named graph of its own, as an application might keep them. */
function storeQuads(): oxigraph.Quad[] {
  const { ontology, templates } = frameworkSource()
  const store = new oxigraph.Store()
  const load = (turtle: string, iri: string): void => {
    store.load(turtle, { format: 'text/turtle', base_iri: iri, to_graph_name: oxigraph.namedNode(iri) })
  }
  load(ontology, BGF_ONTOLOGY_IRI)
  for (const [name, turtle] of Object.entries(templates)) load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)
  return store.match(null, null, null, null)
}

/** Plain RDF/JS objects, as another library such as N3.js would give, with blank nodes labelled its way. */
function plainQuads(quads: readonly oxigraph.Quad[]): QuadLike[] {
  const plain = (term: oxigraph.Term): TermLike =>
    term.termType === 'Literal'
      ? { termType: 'Literal', value: term.value, language: term.language, datatype: { value: term.datatype.value } }
      : { termType: term.termType, value: term.termType === 'BlankNode' ? `n3-${term.value}` : term.value }
  return quads.map((q) => ({ subject: plain(q.subject), predicate: plain(q.predicate), object: plain(q.object), graph: plain(q.graph) }))
}

/** Everything a framework holds, as plain data, in order. */
function snapshot(framework: BondgraphFramework): unknown {
  const classes = new Set([...framework.elementTemplates.values()].map((t) => t.elementClass))
  return {
    issues: framework.log.issues,
    domains: [...framework.domains],
    elementTemplates: [...framework.elementTemplates].map(([iri, t]) => [
      iri,
      { ...t, ports: [...t.ports], parameters: [...t.parameters], variables: [...t.variables] },
    ]),
    junctions: [...framework.junctions],
    compositeTemplates: [...framework.compositeTemplates].map(([iri, c]) => [iri, c.label, c.template.iri]),
    byClassAndDomain: [...classes].flatMap((elementClass) =>
      [...framework.domains.keys()].map((domain) => framework.templatesOfClass(elementClass, domain).map((t) => t.iri)),
    ),
  }
}

describe('Converter.loadFramework()', () => {
  let fromTurtle: unknown

  beforeAll(() => {
    const converter = new Converter(runtime)
    expect(converter.framework).toBeUndefined()
    expect(converter.loadFramework(frameworkSource())).toEqual([])
    fromTurtle = snapshot(converter.framework!)
  })

  it('loads the whole framework from Turtle', () => {
    const { domains, elementTemplates, junctions, compositeTemplates } = fromTurtle as Record<string, unknown[]>
    expect([domains!.length, elementTemplates!.length, junctions!.length, compositeTemplates!.length]).toEqual([4, 25, 27, 17]) // CellDL/BG-RDF's 22, 22 and 14, and the fork's additions
  })

  it('gives the same framework from oxigraph quads in named graphs', () => {
    const converter = new Converter(runtime)
    expect(converter.loadFramework({ quads: storeQuads() })).toEqual([])
    expect(snapshot(converter.framework!)).toEqual(fromTurtle)
  })

  it('gives the same framework from RDF/JS quads made by another library', () => {
    const converter = new Converter(runtime)
    expect(converter.loadFramework({ quads: plainQuads(storeQuads()) })).toEqual([])
    expect(snapshot(converter.framework!)).toEqual(fromTurtle)
  })
})

describe('RdfGraph.addAll()', () => {
  const ex = (name: string) => ({ termType: 'NamedNode', value: `https://example.org/${name}` })
  const blank = { termType: 'BlankNode', value: 'b0' }

  it('keeps a blank node the same node across calls', () => {
    const graph = new RdfGraph(oxigraph)
    graph.addAll([{ subject: ex('a'), predicate: ex('p'), object: blank }])
    graph.addAll([{ subject: blank, predicate: ex('q'), object: { termType: 'Literal', value: 'x' } }])
    const rows = graph.select('SELECT ?v WHERE { <https://example.org/a> <https://example.org/p> ?b . ?b <https://example.org/q> ?v }')
    expect(rows.map((row) => row.get('v')!.value)).toEqual(['x'])
  })

  it('keeps languages and datatypes, and puts everything in the default graph', () => {
    const graph = new RdfGraph(oxigraph)
    const rdfs = 'http://www.w3.org/2000/01/rdf-schema#label'
    graph.addAll([
      { subject: ex('a'), predicate: { termType: 'NamedNode', value: rdfs }, object: { termType: 'Literal', value: 'a', language: 'en' }, graph: ex('g') },
      {
        subject: ex('a'),
        predicate: ex('n'),
        object: { termType: 'Literal', value: '10.0', datatype: { value: 'http://www.w3.org/2001/XMLSchema#decimal' } },
        graph: ex('g'),
      },
    ])
    const [row] = graph.select(`SELECT ?label ?n WHERE { <https://example.org/a> <${rdfs}> ?label ; <https://example.org/n> ?n }`)
    const label = row!.get('label') as oxigraph.Literal
    const n = row!.get('n') as oxigraph.Literal
    expect([label.value, label.language]).toEqual(['a', 'en'])
    expect([n.value, n.datatype.value]).toEqual(['10', 'http://www.w3.org/2001/XMLSchema#decimal'])
  })

  it('rejects terms that can’t be in a statement here', () => {
    const graph = new RdfGraph(oxigraph)
    expect(() => graph.addAll([{ subject: ex('a'), predicate: ex('p'), object: { termType: 'Variable', value: 'x' } }])).toThrow(
      "Can't add a Variable term to the graph",
    )
  })
})
