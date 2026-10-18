import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CELLML_BUILT_IN_UNITS,
  UcumError,
  nameUnits,
  parseUcum,
  parseUnitExpression,
  resolveSymbol,
  uniqueName,
  unitsName,
} from '../src/index.js'

import { BG_RDF_CODES } from './codes.js'

/** A small units library, as in PhLynx's tests. */
const LIBRARY = new Set([...CELLML_BUILT_IN_UNITS, 'celsius', 'fahrenheit', 'mM', 'Hz2', 'widget', 'per_widget'])

//==============================================================================
// PhLynx's own tests, ported (tests/vitest/utils/unitExpression.test.js)

describe('parseUnitExpression', () => {
  const symbols = (text: string) => {
    const parsed = parseUnitExpression(text)
    return 'error' in parsed ? parsed.error : parsed.symbols.map(({ text: written, sign }) => `${sign < 0 ? '/' : ''}${written}`)
  }
  const factor = (text: string) => {
    const parsed = parseUnitExpression(text)
    return 'error' in parsed ? Number.NaN : parsed.factor
  }
  const error = (text: string) => {
    const parsed = parseUnitExpression(text)
    return 'error' in parsed ? parsed.error : ''
  }

  it('reads . and / left to right, as UCUM does', () => {
    expect(symbols('mV/ms')).toEqual(['mV', '/ms'])
    expect(symbols('mmol/L/s')).toEqual(['mmol', '/L', '/s'])
    expect(symbols('mmol/L.s')).toEqual(['mmol', '/L', 's'])
  })

  it('groups with brackets, dividing by the whole group', () => {
    expect(symbols('mmol/(L.s)')).toEqual(['mmol', '/L', '/s'])
    expect(symbols('/(m/s)')).toEqual(['/m', 's'])
  })

  it('keeps exponents and square brackets with their symbol', () => {
    expect(symbols('kg.m-3')).toEqual(['kg', 'm-3'])
    expect(symbols('mm[Hg]-1.s2')).toEqual(['mm[Hg]-1', 's2'])
  })

  it('reads a leading / as one over', () => {
    expect(parseUnitExpression('/s')).toEqual({ factor: 1, symbols: [{ text: 's', sign: -1 }] })
  })

  it('reads integers and powers of ten as factors', () => {
    expect(factor('10*3/uL')).toBe(1000)
    expect(factor('10^-6.mol')).toBeCloseTo(1e-6, 18)
    expect(parseUnitExpression('1/s')).toEqual({ factor: 1, symbols: [{ text: 's', sign: -1 }] })
    expect(factor('/100')).toBe(0.01)
  })

  it('drops annotations, counting one on its own as 1', () => {
    expect(parseUnitExpression('{cells}/mL')).toEqual({ factor: 1, symbols: [{ text: 'mL', sign: -1 }] })
    expect(symbols('mL{RBC}/min')).toEqual(['mL', '/min'])
  })

  it('reports what it cannot read', () => {
    expect(error('')).toBeTruthy()
    expect(error('mV /ms')).toMatch(/Spaces/)
    expect(error('m^2')).toMatch(/straight after/)
    expect(error('(m.s)2')).toMatch(/exponent/)
    expect(error('(m.s')).toMatch(/\)/)
    expect(error('mV/')).toBeTruthy()
    expect(error('m{x')).toMatch(/\{/)
  })
})

describe('resolveSymbol', () => {
  const resolve = (text: string) => resolveSymbol(text, LIBRARY)

  it('prefers a library name as written', () => {
    expect(resolve('Hz2')).toMatchObject({ library: 'Hz2', exponent: 1 })
    expect(resolve('mM')).toMatchObject({ library: 'mM' })
  })

  it('reads UCUM symbols, with a prefix on metric ones only', () => {
    expect(resolve('mV')).toMatchObject({ atom: { units: 'volt' }, prefix: -3 })
    expect(resolve('dL')).toMatchObject({ atom: { units: 'litre' }, prefix: -1 })
    expect(resolve('dam')).toMatchObject({ atom: { units: 'metre' }, prefix: 1 })
    expect(resolve('min')).toMatchObject({ atom: { units: 'second', factor: 60 }, prefix: 0 })
    expect(resolve('cd')).toMatchObject({ atom: { units: 'candela' } })
    expect(resolve('mmin')).toBeNull()
  })

  it('reads a trailing integer as the exponent only when the whole symbol is unknown', () => {
    expect(resolve('m2')).toMatchObject({ atom: { units: 'metre' }, exponent: 2, label: 'm' })
    expect(resolve('s-1')).toMatchObject({ atom: { units: 'second' }, exponent: -1 })
    expect(resolve('m+2')).toMatchObject({ exponent: 2, label: 'm' })
    expect(resolve('mm[Hg]-1')).toMatchObject({ atom: { units: 'pascal' }, exponent: -1, label: 'mm[Hg]' })
    expect(resolve('mM2')).toMatchObject({ library: 'mM', exponent: 2 })
  })

  it('accepts bracketed symbols without their brackets', () => {
    expect(resolve('mmHg')).toMatchObject({ atom: { units: 'pascal', factor: 133322 }, prefix: -3 })
    expect(resolve('cmH2O')).toMatchObject({ atom: { units: 'pascal' }, prefix: -2 })
  })

  it('maps affine temperatures to their units', () => {
    expect(resolve('Cel')).toMatchObject({ affine: 'celsius' })
    expect(resolve('[degF]')).toMatchObject({ affine: 'fahrenheit' })
  })

  it('returns null for unknown symbols', () => {
    expect(resolve('xyz')).toBeNull()
    expect(resolve('2m')).toBeNull()
  })
})

