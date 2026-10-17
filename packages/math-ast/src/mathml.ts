/**
 * Reading Content MathML, as CellML 2.0 restricts it, into AstNodes.
 *
 * The element handling follows vue3-math-editor's `editor/mathmlImport.ts`:
 * `cellml:units` in any CellML version's namespace, e-notation numbers, the
 * `bvar`, `degree` and `logbase` qualifiers, and `piecewise`. That import
 * builds editor rows; this builds AstNodes, which the editor could turn into
 * rows instead.
 *
 * `readMathML` never throws on content: it reads what it can and lists every
 * problem, as an editor pasting MathML wants. `parseMathML` throws on any
 * problem, as a converter wants.
 */

import type { AstNode, ConstantName, Equation, NumberNode } from './ast.js'
import {
  conditionOperatorForMathml,
  constantForMathml,
  functionForMathml,
  type ConditionOperator,
} from './registry.js'

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

export interface MathMLProblem {
  /** Which top-level expression it is in, counting from 0. */
  readonly expression: number
  readonly message: string
}

export interface MathMLRead {
  /** One per top-level expression, in order; `null` where that expression has problems. */
  readonly expressions: readonly (AstNode | null)[]
  readonly problems: readonly MathMLProblem[]
}

export class MathMLError extends Error {
  override name = 'MathMLError'
  constructor(readonly problems: readonly MathMLProblem[]) {
    super(problems.map((p) => (problems.length > 1 ? `[${p.expression}] ${p.message}` : p.message)).join('\n'))
  }
}

//==============================================================================

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4

/** A CellML identifier. */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

const QUALIFIERS = new Set(['bvar', 'degree', 'logbase'])

/** Functions taking any number of operands; the rest of FUNCTIONS take one, except rem and log. */
const NARY_FUNCTIONS = new Set(['min', 'max'])

function elements(node: Node): Element[] {
  return Array.from(node.childNodes).filter((n): n is Element => n.nodeType === ELEMENT_NODE)
}

function text(el: Element): string {
  return (el.textContent ?? '').trim()
}

/** Non-whitespace text directly inside an element that should only hold elements. */
function strayText(el: Element): string | undefined {
  for (const n of Array.from(el.childNodes)) {
    if ((n.nodeType === TEXT_NODE || n.nodeType === CDATA_SECTION_NODE) && (n.nodeValue ?? '').trim() !== '') {
      return (n.nodeValue ?? '').trim()
    }
  }
  return undefined
}

/** A `<cn>`'s cellml:units, whichever CellML version's namespace declares it. */
function unitsOf(el: Element): string | undefined {
  for (const attribute of Array.from(el.attributes)) {
    if (
      attribute.localName === 'units' &&
      (attribute.prefix === 'cellml' || (attribute.namespaceURI ?? '').startsWith('http://www.cellml.org/cellml/'))
    ) {
      return attribute.value.trim()
    }
  }
  return undefined
}

/** Reads one top-level expression; `null` wherever something couldn't be read, with the reason recorded. */
class Reader {
  constructor(private readonly report: (message: string) => void) {}

  private problem(message: string): null {
    this.report(message)
    return null
  }

  expression(el: Element): AstNode | null {
    if (el.namespaceURI !== MATHML_NS) {
      return this.problem(`<${el.nodeName}> isn't in the MathML namespace`)
    }
    switch (el.localName) {
      case 'ci':
        return this.identifier(el)
      case 'cn':
        return this.number(el)
      case 'apply':
        return this.apply(el)
      case 'piecewise':
        return this.piecewise(el)
      default: {
        const constant = constantForMathml(el.localName)
        if (constant !== undefined) {
          if (elements(el).length > 0 || text(el) !== '') return this.problem(`<${el.localName}/> must be empty`)
          return { type: 'Constant', name: constant.name as ConstantName }
        }
        return this.problem(`<${el.localName}> isn't supported in CellML's MathML`)
      }
    }
  }

  private identifier(el: Element): AstNode | null {
    if (elements(el).length > 0) return this.problem('<ci> must hold only a name')
    const name = text(el)
    if (!NAME.test(name)) return this.problem(`"${name}" isn't a valid CellML variable name`)
    return { type: 'Identifier', name }
  }

