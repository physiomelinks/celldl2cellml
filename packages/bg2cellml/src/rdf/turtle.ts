/**
 * A small Turtle writer for the triples bg2cellml makes, with prefixes.
 * oxigraph's JavaScript `dump()` takes no prefixes, so its Turtle has every
 * IRI in full.
 */

import { NAMESPACES } from './namespaces.js'

/** An IRI, or a plain string literal. */
export type TurtleObject = { readonly iri: string } | { readonly literal: string }

export interface Triple {
  readonly subject: string
  readonly predicate: string
  readonly object: TurtleObject
}

const RDF_TYPE = `${NAMESPACES.rdf}type`

/** A local name that can follow a prefix without escapes: letters, digits, `_` and `-`, not starting with `-`. */
const SAFE_LOCAL = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/

const escapeIri = (iri: string): string =>
  iri.replace(/[\u0000- <>"{}|^`\\]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)

function escapeLiteral(text: string): string {
  return text.replace(/[\\"\n\r\t]/g, (c) => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c]!)
}

/**
 * Triples as Turtle: the prefixes, then each subject's triples together, in
 * the order the subjects first appear. An IRI is written with the longest
 * prefix it starts with, when what follows is a plain local name.
 */
export function toTurtle(triples: readonly Triple[], prefixes: Readonly<Record<string, string>>): string {
  const byLength = Object.entries(prefixes).sort(([, a], [, b]) => b.length - a.length)
  const iri = (value: string): string => {
    for (const [prefix, namespace] of byLength) {
      if (value.startsWith(namespace) && SAFE_LOCAL.test(value.slice(namespace.length))) return `${prefix}:${value.slice(namespace.length)}`
    }
    return `<${escapeIri(value)}>`
  }
  const object = (o: TurtleObject): string => ('iri' in o ? iri(o.iri) : `"${escapeLiteral(o.literal)}"`)

  const subjects = new Map<string, Triple[]>()
  for (const triple of triples) {
    if (!subjects.has(triple.subject)) subjects.set(triple.subject, [])
    subjects.get(triple.subject)!.push(triple)
  }
  const lines = Object.entries(prefixes).map(([prefix, namespace]) => `@prefix ${prefix}: <${escapeIri(namespace)}> .`)
  lines.push('')
  for (const [subject, group] of subjects) {
    const predicates = group.map((t) => `${t.predicate === RDF_TYPE ? 'a' : iri(t.predicate)} ${object(t.object)}`)
    lines.push(`${iri(subject)} ${predicates.join(' ;\n    ')} .`)
  }
  return `${lines.join('\n')}\n`
}
