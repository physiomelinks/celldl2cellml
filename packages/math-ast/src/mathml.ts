import type { Cn, Equation } from './ast.js'

export const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
export const CELLML_2_0_NS = 'http://www.cellml.org/cellml/2.0#'

/** Something that can parse XML: the browser's `DOMParser`, or `@xmldom/xmldom` in Node. */
export interface DOMParserLike {
  parseFromString(source: string, mimeType: 'application/xml' | 'text/xml'): Document
}

export interface ParseOptions {
  /** Defaults to `globalThis.DOMParser`. */
  domParser?: DOMParserLike
}

export class MathMLError extends Error {
  override name = 'MathMLError'
}

/**
 * Read the equations in a `<math>` element. Each `<apply><eq/> lhs rhs</apply>`
 * becomes one Equation. An ODE written as `rhs = d(x)/dt` is turned round so the
 * derivative is on the left.
 */
export function fromMathMLElement(_math: Element): Equation[] {
  throw new Error('fromMathMLElement() is not implemented yet')
}

/** Parse a MathML string, which may contain several `<math>` elements. */
export function parseMathML(source: string, options: ParseOptions = {}): Equation[] {
  const parser = options.domParser ?? (globalThis as { DOMParser?: new () => DOMParserLike }).DOMParser
  if (parser === undefined) {
    throw new MathMLError('No DOMParser is available; pass one in ParseOptions.domParser')
  }
  const domParser = typeof parser === 'function' ? new parser() : parser
  const doc = domParser.parseFromString(source, 'application/xml')
  const maths = Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'math'))
  return maths.flatMap(fromMathMLElement)
}

export interface WriteOptions {
  /**
   * The `cellml:units` value for a `<cn>`. CellML 2.0 needs one on every
   * number. When this isn't given, a number's own `units` is used. CellML
   * knowledge stays out of this package: the caller decides the units.
   */
  cnUnits?: (cn: Cn) => string | undefined
  /** Namespace for the `cellml:units` attribute. Defaults to CellML 2.0. */
  cellmlNamespace?: string
  /** Indent per level. Use `''` for compact output. Defaults to two spaces. */
  indent?: string
}

/** Write equations as one `<math>` element. The result is a string, so no DOM is needed. */
export function toMathML(_equations: readonly Equation[], _options: WriteOptions = {}): string {
  throw new Error('toMathML() is not implemented yet')
}
