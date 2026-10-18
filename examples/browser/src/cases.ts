/**
 * The cases the page converts, shared by the page and the Playwright test so
 * both convert the same files with the same IRIs. Paths are relative to the
 * repository root. Nothing here reads files: the page bundles them with Vite,
 * the test reads them with Node.
 */

import manifest from '../../../packages/bg2cellml/test/reference/manifest.json' with { type: 'json' }

export interface Case {
  name: string
  /** `example` and `variant` come from the reference manifest; `celldl` is a document saved by the CellDL Editor. */
  kind: 'example' | 'variant' | 'celldl'
  /** Relative to the repository root. */
  source: string
  /** The base IRI the parity tests use, so names match theirs. */
  sourceUri: string
  /** BG-RDF Turtle rather than a CellDL document. */
  rdfSource: boolean
}

/** The BG-RDF framework files, relative to the repository root. */
export const ONTOLOGY = 'bg-rdf/schema/ontology.ttl'
export const TEMPLATES: readonly string[] = Object.keys(manifest.bgRdf.files)
  .filter((file) => file.startsWith('templates/'))
  .map((file) => `bg-rdf/${file}`)

/** The BG-RDF tag the references were made from. */
export const BG_RDF_TAG: string = manifest.bgRdf.tag

export const CASES: readonly Case[] = [
  // BG-Tools' tests/models/rdf_error.celldl, the only CellDL saved by the editor we have (see test/hand-worked.test.ts)
  {
    name: 'rdf_error.celldl',
    kind: 'celldl',
    source: 'packages/bg2cellml/test/models/rdf_error.celldl',
    sourceUri: 'file:///C:/Users/Some%20One/rdf_error.celldl',
    rdfSource: false,
  },
  ...manifest.cases.map(
    (c): Case => ({
      name: c.name,
      kind: c.kind as 'example' | 'variant',
      source: c.source,
      sourceUri: c.baseIri,
      rdfSource: true,
    }),
  ),
]

/** Templates, keyed by file name as `Converter.loadFramework` wants them. */
export function templateName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** What one conversion gave, as the page reports it and the test compares it. */
export interface CaseResult {
  name: string
  cellml?: string
  metadata?: string
  issues?: string[]
  exception?: string
  /** Milliseconds for `celldl2cellml`. */
  ms: number
}