  private number(el: Element): AstNode | null {
    const units = unitsOf(el)
    const base = el.getAttribute('base')
    if (base !== null && base.trim() !== '10') return this.problem(`<cn base="${base}"> isn't supported; numbers must be base 10`)
    const kind = el.getAttribute('type') ?? 'real'

    let node: NumberNode
    if (kind === 'e-notation') {
      const parts = Array.from(el.childNodes)
      const sepIndex = parts.findIndex((n) => n.nodeType === ELEMENT_NODE && (n as Element).localName === 'sep')
      if (sepIndex < 0) return this.problem('<cn type="e-notation"> needs a <sep/> between mantissa and exponent')
      const mantissa = parts.slice(0, sepIndex).map((n) => n.textContent ?? '').join('').trim()
      const exponentText = parts.slice(sepIndex + 1).map((n) => n.textContent ?? '').join('').trim()
      const exponent = Number(exponentText)
      const value = Number(`${mantissa}e${exponentText}`)
      if (mantissa === '' || !Number.isFinite(Number(mantissa)) || !Number.isInteger(exponent) || exponentText === '') {
        return this.problem(`"${mantissa}<sep/>${exponentText}" isn't a number in e-notation`)
      }
      node = { type: 'Number', value, scientific: { mantissa, exponent } }
    } else if (kind === 'real' || kind === 'integer') {
      if (elements(el).length > 0) return this.problem('<cn> must hold only a number')
      const digits = text(el)
      const value = Number(digits)
      if (digits === '' || !Number.isFinite(value) || (kind === 'integer' && !Number.isInteger(value))) {
        return this.problem(`"${digits}" isn't ${kind === 'integer' ? 'an integer' : 'a number'}`)
      }
      node = { type: 'Number', value }
    } else {
      return this.problem(`<cn type="${kind}"> isn't supported in CellML's MathML`)
    }
    return units === undefined ? node : { ...node, units }
  }

  private apply(el: Element): AstNode | null {
    const stray = strayText(el)
    if (stray !== undefined) return this.problem(`Unexpected text "${stray}" in <apply>`)
    const [operator, ...rest] = elements(el)
    if (operator === undefined) return this.problem('An empty <apply>')
    if (operator.namespaceURI !== MATHML_NS) return this.problem(`<${operator.nodeName}> isn't in the MathML namespace`)
    const tag = operator.localName
    const qualifiers = rest.filter((child) => QUALIFIERS.has(child.localName))
    const operandElements = rest.filter((child) => !QUALIFIERS.has(child.localName))

    // Which qualifiers each operator takes; any other is a problem.
    const allowed = tag === 'diff' ? ['bvar'] : tag === 'root' ? ['degree'] : tag === 'log' ? ['logbase'] : []
    for (const q of qualifiers) {
      if (!allowed.includes(q.localName)) return this.problem(`<${q.localName}> can't qualify <${tag}>`)
    }
    if (new Set(qualifiers.map((q) => q.localName)).size < qualifiers.length) {
      return this.problem(`<${tag}> has a repeated qualifier`)
    }

    // Read every operand, so all their problems are reported, then check the shape.
    const operands = operandElements.map((child) => this.expression(child))
    if (operands.some((o) => o === null)) return null
    const args = operands as AstNode[]
    const count = (n: number, what = `${n} operand${n === 1 ? '' : 's'}`): boolean => {
      if (args.length === n) return true
      this.problem(`<${tag}> needs ${what}, not ${args.length}`)
      return false
    }
    const atLeast = (n: number): boolean => {
      if (args.length >= n) return true
      this.problem(`<${tag}> needs at least ${n} operand${n === 1 ? '' : 's'}, not ${args.length}`)
      return false
    }

    switch (tag) {
      case 'eq':
        return count(2) ? { type: 'Equal', left: args[0]!, right: args[1]! } : null
      case 'plus':
        return atLeast(1) ? { type: 'Add', children: args } : null
      case 'times':
        return atLeast(1) ? { type: 'Multiply', children: args } : null
      case 'minus':
        if (args.length === 1) return { type: 'Negate', value: args[0]! }
        return count(2, '1 or 2 operands') ? { type: 'Subtract', minuend: args[0]!, subtrahend: args[1]! } : null
      case 'divide':
        return count(2) ? { type: 'Divide', numerator: args[0]!, denominator: args[1]! } : null
      case 'power':
        return count(2) ? { type: 'Power', base: args[0]!, exponent: args[1]! } : null
      case 'abs':
        return count(1) ? { type: 'Abs', value: args[0]! } : null
      case 'root': {
        if (!count(1)) return null
        const degree = qualifiers[0] === undefined ? null : this.qualifierValue(qualifiers[0])
        if (qualifiers[0] !== undefined && degree === null) return null
        return { type: 'Root', radicand: args[0]!, degree }
      }
      case 'diff':
        return this.derivative(qualifiers, args)
    }

    const condition = conditionOperatorForMathml(tag)
    if (condition !== undefined) return this.condition(condition, args, count, atLeast)

    const fn = functionForMathml(tag)
    if (fn === undefined) return this.problem(`<${tag}> isn't supported in CellML's MathML`)
    if (fn.name === 'log') {
      if (!count(1)) return null
      if (qualifiers[0] === undefined) return { type: 'FunctionCall', name: 'log', args }
      const base = this.qualifierValue(qualifiers[0])
      return base === null ? null : { type: 'FunctionCall', name: 'log', args: [args[0]!, base] }
    }
    if (fn.name === 'rem') return count(2) ? { type: 'FunctionCall', name: 'rem', args } : null
    if (NARY_FUNCTIONS.has(fn.name)) return atLeast(1) ? { type: 'FunctionCall', name: fn.name, args } : null
    return count(1) ? { type: 'FunctionCall', name: fn.name, args } : null
  }

