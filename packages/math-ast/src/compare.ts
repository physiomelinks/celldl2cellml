import type { AstNode } from './ast.js'
import { children, walk } from './traverse.js'

/**
 * Structural equality. Bond graph assembly relies on this, for example to find
 * and remove a junction's left-hand side from its list of inputs.
 *
 * Numbers are equal when their values and units are: `1e-8` written in
 * e-notation equals `0.00000001` written plainly.
 */
export function equals(a: AstNode, b: AstNode): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'Number': {
      const n = b as typeof a
      return (a.value === n.value || (Number.isNaN(a.value) && Number.isNaN(n.value))) && a.units === n.units
    }
    case 'Identifier':
      return a.name === (b as typeof a).name
    case 'Constant':
      return a.name === (b as typeof a).name
    case 'FunctionCall':
      if (a.name !== (b as typeof a).name) return false
      break
    case 'Root':
      // a square root and a root with an explicit degree have different operand lists
      if ((a.degree === null) !== ((b as typeof a).degree === null)) return false
      break
    case 'Piecewise':
      if (a.pieces.length !== (b as typeof a).pieces.length) return false
      if ((a.otherwise === null) !== ((b as typeof a).otherwise === null)) return false
      break
  }
  const left = children(a)
  const right = children(b)
  return left.length === right.length && left.every((child, i) => equals(child, right[i]!))
}

/** The names of all variables in one or more trees, in first-seen order. */
export function variables(...nodes: readonly AstNode[]): string[] {
  const names = new Set<string>()
  for (const node of nodes) {
    for (const n of walk(node)) if (n.type === 'Identifier') names.add(n.name)
  }
  return [...names]
}

/**
 * A deterministic key for sorting equations by their left-hand side: a
 * variable's name, `d(q)/d(t)` for a derivative, otherwise a compact
 * structural form.
 */
export function sortKey(node: AstNode): string {
  switch (node.type) {
    case 'Identifier':
      return node.name
    case 'Number':
      return String(node.value)
    case 'Constant':
      return node.name
    case 'Derivative':
      return `d(${sortKey(node.expression)})/d(${sortKey(node.variable)})`
    case 'FunctionCall':
      return `${node.name}(${node.args.map(sortKey).join(',')})`
    default:
      return `${node.type}(${children(node).map(sortKey).join(',')})`
  }
}
