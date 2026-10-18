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
 * A term as the RDF/JS data model has it, so statements can come from any
 * RDF library or another oxigraph instance.
 */
export interface TermLike {
  readonly termType: string
  readonly value: string
  readonly language?: string
  readonly datatype?: { readonly value: string }
}

/** A statement as the RDF/JS data model has it. Its graph, if any, is ignored. */
export interface QuadLike {
  readonly subject: TermLike
  readonly predicate: TermLike
  readonly object: TermLike
  readonly graph?: TermLike
}

const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'
const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

/**
 * A thin wrapper over an oxigraph Store. Ported from `bg2cellml/rdf/oxigraph.py`.
 *
 * Unlike in Python, JS terms are objects: compare them with `.equals()` or by
 * `.value`, never with `===`. Unbound variables are absent from the row Map.
 */
export class RdfGraph {
  readonly #oxigraph: OxigraphModule
  readonly #store: Oxigraph.Store
  /** Blank nodes from `addAll()`, by their original label, so a node keeps its identity across calls. */
  readonly #blankNodes = new Map<string, Oxigraph.BlankNode>()

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

  /**
   * Add statements from elsewhere, such as the CellDL Editor's RDF store. Each
   * goes into the default graph, which the queries read, whatever graph it
   * was in. Terms are rebuilt with this graph's oxigraph, so they can come from
   * any RDF/JS library; blank nodes are renamed, consistently across calls.
   */
  addAll(quads: Iterable<QuadLike>): void {
    const { quad, defaultGraph } = this.#oxigraph
    for (const statement of quads) {
      this.#store.add(
        quad(
          this.#term(statement.subject) as Oxigraph.Quad_Subject,
          this.#term(statement.predicate) as Oxigraph.Quad_Predicate,
          this.#term(statement.object) as Oxigraph.Quad_Object,
          defaultGraph(),
        ),
      )
    }
  }

  #term(term: TermLike): Oxigraph.NamedNode | Oxigraph.BlankNode | Oxigraph.Literal {
    switch (term.termType) {
      case 'NamedNode':
        return this.#oxigraph.namedNode(term.value)
      case 'BlankNode': {
        let node = this.#blankNodes.get(term.value)
        if (node === undefined) {
          node = this.#oxigraph.blankNode()
          this.#blankNodes.set(term.value, node)
        }
        return node
      }
      case 'Literal': {
        const datatype = term.datatype?.value ?? XSD_STRING
        if (term.language) return this.#oxigraph.literal(term.value, term.language)
        if (datatype === XSD_STRING || datatype === RDF_LANG_STRING) return this.#oxigraph.literal(term.value)
        return this.#oxigraph.literal(term.value, this.#oxigraph.namedNode(datatype))
      }
      default:
        throw new TypeError(`Can't add a ${term.termType} term to the graph`)
    }
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
