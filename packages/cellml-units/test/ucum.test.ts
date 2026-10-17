import { describe, expect, it } from 'vitest'

import { parseUcum, UCUM_TO_CELLML_PREFIX, UCUM_TO_CELLML_UNIT } from '../src/index.js'

describe('parseUcum', () => {
  it('turns division into negative exponents', () => {
    expect(parseUcum('mL/s')).toEqual([
      { atom: 'L', prefix: 'm', exponent: 1 },
      { atom: 's', exponent: -1 },
    ])
  })

  it('handles dotted products with exponents', () => {
    expect(parseUcum('L2.s-1.J-1')).toEqual([
      { atom: 'L', exponent: 2 },
      { atom: 's', exponent: -1 },
      { atom: 'J', exponent: -1 },
    ])
  })

  it('keeps annotations', () => {
    expect(parseUcum('mmol{Na}/L')).toEqual([
      { atom: 'mol', prefix: 'm', exponent: 1, annotation: 'Na' },
      { atom: 'L', exponent: -1 },
    ])
  })

  it('handles a leading division', () => {
    expect(parseUcum('/s')).toEqual([{ atom: 's', exponent: -1 }])
  })
})

describe('tables', () => {
  // Every unit code that appears in the BG-RDF templates and examples
  const BG_RDF_CODES = [
    'mol', 'L', 'mol-1', 'mol/s', 'Ohm', 'F', 'C', 'A', 'm/s', 'L2.s-1.J-1', 'L/mol', 'J/C', 'J',
    'J.s.C-1.m-1', 'J/mol', 'm2.J-1', 'V', 'J.s2.m-2', 'H', 'm', 'J.s.m-2', 'm2/J', 'm/s2', 'L/s',
    'J/m', 'J/L', 'J.s2.C-2', 'J.s.C-2', 'C2/J', 'C/s', 'C/mol', 's',
  ]

  it('maps every atom and prefix used by BG-RDF', () => {
    for (const code of BG_RDF_CODES) {
      for (const term of parseUcum(code)) {
        expect(UCUM_TO_CELLML_UNIT, `${code}: ${term.atom}`).toHaveProperty([term.atom])
        if (term.prefix !== undefined) expect(UCUM_TO_CELLML_PREFIX).toHaveProperty([term.prefix])
      }
    }
  })
})
