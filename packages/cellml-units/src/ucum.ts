/**
 * Units expressions in UCUM's notation (`mV/ms`, `mmol/L/s`, `kg.m-3`,
 * `mm[Hg]`, `10*3/uL`): parsing them, resolving their symbols, and naming them.
 *
 * Ported from PhLynx (`src/utils/unitExpression.js`), keeping its function
 * names and behaviour, so units read and named here match PhLynx's.
 */

import { AFFINE_SYMBOLS, PREFIX_NAMES, PREFIX_POWERS, UCUM_ATOMS, UCUM_PREFIXES, type UcumAtom } from './tables.js'

export class UcumError extends Error {
  override name = 'UcumError'
}

class ExpressionError extends Error {}

//==============================================================================
// Parsing

/** A symbol as written, with any exponent still attached, and whether it multiplies (1) or divides (-1). */
export interface WrittenSymbol {
  readonly text: string
  readonly sign: 1 | -1
}

export type ParsedExpression = { readonly factor: number; readonly symbols: readonly WrittenSymbol[] } | { readonly error: string }

const POWER_OF_TEN = /10[*^]([+-]?\d+)/y
const SYMBOL = /(?:\[[^[\]]*\]|[A-Za-z0-9_%])+(?:[+-]\d+)?/y

/** Drops `{annotations}`: one on its own counts as 1, as in `{cells}/mL`. */
function stripAnnotations(text: string): string {
  const stripped = text.replace(/\{[^{}]*\}/g, (_match, offset: number) => (/[A-Za-z0-9_%\]]/.test(text[offset - 1] ?? '') ? '' : '1'))
  if (/[{}]/.test(stripped)) throw new ExpressionError('Unbalanced "{"')
  return stripped
}

/**
 * Parses a units expression in UCUM's notation. `.` multiplies and `/`
 * divides, read left to right, so `mmol/L.s` is (mmol/L)·s; `(...)` groups; a
 * trailing integer is an exponent (`m2`, `s-1`); `10*3` and plain integers are
 * factors.
 */
export function parseUnitExpression(text: string): ParsedExpression {
  const trimmed = (text ?? '').trim()
  if (!trimmed) return { error: 'Nothing to read' }
  if (/\s/.test(trimmed)) return { error: "Spaces aren't allowed; use . to multiply" }

  try {
    const source = stripAnnotations(trimmed)
    let position = 0

    const peek = (): string | undefined => source[position]
    const fail = (message: string): never => {
      throw new ExpressionError(message)
    }

    type Term = { factor: number; symbols: WrittenSymbol[] }

    const readComponent = (): Term => {
      if (peek() === '(') {
        position += 1
        const inner = readTerm()
        if (peek() !== ')') fail('Missing ")"')
        position += 1
        const next = peek()
        if (next !== undefined && !'./)'.includes(next)) fail("A bracketed group can't take an exponent")
        return inner
      }

      POWER_OF_TEN.lastIndex = position
      const power = POWER_OF_TEN.exec(source)
      if (power) {
        position = POWER_OF_TEN.lastIndex
        return { factor: 10 ** Number(power[1]), symbols: [] }
      }

      SYMBOL.lastIndex = position
      const symbol = SYMBOL.exec(source)
      if (!symbol) {
        if (peek() === undefined) fail('Expected a units after the last operator')
        return fail(peek() === '^' ? 'Write the exponent straight after the units, e.g. m2 or s-1' : `Unexpected "${peek()}"`)
      }
      position = SYMBOL.lastIndex
      return /^\d+$/.test(symbol[0]) ? { factor: Number(symbol[0]), symbols: [] } : { factor: 1, symbols: [{ text: symbol[0], sign: 1 }] }
    }

    const readTerm = (): Term => {
      const term: Term = { factor: 1, symbols: [] }
      let sign: 1 | -1 = 1
      if (peek() === '/') {
        position += 1
        sign = -1
      }
      for (;;) {
        const component = readComponent()
        term.factor *= component.factor ** sign
        term.symbols.push(...component.symbols.map((s) => ({ ...s, sign: (s.sign * sign) as 1 | -1 })))
        if (peek() !== '.' && peek() !== '/') return term
        sign = peek() === '/' ? -1 : 1
        position += 1
      }
    }

    const expression = readTerm()
    if (peek() === '^') fail('Write the exponent straight after the units, e.g. m2 or s-1')
    if (position < source.length) fail(`Unexpected "${peek()}"`)
    return expression
  } catch (error) {
    if (error instanceof ExpressionError) return { error: error.message }
    throw error
  }
}

//==============================================================================
// Symbols

/** One symbol of an expression, resolved: a known name, an affine temperature, or a UCUM symbol with its prefix. */
export interface ResolvedSymbol {
  /** The symbol as written, without its exponent: `mm[Hg]`. */
  readonly label: string
  readonly exponent: number
  /** A units name the caller already has, such as one from a units library. */
  readonly library?: string
  /** `celsius` or `fahrenheit`. */
  readonly affine?: string
  readonly atom?: UcumAtom
  /** The prefix's power of ten; 0 for none. */
  readonly prefix?: number
}

type Found = Omit<ResolvedSymbol, 'label' | 'exponent'>

/** Affine temperature units, accepted by name as PhLynx does. */
const AFFINE_UNITS = new Set(AFFINE_SYMBOLS.values())

