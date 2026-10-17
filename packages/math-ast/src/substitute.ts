import type { AstNode } from './ast.js'
import { ci } from './ast.js'
import { mapChildren } from './traverse.js'

/** A replacement for each variable name: either a new name or a whole expression. */
export type Substitutions = ReadonlyMap<string, string | AstNode> | Readonly<Record<string, string | AstNode>>

function lookup(subs: Substitutions, name: string): string | AstNode | undefined {
  return subs instanceof Map ? subs.get(name) : Object.hasOwn(subs, name) ? (subs as Record<string, string | AstNode>)[name] : undefined
}

/**
 * Replace variables. Renaming is how template variables get an element's
 * symbols (`v` -> `v_R_0`). A derivative's bound variable can only be renamed,
 * not replaced by an expression.
 */
export function substitute(node: AstNode, subs: Substitutions): AstNode {
  if (node.type === 'Identifier') {
    const replacement = lookup(subs, node.name)
    return replacement === undefined ? node : typeof replacement === 'string' ? ci(replacement) : replacement
  }
  if (node.type === 'Derivative') {
    const variable = substitute(node.variable, subs)
    if (variable.type !== 'Identifier') {
      throw new TypeError(`Cannot replace the bound variable of a derivative with an expression`)
    }
    return { ...node, expression: substitute(node.expression, subs), variable }
  }
  return mapChildren(node, (child) => substitute(child, subs))
}
