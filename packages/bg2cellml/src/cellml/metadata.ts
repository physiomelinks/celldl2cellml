/**
 * Metadata linking the CellML variables back to the bond graph, from
 * `CellMLModel.metadata()` and `annotation()` in `cellml/__init__.py`
 * (plan chunk 6.4).
 *
 * The metadata says the CellML file `bqmodel:isDescribedBy` the bond graph
 * model, and for each element or junction variable with a `bgf:` type, that
 * the CellML variable `bqmodel:isDerivedFrom` the element or junction and has
 * that type. Labelled elements and junctions get their `rdfs:label`. CellML
 * variables are named by their ids, `<cellml file>#<component>-<name>`.
 *
 * The annotation lists, for each element or junction, the CellML variables
 * made from it (`<component>/<name>`, `main/<name>` by default), in the order the variables are written.
 *
 * Differences from Python:
 * - Python's metadata() fails for every BG-RDF model: it adds a `diagram`
 *   prefix of the model's IRI with `#` appended, which isn't an IRI when the
 *   model's IRI already has a fragment. Here `diagram` is the model's IRI
 *   up to its fragment, so element IRIs are written `diagram:R_0`.
 * - The Turtle is written here, so it lays out differently; the triples are
 *   the same.
 */

import { NAMESPACES } from '../rdf/namespaces.js'
import { toTurtle, type Triple } from '../rdf/turtle.js'
import type { BondgraphModel } from '../model/model.js'
import type { CellMLModelBuild } from './model.js'

/** The CellML file's IRI when none is given, as Python's `CELLML_MODEL_URI`. */
export const CELLML_MODEL_URI = 'file:///CELLML_MODEL_URI'

export const BQMODEL = 'http://biomodels.net/model-qualifiers/'

/**
 * The CellML file's IRI for a source, as `@celldl/editor-python-tools` names
 * it when it's given none: the source's IRI with its last `.` part replaced by
 * `cellml` (`example_RC.ttl` gives `example_RC.cellml`).
 */
export function cellmlUriFor(sourceUri: string): string {
  const parts = sourceUri.split('.')
  if (parts.length > 1) parts.pop()
  parts.push('cellml')
  return parts.join('.')
}

/** The CellML variables made from an element or junction, by its IRI, as Python's `annotation()`. */
export type ElementAnnotation = Readonly<Record<string, { readonly variables: readonly string[] }>>

/** The metadata's triples, in a fixed order: the model, then each variable's, then labels. */
export function metadataTriples(build: CellMLModelBuild, model: BondgraphModel, cellmlUri: string = CELLML_MODEL_URI): Triple[] {
  const triples: Triple[] = [{ subject: cellmlUri, predicate: `${BQMODEL}isDescribedBy`, object: { iri: model.iri } }]
  const labels: Triple[] = []
  const labelled = new Set<string>()
  for (const variable of build.variables) {
    const source = variable.source
    if (variable.kind !== 'variable' || source === undefined) continue
    if (variable.type !== undefined) {
      const subject = `${cellmlUri}#${variable.id}`
      triples.push({ subject, predicate: `${BQMODEL}isDerivedFrom`, object: { iri: source.iri } })
      triples.push({ subject, predicate: `${NAMESPACES.rdf}type`, object: { iri: variable.type } })
    }
    if (source.label !== undefined && !labelled.has(source.iri)) {
      labelled.add(source.iri)
      labels.push({ subject: source.iri, predicate: `${NAMESPACES.rdfs}label`, object: { literal: source.label } })
    }
  }
  return [...triples, ...labels]
}

/** The prefixes the metadata is written with. */
export function metadataPrefixes(model: BondgraphModel, cellmlUri: string = CELLML_MODEL_URI): Record<string, string> {
  const hash = model.iri.indexOf('#')
  return {
    bgf: NAMESPACES.bgf,
    bqmodel: BQMODEL,
    rdfs: NAMESPACES.rdfs,
    model: `${cellmlUri}#`,
    diagram: `${hash >= 0 ? model.iri.slice(0, hash) : model.iri}#`,
  }
}

/** The metadata as Turtle. */
export function metadataTurtle(build: CellMLModelBuild, model: BondgraphModel, cellmlUri: string = CELLML_MODEL_URI): string {
  return toTurtle(metadataTriples(build, model, cellmlUri), metadataPrefixes(model, cellmlUri))
}

/** Each element's and junction's CellML variables, as Python's `annotation()`: one entry per element, in the order the variables come. */
export function annotation(build: CellMLModelBuild): ElementAnnotation[] {
  const variables = new Map<string, string[]>()
  for (const variable of build.variables) {
    if (variable.kind !== 'variable' || variable.source === undefined) continue
    const iri = variable.source.iri
    if (!variables.has(iri)) variables.set(iri, [])
    variables.get(iri)!.push(`${build.componentName}/${variable.name}`)
  }
  return [...variables].map(([iri, names]) => ({ [iri]: { variables: names } }))
}
