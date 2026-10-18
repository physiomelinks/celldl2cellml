import { describe, expect, it } from 'vitest'

import {
  canonicalise,
  ci,
  cn,
  diff,
  divide,
  eq,
  equals,
  exp,
  fn,
  minus,
  plus,
  power,
  times,
  type AstNode,
} from '../src/index.js'

const a = ci('a')
const b = ci('b')
const c = ci('c')
const x = ci('x')
const y = ci('y')

/** canonicalise(input) is structurally equal to canonicalise(expected). */
function same(input: AstNode, expected: AstNode): void {
  expect(canonicalise(input)).toEqual(canonicalise(expected))
}

describe('sympy behaviour the bond graph code relies on', () => {
  it.each<[string, AstNode, AstNode]>([
    ['2x + 3x = 5x', plus(times(cn(2), x), times(cn(3), x)), times(cn(5), x)],
    ['x - x = 0', minus(x, x), cn(0)],
    ['an empty sum is 0', plus(), cn(0)],
    ['an empty product is 1', times(), cn(1)],
    ['-1 × (empty sum) = 0', times(cn(-1), plus()), cn(0)],
    ['-1 × (a + b) = -(a + b)', times(cn(-1), plus(a, b)), minus(plus(a, b))],
    ['a + (-b) = a - b', plus(a, minus(b)), minus(a, b)],
    ['2 × 3 × x = 6x', times(cn(2), cn(3), x), times(cn(6), x)],
    ['x × 1 = x', times(x, cn(1)), x],
    ['x + 0 = x', plus(x, cn(0)), x],
    ['0 × x = 0', times(cn(0), x), cn(0)],
    ['nested sums flatten', plus(a, plus(b, c)), plus(a, b, c)],
    ['nested products flatten', times(a, times(b, c)), times(a, b, c)],
    ['2(a + b) = 2a + 2b', times(cn(2), plus(a, b)), plus(times(cn(2), a), times(cn(2), b))],
    ['--x = x', minus(minus(x)), x],
    ['-(-2) = 2', minus(cn(-2)), cn(2)],
    ['x / 1 = x', divide(x, cn(1)), x],
    ['x ^ 1 = x', power(x, cn(1)), x],
    ['2 × bond count stays', times(cn(2), x), times(cn(2), x)],
  ])('%s', (_name, input, expected) => {
    same(input, expected)
  })

  it('cancels a variable that is both a junction input and output', () => {
    // inputs + (-1)(outputs), as model_support.py builds a junction's equation
    const junction = plus(a, b, times(cn(-1), plus(b, c)))
    same(junction, minus(a, c))
  })
})

describe('form', () => {
  it('puts terms and factors in a fixed order', () => {
    same(plus(b, a), plus(a, b))
    same(times(y, x), times(x, y))
    same(plus(times(b, a), c), plus(c, times(a, b)))
  })

  it('writes negative terms as one subtraction', () => {
    expect(canonicalise(plus(a, minus(b), c, minus(x)))).toEqual(minus(plus(a, c), plus(b, x)))
  })

  it('writes an all-negative sum as a negation', () => {
    expect(canonicalise(plus(minus(a), minus(b)))).toEqual(minus(plus(a, b)))
  })

  it('puts the constant term last and the coefficient first', () => {
    expect(canonicalise(plus(cn(3), times(x, cn(2))))).toEqual(plus(times(cn(2), x), cn(3)))
  })

  it('never folds numbers with units', () => {
    const node = plus(cn(2, 'second'), cn(3, 'second'))
    expect(canonicalise(node)).toEqual(node)
    expect(canonicalise(times(cn(2), cn(3, 'volt')))).toEqual(times(cn(2), cn(3, 'volt')))
  })

  it('tidies inside other nodes', () => {
    expect(canonicalise(exp(plus(x, cn(0))))).toEqual(exp(x))
    expect(canonicalise(eq(diff('q', 't'), plus(b, a)))).toEqual(eq(diff('q', 't'), plus(a, b)))
  })

  it('leaves products of sums unexpanded, as sympy does', () => {
    expect(canonicalise(times(x, plus(a, b)))).toEqual(times(plus(a, b), x))
  })
})

//==============================================================================
// Randomised checks: canonicalising keeps the value, and a second pass changes nothing

