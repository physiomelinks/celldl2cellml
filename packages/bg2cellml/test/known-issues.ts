/** Issues some reference cases are expected to give. */

import { expect } from 'vitest'

/**
 * BG-RDF's example_A3 and example_A3_reduced give their voltage source's
 * numbers no units (`u = 50 sin(50 * 2 * pi * t)`), so they're dimensionless
 * and sin's argument is in seconds: the Analyser warns once for A3, and twice
 * for A3_reduced, whose junction equation repeats the source's expression.
 * `A3_numbers_with_units` and `A3_reduced_numbers_with_units` are these
 * examples with units, and are checked in their place (decided with Hugh).
 */
export const UNITS_INCONSISTENT: Readonly<Record<string, number>> = { example_A3: 1, example_A3_reduced: 2 }

export const SIN_UNITS_MESSAGE = /^CellML analysis: The unit of '.*' in 'sin\(.*\)' .* is not dimensionless\./

/** A case's issue messages are the ones it's expected to give: none, or the A3 examples' units warnings. */
export function expectKnownIssues(name: string, messages: readonly string[]): void {
  const count = UNITS_INCONSISTENT[name] ?? 0
  expect(messages, `${name}'s issues`).toHaveLength(count)
  for (const message of messages) expect(message).toMatch(SIN_UNITS_MESSAGE)
}
