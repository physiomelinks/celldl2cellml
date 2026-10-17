/** Getting BG-RDF out of a CellDL (SVG) document. */

export const CELLDL_METADATA_ID = 'celldl-rdf-metadata'
const SVG_NS = 'http://www.w3.org/2000/svg'
const TURTLE = 'text/turtle'

export interface DOMParserLike {
  parseFromString(source: string, mimeType: 'image/svg+xml' | 'application/xml'): Document
}

/**
 * The Turtle in a CellDL document's `<metadata id="celldl-rdf-metadata">`,
 * or `''` if there isn't any. This matches `getBgRdf` in
 * `@celldl/editor-python-tools`.
 */
export function extractBgRdf(celldl: string, domParser?: DOMParserLike): string {
  const parser =
    domParser ?? (() => {
      const P = (globalThis as { DOMParser?: new () => DOMParserLike }).DOMParser
      if (P === undefined) throw new Error('No DOMParser is available; pass one in')
      return new P()
    })()
  const doc = parser.parseFromString(celldl, 'image/svg+xml')
  const metadata = Array.from(doc.getElementsByTagNameNS(SVG_NS, 'metadata')).find(
    (e) => e.getAttribute('id') === CELLDL_METADATA_ID,
  )
  if (metadata === undefined) return ''
  const contentType = metadata.getAttribute('data-content-type')
  if (contentType !== null && contentType !== TURTLE) return ''
  for (const child of Array.from(metadata.childNodes)) {
    // CDATA_SECTION_NODE
    if (child.nodeType === 4) return (child as CharacterData).data
  }
  return metadata.textContent ?? ''
}
