/** Helpers for reading query rows that describe one thing over several rows. */

import { DeclarationError } from '../framework/variables.js'
import type { ResultRow, Term } from '../rdf/graph.js'

/** Query rows grouped by the term in `key`, in query order. */
export function groupRows(rows: readonly ResultRow[], key: string): Map<string, ResultRow[]> {
  const groups = new Map<string, ResultRow[]>()
  for (const row of rows) {
    const iri = row.get(key)!.value
    groups.set(iri, [...(groups.get(iri) ?? []), row])
  }
  return groups
}

/** The one term bound to `name` in a group of rows, if any; throws a `DeclarationError` if there are several. */
export function singleTerm(rows: readonly ResultRow[], name: string, message: () => string): Term | undefined {
  const terms = new Map<string, Term>()
  for (const row of rows) {
    const term = row.get(name)
    if (term !== undefined) terms.set(`${term.termType} ${term.value} ${term.termType === 'Literal' ? term.datatype.value : ''}`, term)
  }
  if (terms.size > 1) throw new DeclarationError(message())
  return [...terms.values()][0]
}
