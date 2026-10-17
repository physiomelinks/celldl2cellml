import type { Equation, Expr } from './ast.js'

/**
 * Structural equality. Bond graph assembly relies on this, for example to find
 * and remove a junction's left-hand side from its list of inputs.
 */
export function equals(a: Expr, b: Expr): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'ci':
      return a.name === (b as typeof a).name
    case 'cn':
      return a.value === (b as typeof a).value && a.units === (b as typeof a).units
    case 'constant':
      return a.name === (b as typeof a).name
    case 'diff': {
      const d = b as typeof a
      return a.variable.name === d.variable.name && a.bvar.name === d.bvar.name
    }
    case 'apply': {
      const o = b as typeof a
      return a.op === o.op && a.args.length === o.args.length && a.args.every((arg, i) => equals(arg, o.args[i]!))
    }
  }
}

function isEquationList(item: Expr | Equation | readonly Equation[]): item is readonly Equation[] {
  return Array.isArray(item)
}

/** The names of all variables in an expression or equation, in first-seen order. */
export function variables(item: Expr | Equation | readonly Equation[]): string[] {
  const names = new Set<string>()
  const visit = (e: Expr): void => {
    switch (e.kind) {
      case 'ci':
        names.add(e.name)
        break
      case 'diff':
        names.add(e.variable.name)
        names.add(e.bvar.name)
        break
      case 'apply':
        e.args.forEach(visit)
        break
    }
  }
  const visitEquation = (eqn: Equation): void => {
    visit(eqn.lhs)
    visit(eqn.rhs)
  }
  if (isEquationList(item)) item.forEach(visitEquation)
  else if ('kind' in item) visit(item)
  else visitEquation(item)
  return [...names]
}

/** A deterministic key for sorting equations by their left-hand side. */
export function sortKey(e: Expr): string {
  switch (e.kind) {
    case 'ci':
      return e.name
    case 'cn':
      return String(e.value)
    case 'constant':
      return e.name
    case 'diff':
      return `d(${e.variable.name})/d(${e.bvar.name})`
    case 'apply':
      return `${e.op}(${e.args.map(sortKey).join(',')})`
  }
}
