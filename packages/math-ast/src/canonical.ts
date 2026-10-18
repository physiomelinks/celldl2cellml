/**
 * The tidying sympy does automatically when bg2cellml builds sums and
 * products, so equal expressions come out structurally equal.
 *
 * - Nested sums and products are flattened.
 * - Plain numbers are folded: `2 * 3 * x` becomes `6 * x`, `x + 0` becomes `x`.
 * - Like terms are collected: `2x + 3x` becomes `5x`, and `x - x` becomes `0`.
 * - A numeric factor is spread over a sum, as sympy does: `2(a + b)` becomes
 *   `2a + 2b`, so terms cancel across it.
 * - Terms and factors are sorted, so `b + a` and `a + b` give the same tree.
 * - Signs are written with Subtract and Negate: `a + b - (c + d)`, `-(a + b)`.
 *
 * Numbers with units are never folded or collected: `2 s + 3` stays as it is.
 * Powers and quotients are only simplified for an exponent or divisor of 1.
 * The result is mathematically equal to the input, and canonicalising it
 * again changes nothing.
 */

import type { AstNode, NumberNode } from './ast.js'
import { sortKey } from './compare.js'
import { mapChildren } from './traverse.js'

/** A product: `coefficient × factors`, the factors canonical and sorted. */
interface Product {
  coefficient: number
  factors: AstNode[]
}

const isPlainNumber = (node: AstNode): node is NumberNode => node.type === 'Number' && node.units === undefined

const number = (value: number): NumberNode => ({ type: 'Number', value })

const byKey = (a: AstNode, b: AstNode): number => compareKeys(sortKey(a), sortKey(b))

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** A canonical node seen as a product. */
function asProduct(node: AstNode): Product {
  if (isPlainNumber(node)) return { coefficient: node.value, factors: [] }
  if (node.type === 'Negate') {
    const inner = asProduct(node.value)
    return { coefficient: -inner.coefficient, factors: inner.factors }
  }
  if (node.type === 'Multiply') {
    let coefficient = 1
    const factors: AstNode[] = []
    for (const child of node.children) {
      const p = asProduct(child)
      coefficient *= p.coefficient
      factors.push(...p.factors)
    }
    return { coefficient, factors }
  }
  return { coefficient: 1, factors: [node] }
}

/** The canonical node for a product. */
function fromProduct({ coefficient, factors }: Product): AstNode {
  if (coefficient === 0) return number(0)
  const sorted = [...factors].sort(byKey)
  if (sorted.length === 0) return number(coefficient)
  const magnitude = Math.abs(coefficient)
  const body: AstNode =
    magnitude === 1
      ? sorted.length === 1
        ? sorted[0]!
        : { type: 'Multiply', children: sorted }
      : { type: 'Multiply', children: [number(magnitude), ...sorted] }
  return coefficient < 0 ? { type: 'Negate', value: body } : body
}

/** Adds the terms of a canonical node, scaled, to `terms`, opening up any sum it is. */
function collectTerms(node: AstNode, scale: number, terms: Product[]): void {
  const p = asProduct(node)
  const coefficient = p.coefficient * scale
  const only = p.factors.length === 1 ? p.factors[0]! : undefined
  if (only?.type === 'Add') {
    for (const child of only.children) collectTerms(child, coefficient, terms)
  } else if (only?.type === 'Subtract') {
    collectTerms(only.minuend, coefficient, terms)
    collectTerms(only.subtrahend, -coefficient, terms)
  } else {
    terms.push({ coefficient, factors: p.factors })
  }
}

/** The canonical node for a sum of canonical nodes. */
function sum(nodes: readonly AstNode[], scale = 1): AstNode {
  const terms: Product[] = []
  for (const node of nodes) collectTerms(node, scale, terms)

  // Collect like terms, keyed by their sorted factors
  const collected = new Map<string, Product>()
  for (const term of terms) {
    const factors = [...term.factors].sort(byKey)
    const key = factors.map(sortKey).join('×')
    const existing = collected.get(key)
    if (existing === undefined) collected.set(key, { coefficient: term.coefficient, factors })
    else existing.coefficient += term.coefficient
  }

  // Variable terms in key order, then the constant
  const ordered = [...collected.entries()]
    .filter(([, term]) => term.coefficient !== 0)
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : compareKeys(a, b)))
    .map(([, term]) => term)

  const positive = ordered.filter((t) => t.coefficient > 0 || Number.isNaN(t.coefficient)).map(fromProduct)
  const negative = ordered.filter((t) => t.coefficient < 0).map((t) => fromProduct({ ...t, coefficient: -t.coefficient }))
  const join = (parts: AstNode[]): AstNode => (parts.length === 1 ? parts[0]! : { type: 'Add', children: parts })

  if (positive.length === 0 && negative.length === 0) return number(0)
  // A single term keeps its own form: -1, not -(1); -x, -(2x)
  if (ordered.length === 1) return fromProduct(ordered[0]!)
  if (negative.length === 0) return join(positive)
  if (positive.length === 0) return { type: 'Negate', value: join(negative) }
  return { type: 'Subtract', minuend: join(positive), subtrahend: join(negative) }
}

/** The canonical node for a product of canonical nodes, spreading a numeric factor over a sum. */
function product(nodes: readonly AstNode[], scale = 1): AstNode {
  const p = asProduct({ type: 'Multiply', children: nodes })
  const coefficient = p.coefficient * scale
  if (coefficient === 0) return number(0)
  const only = p.factors.length === 1 ? p.factors[0]! : undefined
  if (coefficient !== 1 && (only?.type === 'Add' || only?.type === 'Subtract')) return sum([only], coefficient)
  return fromProduct({ coefficient, factors: p.factors })
}

const isOne = (node: AstNode): boolean => isPlainNumber(node) && node.value === 1

/** Tidy an expression as sympy would, so equal expressions compare equal. */
export function canonicalise(node: AstNode): AstNode {
  switch (node.type) {
    case 'Add':
      return sum(node.children.map(canonicalise))
    case 'Subtract':
      return sum([canonicalise(node.minuend), product([canonicalise(node.subtrahend)], -1)])
    case 'Multiply':
      return product(node.children.map(canonicalise))
    case 'Negate':
      return product([canonicalise(node.value)], -1)
    case 'Divide': {
      const numerator = canonicalise(node.numerator)
      const denominator = canonicalise(node.denominator)
      return isOne(denominator) ? numerator : { type: 'Divide', numerator, denominator }
    }
    case 'Power': {
      const base = canonicalise(node.base)
      const exponent = canonicalise(node.exponent)
      return isOne(exponent) ? base : { type: 'Power', base, exponent }
    }
    default:
      return mapChildren(node, canonicalise)
  }
}
