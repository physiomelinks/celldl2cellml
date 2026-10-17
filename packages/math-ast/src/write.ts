/**
 * Writing AstNodes as Content MathML, in the form CellML 2.0 accepts.
 *
 * Based on vue3-math-editor's `renderers/mathml.ts`: numbers in e-notation
 * where they need an exponent, `log` with a `<logbase>`, `root` with a
 * `<degree>`, and `cellml:units` on numbers. The text is built here, so no DOM
 * is needed, and it's indented consistently.
 */

import type { AstNode, NumberNode } from './ast.js'
import { CELLML_2_0_NS, MATHML_NS } from './mathml.js'
import { conditionOperatorOfType, CONSTANTS, functionNamed } from './registry.js'

export interface WriteOptions {
  /**
   * The `cellml:units` for a number. CellML 2.0 needs one on every `<cn>`.
   * Return `undefined` to use the number's own `units`. A number with neither
   * is written without the attribute. The caller decides the units, so this
   * package needs no knowledge of CellML models.
   */
  cnUnits?: (cn: NumberNode) => string | undefined
  /** Namespace for the `cellml:units` attribute. Defaults to CellML 2.0. */
  cellmlNamespace?: string
  /** Indent per level. `''` writes everything on one line. Defaults to two spaces. */
  indent?: string
}

export class MathMLWriteError extends Error {
  override name = 'MathMLWriteError'
}

//==============================================================================
// A small element tree, so indentation is handled in one place

interface XmlElement {
  readonly name: string
  readonly attributes: readonly [string, string][]
  /** Text content, or child elements. */
  readonly content: string | readonly XmlElement[]
}

const element = (name: string, content: string | readonly XmlElement[] = [], attributes: [string, string][] = []): XmlElement => ({
  name,
  attributes,
  content,
})

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function serialise(el: XmlElement, indent: string, depth: number): string {
  const pad = indent.repeat(depth)
  const newline = indent === '' ? '' : '\n'
  const attributes = el.attributes.map(([name, value]) => ` ${name}="${escape(value)}"`).join('')
  if (typeof el.content === 'string') return `${pad}<${el.name}${attributes}>${el.content}</${el.name}>`
  if (el.content.length === 0) return `${pad}<${el.name}${attributes}/>`
  const inside = el.content.map((child) => serialise(child, indent, depth + 1)).join(newline)
  return `${pad}<${el.name}${attributes}>${newline}${inside}${newline}${pad}</${el.name}>`
}

//==============================================================================

/** A finite number's text, as e-notation's mantissa and exponent where JavaScript would print an exponent. */
function numberText(node: NumberNode): { text: string } | { mantissa: string; exponent: number } {
  if (node.scientific !== undefined) return { mantissa: node.scientific.mantissa, exponent: node.scientific.exponent }
  const text = String(node.value)
  const [mantissa, exponent] = text.split('e')
  return exponent === undefined ? { text } : { mantissa: mantissa!, exponent: Number(exponent) }
}

class Writer {
  /** Whether any `cellml:units` was written, so `<math>` declares the prefix. */
  usedUnits = false

  constructor(private readonly options: WriteOptions) {}

  private apply(operator: string, operands: readonly AstNode[], qualifiers: XmlElement[] = []): XmlElement {
    return element('apply', [element(operator), ...qualifiers, ...operands.map((o) => this.node(o))])
  }

  private number(node: NumberNode): XmlElement {
    // CellML has no number syntax for these, so they're written with its constants
    if (Number.isNaN(node.value)) return element('notanumber')
    if (node.value === Infinity) return element('infinity')
    if (node.value === -Infinity) return element('apply', [element('minus'), element('infinity')])

    const units = this.options.cnUnits?.(node) ?? node.units
    const attributes: [string, string][] = []
    if (units !== undefined) {
      attributes.push(['cellml:units', units])
      this.usedUnits = true
    }
    const written = numberText(node)
    if ('text' in written) return element('cn', escape(written.text), attributes)
    attributes.push(['type', 'e-notation'])
    // <sep/> sits inside the text, so this <cn> is written by hand
    return element('cn', `${escape(written.mantissa)}<sep/>${written.exponent}`, attributes)
  }

  node(node: AstNode): XmlElement {
    switch (node.type) {
      case 'Number':
        return this.number(node)
      case 'Identifier':
        return element('ci', escape(node.name))
      case 'Constant': {
        const constant = CONSTANTS.find((c) => c.name === node.name)
        if (constant === undefined) throw new MathMLWriteError(`Unknown constant ${node.name}`)
        return element(constant.mathml)
      }
      case 'Add':
        return this.apply('plus', node.children)
      case 'Multiply':
        return this.apply('times', node.children)
      case 'Subtract':
        return this.apply('minus', [node.minuend, node.subtrahend])
      case 'Negate':
        return this.apply('minus', [node.value])
      case 'Abs':
        return this.apply('abs', [node.value])
      case 'Root':
        return this.apply('root', [node.radicand], node.degree === null ? [] : [element('degree', [this.node(node.degree)])])
      case 'FunctionCall': {
        const definition = functionNamed(node.name)
        if (definition === undefined) throw new MathMLWriteError(`Unknown function ${node.name}`)
        if (definition.name === 'log' && node.args.length === 2) {
          return this.apply('log', [node.args[0]!], [element('logbase', [this.node(node.args[1]!)])])
        }
        return this.apply(definition.mathml, node.args)
      }
      case 'Equal':
        return this.apply('eq', [node.left, node.right])
      case 'Less':
      case 'Greater':
      case 'LessEqual':
      case 'GreaterEqual':
      case 'NotEqual':
        return this.apply(conditionOperatorOfType(node.type)!.mathml, [node.left, node.right])
      case 'And':
      case 'Or':
      case 'Xor':
        return this.apply(conditionOperatorOfType(node.type)!.mathml, node.children)
      case 'Not':
        return this.apply('not', [node.value])
      case 'Piecewise':
        return element('piecewise', [
          ...node.pieces.map((p) => element('piece', [this.node(p.value), this.node(p.condition)])),
          ...(node.otherwise === null ? [] : [element('otherwise', [this.node(node.otherwise)])]),
        ])
      case 'Divide':
        return this.apply('divide', [node.numerator, node.denominator])
      case 'Power':
        return this.apply('power', [node.base, node.exponent])
      case 'Derivative':
        return this.apply('diff', [node.expression], [element('bvar', [this.node(node.variable)])])
    }
  }
}

/**
 * Write expressions, usually equations, as one `<math>` element. It declares
 * the MathML namespace, and the `cellml` prefix when any number has units.
 */
export function toMathML(expressions: readonly AstNode[], options: WriteOptions = {}): string {
  const writer = new Writer(options)
  const children = expressions.map((e) => writer.node(e))
  const attributes: [string, string][] = [['xmlns', MATHML_NS]]
  if (writer.usedUnits) attributes.push(['xmlns:cellml', options.cellmlNamespace ?? CELLML_2_0_NS])
  return serialise(element('math', children, attributes), options.indent ?? '  ', 0)
}

/**
 * Write one expression without a `<math>` element around it, for putting
 * inside other MathML. Any `cellml:units` prefix must be declared by the
 * surrounding document.
 */
export function toMathMLFragment(expression: AstNode, options: WriteOptions = {}): string {
  return serialise(new Writer(options).node(expression), options.indent ?? '  ', 0)
}
