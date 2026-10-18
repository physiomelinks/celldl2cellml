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

  // These pin down libCellML's behaviour that toCellMLUnits, compatible and convertValue rely on.
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

  it('gives the factor that takes a value in the second units to the first', () => {
    const farad = new libcellml.Units('F')
    farad.addUnitByReferenceExponent('farad', 1, '')
    const microfarad = new libcellml.Units('uF')
    microfarad.addUnitByReferenceStringPrefix('farad', 'micro', 1, 1, '')
    // 1 F is 1e6 uF
    expect(libcellml.Units.scalingFactor(microfarad, farad, true)).toBe(1e6)
  })

  it('applies a prefix before the exponent and the multiplier after it', () => {
    const squareMetre = new libcellml.Units('m2')
    squareMetre.addUnitByReferenceExponent('metre', 2, '')
    const scaled = new libcellml.Units('scaled')
    scaled.addUnitByReferenceStringPrefix('metre', 'milli', 2, 10, '')
    // 10 × (1e-3 m)² is 1e-5 m²
    expect(libcellml.Units.scalingFactor(scaled, squareMetre, true)).toBeCloseTo(1e5)
  })

  it('gets kilogram and gram wrong when both are bare built-ins', () => {
    // So cellml-units always compares definitions that refer to built-ins
    expect(libcellml.Units.scalingFactor(new libcellml.Units('kilogram'), new libcellml.Units('gram'), true)).toBe(1)
  })
})
