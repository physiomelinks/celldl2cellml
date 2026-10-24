/**
 * Diagrams saved by the CellDL editor, one for each element template its
 * element audit found unusable: a template's variable values (as
 * `bgf:variableValue`), an elastic vessel's defaults, and a One storage node.
 * Each converts and simulates to finite values.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter } from '../src/index.js'
import { decodeValue, frameworkSource } from './reference.js'
import { loadLibOpenCOR, simulate, type LibOpenCOR } from './simulate.js'

const SETTINGS = { start: 0, end: 1, steps: 100, recordedEvery: 1 }

let converter: Converter
let loc: LibOpenCOR

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource())).toEqual([])
  loc = await loadLibOpenCOR()
})

describe("the editor's diagrams", () => {
  it.each([
    ['osmotic-transporter', 'ode'],
    ['elastic-vessels', 'dae'],
    ['electrical-inductive-node', 'dae'],
  ])('%s converts as %s and simulates', async (name, modelType) => {
    const source = readFileSync(new URL(`./models/editor/${name}.ttl`, import.meta.url), 'utf8')
    const result = await converter.convert(source, { sourceUri: `https://example.org/${name}.celldl`, rdfSource: true })
    expect(result.errors).toEqual([])
    expect(result).toMatchObject({ ok: true, runnable: true, modelType })
    const { states } = simulate(loc, result.cellml!, SETTINGS)
    expect(Object.keys(states).length).toBeGreaterThan(0)
    for (const trajectory of Object.values(states)) {
      expect(trajectory.map(decodeValue).every(Number.isFinite)).toBe(true)
    }
  })
})
