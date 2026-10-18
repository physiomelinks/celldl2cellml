import createLibCellML from 'libcellml.js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  UcumError,
  builtInUnits,
  compatible,
  convertValue,
  parseUcum,
  resolveSymbol,
  toCellMLUnits,
  unitsName,
  type LibCellML,
  type Units,
} from '../src/index.js'

import { BG_RDF_CODES, HARDER_CODES } from './codes.js'

// The parts of libCellML these tests use beyond Units
interface Model {
  setName(name: string): void
  addUnits(units: Units): void
  addComponent(component: Component): void
}
interface Component {
  setName(name: string): void
  addVariable(variable: Variable): void
}
interface Variable {
  setName(name: string): void
  setUnitsByName(name: string): void
}
interface TestLibCellML extends LibCellML {
  Model: new () => Model
  Component: new () => Component
  Variable: new () => Variable
  Validator: new () => { validateModel(model: Model): void; issueCount(): number; issue(index: number): { description(): string } }
  Printer: new () => { printModel(model: Model, autoIds: boolean): string }
}

let libcellml: TestLibCellML

beforeAll(async () => {
  libcellml = (await createLibCellML()) as unknown as TestLibCellML
})

/** A model with the units for each code, and a variable in each, plus the Validator's issues and the printed CellML. */
function modelFor(codes: readonly string[]): { issues: string[]; cellml: string } {
  const model = new libcellml.Model()
  model.setName('units_test')
  const component = new libcellml.Component()
  component.setName('main')
  model.addComponent(component)

  const defined = new Set<string>()
  codes.forEach((code, index) => {
    const name = unitsName(code)
    if (!defined.has(name)) {
      const units = toCellMLUnits(libcellml, code)
      if (units !== undefined) model.addUnits(units)
      defined.add(name)
    }
    const variable = new libcellml.Variable()
    variable.setName(`v_${index}`)
    variable.setUnitsByName(name)
    component.addVariable(variable)
  })

  const validator = new libcellml.Validator()
  validator.validateModel(model)
  const issues = Array.from({ length: validator.issueCount() }, (_, index) => validator.issue(index).description())
  return { issues, cellml: new libcellml.Printer().printModel(model, false) }
}

/** The `<unit>` elements libCellML prints for a code. */
function unitElements(code: string): string[] {
  return modelFor([code]).cellml.match(/<unit [^>]*\/>/g) ?? []
}

//==============================================================================

describe('toCellMLUnits', () => {
  it('builds valid CellML 2.0 units for every BG-RDF code', () => {
    expect(modelFor(BG_RDF_CODES).issues).toEqual([])
  })

  it('builds valid units for the codes that send Python into recursion, and other harder codes', () => {
    expect(modelFor(HARDER_CODES).issues).toEqual([])
  })

  it('has nothing to define for a built-in units, or for dimensionless', () => {
    for (const code of ['F', 'mol', 's', 'kg', 'Ohm', '1', 'm/m', 'mL/mL']) expect(toCellMLUnits(libcellml, code), code).toBeUndefined()
    expect(modelFor(['F', 'kg', '1']).cellml).not.toContain('<units ')
  })

  it('writes each symbol as a built-in units with its prefix and exponent', () => {
    expect(unitElements('uF')).toEqual(['<unit prefix="micro" units="farad"/>'])
    expect(unitElements('mmol/s')).toEqual(['<unit prefix="milli" units="mole"/>', '<unit exponent="-1" units="second"/>'])
    expect(unitElements('L2.s-1.J-1')).toEqual([
      '<unit exponent="2" units="litre"/>',
      '<unit exponent="-1" units="second"/>',
      '<unit exponent="-1" units="joule"/>',
    ])
    expect(unitElements('kg.m-3')).toEqual(['<unit prefix="kilo" units="gram"/>', '<unit exponent="-3" units="metre"/>'])
    expect(unitElements('dam')).toEqual(['<unit prefix="deca" units="metre"/>'])
  })

  it('puts every factor in the first unit’s multiplier', () => {
    expect(unitElements('/min')).toEqual(['<unit exponent="-1" multiplier="0.0166666666666667" units="second"/>'])
    expect(unitElements('mm[Hg]')).toEqual(['<unit multiplier="133322" prefix="milli" units="pascal"/>'])
    expect(unitElements('10*9/L')).toEqual(['<unit exponent="-1" multiplier="1000000000" units="litre"/>'])
    expect(unitElements('%')).toEqual(['<unit multiplier="0.01" units="dimensionless"/>'])
    expect(unitElements('s.min')).toEqual(['<unit multiplier="60" units="second"/>', '<unit units="second"/>'])
    // libCellML's Printer writes 15 significant figures: 60 × 4.184 is 251.04000000000002
    expect(unitElements('min.cal')).toEqual(['<unit multiplier="251.04" units="second"/>', '<unit units="joule"/>'])
  })

  it('is a scaled dimensionless for a factor with no symbols', () => {
    expect(unitElements('10*3')).toEqual(['<unit multiplier="1000" units="dimensionless"/>'])
  })

  it('names the units unitsName’s name unless given one', () => {
    expect(toCellMLUnits(libcellml, 'mol/s')!.name()).toBe('mol_per_s')
    expect(toCellMLUnits(libcellml, parseUcum('mol/s'), 'flux')!.name()).toBe('flux')
  })

  it('refers to units from a library by name', () => {
    const units = toCellMLUnits(libcellml, 'mM/s', undefined, new Set(['mM']))!
    expect(units.name()).toBe('mM_per_s')
    expect(units.unitCount()).toBe(2)
  })

  it('throws for affine temperatures, which CellML 2.0 has no units for', () => {
    expect(() => toCellMLUnits(libcellml, 'Cel')).toThrow(UcumError)
    expect(() => toCellMLUnits(libcellml, 'Cel/s')).toThrow(/"Cel" in "Cel\/s" is an affine temperature/)
  })
})

