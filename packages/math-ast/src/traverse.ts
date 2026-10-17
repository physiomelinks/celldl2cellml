/**
 * Generic access to a node's operands, so code that walks or rebuilds trees
 * doesn't need a case for every node type. Only this file needs updating when
 * a node type is added.
 */

import type { AstNode } from './ast.js'

function assertNever(value: never): never {
  throw new Error(`Unknown AST node: ${JSON.stringify(value)}`)
}

/** A node's operands, in reading order. Leaves have none. */
export function children(node: AstNode): AstNode[] {
  switch (node.type) {
    case 'Number':
    case 'Identifier':
    case 'Constant':
      return []
    case 'Add':
    case 'Multiply':
    case 'And':
    case 'Or':
    case 'Xor':
      return [...node.children]
    case 'FunctionCall':
      return [...node.args]
    case 'Subtract':
      return [node.minuend, node.subtrahend]
    case 'Negate':
    case 'Abs':
    case 'Not':
      return [node.value]
    case 'Root':
      return node.degree === null ? [node.radicand] : [node.radicand, node.degree]
    case 'Equal':
    case 'Less':
    case 'Greater':
    case 'LessEqual':
    case 'GreaterEqual':
    case 'NotEqual':
      return [node.left, node.right]
    case 'Piecewise':
      return [...node.pieces.flatMap((p) => [p.value, p.condition]), ...(node.otherwise ? [node.otherwise] : [])]
    case 'Divide':
      return [node.numerator, node.denominator]
    case 'Power':
      return [node.base, node.exponent]
    case 'Derivative':
      return [node.expression, node.variable]
    default:
      return assertNever(node)
  }
}

/** The same node with each operand replaced by `f(operand)`. Leaves are returned as they are. */
export function mapChildren(node: AstNode, f: (child: AstNode) => AstNode): AstNode {
  switch (node.type) {
    case 'Number':
    case 'Identifier':
    case 'Constant':
      return node
    case 'Add':
    case 'Multiply':
    case 'And':
    case 'Or':
    case 'Xor':
      return { ...node, children: node.children.map(f) }
    case 'FunctionCall':
      return { ...node, args: node.args.map(f) }
    case 'Subtract':
      return { ...node, minuend: f(node.minuend), subtrahend: f(node.subtrahend) }
    case 'Negate':
    case 'Abs':
    case 'Not':
      return { ...node, value: f(node.value) }
    case 'Root':
      return { ...node, radicand: f(node.radicand), degree: node.degree === null ? null : f(node.degree) }
    case 'Equal':
    case 'Less':
    case 'Greater':
    case 'LessEqual':
    case 'GreaterEqual':
    case 'NotEqual':
      return { ...node, left: f(node.left), right: f(node.right) }
    case 'Piecewise':
      return {
        ...node,
        pieces: node.pieces.map((p) => ({ value: f(p.value), condition: f(p.condition) })),
        otherwise: node.otherwise === null ? null : f(node.otherwise),
      }
    case 'Divide':
      return { ...node, numerator: f(node.numerator), denominator: f(node.denominator) }
    case 'Power':
      return { ...node, base: f(node.base), exponent: f(node.exponent) }
    case 'Derivative':
      return { ...node, expression: f(node.expression), variable: f(node.variable) }
    default:
      return assertNever(node)
  }
}

/** Every node in the tree, parents before their operands. */
export function* walk(node: AstNode): Generator<AstNode> {
  yield node
  for (const child of children(node)) yield* walk(child)
}
