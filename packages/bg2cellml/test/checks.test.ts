/**
 * `convert()`'s `checks`: both of libCellML's checks, the Validator alone, or
 * neither; and loading the framework from N-Quads.
 */

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter, type ConvertOptions, type Runtime } from '../src/index.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

const manifest = loadManifest()
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!

let libcellml: LibCellML
let converter: Converter

const converterWith = (runtimeLibcellml: LibCellML): Converter => {
  const runtime: Runtime = { libcellml: runtimeLibcellml, oxigraph, domParser: new DOMParser() as never }
  const made = new Converter(runtime)
  expect(made.loadFramework({ nquads: converter.frameworkNQuads()! })).toEqual([])
  return made
}

beforeAll(async () => {
  libcellml = (await createLibCellML()) as unknown as LibCellML
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
})

const convertCase = (name: string, options: ConvertOptions = {}, using = converter) => {
  const c = caseNamed(name)
  return using.convert(readSource(c), { sourceUri: c.baseIri, rdfSource: true, ...options })
}

describe('checks', () => {
  it('runs both checks by default, as full does', async () => {
    const byDefault = await convertCase('example_A1')
    expect(byDefault).toMatchObject({ ok: true, runnable: true, modelType: 'dae', checks: 'full' })
    expect(await convertCase('example_A1', { checks: 'full' })).toEqual(byDefault)
  })

  it("gives the same CellML and elements without checks, with runnable unknown", async () => {
    const full = await convertCase('example_A1')
    const none = await convertCase('example_A1', { checks: 'none' })
    expect(none).toMatchObject({ ok: true, runnable: undefined, checks: 'none', issues: [] })
    expect(none.modelType).toBeUndefined()
    expect(none.cellml).toBe(full.cellml)
    expect(none.elements).toEqual(full.elements)
  })

  it('is much faster without checks', async () => {
    const median = async (checks: 'none' | 'full'): Promise<number> => {
      const times: number[] = []
      for (let run = 0; run < 5; run += 1) {
        const start = performance.now()
        await convertCase('example_A1', { checks })
        times.push(performance.now() - start)
      }
      return times.sort((a, b) => a - b)[2]!
    }
    await median('none') // warm up
    expect(await median('none')).toBeLessThan((await median('full')) / 2)
  })

  it("doesn't analyse with validate, so an underconstrained model passes", async () => {
    // The capacitor with no initial charge: the Validator is content, the Analyser isn't
    const c = caseNamed('example_RC')
    const source = readSource(c).replace('bgf:hasValue "0 C"^^cdt:ucum ;', '')
    const options = { sourceUri: c.baseIri, rdfSource: true }
    const full = await converter.convert(source, options)
    expect(full).toMatchObject({ ok: false, runnable: false, modelType: 'underconstrained', checks: 'full' })
    expect(full.errors.every((issue) => issue.stage === 'analyser')).toBe(true)
    const validated = await converter.convert(source, { ...options, checks: 'validate' })
    expect(validated).toMatchObject({ ok: true, runnable: undefined, checks: 'validate', issues: [] })
    expect(validated.cellml).toBe(full.cellml)
  })

  it('reports what the Validator finds with validate, and not with none', async () => {
    const { Level } = libcellml.Issue
    const stub = Object.create(libcellml) as LibCellML
    Object.assign(stub, {
      Validator: class {
        validateModel(): void {}
        issueCount(): number {
          return 1
        }
        issue() {
          return { level: () => Level.ERROR, description: () => 'a stub error', delete: () => {} }
        }
        delete(): void {}
      },
      Analyser: class {
        constructor() {
          throw new Error('The Analyser ran')
        }
      },
    })
    const stubbed = converterWith(stub)

    const validated = await convertCase('example_RC', { checks: 'validate' }, stubbed)
    expect(validated).toMatchObject({ ok: false, runnable: false, modelType: 'invalid', checks: 'validate' })
    expect(validated.errors.map(({ message, stage }) => ({ message, stage }))).toEqual([
      { message: 'CellML validation: a stub error', stage: 'validator' },
    ])
    expect(validated.cellml).toContain('<model ')

    // full stops at the Validator's errors, and says so
    expect(await convertCase('example_RC', { checks: 'full' }, stubbed)).toMatchObject({ ok: false, runnable: false, checks: 'validate' })

    expect(await convertCase('example_RC', { checks: 'none' }, stubbed)).toMatchObject({ ok: true, runnable: undefined, checks: 'none', issues: [] })
  })

  it("says no checks ran when the model couldn't be built", async () => {
    const result = await converter.convert('this is not Turtle', { rdfSource: true })
    expect(result).toMatchObject({ ok: false, runnable: false, checks: 'none' })
    expect((await converter.convert('this is not Turtle', { rdfSource: true, checks: 'none' })).runnable).toBeUndefined()
  })
})

describe('loadFramework({ nquads })', () => {
  it('loads the framework frameworkNQuads() dumps, converting the same', async () => {
    expect(new Converter({ libcellml, oxigraph }).frameworkNQuads()).toBeUndefined()
    const nquads = converter.frameworkNQuads()!
    expect(nquads).toMatch(/^<.*> \.$/m)

    const reloaded = converterWith(libcellml)
    expect(reloaded.framework!.version).toBe(converter.framework!.version)
    expect(reloaded.frameworkNQuads()!.split('\n').length).toBe(nquads.split('\n').length)
    const original = await convertCase('example_A1', { metadata: true })
    expect(await convertCase('example_A1', { metadata: true }, reloaded)).toEqual(original)
  })

  it('merges named graphs', () => {
    const named = converter
      .frameworkNQuads()!
      .split('\n')
      .map((line) => line.replace(/ \.$/, ' <https://example.org/graph> .'))
      .join('\n')
    const loaded = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
    expect(loaded.loadFramework({ nquads: named })).toEqual([])
    expect(loaded.framework!.version).toBe(converter.framework!.version)
  })
})
