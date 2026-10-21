/**
 * The messages between a page and a conversion worker. Everything in them
 * is structured-cloneable: the framework goes as text, never as RDF terms.
 */

import type { ConversionResult, ConvertOptions } from '../convert.js'
import type { FrameworkSource } from '../converter.js'

/** The framework as text, which can be posted: `{ nquads }`, such as `Converter.frameworkNQuads()` gives, or `{ ontology, templates }`. */
export type WorkerFramework = Exclude<FrameworkSource, { quads: unknown }>

/** The WebAssembly files' URLs, when the modules can't find them themselves, as with a bundler's asset URLs. */
export interface WasmUrls {
  readonly libcellml?: string
  readonly oxigraph?: string
}

/** Start the worker: load libCellML, oxigraph and the framework. Send it once, first. */
export interface InitRequest {
  readonly type: 'init'
  readonly framework: WorkerFramework
  readonly wasm?: WasmUrls
  /** Options every conversion gets unless it gives its own, such as `knownUnits`, so they are sent once. */
  readonly defaults?: ConvertOptions
}

/** Replace the default options, such as when the host's units change. */
export interface DefaultsRequest {
  readonly type: 'defaults'
  readonly defaults: ConvertOptions
}

export interface ConvertRequest {
  readonly type: 'convert'
  /** The request's number, which its reply gives. */
  readonly seq: number
  readonly source: string
  /** The source is BG-RDF Turtle, as `options.rdfSource`. */
  readonly rdfSource?: boolean
  readonly options?: ConvertOptions
  /**
   * Latest wins in a lane: a request that hasn't started when a newer one in
   * its lane arrives gets `superseded` instead of a result.
   */
  readonly lane?: string
}

export type WorkerRequest = InitRequest | DefaultsRequest | ConvertRequest

export interface ReadyResponse {
  readonly type: 'ready'
  /** The loaded framework's `owl:versionInfo`. */
  readonly framework: { readonly version?: string }
  /** Milliseconds to start the WebAssembly modules and to load the framework. */
  readonly timings: { readonly wasm: number; readonly framework: number }
}

export interface ResultResponse {
  readonly type: 'result'
  readonly seq: number
  readonly result: ConversionResult
  /** Milliseconds waiting in the worker (for `init`, or an earlier conversion) and converting. */
  readonly timings: { readonly queued: number; readonly convert: number }
}

export interface SupersededResponse {
  readonly type: 'superseded'
  readonly seq: number
}

/** `init` failed (no `seq`), or a request couldn't be run. */
export interface ErrorResponse {
  readonly type: 'error'
  readonly seq?: number
  readonly error: string
}

export type WorkerResponse = ReadyResponse | ResultResponse | SupersededResponse | ErrorResponse
