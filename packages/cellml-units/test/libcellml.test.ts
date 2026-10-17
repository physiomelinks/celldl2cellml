import createLibCellML from 'libcellml.js'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '../src/index.js'

let libcellml: LibCellML

beforeAll(async () => {
  libcellml = (await createLibCellML()) as unknown as LibCellML
})

describe('libCellML units', () => {
  it('loads the WebAssembly module', () => {
    expect(libcellml.versionString()).toMatch(/^\d+\.\d+\.\d+/)
  })

  // These pin down libCellML's behaviour that toCellMLUnits and convertValue will rely on.
  it('treats mole as a base unit', () => {
    const molPerS = new libcellml.Units('mol_per_s')
    molPerS.addUnitByReferenceExponent('mole', 1, '')
    molPerS.addUnitByReferenceExponent('second', -1, '')
    const perS = new libcellml.Units('per_s')
    perS.addUnitByReferenceExponent('second', -1, '')
    expect(libcellml.Units.compatible(molPerS, perS)).toBe(false)
  })

  it('gives scaling factors for prefixes', () => {
    const mmolPerS = new libcellml.Units('mmol_per_s')
    mmolPerS.addUnitByReferenceStringPrefix('mole', 'milli', 1, 1, '')
    mmolPerS.addUnitByReferenceExponent('second', -1, '')
    const molPerS = new libcellml.Units('mol_per_s')
    molPerS.addUnitByReferenceExponent('mole', 1, '')
    molPerS.addUnitByReferenceExponent('second', -1, '')
    expect(libcellml.Units.compatible(mmolPerS, molPerS)).toBe(true)
    expect(libcellml.Units.scalingFactor(mmolPerS, molPerS, true)).toBeCloseTo(1000)
  })
})
