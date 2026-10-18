/**
 * Plan chunk 7.4: cases the Python bg2cellml can't check, against
 * expectations worked out by hand.
 *
 * - **A bond with `bgf:bondCount`:** example_B2 and example_B2_reduced, in
 *   parity.test.ts, against a hand-worked reference (`mixedReaction` in
 *   test/hand-worked.ts) and PMR's FAIRDO BG example 3.5.
 * - **A template in prefixed units:** test/models/prefixed_electrical.ttl, an
 *   electrical domain in mC, mA and V, with RC_prefixed_template.ttl, an RC
 *   circuit on it. Python can't load the templates (bug 1).
 * - **A CellDL document saved by the CellDL Editor:**
 *   test/models/rdf_error.celldl, from BG-Tools' tests (commit 9d44196): a
 *   mechanical series R, C and L, saved on Windows at the Vital workshop,
 *   where its file path as the base IRI failed in Python with
 *   `Invalid IRI code point ' '`.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter } from '../src/index.js'
import { fromSolutions } from './hand-worked.js'
import { compareResults, frameworkSource, loadManifest } from './reference.js'
import { loadLibOpenCOR, simulate } from './simulate.js'

const manifest = loadManifest()
const model = (file: string): string => readFileSync(new URL(`./models/${file}`, import.meta.url), 'utf8')

let converter: Converter

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  const bgRdf = frameworkSource(manifest)
  const issues = converter.loadFramework({ ...bgRdf, templates: { ...bgRdf.templates, 'prefixed_electrical.ttl': model('prefixed_electrical.ttl') } })
  expect(issues).toEqual([])
})

/** The CellML, with no issues. */
async function convert(source: string, sourceUri: string, rdfSource: boolean): Promise<string> {
  const output = await converter.celldl2cellml(source, { sourceUri, rdfSource, debug: true })
  expect(output.exception).toBeUndefined()
  expect(output.issues ?? []).toEqual([])
  expect(output.cellml).toBeDefined()
  return output.cellml!
}

/** Each variable's units and initial value, as the CellML has them. */
function variables(cellml: string): Record<string, { units: string; initialValue?: number }> {
  return Object.fromEntries(
    [...cellml.matchAll(/<variable name="([^"]+)" units="([^"]+)"(?: initial_value="([^"]+)")?/g)].map(([, name, units, value]) => [
      name!,
      value === undefined ? { units: units! } : { units: units!, initialValue: Number(value) },
    ]),
  )
}

describe('a template in prefixed units', () => {
  // q = C V (1 - exp(-t/RC)) with R = 10 Ohm, C = 1000 uF, V = 10 V: tau = 0.01 s, C V = 10 mC
  const tau = 0.01
  const charge = (t: number) => 10 * (1 - Math.exp(-t / tau)) // mC, and u_C in V as C = 1 mF
  const current = (t: number) => (10 / tau) * Math.exp(-t / tau) // mA
  const resistorVoltage = (t: number) => 10 * Math.exp(-t / tau) // V
  let cellml: string

  beforeAll(async () => {
    cellml = await convert(model('RC_prefixed_template.ttl'), 'https://example.org/bg2cellml/test/RC_prefixed_template.ttl', true)
  })

  it("puts the variables in the template's units, and values into them", () => {
    const units = (name: string) => cellml.match(new RegExp(`<units name="${name}">([\\s\\S]*?)</units>`))?.[1]?.replace(/\s+/g, ' ').trim()
    const v = variables(cellml)
    expect(v['q_1']).toEqual({ units: 'mC', initialValue: 0 })
    expect(v['v_q_1']?.units).toBe('mA')
    expect(v['u_q_1']?.units).toBe('volt')
    // 1000 uF is 1 mF; 10 Ohm is 0.01 kOhm
    expect(v['C_q_1']).toEqual({ units: 'mF', initialValue: 1 })
    expect(v['R_R_0']).toEqual({ units: 'kOhm', initialValue: 0.01 })
    expect(v['u_V_in']).toEqual({ units: 'volt', initialValue: 10 })
    expect(units('mC')).toBe('<unit prefix="milli" units="coulomb"/>')
    expect(units('mF')).toBe('<unit prefix="milli" units="farad"/>')
    expect(units('kOhm')).toBe('<unit prefix="kilo" units="ohm"/>')
  })

  it('simulates as worked out by hand', async () => {
    const expected = fromSolutions(
      { start: 0, end: 0.1, steps: 100, recordedEvery: 1 },
      {
        states: { q_1: charge },
        rates: { q_1: current },
        algebraics: {
          v_q_1: current,
          u_q_1: charge,
          V_C: charge,
          u_R_0: resistorVoltage,
          v_R_0: current,
          I_R: current,
          // A port's flow is into its element, so the source's is negative (as in Python's example_RC)
          v_V_in: (t) => -current(t),
        },
      },
    )
    const actual = simulate(await loadLibOpenCOR(), cellml, expected.simulation)
    expect(compareResults(actual, expected, manifest.tolerance)).toEqual([])
  })
})

