import { describe, expect, it } from 'vitest'

import {
  children,
  ci,
  cn,
  diff,
  divide,
  eq,
  equals,
  exp,
  mapChildren,
  minus,
  sortKey,
  substitute,
  times,
  variables,
  type AstNode,
} from '../src/index.js'

// v = kappa*(exp(u_f/RT) - exp(u_r/RT)), the ChemicalReaction template's relation
const reaction = eq(
  ci('v'),
  times(ci('kappa'), minus(exp(divide(ci('u_f'), ci('RT'))), exp(divide(ci('u_r'), ci('RT'))))),
)

describe('equals', () => {
  it('compares structure, not identity', () => {
    expect(equals(times(cn(2), ci('x')), times(cn(2), ci('x')))).toBe(true)
    expect(equals(times(cn(2), ci('x')), times(cn(3), ci('x')))).toBe(false)
    expect(equals(diff('q', 't'), diff('q', 't'))).toBe(true)
    expect(equals(minus(ci('x')), minus(ci('x'), ci('y')))).toBe(false)
  })

  it('compares numbers by value and units, not notation', () => {
    const scientific: AstNode = { type: 'Number', value: 1e-8, scientific: { mantissa: '1', exponent: -8 } }
    expect(equals(scientific, cn(0.00000001))).toBe(true)
    expect(equals(cn(1, 'second'), cn(1))).toBe(false)
  })

  it('compares function names', () => {
    expect(equals(exp(ci('x')), { type: 'FunctionCall', name: 'ln', args: [ci('x')] })).toBe(false)
  })
})

describe('variables', () => {
  it('lists names in first-seen order', () => {
    expect(variables(reaction)).toEqual(['v', 'kappa', 'u_f', 'RT', 'u_r'])
  })

  it('includes a derivative’s variables', () => {
    expect(variables(eq(diff('q', 't'), ci('v')))).toEqual(['q', 't', 'v'])
  })
})

describe('substitute', () => {
  it('renames variables to element symbols', () => {
    const renamed = substitute(reaction.right, { kappa: 'kappa_r', u_f: 'u_f_Re_r' })
    expect(variables(renamed)).toEqual(['kappa_r', 'u_f_Re_r', 'RT', 'u_r'])
  })

  it('renames inside a derivative', () => {
    expect(equals(substitute(diff('q', 't'), { q: 'q_1' }), diff('q_1', 't'))).toBe(true)
  })

  it('replaces a variable with an expression', () => {
    expect(equals(substitute(times(ci('x'), ci('y')), { y: cn(2) }), times(ci('x'), cn(2)))).toBe(true)
  })

  it("refuses to replace a derivative's bound variable with an expression", () => {
    expect(() => substitute(diff('q', 't'), { t: cn(2) })).toThrow(TypeError)
  })

  it("doesn't treat inherited object keys as substitutions", () => {
    expect(equals(substitute(ci('toString'), {}), ci('toString'))).toBe(true)
  })
})

describe('traversal', () => {
  it('rebuilds a tree with mapChildren', () => {
    const doubled = mapChildren(times(ci('a'), ci('b')), (child) => times(cn(2), child))
    expect(children(doubled)).toHaveLength(2)
    expect(equals(doubled, times(times(cn(2), ci('a')), times(cn(2), ci('b'))))).toBe(true)
  })
})

describe('sortKey', () => {
  it('gives variables their names and derivatives a d(q)/d(t) form', () => {
    expect(sortKey(ci('v_q_1'))).toBe('v_q_1')
    expect(sortKey(diff('q_1', 't'))).toBe('d(q_1)/d(t)')
  })
})