//==============================================================================

describe('compatible', () => {
  it('keeps mole as a base unit', () => {
    expect(compatible(libcellml, 'mol/s', '/s')).toBe(false)
    expect(compatible(libcellml, 'mol-1', '%')).toBe(false)
  })

  it('compares units by what they are, not by name', () => {
    expect(compatible(libcellml, 'mmol/s', 'mol/s')).toBe(true)
    expect(compatible(libcellml, 'C/s', 'A')).toBe(true)
    expect(compatible(libcellml, 'J/C', 'V')).toBe(true)
    expect(compatible(libcellml, 'kPa', 'J/L')).toBe(true)
    expect(compatible(libcellml, 'm2.J-1', 'm2/J')).toBe(true)
    expect(compatible(libcellml, 'F', 'H')).toBe(false)
  })

  it('finds every BG-RDF code compatible with itself and nothing else of a different kind', () => {
    for (const code of BG_RDF_CODES) expect(compatible(libcellml, code, code), code).toBe(true)
    expect(compatible(libcellml, 'J.s.C-2', 'Ohm')).toBe(true)
    expect(compatible(libcellml, 'C2/J', 'F')).toBe(true)
    expect(compatible(libcellml, 'J.s2.C-2', 'H')).toBe(true)
  })

  it('throws for codes it can’t compare', () => {
    expect(() => compatible(libcellml, 'furlong', 'm')).toThrow(UcumError)
    expect(() => compatible(libcellml, 'Cel', 'K')).toThrow(UcumError)
    expect(() => compatible(libcellml, parseUcum('mM', new Set(['mM'])), 'mol/L')).toThrow(/library units/)
  })
})

describe('convertValue', () => {
  it('converts the values in the work plan', () => {
    expect(convertValue(libcellml, 1000, 'uF', 'F')).toBe(0.001)
    expect(convertValue(libcellml, 0.01, 'kOhm', 'Ohm')).toBe(10)
    expect(convertValue(libcellml, 10000, 'mV', 'V')).toBe(10)
  })

  it('converts in the direction asked', () => {
    expect(convertValue(libcellml, 1, 'F', 'uF')).toBe(1e6)
    expect(convertValue(libcellml, 1, 'min', 's')).toBe(60)
    expect(convertValue(libcellml, 120, 's', 'min')).toBe(2)
    expect(convertValue(libcellml, 2, 'mmol/s', 'mol/s')).toBe(0.002)
  })

  it('converts between differently written units', () => {
    expect(convertValue(libcellml, 1, 'kPa', 'J/L')).toBe(1)
    expect(convertValue(libcellml, 1, 'mm[Hg]', 'Pa')).toBe(133.322)
    expect(convertValue(libcellml, 50, '%', '1')).toBe(0.5)
    expect(convertValue(libcellml, 3, '10*9/L', '/mL')).toBe(3e6)
    expect(convertValue(libcellml, 1, 'C/s', 'mA')).toBe(1000)
  })

  it('converts kilograms, which libCellML gets wrong between bare built-ins', () => {
    expect(builtInUnits(parseUcum('kg'))).toBe('kilogram')
    expect(convertValue(libcellml, 1, 'kg', 'g')).toBe(1000)
    expect(convertValue(libcellml, 1, 'g', 'kg')).toBe(0.001)
  })

  it('rounds away floating-point noise', () => {
    expect(0.29 * 100).toBe(28.999999999999996)
    expect(convertValue(libcellml, 0.29, 'm', 'cm')).toBe(29)
    expect(convertValue(libcellml, 0.1 + 0.2, 'm', 'm')).toBe(0.3)
  })

  it('leaves values in the same units alone', () => {
    for (const code of BG_RDF_CODES) expect(convertValue(libcellml, 2.5, code, code), code).toBe(2.5)
  })

  it('throws for incompatible units', () => {
    expect(() => convertValue(libcellml, 1, 'mol/s', '/s')).toThrow(UcumError)
    expect(() => convertValue(libcellml, 1, 'F', 'H')).toThrow(/Can't convert from "F" to "H": the units aren't compatible/)
  })
})

