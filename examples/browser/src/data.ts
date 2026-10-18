/**
 * The BG-RDF framework and every case's source, as text, bundled from the
 * repository by Vite, with the case list. The page imports this dynamically,
 * so it builds into its own chunk and the converter's own size can be
 * measured without it.
 */

import { CASES, ONTOLOGY, TEMPLATES } from './cases.js'

// The case list comes from the reference manifest, so it rides in this chunk too
export { CASES, ONTOLOGY, TEMPLATES, templateName } from './cases.js'

const RAW = {
  ...import.meta.glob('../../../bg-rdf/schema/ontology.ttl', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../bg-rdf/templates/*.ttl', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../bg-rdf/examples/*.ttl', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../../packages/bg2cellml/test/models/*.{ttl,celldl}', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>

/** Keyed by path from the repository root. */
const FILES = new Map(Object.entries(RAW).map(([path, text]) => [path.replace(/^(\.\.\/)+/, ''), text]))

/** A bundled file's text. */
export function bundled(path: string): string {
  const text = FILES.get(path)
  if (text === undefined) throw new Error(`${path} isn't bundled`)
  return text
}

/** The framework files and case sources that aren't bundled; there should be none. */
export function missingSources(): string[] {
  return [ONTOLOGY, ...TEMPLATES, ...CASES.map((c) => c.source)].filter((path) => !FILES.has(path))
}
