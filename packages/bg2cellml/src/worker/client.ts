/** The page side: a conversion worker with promises for its replies. */

import type { ConversionResult, ConvertOptions } from '../convert.js'
import type { ConvertRequest, InitRequest, ReadyResponse, WorkerRequest, WorkerResponse } from './protocol.js'

/** The part of a `Worker` the client uses. */
export interface WorkerLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message' | 'error', listener: (event: { readonly data?: unknown; readonly message?: string }) => void): void
  terminate(): void
}

export type ConversionWorkerOptions = Omit<InitRequest, 'type'>

export interface WorkerConversion {
  readonly seq: number
  readonly result: ConversionResult
  readonly timings: { readonly queued: number; readonly convert: number }
}

/** Converts, latest wins: resolves to `undefined` if another call has been made since. */
export type LatestConversion = (source: string, options?: ConvertOptions) => Promise<WorkerConversion | undefined>

export interface ConversionWorker {
  /** Resolves once the worker has loaded the framework; rejects if it couldn't. */
  readonly ready: Promise<ReadyResponse>
  /** Convert in the worker, after any earlier requests. */
  convert(source: string, options?: ConvertOptions): Promise<WorkerConversion>
  /**
   * A latest-wins converter, such as for conversions as the user edits: one
   * request in the worker at a time, and of those waiting only the newest is
   * sent. A call superseded before or while it runs resolves to `undefined`.
   * Each `latest()` is its own lane, so a quick pass and a full one don't
   * supersede each other.
   */
  latest(): LatestConversion
  /** Replace the options every conversion gets unless it gives its own, such as `knownUnits`. */
  setDefaults(defaults: ConvertOptions): void
  /** Stop the worker. Waiting conversions reject. */
  terminate(): void
}

interface Pending {
  resolve(response: WorkerConversion | undefined): void
  reject(error: Error): void
}

/**
 * Start a conversion worker. `worker` is a module worker whose script calls
 * `startConversionWorker()`, or its URL; with Vite and webpack, construct it
 * as `new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' })`
 * so it is bundled.
 */
export function createConversionWorker(worker: WorkerLike | URL | string, options: ConversionWorkerOptions): ConversionWorker {
  const port: WorkerLike = typeof worker === 'string' || worker instanceof URL ? new Worker(worker, { type: 'module' }) : worker
  const pending = new Map<number, Pending>()
  let seq = 0
  let lanes = 0
  let stopped: Error | undefined
  let settleReady: { resolve(ready: ReadyResponse): void; reject(error: Error): void }
  const ready = new Promise<ReadyResponse>((resolve, reject) => {
    settleReady = { resolve, reject }
  })
  ready.catch(() => {}) // conversions report it too

  const fail = (error: Error): void => {
    stopped ??= error
    settleReady.reject(error)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  port.addEventListener('message', (event) => {
    const response = event.data as WorkerResponse
    if (response.type === 'ready') return settleReady.resolve(response)
    if (response.type === 'error' && response.seq === undefined) return settleReady.reject(new Error(response.error))
    if (response.seq === undefined) return
    const request = pending.get(response.seq)
    if (request === undefined) return
    pending.delete(response.seq)
    if (response.type === 'result') request.resolve({ seq: response.seq, result: response.result, timings: response.timings })
    else if (response.type === 'superseded') request.resolve(undefined)
    else request.reject(new Error(response.error))
  })
  port.addEventListener('error', (event) => fail(new Error(`The conversion worker failed${event.message ? `: ${event.message}` : ''}`)))

  const post = (request: WorkerRequest): void => port.postMessage(request)
  post({ type: 'init', ...options })

  function send(source: string, convertOptions: ConvertOptions | undefined, lane?: string): Promise<WorkerConversion | undefined> {
    if (stopped !== undefined) return Promise.reject(stopped)
    seq += 1
    const request: ConvertRequest = {
      type: 'convert',
      seq,
      source,
      ...(convertOptions === undefined ? {} : { options: convertOptions }),
      ...(lane === undefined ? {} : { lane }),
    }
    return new Promise((resolve, reject) => {
      pending.set(request.seq, { resolve, reject })
      post(request)
    })
  }

  function latest(): LatestConversion {
    const lane = `latest-${(lanes += 1)}`
    let running = false
    let waiting: { source: string; options: ConvertOptions | undefined; done: Pending } | undefined

    const pump = (): void => {
      if (running || waiting === undefined) return
      const next = waiting
      waiting = undefined
      running = true
      send(next.source, next.options, lane).then(
        (conversion) => {
          running = false
          next.done.resolve(waiting === undefined ? conversion : undefined)
          pump()
        },
        (error: Error) => {
          running = false
          next.done.reject(error)
          pump()
        },
      )
    }

    return (source, convertOptions) =>
      new Promise((resolve, reject) => {
        waiting?.done.resolve(undefined)
        waiting = { source, options: convertOptions, done: { resolve, reject } }
        pump()
      })
  }

  return {
    ready,
    convert: (source, convertOptions) => send(source, convertOptions) as Promise<WorkerConversion>,
    latest,
    setDefaults: (defaults) => post({ type: 'defaults', defaults }),
    terminate: () => {
      port.terminate()
      fail(new Error('The conversion worker was terminated'))
    },
  }
}