//==============================================================================

/** The UcumError `run` throws. */
function failure(run: () => unknown): UcumError {
  try {
    run()
  } catch (error) {
    if (error instanceof UcumError) return error
    throw error
  }
  throw new Error('Expected a UcumError')
}

describe('unsupported units', () => {
  it('supports percent and pi as scaled dimensionless units', () => {
    expect(unitsName('%')).toBe('percent')
    expect(unitsName('[pi].rad')).toBe('pi_rad')
    expect(unitElements('[pi]')).toEqual(['<unit multiplier="3.14159265358979" units="dimensionless"/>'])
    expect(compatible(libcellml, '[pi]', '1')).toBe(true)
    expect(convertValue(libcellml, 2, '[pi].rad', 'rad')).toBe(6.28318530717959)
    expect(convertValue(libcellml, 25, '%', '1')).toBe(0.25)
  })

  it('reads affine temperatures and names them, but can’t build, compare or convert them', () => {
    expect(unitsName('Cel')).toBe('celsius')
    expect(failure(() => toCellMLUnits(libcellml, 'Cel/s'))).toMatchObject({ reason: 'affine', code: 'Cel/s', symbol: 'Cel' })
    expect(failure(() => toCellMLUnits(libcellml, '[degF]'))).toMatchObject({ reason: 'affine', symbol: '[degF]' })
    expect(failure(() => convertValue(libcellml, 20, 'Cel', 'K')).message).toBe(
      '"Cel" in "Cel" is an affine temperature, which CellML 2.0 can\'t express; use K',
    )
  })

  it.each([
    ['[iU]', '[iU]'],
    ['[iU]/L', '[iU]'],
    ['m[IU]/mL', 'm[IU]'],
    ["[arb'U]", "[arb'U]"],
    ['[CFU]/mL', '[CFU]'],
    ['[iU]2', '[iU]2'],
  ])('rejects the arbitrary units in %s', (code, symbol) => {
    expect(failure(() => parseUcum(code))).toMatchObject({ reason: 'arbitrary', code, symbol })
  })

  it.each([
    ['[pH]', '[pH]'],
    ['dB', 'dB'],
    ['Np', 'Np'],
    ['B[SPL]', 'B[SPL]'],
    ['B[10.nV]', 'B[10.nV]'],
  ])('rejects the logarithmic units in %s', (code, symbol) => {
    expect(failure(() => parseUcum(code))).toMatchObject({ reason: 'logarithmic', code, symbol })
  })

  it('names the code and the symbol in the message', () => {
    expect(failure(() => parseUcum('[iU]/L')).message).toBe('"[iU]" in "[iU]/L" is an arbitrary units, which can\'t be related to CellML units')
    expect(failure(() => parseUcum('mol/[pH]')).message).toBe('"[pH]" in "mol/[pH]" is a logarithmic units, which CellML units can\'t express')
  })

  it('rejects them wherever a code is used', () => {
    expect(failure(() => unitsName('[iU]/L')).reason).toBe('arbitrary')
    expect(failure(() => toCellMLUnits(libcellml, '[iU]/L')).reason).toBe('arbitrary')
    expect(failure(() => compatible(libcellml, '[pH]', '1')).reason).toBe('logarithmic')
    expect(failure(() => convertValue(libcellml, 1, 'dB', '1')).reason).toBe('logarithmic')
  })

  it('leaves resolveSymbol as PhLynx has it', () => {
    expect(resolveSymbol('[iU]')).toBeNull()
    expect(resolveSymbol('[pH]')).toBeNull()
  })

  it('gives a reason for every other failure', () => {
    expect(failure(() => parseUcum('m^2'))).toMatchObject({ reason: 'syntax', code: 'm^2', symbol: undefined })
    expect(failure(() => parseUcum('furlong/s'))).toMatchObject({ reason: 'unknown', code: 'furlong/s', symbol: 'furlong' })
    expect(failure(() => parseUcum('[foo]'))).toMatchObject({ reason: 'unknown', symbol: '[foo]' })
    expect(failure(() => parseUcum('kB'))).toMatchObject({ reason: 'logarithmic', symbol: 'kB' })
    expect(failure(() => compatible(libcellml, parseUcum('mM', new Set(['mM'])), 'mol/L'))).toMatchObject({
      reason: 'library',
      code: 'mM',
      symbol: 'mM',
    })
    expect(failure(() => convertValue(libcellml, 1, 'F', 'H'))).toMatchObject({ reason: 'incompatible', code: 'F' })
  })
})

