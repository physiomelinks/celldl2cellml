/**
 * `@physiomelinks/bg2cellml/worker`: the handler driven directly, and the
 * client over a stand-in Worker that clones messages as a real one does.
 */

import { readFileSync } from 'node:fs'

import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter } from '../src/index.js'
import {
  createConversionHandler,
  createConversionWorker,
  startConversionWorker,
  type InitRequest,
  type WorkerLike,
  type WorkerSetup,
} from '../src/worker/index.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

const manifest = loadManifest()
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const rc = caseNamed('example_RC')
const rcSource = readSource(rc)
const celldl = readFileSync(new URL('./models/rdf_error.celldl', import.meta.url), 'utf8')

let nquads: string
let setup: WorkerSetup

beforeAll(async () => {
  const { DOMParser } = await import('@xmldom/xmldom')
  const converter = new Converter({ libcellml: (await createLibCellML()) as unknown as LibCellML, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
  nquads = converter.frameworkNQuads()!
  // No domParser: the handler loads @xmldom/xmldom, as in a worker
  setup = { libcellml: createLibCellML as WorkerSetup['libcellml'], oxigraph }
})

const init = (extra: Partial<InitRequest> = {}): InitRequest => ({ type: 'init', framework: { nquads }, ...extra })
const convertRc = (seq: number, lane?: string) =>
  ({ type: 'convert', seq, source: rcSource, rdfSource: true, options: { sourceUri: rc.baseIri }, ...(lane === undefined ? {} : { lane }) }) as const

describe('createConversionHandler', () => {
  it('starts, then converts BG-RDF and CellDL', async () => {
    const handle = createConversionHandler(setup)
    const ready = await handle(init())
    expect(ready).toMatchObject({ type: 'ready', framework: { version: '2026-04-12' } })
    const reply = await handle(convertRc(1))
    expect(reply).toMatchObject({ type: 'result', seq: 1, result: { ok: true, runnable: true, checks: 'full' } })
    if (reply?.type !== 'result') throw new Error('No result')
    expect(reply.result.cellml).toContain('<component name="main" id="main">')
    expect(reply.result.sections.at(-1)?.title).toMatch(/Conservation/i)
    expect(reply.timings.convert).toBeGreaterThan(0)
    expect(structuredClone(reply)).toEqual(reply)

    const fromCelldl = await handle({ type: 'convert', seq: 2, source: celldl })
    expect(fromCelldl).toMatchObject({ type: 'result', seq: 2 })
    if (fromCelldl?.type !== 'result') throw new Error('No result')
    expect(fromCelldl.result.exception).toBeUndefined()
    expect(fromCelldl.result.modelIri).toBeDefined()
  })

  it('applies defaults, which a request can override', async () => {
    const handle = createConversionHandler(setup)
    await handle(init({ defaults: { checks: 'none', componentName: 'rc' } }))
    const quick = await handle(convertRc(1))
    expect(quick).toMatchObject({ result: { checks: 'none', runnable: undefined, componentName: 'rc' } })
    expect(await handle({ ...convertRc(2), options: { sourceUri: rc.baseIri, checks: 'full' } })).toMatchObject({
      result: { checks: 'full', componentName: 'rc' },
    })
    expect(await handle({ type: 'defaults', defaults: {} })).toBeUndefined()
    expect(await handle(convertRc(3))).toMatchObject({ result: { checks: 'full', componentName: 'main' } })
  })

  it('supersedes requests in a lane that a newer one overtakes', async () => {
    const handle = createConversionHandler(setup)
    const replies = [handle(init()), handle(convertRc(1, 'live')), handle(convertRc(2, 'live')), handle(convertRc(3, 'full')), handle(convertRc(4, 'live')), handle(convertRc(5))]
    const [ready, ...conversions] = await Promise.all(replies)
    expect(ready?.type).toBe('ready')
    expect(conversions.map((reply) => [reply?.type, (reply as { seq: number }).seq])).toEqual([
      ['superseded', 1],
      ['superseded', 2],
      ['result', 3],
      ['result', 4],
      ['result', 5],
    ])
  })

  it('supersedes a request that arrives while another conversion blocks the worker', async () => {
    const handle = createConversionHandler(setup)
    await handle(init())
    // Each a task of its own, as messages are, so neither sees the other until the first yields
    const inTask = (request: ReturnType<typeof convertRc>) => new Promise((resolve) => setTimeout(() => resolve(handle(request))))
    const replies = await Promise.all([inTask(convertRc(1, 'live')), inTask(convertRc(2, 'live'))])
    expect(replies.map((reply) => (reply as { type: string }).type)).toEqual(['superseded', 'result'])
  })

  it("posts an error with the request's seq when a reply can't be posted", async () => {
    const posted: unknown[] = []
    let listener: ((event: { readonly data: unknown }) => void) | undefined
    startConversionWorker(setup, {
      addEventListener: (_type, added) => (listener = added),
      postMessage: (reply) => {
        if ((reply as { type: string }).type === 'result') throw new Error('Could not be cloned')
        posted.push(reply)
      },
    })
    listener!({ data: init() })
    listener!({ data: convertRc(7) })
    await expect.poll(() => posted.length).toBe(2)
    expect(posted[1]).toEqual({ type: 'error', seq: 7, error: 'Could not be cloned' })
  })

  it('reports requests before init, a second init and a failed init', async () => {
    const handle = createConversionHandler(setup)
    expect(await handle(convertRc(1))).toEqual({ type: 'error', seq: 1, error: 'The worker has not been sent init' })
    expect((await handle(init()))?.type).toBe('ready')
    expect(await handle(init())).toMatchObject({ type: 'error', error: 'The worker has already been sent init' })

    const broken = createConversionHandler(setup)
    const failed = await broken(init({ framework: { nquads: 'not N-Quads' } }))
    expect(failed).toMatchObject({ type: 'error' })
    expect(failed).not.toHaveProperty('seq')
    expect(await broken(convertRc(1))).toMatchObject({ type: 'error', seq: 1, error: expect.stringMatching(/^The worker failed to start/) })
  })

  it('passes the wasm URLs to the factories', async () => {
    const seen: string[] = []
    const handle = createConversionHandler({
      libcellml: async (options) => {
        seen.push(options!.locateFile!('libcellml.wasm', '/assets/'), options!.locateFile!('other.js', '/assets/'))
        return createLibCellML()
      },
      oxigraph,
      initOxigraph: async (options) => seen.push(options!.module_or_path),
    })
    await handle(init({ wasm: { libcellml: '/a/libcellml-123.wasm', oxigraph: '/a/web_bg-456.wasm' } }))
    expect(seen).toEqual(['/a/libcellml-123.wasm', '/assets/other.js', '/a/web_bg-456.wasm'])
  })

  it('makes a cause that cannot be posted a string', async () => {
    const handle = createConversionHandler(setup)
    await handle(init())
    // An issue from a stand-in Converter whose cause holds a function
    const original = Converter.prototype.convert
    Converter.prototype.convert = async function (this: Converter, ...args) {
      const result = await original.apply(this, args)
      const issue = { message: 'stub', severity: 'warning', stage: 'build', cause: { callback: () => {} } } as const
      return { ...result, issues: [issue], warnings: [issue] }
    }
    try {
      const reply = await handle(convertRc(1))
      expect(() => structuredClone(reply)).not.toThrow()
      expect(reply).toMatchObject({ result: { issues: [{ cause: '[object Object]' }], warnings: [{ cause: '[object Object]' }] } })
    } finally {
      Converter.prototype.convert = original
    }
  })

  it('frees what it makes over 100 conversions, and its memory stays flat', async () => {
    const made: { isDeleted(): boolean }[] = []
    const memories: WebAssembly.Memory[] = []
    const tracked: WorkerSetup['libcellml'] = async (options) => {
      const instantiate = WebAssembly.instantiate
      WebAssembly.instantiate = (async (bytes: BufferSource, imports?: WebAssembly.Imports) => {
        const result = await instantiate(bytes, imports)
        for (const value of Object.values(result.instance.exports)) if (value instanceof WebAssembly.Memory) memories.push(value)
        return result
      }) as unknown as typeof instantiate
      let libcellml: Record<string, unknown>
      try {
        libcellml = (await createLibCellML(options)) as Record<string, unknown>
      } finally {
        WebAssembly.instantiate = instantiate
      }
      const wrapped = Object.create(libcellml) as Record<string, unknown>
      for (const name of ['Model', 'Component', 'Variable', 'Units', 'Parser', 'Printer', 'Validator', 'Analyser']) {
        wrapped[name] = new Proxy(libcellml[name] as new () => { isDeleted(): boolean }, {
          construct: (target, args) => {
            const object = new target(...(args as []))
            made.push(object)
            return object
          },
        })
      }
      return wrapped
    }
    const handle = createConversionHandler({ ...setup, libcellml: tracked })
    await handle(init())
    const first = await handle(convertRc(0))
    if (first?.type !== 'result') throw new Error('No result')
    await handle({ type: 'defaults', defaults: { knownUnits: first.result.cellml! } })

    const memory = (): number => memories.reduce((total, m) => total + m.buffer.byteLength, 0)
    let warm = 0
    for (let seq = 1; seq <= 100; seq += 1) {
      const reply = await handle({ ...convertRc(seq), options: { sourceUri: rc.baseIri, checks: seq % 2 === 0 ? 'full' : 'none' } })
      expect(reply?.type).toBe('result')
      if (seq === 20) warm = memory()
    }
    expect(made.length).toBeGreaterThan(100)
    expect(made.filter((object) => !object.isDeleted())).toEqual([])
    expect(memories.length).toBeGreaterThan(0)
    expect(memory()).toBe(warm)
  }, 60_000)
})

/** A Worker running `startConversionWorker()` in this thread, which clones each message as postMessage does. */
function standInWorker(): WorkerLike & { posted: unknown[] } {
  type Listener = (event: { readonly data: unknown }) => void
  const toPage: Listener[] = []
  const toWorker: Listener[] = []
  const posted: unknown[] = []
  let terminated = false
  const deliver = (listeners: Listener[], message: unknown): void => {
    const data = structuredClone(message)
    setTimeout(() => !terminated && listeners.forEach((listener) => listener({ data })))
  }
  startConversionWorker(setup, { addEventListener: (_type, listener) => toWorker.push(listener), postMessage: (message) => deliver(toPage, message) })
  return {
    posted,
    postMessage: (message) => {
      posted.push(message)
      deliver(toWorker, message)
    },
    addEventListener: (type, listener) => {
      if (type === 'message') toPage.push(listener)
    },
    terminate: () => {
      terminated = true
    },
  }
}

describe('createConversionWorker', () => {
  const start = () => {
    const worker = standInWorker()
    return { worker, client: createConversionWorker(worker, { framework: { nquads }, defaults: { sourceUri: rc.baseIri, rdfSource: true } }) }
  }

  it('starts the worker and converts', async () => {
    const { client } = start()
    expect((await client.ready).framework.version).toBe('2026-04-12')
    const conversion = await client.convert(rcSource)
    expect(conversion.result).toMatchObject({ ok: true, modelType: 'ode' })
    client.setDefaults({ sourceUri: rc.baseIri, rdfSource: true, checks: 'none' })
    expect((await client.convert(rcSource)).result.checks).toBe('none')
    client.terminate()
  })

  it('delivers only the latest of a lane, sending one at a time', async () => {
    const { worker, client } = start()
    const live = client.latest()
    const full = client.latest()
    const results = Promise.all([live(rcSource), live(rcSource), full(rcSource, { checks: 'full' }), live(rcSource, { checks: 'none' })])
    const [first, second, other, last] = await results
    expect(first).toBeUndefined() // overtaken while it ran
    expect(second).toBeUndefined() // overtaken before it was sent
    expect(other?.result.checks).toBe('full')
    expect(last?.result.checks).toBe('none')
    const sent = worker.posted.filter((message) => (message as { type: string }).type === 'convert') as { lane: string }[]
    expect(sent.map((message) => message.lane)).toEqual(['latest-1', 'latest-2', 'latest-1'])
    client.terminate()
  })

  it('rejects when the worker fails to start, or is terminated', async () => {
    const worker = standInWorker()
    const client = createConversionWorker(worker, { framework: { nquads: 'not N-Quads' } })
    await expect(client.ready).rejects.toThrow()
    await expect(client.convert(rcSource)).rejects.toThrow(/failed to start/)

    const { client: other } = start()
    const pending = other.convert(rcSource)
    other.terminate()
    await expect(pending).rejects.toThrow(/terminated/)
    await expect(other.convert(rcSource)).rejects.toThrow(/terminated/)
  })
})
