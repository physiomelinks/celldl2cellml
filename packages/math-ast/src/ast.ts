/**
 * The expression tree: one node type per construct in CellML 2.0's subset of
 * Content MathML.
 *
 * Ported from vue3-math-editor's `types/ast.ts`, without its two editor-only
 * nodes: `Group` (brackets the user typed, which carry no meaning) and
 * `Placeholder` (an empty slot). The editor can add those to this union.
 *
 * Nodes are plain, read-only data: easy to compare, copy and serialise.
 */

export type AstNode =
  | NumberNode
  | IdentifierNode
  | ConstantNode
  | AddNode
  | MultiplyNode
  | SubtractNode
  | NegateNode
  | AbsNode
  | RootNode
  | FunctionCallNode
  | EqualNode
  | ComparisonNode
  | LogicNode
  | NotNode
  | PiecewiseNode
  | DivideNode
  | PowerNode
  | DerivativeNode

/** `<cn>` */
export interface NumberNode {
  readonly type: 'Number'
  readonly value: number
  /**
   * Written in scientific notation (`<cn type="e-notation">1<sep/>-8</cn>`): the
   * mantissa as written and the exponent, for writers that keep the notation.
   * `value` is the number itself (1e-8).
   */
  readonly scientific?: { readonly mantissa: string; readonly exponent: number }
  /** Its `cellml:units`, when given. */
  readonly units?: string
}

/** `<ci>` */
export interface IdentifierNode {
  readonly type: 'Identifier'
  readonly name: string
}

/** `<pi/>`, `<exponentiale/>`, `<infinity/>`, `<notanumber/>`, `<true/>`, `<false/>`: see CONSTANTS. */
export interface ConstantNode {
  readonly type: 'Constant'
  readonly name: ConstantName
}

export type ConstantName = 'pi' | 'exponentiale' | 'infinity' | 'notanumber' | 'true' | 'false'

/** `<plus/>`, flat: a + b + c is one node. */
export interface AddNode {
  readonly type: 'Add'
  readonly children: readonly AstNode[]
}

/** `<times/>`, flat. */
export interface MultiplyNode {
  readonly type: 'Multiply'
  readonly children: readonly AstNode[]
}

/** `<minus/>` with two operands. */
export interface SubtractNode {
  readonly type: 'Subtract'
  readonly minuend: AstNode
  readonly subtrahend: AstNode
}

/** `<minus/>` with one operand. */
export interface NegateNode {
  readonly type: 'Negate'
  readonly value: AstNode
}

/** `<abs/>` */
export interface AbsNode {
  readonly type: 'Abs'
  readonly value: AstNode
}

/** `<root/>`, with an optional `<degree>`. */
export interface RootNode {
  readonly type: 'Root'
  readonly radicand: AstNode
  readonly degree: AstNode | null
}

/**
 * A named function from FUNCTIONS: `exp`, `ln`, `sin`, `min`, `rem`, ... `name`
 * is the function's name there (`asin`), not its MathML element (`arcsin`).
 * `log` with a `<logbase>` has the base as its second argument.
 */
export interface FunctionCallNode {
  readonly type: 'FunctionCall'
  readonly name: string
  readonly args: readonly AstNode[]
}

/** `<eq/>`: an equation at the top level, or a condition in a piecewise. */
export interface EqualNode {
  readonly type: 'Equal'
  readonly left: AstNode
  readonly right: AstNode
}

/** `<lt/>`, `<gt/>`, `<leq/>`, `<geq/>`, `<neq/>`. Equality is EqualNode. */
export interface ComparisonNode {
  readonly type: 'Less' | 'Greater' | 'LessEqual' | 'GreaterEqual' | 'NotEqual'
  readonly left: AstNode
  readonly right: AstNode
}

/** `<and/>`, `<or/>`, `<xor/>`, flat like Add. */
export interface LogicNode {
  readonly type: 'And' | 'Or' | 'Xor'
  readonly children: readonly AstNode[]
}

/** `<not/>` */
export interface NotNode {
  readonly type: 'Not'
  readonly value: AstNode
}

/** `<piecewise>`: value₀ if condition₀; ...; otherwise. */
export interface PiecewiseNode {
  readonly type: 'Piecewise'
  readonly pieces: readonly { readonly value: AstNode; readonly condition: AstNode }[]
  readonly otherwise: AstNode | null
}

/** `<divide/>` */
export interface DivideNode {
  readonly type: 'Divide'
  readonly numerator: AstNode
  readonly denominator: AstNode
}

/** `<power/>` */
export interface PowerNode {
  readonly type: 'Power'
  readonly base: AstNode
  readonly exponent: AstNode
}

/** `<diff/>`: the first derivative of `expression` with respect to `variable`. */
export interface DerivativeNode {
  readonly type: 'Derivative'
  readonly expression: AstNode
  readonly variable: AstNode
}

/** An equation: an EqualNode at the top level of `<math>`. */
export type Equation = EqualNode

//==============================================================================
// Builders, named after their MathML elements

export function ci(name: string): IdentifierNode {
  return { type: 'Identifier', name }
}

export function cn(value: number, units?: string): NumberNode {
  return units === undefined ? { type: 'Number', value } : { type: 'Number', value, units }
}

export function constant(name: ConstantName): ConstantNode {
  return { type: 'Constant', name }
}

export const plus = (...children: AstNode[]): AddNode => ({ type: 'Add', children })
export const times = (...children: AstNode[]): MultiplyNode => ({ type: 'Multiply', children })

/** One operand negates, two subtract. */
export function minus(a: AstNode): NegateNode
export function minus(a: AstNode, b: AstNode): SubtractNode
export function minus(a: AstNode, b?: AstNode): NegateNode | SubtractNode {
  return b === undefined ? { type: 'Negate', value: a } : { type: 'Subtract', minuend: a, subtrahend: b }
}

export const divide = (numerator: AstNode, denominator: AstNode): DivideNode => ({
  type: 'Divide',
  numerator,
  denominator,
})
export const power = (base: AstNode, exponent: AstNode): PowerNode => ({ type: 'Power', base, exponent })

/** A function from FUNCTIONS by name: `fn('sin', x)`. */
export const fn = (name: string, ...args: AstNode[]): FunctionCallNode => ({ type: 'FunctionCall', name, args })
export const exp = (a: AstNode): FunctionCallNode => fn('exp', a)
export const ln = (a: AstNode): FunctionCallNode => fn('ln', a)
export const sin = (a: AstNode): FunctionCallNode => fn('sin', a)
export const cos = (a: AstNode): FunctionCallNode => fn('cos', a)

/** d(variable)/d(bvar), the form constitutive relations use. */
export function diff(variable: AstNode | string, bvar: AstNode | string): DerivativeNode {
  return {
    type: 'Derivative',
    expression: typeof variable === 'string' ? ci(variable) : variable,
    variable: typeof bvar === 'string' ? ci(bvar) : bvar,
  }
}

export function eq(left: AstNode, right: AstNode): Equation {
  return { type: 'Equal', left, right }
}