/** A small, seeded random number generator, so failures can be replayed. */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = ['a', 'b', 'c', 'x']

function randomExpression(next: () => number, depth: number): AstNode {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!
  if (depth === 0 || next() < 0.25) {
    return next() < 0.6 ? ci(pick(NAMES)) : cn(pick([-2, -1, 0, 0.5, 1, 2, 3]))
  }
  const operands = (): AstNode[] =>
    Array.from({ length: 1 + Math.floor(next() * 3) }, () => randomExpression(next, depth - 1))
  switch (pick(['plus', 'times', 'minus2', 'minus1', 'divide', 'power', 'exp'] as const)) {
    case 'plus':
      return plus(...operands())
    case 'times':
      return times(...operands())
    case 'minus2':
      return minus(randomExpression(next, depth - 1), randomExpression(next, depth - 1))
    case 'minus1':
      return minus(randomExpression(next, depth - 1))
    case 'divide':
      return divide(randomExpression(next, depth - 1), randomExpression(next, depth - 1))
    case 'power':
      return power(randomExpression(next, depth - 1), cn(pick([1, 2])))
    case 'exp':
      return fn('sin', randomExpression(next, depth - 1))
  }
}

/**
 * The value of an expression, and whether every step of it was finite.
 * canonicalise is exact algebra, which holds for finite arithmetic: once a
 * division by zero gives an infinity, JavaScript's signed zero can decide
 * between inf - inf and inf + inf, and folding -(0) to 0 loses that sign.
 */
function evaluate(node: AstNode, env: Record<string, number>, state = { finite: true }): number {
  const value = evaluateStep(node, env, state)
  if (!Number.isFinite(value)) state.finite = false
  return value
}

function evaluateStep(node: AstNode, env: Record<string, number>, state: { finite: boolean }): number {
  const evaluate_ = (child: AstNode) => evaluate(child, env, state)
  switch (node.type) {
    case 'Number':
      return node.value
    case 'Identifier':
      return env[node.name]!
    case 'Add':
      return node.children.reduce((s, child) => s + evaluate_(child), 0)
    case 'Multiply':
      return node.children.reduce((p, child) => p * evaluate_(child), 1)
    case 'Subtract':
      return evaluate_(node.minuend) - evaluate_(node.subtrahend)
    case 'Negate':
      return -evaluate_(node.value)
    case 'Divide':
      return evaluate_(node.numerator) / evaluate_(node.denominator)
    case 'Power':
      return evaluate_(node.base) ** evaluate_(node.exponent)
    case 'FunctionCall':
      return Math.sin(evaluate_(node.args[0]!))
    default:
      throw new Error(`Can't evaluate ${node.type}`)
  }
}

function closeEnough(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected))
}

describe('randomised', () => {
  const SEEDS = 2000

  it(`keeps the value of ${SEEDS} random expressions`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const next = random(seed)
      const expression = randomExpression(next, 4)
      const tidied = canonicalise(expression)
      for (let trial = 0; trial < 3; trial += 1) {
        const env = Object.fromEntries(NAMES.map((name) => [name, next() * 4 - 2]))
        const state = { finite: true }
        const expected = evaluate(expression, env, state)
        if (!state.finite) continue
        const actual = evaluate(tidied, env)
        if (!closeEnough(actual, expected)) {
          throw new Error(`Seed ${seed}: ${JSON.stringify(expression)} gave ${expected}, tidied ${actual}`)
        }
      }
    }
  })

  it(`changes nothing the second time, for ${SEEDS} random expressions`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const once = canonicalise(randomExpression(random(seed), 4))
      const twice = canonicalise(once)
      if (!equals(once, twice) || JSON.stringify(once) !== JSON.stringify(twice)) {
        throw new Error(`Seed ${seed}: not idempotent\n${JSON.stringify(once)}\n${JSON.stringify(twice)}`)
      }
    }
  })

  it(`gives the same tree for reordered sums and products`, () => {
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const next = random(seed)
      const parts = Array.from({ length: 2 + Math.floor(next() * 3) }, () => randomExpression(next, 2))
      const reversed = [...parts].reverse()
      expect(canonicalise(plus(...parts))).toEqual(canonicalise(plus(...reversed)))
      expect(canonicalise(times(...parts))).toEqual(canonicalise(times(...reversed)))
    }
  })
})
