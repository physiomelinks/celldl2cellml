/**
 * What CellML 2.0's subset of Content MathML contains: its functions,
 * constants and condition operators, with how each is written in MathML,
 * LaTeX and MathJSON.
 *
 * Ported from vue3-math-editor (`registry/nodes.ts`, `editor/constants.ts`,
 * `editor/operators.ts`), without the editor's typing commands. Plain data, so
 * other tools can share it.
 */

import type { ComparisonNode, ConstantName, LogicNode } from './ast.js'

/** A MathJSON expression (CortexJS). */
export type MathJsonValue = number | string | null | MathJsonValue[] | { [key: string]: MathJsonValue }

//==============================================================================
// Functions

export interface FunctionDefinition {
  /** The FunctionCallNode name: `asin`, `ceiling`. */
  readonly name: string
  /** The Content MathML element: `arcsin`, `ceiling`. */
  readonly mathml: string
  /** Its usual written name, as a LaTeX command or operator name: `arcsin`. */
  readonly latexName: string
  /** Whether `\latexName` is a standard LaTeX command (`\sin`); if not, it's written `\operatorname{...}`. */
  readonly latexCommand: boolean
  /** MathJSON operator (CortexJS standard library names). */
  readonly mathJson: string
  /** Other spellings of the name (`ceil` for ceiling). */
  readonly aliases?: readonly string[]
}

type Entry = [name: string, latexName: string, latexCommand: boolean, mathml: string, mathJson: string, aliases?: string[]]

// prettier-ignore
const ENTRIES: Entry[] = [
  ['exp', 'exp', true, 'exp', 'Exp'],
  ['log', 'log', true, 'log', 'Log'],
  ['ln', 'ln', true, 'ln', 'Ln'],
  ['floor', 'floor', false, 'floor', 'Floor'],
  ['ceiling', 'ceiling', false, 'ceiling', 'Ceil', ['ceil']],
  ['min', 'min', true, 'min', 'Min'],
  ['max', 'max', true, 'max', 'Max'],
  // Remainder of a / b (MathML rem). MathJSON's Mod rounds differently for
  // negative numbers, so this is not Mod.
  ['rem', 'rem', false, 'rem', 'Remainder'],
  ['sin', 'sin', true, 'sin', 'Sin'],
  ['cos', 'cos', true, 'cos', 'Cos'],
  ['tan', 'tan', true, 'tan', 'Tan'],
  ['sec', 'sec', true, 'sec', 'Sec'],
  ['csc', 'csc', true, 'csc', 'Csc'],
  ['cot', 'cot', true, 'cot', 'Cot'],
  ['sinh', 'sinh', true, 'sinh', 'Sinh'],
  ['cosh', 'cosh', true, 'cosh', 'Cosh'],
  ['tanh', 'tanh', true, 'tanh', 'Tanh'],
  ['sech', 'sech', false, 'sech', 'Sech'],
  ['csch', 'csch', false, 'csch', 'Csch'],
  ['coth', 'coth', true, 'coth', 'Coth'],
  ['asin', 'arcsin', true, 'arcsin', 'Arcsin'],
  ['acos', 'arccos', true, 'arccos', 'Arccos'],
  ['atan', 'arctan', true, 'arctan', 'Arctan'],
  ['asec', 'arcsec', false, 'arcsec', 'Asec'],
  ['acsc', 'arccsc', false, 'arccsc', 'Acsc'],
  ['acot', 'arccot', false, 'arccot', 'Acot'],
  ['asinh', 'arcsinh', false, 'arcsinh', 'Arsinh'],
  ['acosh', 'arccosh', false, 'arccosh', 'Arcosh'],
  ['atanh', 'arctanh', false, 'arctanh', 'Artanh'],
  ['asech', 'arcsech', false, 'arcsech', 'Asech'],
  ['acsch', 'arccsch', false, 'arccsch', 'Acsch'],
  ['acoth', 'arccoth', false, 'arccoth', 'Arcoth'],
]

