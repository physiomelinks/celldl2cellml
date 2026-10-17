import { describe, expect, it } from 'vitest'

import { ci, cn, diff, divide, eq, equals, exp, minus, substitute, times, variables } from '../src/index.js'

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
  })
})

describe('variables', () => {
  it('lists names in first-seen order', () => {
    expect(variables(reaction)).toEqual(['v', 'kappa', 'u_f', 'RT', 'u_r'])
  })
})

describe('substitute', () => {
  it('renames variables to element symbols', () => {
    const renamed = substitute(reaction.rhs, { kappa: 'kappa_r', u_f: 'u_f_Re_r' })
    expect(variables(renamed)).toEqual(['kappa_r', 'u_f_Re_r', 'RT', 'u_r'])
  })

  it('renames inside a derivative', () => {
    expect(equals(substitute(diff('q', 't'), { q: 'q_1' }), diff('q_1', 't'))).toBe(true)
  })
})
