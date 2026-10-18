/** Reading the Python bg2cellml's equations, as sympy writes them in the reference fixtures, for comparison with ours. */

import { DOMParser } from '@xmldom/xmldom'
import { canonicalise, mapChildren, parseMathML, toEquations, type AstNode, type DOMParserLike, type Equation } from '@physiomelinks/math-ast'

// prettier-ignore
const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
]
const LOWER = 'αβγδεζηθικλμνξοπρστυφχψω'
const UPPER = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ'

/**
 * sympy's printer writes a variable named exactly after a Greek letter as
 * that letter, as a character reference: `<ci>&#954;</ci>` (κ) for `kappa`.
 * This puts the names back.
 */
export function ungreek(source: string): string {
  return source.replace(/<ci>([^<]+)<\/ci>/g, (_match, written: string) => {
    const name = written.replace(/&#(x?)([0-9a-fA-F]+);/g, (_ref, hex: string, code: string) =>
      String.fromCodePoint(Number.parseInt(code, hex === 'x' ? 16 : 10)),
    )
    const lower = LOWER.indexOf(name)
    const upper = UPPER.indexOf(name)
    const word = lower >= 0 ? GREEK[lower]! : upper >= 0 ? GREEK[upper]!.replace(/^./, (c) => c.toUpperCase()) : name
    return `<ci>${word}</ci>`
  })
}

/** sympy's MathML for an equation, read and tidied as ours is, for comparison. */
export function pythonEquation(source: string): Equation {
  return canonicalise(toEquations(parseMathML(ungreek(source), { domParser: new DOMParser() as unknown as DOMParserLike }))[0]!) as Equation
}

/** A node with its numbers' units removed. */
export function withoutNumberUnits(node: AstNode): AstNode {
  if (node.type !== 'Number') return mapChildren(node, withoutNumberUnits)
  const { units: _units, ...plain } = node
  return plain
}

/**
 * Our equation, tidied for comparing with Python's. Python ignores the units
 * a source gives its numbers (`<cn bgf:units="V">`), so ours lose them first.
 */
export function forPython(equation: Equation): Equation {
  return canonicalise(withoutNumberUnits(equation)) as Equation
}
