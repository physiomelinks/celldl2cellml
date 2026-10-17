/**
 * The entry point for applications. It keeps the shape of
 * `@celldl/editor-python-tools` (`celldl2cellml` returning
 * `{ cellml, metadata, issues, exception }`), so the CellDL Editor and PhLynx
 * can switch from the Pyodide version without other changes.
 */

import type { LibCellML } from '@physiomelinks/cellml-units'
import type * as Oxigraph from 'oxigraph'

import { extractBgRdf, type DOMParserLike } from './celldl.js'
import { generateCellML } from './cellml/generate.js'
import { BondgraphFramework } from './framework/framework.js'
import { BondgraphModel } from './model/model.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX } from './rdf/namespaces.js'
import { RdfGraph, type OxigraphModule } from './rdf/graph.js'

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
  /** Statements already in an RDF store, such as the CellDL Editor's. */
  | { quads: Iterable<Oxigraph.Quad> }

export interface CellMLGenerationOptions {
  sourceUri: string
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

  constructor(runtime: Runtime) {
    this.#runtime = runtime
  }

  /** Load the BG-RDF framework. Returns any issues found. */
  loadFramework(source: FrameworkSource): string[] {
    const graph = new RdfGraph(this.#runtime.oxigraph)
    if ('quads' in source) {
      graph.addAll(source.quads)
    } else {
      graph.load(source.ontology, BGF_ONTOLOGY_IRI)
      for (const [name, turtle] of Object.entries(source.templates)) {
        graph.load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)
      }
    }
    this.#framework = BondgraphFramework.fromGraph(graph)
    return this.#framework.log.issues.map((issue) => issue.message)
  }

  /** Convert a CellDL document, or BG-RDF Turtle with `rdfSource: true`, to CellML 2.0. */
  async celldl2cellml(source: string, options: CellMLGenerationOptions): Promise<CellMLOutput> {
    if (this.#framework === undefined) {
      return { issues: ['The BG-RDF framework has not been loaded'] }
    }
    try {
      const bgRdf = options.rdfSource ? source : extractBgRdf(source, this.#runtime.domParser)
      const model = BondgraphModel.fromTurtle(this.#framework, this.#runtime.oxigraph, bgRdf, options.sourceUri)
      if (model.log.hasIssues) {
        return { issues: model.log.issues.map((issue) => issue.message) }
      }
      const result = generateCellML(this.#runtime.libcellml, model, {
        metadata: options.metadata ?? false,
        ...(options.cellmlUri === undefined ? {} : { cellmlUri: options.cellmlUri }),
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
