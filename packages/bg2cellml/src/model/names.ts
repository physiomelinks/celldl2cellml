/**
 * How the Python bg2cellml names model elements and their variables, and
 * prints them in messages. From `model_support.py` and `bondgraph/utils.py`.
 */

import type { Domain } from '../framework/framework.js'
import { cleanName } from '../framework/variables.js'
import { fragment } from '../rdf/namespaces.js'

/** Models the CellDL Editor makes live under here; `prettyUri` drops it. */
export const LOCAL_MODEL_BASE = 'https://bg-rdf.org/models/local/'

/**
 * A LaTeX species or location, such as `\mathrm{Na^+}`, `Ca^{2+}` or
 * `\text{in}`, as part of a name: `Na_`, `Ca_2` and `in`. Python's `clean_latex`:
 *
 * 1. each `\command{argument}` becomes `_argument`;
 * 2. `^` becomes `_`;
 * 3. anything but ASCII letters, digits and `_` is dropped;
 * 4. leading `_`s are dropped.
 */
export function cleanLatex(latex: string): string {
  let name = latex.trim().replace(/\\[^{]*\{([^}]*)\}/g, '_$1')
  name = name.replaceAll('^', '_')
  name = name.replace(/[^a-zA-Z_0-9]/g, '')
  return name.replace(/^_*/, '')
}

/** What a model gives for an element or junction's name. */
export interface SymbolParts {
  readonly iri: string
  readonly symbol?: string
  readonly species?: string
  readonly location?: string
}

/**
 * An element or junction's symbol, as Python's `make_symbolic_name`: its
 * `bgf:hasSymbol`, or else its IRI's fragment, then `_` and the cleaned
 * species and location if it has them. The symbol itself isn't cleaned.
 */
export function makeSymbolicName(parts: SymbolParts): string {
  let symbol = parts.symbol ?? fragment(parts.iri)
  if (parts.species !== undefined) symbol += `_${cleanLatex(parts.species)}`
  if (parts.location !== undefined) symbol += `_${cleanLatex(parts.location)}`
  return symbol
}

/**
 * The name of an element's copy of a template variable, as Python's
 * `Variable.copy(suffix, domain)`: the name, `_` and the cleaned element
 * symbol (`R` of `R_0` is `R_R_0`). Where the name is one of the domain's
 * flow, potential or quantity and the symbol starts with it, the symbol alone
 * (`q` of `q_1` is `q_1`, not `q_q_1`).
 */
export function elementVariableName(name: string, elementSymbol: string, domain: Domain): string {
  const suffix = cleanName(elementSymbol)
  return domain.intrinsicSymbols.includes(name) && name === suffix.split('_')[0] ? suffix : `${name}_${suffix}`
}

/** An IRI for messages, as Python's `pretty_uri`: `#fragment`, or the part after `LOCAL_MODEL_BASE`. */
export function prettyUri(iri: string): string {
  if (iri.startsWith(LOCAL_MODEL_BASE)) return iri.slice(LOCAL_MODEL_BASE.length)
  const hash = iri.indexOf('#')
  return hash >= 0 ? iri.slice(hash) : iri
}

/** `symbol (#fragment)`, as Python's `pretty_name`. */
export function prettyName(symbol: string, iri: string): string {
  return `${symbol} (${prettyUri(iri)})`
}
