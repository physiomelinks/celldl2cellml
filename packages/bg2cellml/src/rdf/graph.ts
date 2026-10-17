import type * as Oxigraph from 'oxigraph'

import { SPARQL_PREFIXES } from './namespaces.js'

/**
 * The oxigraph module. Node can use `import * as oxigraph from 'oxigraph'`
 * directly. In a browser, call the web build's `init()` first; the CellDL
 * Editor already has an initialised copy through `@celldl/rdf`.
 */
export type OxigraphModule = Pick<typeof Oxigraph, 'Store' | 'namedNode' | 'literal' | 'blankNode' | 'quad' | 'defaultGraph'>

export type Term = Oxigraph.Term
export type ResultRow = ReadonlyMap<string, Term>

/**
 * A thin wrapper over an oxigraph Store. Ported from `bg2cellml/rdf/oxigraph.py`.
 *
 * Unlike in Python, JS terms are objects: compare them with `.equals()` or by
 * `.value`, never with `===`. Unbound variables are absent from the row Map.
 */
export class RdfGraph {
  readonly #oxigraph: OxigraphModule
  readonly #store: Oxigraph.Store

  constructor(oxigraph: OxigraphModule) {
    this.#oxigraph = oxigraph
    this.#store = new oxigraph.Store()
  }

  get size(): number {
    return this.#store.size
  }

  get oxigraph(): OxigraphModule {
    return this.#oxigraph
  }

  /** Parse Turtle into the store. Relative IRIs resolve against `baseIri`. */
  load(turtle: string, baseIri: string): void {
    this.#store.load(turtle, { format: 'text/turtle', base_iri: baseIri })
  }

  add(quad: Oxigraph.Quad): void {
    this.#store.add(quad)
  }

  addAll(quads: Iterable<Oxigraph.Quad>): void {
    for (const quad of quads) this.#store.add(quad)
  }

  /** `null` matches anything. */
  match(subject: Term | null, predicate: Term | null, object: Term | null): Oxigraph.Quad[] {
    return this.#store.match(subject, predicate, object, null)
  }

  has(subject: Term | null, predicate: Term | null, object: Term | null): boolean {
    return this.match(subject, predicate, object).length > 0
  }

  /** Run a SPARQL SELECT. The BG-RDF prefixes (bgf:, cdt:, rdfs:, ...) are added for you. */
  select(sparql: string): ResultRow[] {
    const result = this.#store.query(`${SPARQL_PREFIXES}\n${sparql}`)
    if (!Array.isArray(result) || (result.length > 0 && !(result[0] instanceof Map))) {
      throw new TypeError('Expected a SPARQL SELECT query')
    }
    return result as Map<string, Term>[]
  }

  serialise(format: 'text/turtle' | 'application/n-triples' = 'text/turtle'): string {
    return this.#store.dump({ format, from_graph_name: this.#oxigraph.defaultGraph() })
  }
}