/** Finds a symbol with no exponent: a known name, a UCUM symbol, or a prefix and a metric UCUM symbol. */
function lookUpSymbol(text: string, names: ReadonlySet<string>): Found | null {
  if (AFFINE_UNITS.has(text)) return { affine: text }
  if (names.has(text)) return { library: text }
  const affine = AFFINE_SYMBOLS.get(text)
  if (affine !== undefined) return { affine }
  const atom = UCUM_ATOMS.get(text)
  if (atom !== undefined) return { atom, prefix: 0 }

  for (const [symbol, prefix] of UCUM_PREFIXES) {
    const prefixed = text.startsWith(symbol) ? UCUM_ATOMS.get(text.slice(symbol.length)) : undefined
    if (prefixed?.metric) return { atom: prefixed, prefix: PREFIX_POWERS.get(prefix)! }
  }
  return null
}

/**
 * Resolves one symbol of an expression. Known names come first, so `Hz2`
 * stays a library's units of that name; only when the whole symbol isn't
 * known is a trailing integer read as its exponent.
 */
export function resolveSymbol(text: string, names: ReadonlySet<string> = new Set()): ResolvedSymbol | null {
  const whole = lookUpSymbol(text, names)
  if (whole) return { ...whole, label: text, exponent: 1 }

  const split = /^(.*?[^\d+-])([+-]?\d+)$/.exec(text)
  const found = split ? lookUpSymbol(split[1]!, names) : null
  return found ? { ...found, label: split![1]!, exponent: Number(split![2]) } : null
}

//==============================================================================
// Naming

const roundFactor = (value: number): number => Number(value.toPrecision(12))

/** Powers of ten that get a word, so `10*9/L` reads `giga_per_L`. */
const FACTOR_WORDS = new Map([...PREFIX_NAMES].filter(([power]) => Math.abs(power) >= 3))

/** A CellML identifier from any text: invalid characters dropped, and `_` first if it would start with a digit. */
export function sanitiseName(name: string): string {
  let sanitised = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
  if (sanitised && !/^[a-zA-Z_]/.test(sanitised)) sanitised = `_${sanitised}`
  return sanitised
}

/** `name`, or `name_1`, `name_2`, ... if it is taken. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  let candidate = name
  let counter = 1
  while (taken.has(candidate)) candidate = `${name}_${counter++}`
  return candidate
}

/** Names a factor: `giga` for 10⁹, `1e4` for other powers of ten, `2p5` otherwise; small ones divide. */
function factorTerm(factor: number): { text: string; above: boolean } {
  const power = Math.round(Math.log10(factor))
  const isPower = roundFactor(10 ** power) === roundFactor(factor)
  if (isPower && FACTOR_WORDS.has(power)) return { text: FACTOR_WORDS.get(power)!, above: true }
  const above = factor > 1
  const size = roundFactor(above ? factor : 1 / factor)
  return { text: isPower ? `1e${Math.abs(power)}` : String(size).replace('.', 'p').replace(/[^A-Za-z0-9_]/g, ''), above }
}

/**
 * Names a units from its symbols as written, in PhLynx's style: `mV_per_ms`,
 * `kg_per_m3`, `mmHg`, `giga_per_L`. Repeated symbols combine (`m.m/s` is
 * `m2_per_s`), and the expression's own factor becomes a word or number.
 */
export function nameUnits(symbols: readonly { label: string; exponent: number }[], factor: number): string {
  const totals = new Map<string, number>()
  for (const { label, exponent } of symbols) {
    const text = label.replace(/[[\]]/g, '').replace(/%/g, 'percent')
    totals.set(text, (totals.get(text) ?? 0) + exponent)
  }

  const term = ([text, exponent]: [string, number]): string => (Math.abs(exponent) === 1 ? text : `${text}${Math.abs(exponent)}`)
  const above = [...totals].filter(([, exponent]) => exponent > 0).map(term)
  const below = [...totals].filter(([, exponent]) => exponent < 0).map(term)
  if (roundFactor(factor) !== 1) {
    const { text, above: isAbove } = factorTerm(factor)
    ;(isAbove ? above : below).unshift(text)
  }

  const name = [above.join('_'), ...below.map((text) => `per_${text}`)].filter(Boolean).join('_')
  return sanitiseName(name)
}

//==============================================================================

/** A units expression with every symbol resolved. */
export interface UcumUnits {
  /** The expression as given. */
  readonly code: string
  /** The expression's own factor, from `10*3` or plain integers. */
  readonly factor: number
  readonly symbols: readonly ResolvedSymbol[]
}

/**
 * Parses and resolves a UCUM units expression, throwing a `UcumError` for
 * anything it can't read or any symbol it doesn't know. `names` are units
 * names the caller already has, which take precedence over UCUM symbols.
 */
export function parseUcum(code: string, names: ReadonlySet<string> = new Set()): UcumUnits {
  const parsed = parseUnitExpression(code)
  if ('error' in parsed) throw new UcumError(`Can't read units "${code}": ${parsed.error}`)
  const symbols = parsed.symbols.map(({ text, sign }) => {
    const symbol = resolveSymbol(text, names)
    if (symbol === null) throw new UcumError(`Unknown units "${text}" in "${code}"`)
    return { ...symbol, exponent: symbol.exponent * sign }
  })
  return { code, factor: parsed.factor, symbols }
}
