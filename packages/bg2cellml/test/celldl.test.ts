import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import { extractBgRdf } from '../src/index.js'

const domParser = new DOMParser() as unknown as Parameters<typeof extractBgRdf>[1]

describe('extractBgRdf', () => {
  it('returns the Turtle in the CellDL metadata element', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <metadata id="celldl-rdf-metadata" data-content-type="text/turtle"><![CDATA[@prefix : <#> .]]></metadata>
    </svg>`
    expect(extractBgRdf(svg, domParser)).toBe('@prefix : <#> .')
  })

  it('returns an empty string when there is no BG-RDF', () => {
    expect(extractBgRdf('<svg xmlns="http://www.w3.org/2000/svg"/>', domParser)).toBe('')
  })
})
