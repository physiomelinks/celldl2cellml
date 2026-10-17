/**
 * The expression tree.
 *
 * It covers the Content MathML used by BG-RDF constitutive relations and by
 * generated junction equations. Add operators here as templates need them.
 */

/** Operators that are written as `<apply><op/> ...args</apply>`. */
export type Operator =
  | 'plus'
  | 'minus'
  | 'times'
  | 'divide'
  | 'power'
  | 'exp'
  | 'ln'
  | 'sin'
  | 'cos'

/** Named constants, written as empty elements such as `<pi/>`. */
export type ConstantName = 'pi' | 'exponentiale'

/** A variable reference, `<ci>name</ci>`. */
export interface Ci {
  readonly kind: 'ci'
  readonly name: string
}

/** A number, `<cn>value</cn>`. `units` holds a `cellml:units` attribute if one was read or set. */
export interface Cn {
  readonly kind: 'cn'
  readonly value: number
  readonly units?: string
}

/** A named constant such as pi. */
export interface Constant {
  readonly kind: 'constant'
  readonly name: ConstantName
}

/** An operator applied to its arguments. */
export interface Apply {
  readonly kind: 'apply'
  readonly op: Operator
  readonly args: readonly Expr[]
}

/** A first-order derivative, d(variable)/d(bvar). */
export interface Diff {
  readonly kind: 'diff'
  readonly variable: Ci
  readonly bvar: Ci
}

export type Expr = Ci | Cn | Constant | Apply | Diff

/** One equation, `<apply><eq/> lhs rhs</apply>`. */
export interface Equation {
  readonly lhs: Expr
  readonly rhs: Expr
}

//==============================================================================
// Builders

export function ci(name: string): Ci {
  return { kind: 'ci', name }
}

export function cn(value: number, units?: string): Cn {
  return units === undefined ? { kind: 'cn', value } : { kind: 'cn', value, units }
}

export function constant(name: ConstantName): Constant {
  return { kind: 'constant', name }
}

export function apply(op: Operator, ...args: Expr[]): Apply {
  return { kind: 'apply', op, args }
}

export const plus = (...args: Expr[]): Apply => apply('plus', ...args)
export const times = (...args: Expr[]): Apply => apply('times', ...args)
export const minus = (a: Expr, b?: Expr): Apply => (b === undefined ? apply('minus', a) : apply('minus', a, b))
export const divide = (a: Expr, b: Expr): Apply => apply('divide', a, b)
export const power = (base: Expr, exponent: Expr): Apply => apply('power', base, exponent)
export const exp = (a: Expr): Apply => apply('exp', a)
export const ln = (a: Expr): Apply => apply('ln', a)
export const sin = (a: Expr): Apply => apply('sin', a)
export const cos = (a: Expr): Apply => apply('cos', a)

export function diff(variable: Ci | string, bvar: Ci | string): Diff {
  return {
    kind: 'diff',
    variable: typeof variable === 'string' ? ci(variable) : variable,
    bvar: typeof bvar === 'string' ? ci(bvar) : bvar,
  }
}

export function eq(lhs: Expr, rhs: Expr): Equation {
  return { lhs, rhs }
}
