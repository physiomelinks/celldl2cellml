import type { Equation, Expr } from './ast.js'
import { ci } from './ast.js'

/** A replacement for each variable name: either a new name or a whole expression. */
export type Substitutions = ReadonlyMap<string, string | Expr> | Readonly<Record<string, string | Expr>>

function lookup(subs: Substitutions, name: string): string | Expr | undefined {
  return subs instanceof Map ? subs.get(name) : (subs as Record<string, string | Expr>)[name]
}

/**
 * Replace variables. Renaming is how template variables get an element's
 * symbols (`v` -> `v_R_0`). A derivative's variable and bound variable can
 * only be renamed, not replaced by an expression.
 */
export function substitute(e: Expr, subs: Substitutions): Expr {
  switch (e.kind) {
    case 'ci': {
      const r = lookup(subs, e.name)
      return r === undefined ? e : typeof r === 'string' ? ci(r) : r
    }
    case 'diff': {
      const rename = (c: typeof e.variable) => {
        const r = lookup(subs, c.name)
        if (r === undefined) return c
        if (typeof r === 'string') return ci(r)
        if (r.kind === 'ci') return r
        throw new TypeError(`Cannot replace ${c.name} in a derivative with an expression`)
      }
      return { kind: 'diff', variable: rename(e.variable), bvar: rename(e.bvar) }
    }
    case 'apply':
      return { kind: 'apply', op: e.op, args: e.args.map((arg) => substitute(arg, subs)) }
    default:
      return e
  }
}

export function substituteEquation(eqn: Equation, subs: Substitutions): Equation {
  return { lhs: substitute(eqn.lhs, subs), rhs: substitute(eqn.rhs, subs) }
}
