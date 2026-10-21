/**
 * The worker side: a message handler that converts with its own libCellML
 * and oxigraph. The worker script imports the modules, so it works with any
 * bundler, and the page passes their `.wasm` URLs if needed:
 *
 * ```js
 * import createLibCellML from 'libcellml.js'
 * import initOxigraph, * as oxigraph from 'oxigraph/web.js'
 * import { startConversionWorker } from '@physiomelinks/bg2cellml/worker'
 *
 * startConversionWorker({ libcellml: createLibCellML, oxigraph, initOxigraph })
 * ```
 */

import type { LibCellML } from '@physiomelinks/cellml-units'

import type { DOMParserLike } from '../celldl.js'
import type { ConversionResult, ConvertOptions } from '../convert.js'
import { Converter, type Runtime } from '../converter.js'
import type { Issue } from '../issues.js'
import type { OxigraphModule } from '../rdf/graph.js'
import type { ConvertRequest, InitRequest, ReadyResponse, WorkerRequest, WorkerResponse } from './protocol.js'

/** What the worker script gives the handler: the modules, which it imports itself. */
export interface WorkerSetup {
  /** libcellml.js's module factory, its default export. It is given `locateFile` when `init` has a `wasm.libcellml` URL. */
  readonly libcellml: (options?: { locateFile?: (path: string, prefix: string) => string }) => Promise<unknown>
  /** oxigraph: `oxigraph/web.js` in a browser, with its default export as `initOxigraph`; `oxigraph` in Node. */
  readonly oxigraph: OxigraphModule
  /** oxigraph's `init()`, given `{ module_or_path }` when `init` has a `wasm.oxigraph` URL. */
  readonly initOxigraph?: (options?: { module_or_path: string }) => Promise<unknown>
  /** For the framework's MathML and CellDL sources; `globalThis.DOMParser`, or else `@xmldom/xmldom`'s, if not given. */
  readonly domParser?: DOMParserLike
}

/** Handles one request, resolving to its reply, if it has one. */
export type ConversionHandler = (request: WorkerRequest) => Promise<WorkerResponse | undefined>

interface Started {
  readonly converter: Converter
}

/**
 * A handler for the worker's messages. Each `convert` waits for `init`, then
 * runs alone: conversions are synchronous, so they never overlap.
 */
export function createConversionHandler(setup: WorkerSetup): ConversionHandler {
  let started: Promise<Started> | undefined
  let defaults: ConvertOptions = {}
  /** The newest request's `seq` in each lane. */
  const newest = new Map<string, number>()

  async function start(request: InitRequest): Promise<{ started: Started; ready: ReadyResponse }> {
    const t0 = performance.now()
    const libcellmlUrl = request.wasm?.libcellml
    const oxigraphUrl = request.wasm?.oxigraph
    const [libcellml] = await Promise.all([
      setup.libcellml(libcellmlUrl === undefined ? undefined : { locateFile: (path, prefix) => (path.endsWith('.wasm') ? libcellmlUrl : prefix + path) }),
      setup.initOxigraph?.(oxigraphUrl === undefined ? undefined : { module_or_path: oxigraphUrl }),
    ])
    const t1 = performance.now()
    // The framework's templates need one for their MathML, and workers have none
    const domParser = setup.domParser ?? globalDomParser() ?? (new (await import('@xmldom/xmldom')).DOMParser() as unknown as DOMParserLike)
    const runtime: Runtime = { libcellml: libcellml as LibCellML, oxigraph: setup.oxigraph, domParser }
    const converter = new Converter(runtime)
    const issues = converter.loadFramework(request.framework)
    if (issues.length > 0) throw new Error(`The BG-RDF framework has issues: ${issues.join('; ')}`)
    const version = converter.framework?.version
    return {
      started: { converter },
      ready: {
        type: 'ready',
        framework: version === undefined ? {} : { version },
        timings: { wasm: t1 - t0, framework: performance.now() - t1 },
      },
    }
  }

  async function convert(request: ConvertRequest): Promise<WorkerResponse> {
    const received = performance.now()
    if (request.lane !== undefined) newest.set(request.lane, request.seq)
    if (started === undefined) return { type: 'error', seq: request.seq, error: 'The worker has not been sent init' }
    let state: Started
    try {
      state = await started
    } catch (error) {
      return { type: 'error', seq: request.seq, error: `The worker failed to start: ${message(error)}` }
    }
    if (request.lane !== undefined && newest.get(request.lane) !== request.seq) return { type: 'superseded', seq: request.seq }
    const options: ConvertOptions = {
      ...defaults,
      ...request.options,
      ...(request.rdfSource === undefined ? {} : { rdfSource: request.rdfSource }),
    }
    const begun = performance.now()
    const result = await state.converter.convert(request.source, options)
    return { type: 'result', seq: request.seq, result: cloneable(result), timings: { queued: begun - received, convert: performance.now() - begun } }
  }

  return async (request) => {
    switch (request.type) {
      case 'init': {
        if (started !== undefined) return { type: 'error', error: 'The worker has already been sent init' }
        defaults = request.defaults ?? {}
        const starting = start(request)
        started = starting.then(({ started }) => started)
        started.catch(() => {}) // each convert reports it
        try {
          return (await starting).ready
        } catch (error) {
          return { type: 'error', error: message(error) }
        }
      }
      case 'defaults':
        defaults = request.defaults
        return undefined
      case 'convert':
        return convert(request)
      default:
        return { type: 'error', error: `Unknown request: ${JSON.stringify((request as { type?: unknown }).type)}` }
    }
  }
}

/** The part of a worker's global scope the handler uses. */
export interface WorkerScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  postMessage(message: unknown): void
}

/** Answer the worker's messages with `createConversionHandler(setup)`. Call it in the worker script. */
export function startConversionWorker(setup: WorkerSetup, scope: WorkerScope = globalThis as unknown as WorkerScope): ConversionHandler {
  const handle = createConversionHandler(setup)
  scope.addEventListener('message', (event) => {
    void handle(event.data as WorkerRequest).then((response) => {
      if (response !== undefined) scope.postMessage(response)
    })
  })
  return handle
}

function globalDomParser(): DOMParserLike | undefined {
  const P = (globalThis as { DOMParser?: new () => DOMParserLike }).DOMParser
  return P === undefined ? undefined : new P()
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The result with any issue `cause` that can't be posted, such as one holding a function, as a string. */
function cloneable(result: ConversionResult): ConversionResult {
  const plain = new Map<Issue, Issue>()
  for (const issue of result.issues) {
    if (issue.cause === undefined) continue
    try {
      structuredClone(issue.cause)
    } catch {
      plain.set(issue, { ...issue, cause: String(issue.cause) })
    }
  }
  if (plain.size === 0) return result
  const map = (issues: readonly Issue[]): Issue[] => issues.map((issue) => plain.get(issue) ?? issue)
  return { ...result, issues: map(result.issues), errors: map(result.errors), warnings: map(result.warnings) }
}
