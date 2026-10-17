import { parseUnit } from '@atomic-ehr/ucum'

/** One factor of a UCUM unit code, for example `mL` in `mL/s` is `{ atom: 'L', prefix: 'm', exponent: 1 }`. */
export interface UcumTerm {
  readonly atom: string
  readonly prefix?: string
  readonly exponent: number
  /** A `{...}` annotation. It has no effect on units. */
  readonly annotation?: string
}

export class UcumError extends Error {
  override name = 'UcumError'
}

interface AstNode {
  type: string
  operator?: '.' | '/'
  left?: AstNode
  right?: AstNode
  operand?: AstNode
  atom?: string
  prefix?: string
  exponent?: number
  annotation?: string
}

/** Break a UCUM code into its factors, with `/` turned into negative exponents. */
export function parseUcum(code: string): UcumTerm[] {
  const result = parseUnit(code) as { ast?: AstNode; errors: { message: string }[] }
  if (result.errors.length > 0 || result.ast === undefined) {
    throw new UcumError(`Invalid UCUM code '${code}': ${result.errors.map((e) => e.message).join('; ')}`)
  }
  const terms: UcumTerm[] = []
  const walk = (node: AstNode, sign: 1 | -1): void => {
    switch (node.type) {
      case 'unit': {
        const term: { -readonly [K in keyof UcumTerm]: UcumTerm[K] } = {
          atom: node.atom!,
          exponent: sign * (node.exponent ?? 1),
        }
        if (node.prefix !== undefined) term.prefix = node.prefix
        if (node.annotation !== undefined) term.annotation = node.annotation
        terms.push(term)
        break
      }
      case 'binary':
        walk(node.left!, sign)
        walk(node.right!, node.operator === '/' ? (-sign as 1 | -1) : sign)
        break
      case 'unary':
        walk(node.operand!, node.operator === '/' ? (-sign as 1 | -1) : sign)
        break
      default:
        throw new UcumError(`Unsupported UCUM construct '${node.type}' in '${code}'`)
    }
  }
  walk(result.ast, 1)
  return terms
}
