import type { Expr } from './ast.js'

/**
 * The tidying sympy does today when bg2cellml builds sums and products.
 *
 * To do:
 * - flatten nested `plus` and `times`;
 * - fold numbers (`2 * 3 * x` -> `6 * x`) and collect like terms (`2x + 3x` -> `5x`);
 * - drop `0` terms and `1` factors; an empty sum is `0`, an empty product `1`;
 * - cancel `x - x`;
 * - turn `times(-1, a)` into `minus(a)` and `plus(a, minus(b))` into `minus(a, b)`.
 *
 * Term order should be deterministic but doesn't need to match sympy. Parity
 * with the Python bg2cellml is checked by simulation, not by comparing text.
 */
export function canonicalise(_e: Expr): Expr {
  throw new Error('canonicalise() is not implemented yet')
}