describe('a CellDL document saved by the CellDL Editor', () => {
  // A mass (L), spring (C) and damper (R) in series, all 1, sharing velocity v:
  // L dv/dt = -(R v + q/C), dq/dt = v, so q'' + q' + q = 0, with q(0) = 1 m and v(0) = 1 m/s:
  //     q = exp(-t/2) (cos wt + sqrt(3) sin wt),  v = exp(-t/2) (cos wt - sqrt(3) sin wt),  w = sqrt(3)/2
  // and dv/dt = -(q + v) = -2 exp(-t/2) cos wt
  const w = Math.sqrt(3) / 2
  const q = (t: number) => Math.exp(-t / 2) * (Math.cos(w * t) + Math.sqrt(3) * Math.sin(w * t))
  const v = (t: number) => Math.exp(-t / 2) * (Math.cos(w * t) - Math.sqrt(3) * Math.sin(w * t))
  const a = (t: number) => -2 * Math.exp(-t / 2) * Math.cos(w * t)
  const celldl = model('rdf_error.celldl')

  it('simulates as worked out by hand, from a percent-encoded Windows file URL', async () => {
    const cellml = await convert(celldl, 'file:///C:/Users/Some%20One/rdf_error.celldl', false)
    const expected = fromSolutions(
      { start: 0, end: 10, steps: 1000, recordedEvery: 10 },
      {
        states: { q_m_C: q, v_L_m_L: v },
        rates: { q_m_C: v, v_L_m_L: a },
        algebraics: {
          v_q_m_C: v,
          u_q_m_C: q,
          u_m_C: q,
          v_R_m_R: v,
          u_R_m_R: v,
          u_m_R: v,
          u_L_m_L: a,
          a_L_m_L: a,
          u_m_L: a,
          v_m_1: v,
        },
      },
    )
    const actual = simulate(await loadLibOpenCOR(), cellml, expected.simulation)
    expect(compareResults(actual, expected, manifest.tolerance)).toEqual([])
  })

  it('reports a source URI that is a file path, or has a space, and does nothing else', async () => {
    for (const sourceUri of ['C:\\Users\\Some One\\rdf_error.celldl', 'file:///C:/Users/Some One/rdf_error.celldl', 'rdf_error.celldl']) {
      const output = await converter.celldl2cellml(celldl, { sourceUri })
      expect(output.cellml).toBeUndefined()
      expect(output.issues).toHaveLength(1)
      expect(output.issues![0]).toMatch(new RegExp(`^sourceUri isn't an absolute IRI: ${JSON.stringify(sourceUri).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')} \\(.+\\)\\. A file path must be given as a file: URL`))
    }
    const output = await converter.celldl2cellml(celldl, { sourceUri: 'file:///C:/Users/rdf_error.celldl', cellmlUri: 'C:\\Users\\rdf_error.cellml' })
    expect(output.issues).toEqual([expect.stringMatching(/^cellmlUri isn't an absolute IRI: /)])
  })
})
