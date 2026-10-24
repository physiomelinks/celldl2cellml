import createLibCellML from 'libcellml.js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  UNIT_SYSTEMS,
  UcumError,
  compatible,
  convertValue,
  isStockUnitSystem,
  rescaleCode,
  rescaleFactor,
  rescaleUnits,
  unitSystem,
  unitsName,
  type LibCellML,
} from '../src/index.js'

import { BG_RDF_CODES, HARDER_CODES } from './codes.js'

let libcellml: LibCellML

beforeAll(async () => {
  libcellml = (await createLibCellML()) as unknown as LibCellML
})

/** Codes the Cellular preset can't rescale: derived units of charge or energy other than V. */
const UNSCALABLE = new Set(['Ohm', 'F', 'A', 'H', 'kPa', 'kOhm', 'uF', 'mm[Hg]', 'cm[H2O]'])

describe('unit systems', () => {
  it('has the SI and Cellular presets', () => {
    expect([...UNIT_SYSTEMS.keys()]).toEqual(['si', 'cellular'])
    expect(unitSystem('cellular')?.prefixes).toEqual({ amount: -15, volume: -12, energy: -15, charge: -15 })
    expect(unitSystem('nope')).toBeUndefined()
    expect(isStockUnitSystem('si')).toBe(true)
    expect(isStockUnitSystem('cellular')).toBe(false)
  })

  it('substitutes mol, L, J and C uniformly in Cellular', () => {
    expect(rescaleUnits('mol', 'cellular')).toEqual({ code: 'fmol', factor: 1e15 })
    expect(rescaleUnits('mol-1', 'cellular')).toEqual({ code: 'fmol-1', factor: 1e-15 })
    expect(rescaleCode('mol/s', 'cellular')).toBe('fmol/s')
    expect(rescaleCode('L/mol', 'cellular')).toBe('pL/fmol')
    expect(rescaleCode('L2.s-1.J-1', 'cellular')).toBe('pL2.s-1.fJ-1')
    expect(rescaleCode('J.s.C-2', 'cellular')).toBe('fJ.s.fC-2')
    expect(rescaleCode('J/m', 'cellular')).toBe('fJ/m')
    expect(rescaleCode('mmol{Na}/s', 'cellular')).toBe('fmol{Na}/s')
  })

  it('keeps codes whose scale is unchanged as given', () => {
    for (const code of ['J/mol', 'C/mol', 'J/C', 'V', 'm/s', 's', 'mmol/L', 'mV', '1', '%']) {
      expect(rescaleUnits(code, 'cellular'), code).toEqual({ code, factor: 1 })
    }
  })

  it('leaves unprefixed codes alone in SI, and unprefixes prefixed ones', () => {
    for (const code of BG_RDF_CODES) expect(rescaleUnits(code, 'si'), code).toEqual({ code, factor: 1 })
    expect(rescaleUnits('mmol/s', 'si')).toEqual({ code: 'mol/s', factor: 1e-3 })
  })

  it('gives the factor libCellML gives, for every BG-RDF and harder code', () => {
    for (const code of [...BG_RDF_CODES, ...HARDER_CODES]) {
      if (UNSCALABLE.has(code)) continue
      const { code: scaled, factor } = rescaleUnits(code, 'cellular')
      expect(compatible(libcellml, code, scaled), code).toBe(true)
      expect(convertValue(libcellml, 1, code, scaled), `${code} -> ${scaled}`).toBe(factor)
      expect(rescaleFactor(code, 'cellular')).toBe(factor)
    }
  })

  it('names scaled codes as PhLynx names its units', () => {
    expect(['fmol', 'fmol-1', 'fmol/s', 'pL/fmol', 'pL'].map((code) => unitsName(code))).toEqual([
      'fmol',
      'per_fmol',
      'fmol_per_s',
      'pL_per_fmol',
      'pL',
    ])
  })

  it("throws for codes Cellular can't rescale by substitution, and for unknown systems", () => {
    for (const code of UNSCALABLE) {
      expect(() => rescaleCode(code, 'cellular'), code).toThrow(UcumError)
    }
    try {
      rescaleCode('A', 'cellular')
    } catch (error) {
      expect((error as UcumError).reason).toBe('unit-system')
    }
    expect(() => rescaleCode('mol', 'metric' as 'si')).toThrow(/Unknown unit system/)
    expect(() => rescaleCode('m^2', 'cellular')).toThrow(UcumError)
  })
})
