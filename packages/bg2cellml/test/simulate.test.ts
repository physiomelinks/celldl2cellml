import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

import { compareResults, loadManifest, loadReference, type ReferenceCase } from './reference.js'
import { loadLibOpenCOR, recordedIndices, shortName, simulate, SimulationError, type LibOpenCOR } from './simulate.js'

const manifest = loadManifest()
const exampleRC = manifest.cases.find((c) => c.name === 'example_RC')!

function pythonCellml(c: ReferenceCase): string {
  return readFileSync(fileURLToPath(new URL(`./reference/${c.pythonCellml}`, import.meta.url)), 'utf8')
}

let loc: LibOpenCOR

beforeAll(async () => {
  loc = await loadLibOpenCOR()
})

describe('simulate', () => {
  it("reproduces example_RC's reference from the Python CellML", () => {
    const reference = loadReference(exampleRC)
    const result = simulate(loc, pythonCellml(exampleRC), reference.simulation)
    expect(result.voi.values).toHaveLength(reference.voi.values.length)
    expect(Object.keys(result.states).sort()).toEqual(Object.keys(reference.states).sort())
    expect(compareResults(result, reference, manifest.tolerance)).toEqual([])
  })

  it('can simulate the same model twice', () => {
    const reference = loadReference(exampleRC)
    const first = simulate(loc, pythonCellml(exampleRC), reference.simulation)
    const second = simulate(loc, pythonCellml(exampleRC), reference.simulation)
    expect(second).toEqual(first)
  })

  it('throws libOpenCOR messages for files it cannot read', () => {
    const settings = { start: 0, end: 1, steps: 10, recordedEvery: 1 }
    expect(() => simulate(loc, 'not CellML', settings)).toThrow(SimulationError)
    expect(() => simulate(loc, 'not CellML', settings)).toThrow(/CellML issues/)
  })

  it('turns a libOpenCOR crash into a SimulationError', () => {
    // A model with no components: Python's libOpenCOR reports an issue, the WebAssembly build traps
    const settings = { start: 0, end: 1, steps: 10, recordedEvery: 1 }
    expect(() => simulate(loc, '<model xmlns="http://www.cellml.org/cellml/2.0#" name="empty"/>', settings)).toThrow(
      SimulationError,
    )
  })

  it('still works after a failed simulation', () => {
    const reference = loadReference(exampleRC)
    const result = simulate(loc, pythonCellml(exampleRC), reference.simulation)
    expect(compareResults(result, reference, manifest.tolerance)).toEqual([])
  })

  it('is caught by the comparison when a value is wrong', () => {
    const reference = loadReference(exampleRC)
    const result = simulate(loc, pythonCellml(exampleRC), reference.simulation)
    const q = result.states['q_1']!
    q[50] = (q[50] as number) * 1.01
    expect(compareResults(result, reference, manifest.tolerance)).toEqual([
      expect.stringMatching(/^states\.q_1 differs at 1 points, first at t=0\.05:/),
    ])
  })
})

describe('every reference, from its Python CellML', () => {
  // The JavaScript libOpenCOR, simulating what the Python bg2cellml wrote, must give
  // what the Python libOpenCOR gave. This checks the harness before parity relies on it.
  const examples = manifest.cases.filter((c) => c.kind === 'example')

  it('covers all 14 BG-RDF examples', () => {
    expect(examples).toHaveLength(14)
    expect(examples.every((c) => c.pythonCellml !== undefined)).toBe(true)
  })

  it.each(examples.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const reference = loadReference(c)
    const result = simulate(loc, pythonCellml(c), reference.simulation)
    for (const group of ['states', 'rates', 'algebraics'] as const) {
      expect(Object.keys(result[group]).sort(), group).toEqual(Object.keys(reference[group]).sort())
    }
    expect(result.voi.values).toHaveLength(reference.voi.values.length)
    expect(compareResults(result, reference, manifest.tolerance)).toEqual([])
  })
})

describe('helpers', () => {
  it('pick the points the reference generator records', () => {
    expect(recordedIndices(100, 1)).toHaveLength(101)
    expect(recordedIndices(4000, 40)).toEqual(Array.from({ length: 101 }, (_, i) => i * 40))
    expect(recordedIndices(10, 3)).toEqual([0, 3, 6, 9, 10])
  })

  it('compare infinities and NaN exactly', () => {
    const expected = loadReference(exampleRC)
    const withValue = (value: number) => ({
      ...expected,
      states: { x: [value] },
      rates: {},
      algebraics: {},
    })
    const reference = { ...withValue(0), states: { x: ['-Infinity' as const] } }
    expect(compareResults(withValue(-Infinity), reference, manifest.tolerance)).toEqual([])
    expect(compareResults(withValue(Infinity), reference, manifest.tolerance)).toHaveLength(1)
    expect(compareResults(withValue(Number.NaN), reference, manifest.tolerance)).toHaveLength(1)
    expect(compareResults(withValue(-1e300), reference, manifest.tolerance)).toHaveLength(1)
    const nanReference = { ...withValue(0), states: { x: ['NaN' as const] } }
    expect(compareResults(withValue(Number.NaN), nanReference, manifest.tolerance)).toEqual([])
  })

  it('name variables as the references do', () => {
    expect(shortName('main/q_1')).toBe('q_1')
    expect(shortName("main/q_1'")).toBe('q_1')
  })
})