  private condition(
    op: ConditionOperator,
    args: AstNode[],
    count: (n: number) => boolean,
    atLeast: (n: number) => boolean,
  ): AstNode | null {
    if (op.role === 'not') return count(1) ? { type: 'Not', value: args[0]! } : null
    if (op.role === 'logic') {
      return atLeast(1) ? { type: op.type as 'And' | 'Or' | 'Xor', children: args } : null
    }
    return count(2)
      ? { type: op.type as 'Less' | 'Greater' | 'LessEqual' | 'GreaterEqual' | 'NotEqual', left: args[0]!, right: args[1]! }
      : null
  }

  /** The single expression inside a `<degree>` or `<logbase>`. */
  private qualifierValue(q: Element): AstNode | null {
    const inside = elements(q)
    if (inside.length !== 1 || strayText(q) !== undefined) return this.problem(`<${q.localName}> must hold one expression`)
    return this.expression(inside[0]!)
  }

  private derivative(qualifiers: Element[], args: AstNode[]): AstNode | null {
    const bvar = qualifiers[0]
    if (bvar === undefined) return this.problem('<diff> needs a <bvar>')
    if (args.length !== 1) return this.problem(`<diff> needs 1 operand, not ${args.length}`)
    const inside = elements(bvar)
    const variables = inside.filter((child) => child.localName === 'ci')
    const degrees = inside.filter((child) => child.localName === 'degree')
    const others = inside.filter((child) => child.localName !== 'ci' && child.localName !== 'degree')
    if (variables.length !== 1 || others.length > 0 || degrees.length > 1) {
      return this.problem('<bvar> must hold one <ci>, and optionally a <degree>')
    }
    if (degrees[0] !== undefined) {
      const degree = this.qualifierValue(degrees[0])
      if (degree === null) return null
      if (degree.type !== 'Number' || degree.value !== 1) {
        return this.problem('Only first derivatives are supported: the <degree> must be 1')
      }
    }
    const variable = this.expression(variables[0]!)
    return variable === null ? null : { type: 'Derivative', expression: args[0]!, variable }
  }

  private piecewise(el: Element): AstNode | null {
    const stray = strayText(el)
    if (stray !== undefined) return this.problem(`Unexpected text "${stray}" in <piecewise>`)
    const pieces: { value: AstNode; condition: AstNode }[] = []
    let otherwise: AstNode | null = null
    let ok = true
    const parts = elements(el)
    for (const [index, part] of parts.entries()) {
      const inside = elements(part)
      if (part.localName === 'piece') {
        if (inside.length !== 2) {
          ok = this.problem('A <piece> must hold a value and a condition') !== null
          continue
        }
        const value = this.expression(inside[0]!)
        const condition = this.expression(inside[1]!)
        if (value === null || condition === null) ok = false
        else pieces.push({ value, condition })
      } else if (part.localName === 'otherwise') {
        if (index !== parts.length - 1) ok = this.problem('<otherwise> must come last in <piecewise>') !== null
        if (inside.length !== 1) {
          ok = this.problem('<otherwise> must hold one value') !== null
          continue
        }
        otherwise = this.expression(inside[0]!)
        if (otherwise === null) ok = false
      } else {
        ok = this.problem(`<${part.localName}> can't appear in <piecewise>`) !== null
      }
    }
    if (!ok) return null
    if (pieces.length === 0) return this.problem('A <piecewise> needs at least one <piece>')
    return { type: 'Piecewise', pieces, otherwise }
  }
}