describe('nameUnits', () => {
  it('names units in the library style', () => {
    expect(unitsName('mV/ms')).toBe('mV_per_ms')
    expect(unitsName('mmol/L/s')).toBe('mmol_per_L_per_s')
    expect(unitsName('kg.m-3')).toBe('kg_per_m3')
    expect(unitsName('mm[Hg]')).toBe('mmHg')
    expect(unitsName('m2')).toBe('m2')
    expect(unitsName('/s')).toBe('per_s')
    expect(unitsName('%')).toBe('percent')
  })

  it('combines repeated symbols', () => {
    expect(unitsName('m.m/s')).toBe('m2_per_s')
  })

  it('names factors with a prefix word where there is one', () => {
    expect(unitsName('10*9/L')).toBe('giga_per_L')
    expect(unitsName('10*-3.mol')).toBe('milli_mol')
    expect(unitsName('10*4/L')).toBe('_1e4_per_L')
    expect(nameUnits([{ label: 's', exponent: 1 }], 2.5)).toBe('_2p5_s')
    expect(nameUnits([{ label: 's', exponent: 1 }], 0.4)).toBe('s_per_2p5')
  })

  it('keeps clear of names already taken by other units', () => {
    expect(uniqueName(unitsName('mV/ms'), new Set(['mV_per_ms']))).toBe('mV_per_ms_1')
    expect(uniqueName('m', new Set(['m', 'm_1']))).toBe('m_2')
  })
})

//==============================================================================

describe('unitsName', () => {
  const fixture = JSON.parse(
    readFileSync(fileURLToPath(new URL('./fixtures/phlynx-names.json', import.meta.url)), 'utf8'),
  ) as { names: Record<string, string> }

  /**
   * Where unitsName deliberately differs from PhLynx: a single symbol that is
   * exactly a CellML built-in units is named as that units, so it needs no
   * definition. PhLynx names `F` `F` and defines it as farad.
   */
  const BUILT_IN: Record<string, string> = {
    mol: 'mole',
    L: 'litre',
    Ohm: 'ohm',
    F: 'farad',
    C: 'coulomb',
    A: 'ampere',
    J: 'joule',
    V: 'volt',
    H: 'henry',
    m: 'metre',
    s: 'second',
  }

  it.each(Object.entries(fixture.names).filter(([code]) => !(code in BUILT_IN)))(
    'names %s as PhLynx does: %s',
    (code, name) => {
      expect(unitsName(code, new Set([...CELLML_BUILT_IN_UNITS, 'celsius', 'fahrenheit']))).toBe(name)
    },
  )

  it.each(Object.entries(BUILT_IN))('names %s as the built-in units %s, where PhLynx defines new units', (code, name) => {
    expect(fixture.names[code]).toBe(code)
    expect(unitsName(code)).toBe(name)
  })

  it('uses built-in units only where the expression is exactly one', () => {
    expect(unitsName('kg')).toBe('kilogram')
    expect(unitsName('g')).toBe('gram')
    expect(unitsName('eq')).toBe('mole')
    // A prefix, an exponent, a scale or a second symbol needs a definition
    expect(unitsName('mF')).toBe('mF')
    expect(unitsName('Mg')).toBe('Mg')
    expect(unitsName('s2')).toBe('s2')
    expect(unitsName('min')).toBe('min')
    expect(unitsName('%')).toBe('percent')
    expect(unitsName('10*3.s')).toBe('kilo_s')
    expect(unitsName('C/s')).toBe('C_per_s')
  })

  it('covers every BG-RDF units code in the fixture', () => {
    for (const code of BG_RDF_CODES) expect(fixture.names, code).toHaveProperty([code])
  })

  it('gives every BG-RDF code a valid CellML identifier', () => {
    for (const code of BG_RDF_CODES) expect(unitsName(code)).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })

  it('gives equal names only to equal units', () => {
    // m2.J-1 and m2/J are the same units written two ways; every other BG-RDF code is distinct
    const byName = new Map<string, string[]>()
    for (const code of BG_RDF_CODES) byName.set(unitsName(code), [...(byName.get(unitsName(code)) ?? []), code])
    const shared = [...byName.values()].filter((codes) => codes.length > 1)
    expect(shared).toEqual([['m2.J-1', 'm2/J']])
  })

  it('is dimensionless for nothing, or symbols that cancel', () => {
    expect(unitsName('1')).toBe('dimensionless')
    expect(unitsName('m/m')).toBe('dimensionless')
    expect(unitsName('mL/mL')).toBe('dimensionless')
    // Different prefixes don't cancel: this is 1000, not 1
    expect(unitsName('L/mL')).toBe('L_per_mL')
  })

  it('accepts a parsed expression', () => {
    expect(unitsName(parseUcum('mol/s'))).toBe('mol_per_s')
  })
})

describe('parseUcum', () => {
  it('resolves every symbol to a CellML built-in units, prefix and exponent', () => {
    expect(parseUcum('mL/s')).toEqual({
      code: 'mL/s',
      factor: 1,
      symbols: [
        { label: 'mL', exponent: 1, atom: { units: 'litre', factor: 1, metric: true }, prefix: -3 },
        { label: 's', exponent: -1, atom: { units: 'second', factor: 1, metric: true }, prefix: 0 },
      ],
    })
  })

  it('resolves every BG-RDF code to CellML built-in units', () => {
    for (const code of BG_RDF_CODES) {
      for (const symbol of parseUcum(code).symbols) {
        expect(CELLML_BUILT_IN_UNITS.has(symbol.atom!.units), `${code}: ${symbol.label}`).toBe(true)
      }
    }
  })

  it('throws for what it cannot read or does not know', () => {
    expect(() => parseUcum('m^2')).toThrow(UcumError)
    expect(() => parseUcum('furlong')).toThrow(/Unknown units "furlong"/)
  })
})
