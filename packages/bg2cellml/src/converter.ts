/**
 * The entry point for applications. It keeps the shape of
 * `@celldl/editor-python-tools` (`celldl2cellml` returning
 * `{ cellml, metadata, issues, exception }`), so the CellDL Editor and PhLynx
 * can switch from the Pyodide version without other changes.
 */

import type { LibCellML } from '@physiomelinks/cellml-units'

import { extractBgRdf, type DOMParserLike } from './celldl.js'
import { convert, iriIssue, type ConversionResult, type ConvertOptions } from './convert.js'
import { generateCellML } from './cellml/generate.js'
import { cellmlUriFor } from './cellml/metadata.js'
import { BondgraphFramework } from './framework/framework.js'
import { BondgraphModel } from './model/model.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX } from './rdf/namespaces.js'
import { RdfGraph, type OxigraphModule, type QuadLike } from './rdf/graph.js'

/** The WebAssembly modules the converter needs. The host application loads them once. */
export interface Runtime {
  libcellml: LibCellML
  oxigraph: OxigraphModule
  /** Needed in Node, which has no DOMParser. `@xmldom/xmldom` works. */
  domParser?: DOMParserLike
}

/** Where the BG-RDF framework comes from. */
export type FrameworkSource =
  /** The ontology and template files as Turtle, with templates keyed by file name such as `electrical.ttl`. */
  | { ontology: string; templates: Readonly<Record<string, string>> }
  /**
   * Statements already in an RDF store, such as the CellDL Editor's: oxigraph
   * quads, or those of any RDF/JS library. Named graphs are merged.
   */
  | { quads: Iterable<QuadLike> }
  /** Statements as N-Quads text, such as `frameworkNQuads()` gives, to send to a worker. Named graphs are merged. */
  | { nquads: string }

export interface CellMLGenerationOptions {
  /** The source's IRI, the base for its relative IRIs: an absolute IRI, such as `file:///C:/Models/My%20model.celldl`. */
  sourceUri: string
  /** The CellML file's IRI, for the metadata. The source's with `.cellml` if not given, as in `@celldl/editor-python-tools`. */
  cellmlUri?: string
  debug?: boolean
  metadata?: boolean
  /** The source is BG-RDF Turtle rather than a CellDL document. */
  rdfSource?: boolean
}

export interface CellMLOutput {
  cellml?: string
  metadata?: string
  exception?: string
  issues?: string[]
}

export class Converter {
  readonly #runtime: Runtime
  #framework: BondgraphFramework | undefined
  #frameworkGraph: RdfGraph | undefined

  constructor(runtime: Runtime) {
    this.#runtime = runtime
  }

  /** The BG-RDF framework, once `loadFramework()` has loaded it. */
  get framework(): BondgraphFramework | undefined {
    return this.#framework
  }

  /** Load the BG-RDF framework. Returns any issues found. */
  loadFramework(source: FrameworkSource): string[] {
    const graph = new RdfGraph(this.#runtime.oxigraph)
    if ('quads' in source) {
      graph.addAll(source.quads)
    } else if ('nquads' in source) {
      graph.loadNQuads(source.nquads)
    } else {
      graph.load(source.ontology, BGF_ONTOLOGY_IRI)
      for (const [name, turtle] of Object.entries(source.templates)) {
        graph.load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)
      }
    }
    this.#framework = BondgraphFramework.fromGraph(graph, this.#runtime)
    this.#frameworkGraph = graph
    return this.#framework.log.issues.map((issue) => issue.message)
  }

  /**
   * The loaded framework's statements as N-Quads, for `loadFramework({ nquads })`
   * elsewhere, such as in a worker; `undefined` before `loadFramework()`.
   */
  frameworkNQuads(): string | undefined {
    return this.#frameworkGraph?.serialise('application/n-quads')
  }

  /** Why `iri` can't be the base or name of a document, or `undefined` if it can, as `convert()` checks it. */
  #iriIssue(option: string, iri: string): string | undefined {
    return iriIssue(this.#runtime.oxigraph, option, iri)
  }

  /**
   * Convert a CellDL document, or BG-RDF Turtle with `rdfSource: true`, to
   * CellML 2.0, returning the CellML with any warnings, and each issue's
   * severity, stage and `elementId`.
   */
  async convert(source: string, options: ConvertOptions = {}): Promise<ConversionResult> {
    return convert({ runtime: this.#runtime, framework: this.#framework }, source, options)
  }

  /** Convert a CellDL document, or BG-RDF Turtle with `rdfSource: true`, to CellML 2.0. */
  async celldl2cellml(source: string, options: CellMLGenerationOptions): Promise<CellMLOutput> {
    if (this.#framework === undefined) {
      return { issues: ['The BG-RDF framework has not been loaded'] }
    }
    const iriIssues = [
      this.#iriIssue('sourceUri', options.sourceUri),
      ...(options.cellmlUri === undefined ? [] : [this.#iriIssue('cellmlUri', options.cellmlUri)]),
    ].filter((issue) => issue !== undefined)
    if (iriIssues.length > 0) return { issues: iriIssues }
    try {
      const bgRdf = options.rdfSource ? source : extractBgRdf(source, this.#runtime.domParser)
      const model = BondgraphModel.fromTurtle(this.#framework, this.#runtime, bgRdf, options.sourceUri)
      if (model.log.hasIssues) {
        return { issues: model.log.issues.map((issue) => issue.message) }
      }
      const result = generateCellML(this.#runtime.libcellml, model, {
        metadata: options.metadata ?? false,
        cellmlUri: options.cellmlUri ?? cellmlUriFor(options.sourceUri),
      })
      if (result.issues.length > 0) {
        return { issues: result.issues.map((issue) => issue.message) }
      }
      const output: CellMLOutput = {}
      if (result.cellml !== undefined) output.cellml = result.cellml
      if (result.metadata !== undefined) output.metadata = result.metadata
      return output
    } catch (error) {
      return { exception: options.debug && error instanceof Error ? (error.stack ?? String(error)) : String(error) }
    }
  }
}