//==============================================================================

function readItems(items: readonly Element[]): MathMLRead {
  const problems: MathMLProblem[] = []
  const expressions = items.map((item, expression) => {
    const reader = new Reader((message) => problems.push({ expression, message }))
    return reader.expression(item)
  })
  return { expressions, problems }
}

/**
 * Read the expressions in a `<math>` element: one per child, usually an
 * equation. Problems are listed, not thrown.
 */
export function readMathMLElement(math: Element): MathMLRead {
  if (math.namespaceURI !== MATHML_NS || math.localName !== 'math') {
    return { expressions: [], problems: [{ expression: 0, message: `Expected <math>, got <${math.nodeName}>` }] }
  }
  const stray = strayText(math)
  if (stray !== undefined) {
    return { expressions: [], problems: [{ expression: 0, message: `Unexpected text "${stray}" in <math>` }] }
  }
  return readItems(elements(math))
}

/**
 * Read MathML text: one or more `<math>` elements, or bare expressions such as
 * an `<apply>`. The `cellml` prefix may be used without being declared.
 * Problems are listed, not thrown; text that isn't well-formed XML throws.
 */
export function readMathML(source: string, options: ParseOptions = {}): MathMLRead {
  const Parser = (globalThis as { DOMParser?: new () => DOMParserLike }).DOMParser
  const parser = options.domParser ?? (Parser === undefined ? undefined : new Parser())
  if (parser === undefined) {
    throw new MathMLError([{ expression: 0, message: 'No DOMParser is available; pass one in ParseOptions.domParser' }])
  }
  // Wrapped so that fragments, and cellml:units without the namespace declared,
  // read as they would inside a CellML model.
  const body = source.replace(/^\s*<\?xml[^>]*\?>/, '')
  const wrapped = `<wrapper xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_2_0_NS}">${body}</wrapper>`
  let doc: Document
  try {
    doc = parser.parseFromString(wrapped, 'application/xml')
  } catch (error) {
    throw new MathMLError([{ expression: 0, message: `Not well-formed XML: ${error instanceof Error ? error.message : String(error)}` }])
  }
  const parseError = doc.getElementsByTagName('parsererror')[0]
  if (parseError !== undefined) {
    throw new MathMLError([{ expression: 0, message: `Not well-formed XML: ${text(parseError)}` }])
  }
  const wrapper = doc.documentElement
  const stray = strayText(wrapper)
  if (stray !== undefined) {
    return { expressions: [], problems: [{ expression: 0, message: `Unexpected text "${stray}" outside the MathML` }] }
  }
  const top = elements(wrapper)
  const maths = top.filter((el) => el.namespaceURI === MATHML_NS && el.localName === 'math')
  if (maths.length === 0) return readItems(top)
  if (maths.length < top.length) {
    return { expressions: [], problems: [{ expression: 0, message: 'Mixed <math> elements and bare expressions' }] }
  }
  return readItems(maths.flatMap(elements))
}

function strict(read: MathMLRead): AstNode[] {
  if (read.problems.length > 0) throw new MathMLError(read.problems)
  return read.expressions as AstNode[]
}

/** As `readMathML`, but throws a `MathMLError` listing every problem. */
export function parseMathML(source: string, options: ParseOptions = {}): AstNode[] {
  return strict(readMathML(source, options))
}

/** As `readMathMLElement`, but throws a `MathMLError` listing every problem. */
export function fromMathMLElement(math: Element): AstNode[] {
  return strict(readMathMLElement(math))
}

/**
 * Expressions as equations: each must be `<eq/>`. A derivative on the right is
 * moved to the left (`v = d(q)/dt` becomes `d(q)/dt = v`), as the Python
 * bg2cellml does.
 */
export function toEquations(expressions: readonly AstNode[]): Equation[] {
  const problems: MathMLProblem[] = []
  const result: Equation[] = []
  for (const [expression, node] of expressions.entries()) {
    if (node.type !== 'Equal') {
      problems.push({ expression, message: `Expected an equation, got ${node.type}` })
    } else if (node.left.type === 'Derivative' && node.right.type === 'Derivative') {
      problems.push({ expression, message: 'An equation can have a derivative on only one side' })
    } else {
      result.push(node.right.type === 'Derivative' ? { type: 'Equal', left: node.right, right: node.left } : node)
    }
  }
  if (problems.length > 0) throw new MathMLError(problems)
  return result
}