export const FUNCTIONS: Readonly<Record<string, FunctionDefinition>> = Object.fromEntries(
  ENTRIES.map(([name, latexName, latexCommand, mathml, mathJson, aliases]) => [
    name,
    { name, latexName, latexCommand, mathml, mathJson, ...(aliases && { aliases }) },
  ]),
)

const FUNCTIONS_BY_MATHML = new Map(Object.values(FUNCTIONS).map((f) => [f.mathml, f]))

/** A function by its name or an alias, ignoring case: `sin`, `ceil`. */
export function functionNamed(name: string): FunctionDefinition | undefined {
  const lower = name.toLowerCase()
  return FUNCTIONS[lower] ?? Object.values(FUNCTIONS).find((f) => f.aliases?.includes(lower))
}

/** A function by its Content MathML element: `arcsin`. */
export function functionForMathml(element: string): FunctionDefinition | undefined {
  return FUNCTIONS_BY_MATHML.get(element)
}

//==============================================================================
// Constants

export interface ConstantDefinition {
  readonly name: ConstantName
  /** The Content MathML element. */
  readonly mathml: string
  readonly latex: string
  readonly mathJson: MathJsonValue
}

export const CONSTANTS: readonly ConstantDefinition[] = [
  { name: 'pi', mathml: 'pi', latex: '\\pi', mathJson: 'Pi' },
  { name: 'exponentiale', mathml: 'exponentiale', latex: '\\mathrm{e}', mathJson: 'ExponentialE' },
  { name: 'infinity', mathml: 'infinity', latex: '\\infty', mathJson: { num: '+Infinity' } },
  { name: 'notanumber', mathml: 'notanumber', latex: '\\mathrm{NaN}', mathJson: { num: 'NaN' } },
  { name: 'true', mathml: 'true', latex: '\\mathrm{true}', mathJson: 'True' },
  { name: 'false', mathml: 'false', latex: '\\mathrm{false}', mathJson: 'False' },
]

const CONSTANTS_BY_MATHML = new Map(CONSTANTS.map((c) => [c.mathml, c]))

export function constantForMathml(element: string): ConstantDefinition | undefined {
  return CONSTANTS_BY_MATHML.get(element)
}

//==============================================================================
// Condition operators

export interface ConditionOperator {
  readonly type: ComparisonNode['type'] | LogicNode['type'] | 'Not'
  readonly role: 'comparison' | 'logic' | 'not'
  /** The Content MathML element. */
  readonly mathml: string
  /** As drawn: `≤`. */
  readonly symbol: string
  readonly latex: string
}

export const CONDITION_OPERATORS: readonly ConditionOperator[] = [
  { type: 'Less', role: 'comparison', mathml: 'lt', symbol: '<', latex: '<' },
  { type: 'Greater', role: 'comparison', mathml: 'gt', symbol: '>', latex: '>' },
  { type: 'LessEqual', role: 'comparison', mathml: 'leq', symbol: '≤', latex: '\\leq' },
  { type: 'GreaterEqual', role: 'comparison', mathml: 'geq', symbol: '≥', latex: '\\geq' },
  { type: 'NotEqual', role: 'comparison', mathml: 'neq', symbol: '≠', latex: '\\neq' },
  { type: 'And', role: 'logic', mathml: 'and', symbol: '∧', latex: '\\land' },
  { type: 'Or', role: 'logic', mathml: 'or', symbol: '∨', latex: '\\lor' },
  { type: 'Xor', role: 'logic', mathml: 'xor', symbol: '⊻', latex: '\\veebar' },
  { type: 'Not', role: 'not', mathml: 'not', symbol: '¬', latex: '\\lnot' },
]

const OPERATORS_BY_MATHML = new Map(CONDITION_OPERATORS.map((op) => [op.mathml, op]))
const OPERATORS_BY_TYPE = new Map(CONDITION_OPERATORS.map((op) => [op.type, op]))

export function conditionOperatorForMathml(element: string): ConditionOperator | undefined {
  return OPERATORS_BY_MATHML.get(element)
}

export function conditionOperatorOfType(type: ConditionOperator['type']): ConditionOperator | undefined {
  return OPERATORS_BY_TYPE.get(type)
}
