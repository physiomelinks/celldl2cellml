/**
 * Plan chunk 6.4: metadata linking CellML variables to bond graph elements,
 * and the element-to-variables annotation, checked against the Python
 * bg2cellml's (test/reference/python/<example>.metadata.ttl and
 * .annotation.json).
 *
 * Python's own metadata() fails on every BG-RDF model (its `diagram` prefix
 * isn't an IRI), so the generator records its triples by serialising them as
 * metadata() would, without that prefix. Turtle is compared as triples.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { LibCellML } from '@physiomelinks/cellml-units'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  BondgraphModel,
  CELLML_MODEL_URI,
  Converter,
  IssueLog,
  ModelVariable,
  annotation,
  buildCellMLModel,
  cellmlUriFor,
  freeBuild,
  generateCellML,
  metadataTriples,
  toTurtle,
  type BondgraphFramework,
  type ModelRuntime,
  type Runtime,
} from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url))
const manifest = loadManifest()
let framework: BondgraphFramework
let runtime: ModelRuntime
let libcellml: LibCellML

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  libcellml = runtime.libcellml
  framework = bgRdfFramework()
})

const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const loadCase = (c: ReferenceCase): BondgraphModel => BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri)
const reference = (file: string): string => readFileSync(`${REFERENCE_DIR}${file}`, 'utf8')

/** Turtle's triples as sorted N-Triples lines, read by oxigraph, so layout and prefixes don't matter. */
function triplesOf(turtle: string): string[] {
  const store = new oxigraph.Store()
  store.load(turtle, { format: 'text/turtle' })
  return store
    .dump({ format: 'application/n-triples', from_graph_name: oxigraph.defaultGraph() })
    .split('\n')
    .filter((line) => line.trim() !== '')
    .sort()
}

function generate(c: ReferenceCase, cellmlUri: string) {
  const result = generateCellML(libcellml, loadCase(c), { metadata: true, cellmlUri })
  expect(result.metadata).toBeDefined()
  return result
}

const examples = manifest.cases.filter((c) => c.kind === 'example')

describe('the reference examples', () => {
  it('have Python metadata, which Python itself fails to write', () => {
    for (const c of examples) {
      expect(c.pythonMetadata, c.name).toBe(`python/${c.name}.metadata.ttl`)
      expect(c.pythonAnnotation, c.name).toBe(`python/${c.name}.annotation.json`)
      expect(c.cellmlUri, c.name).toBe(cellmlUriFor(c.baseIri))
      expect(c.pythonMetadataError, c.name).toMatch(/^ValueError: Invalid prefix diagram IRI '.*#.*#'/)
    }
  })

  describe.each(examples)('$name', (c) => {
    it("has Python's metadata triples", () => {
      const result = generate(c, c.cellmlUri!)
      expect(triplesOf(result.metadata!)).toEqual(triplesOf(reference(c.pythonMetadata!)))
    })

    it("has Python's annotation", () => {
      const result = generate(c, c.cellmlUri!)
      expect(result.annotation).toEqual(JSON.parse(reference(c.pythonAnnotation!)))
    })
  })
})

describe('example_RC', () => {
  it('writes its metadata with prefixes, elements as diagram: names', () => {
    const c = caseNamed('example_RC')
    const { metadata } = generate(c, c.cellmlUri!)
    expect(metadata).toContain('@prefix model: <https://github.com/CellDL/BG-RDF/blob/v2026-04-12/examples/example_RC.cellml#> .')
    expect(metadata).toContain('@prefix diagram: <https://github.com/CellDL/BG-RDF/blob/v2026-04-12/examples/example_RC.ttl#> .')
    expect(metadata).toContain('model:main-q_1 bqmodel:isDerivedFrom diagram:q_1 ;\n    a bgf:QuantityVariable .')
    expect(metadata).toContain('<https://github.com/CellDL/BG-RDF/blob/v2026-04-12/examples/example_RC.cellml> bqmodel:isDescribedBy diagram:RC_circuit .')
  })

  it("uses Python's placeholder for the CellML file's IRI when none is given", () => {
    const result = generateCellML(libcellml, loadCase(caseNamed('example_RC')), { metadata: true })
    expect(triplesOf(result.metadata!).join('\n')).toContain(`<${CELLML_MODEL_URI}#main-q_1>`)
  })

  it('gives metadata only when asked, and the annotation always', () => {
    const result = generateCellML(libcellml, loadCase(caseNamed('example_RC')))
    expect(result.metadata).toBeUndefined()
    expect(result.annotation).toHaveLength(5)
  })
})

describe('the variants', () => {
  // A variant's IRIs are its own; with its example's put in their place, its metadata is its example's
  describe.each(manifest.cases.filter((c) => c.kind === 'variant'))('$name', (c) => {
    it("has its example's metadata and annotation, in its own IRIs", () => {
      const example = caseNamed(c.reference.replace(/\.json$/, ''))
      const result = generate(c, cellmlUriFor(c.baseIri))
      const asExample = (text: string): string =>
        text.replaceAll(cellmlUriFor(c.baseIri), example.cellmlUri!).replaceAll(c.baseIri, example.baseIri)
      expect(triplesOf(asExample(result.metadata!))).toEqual(triplesOf(reference(example.pythonMetadata!)))
      expect(JSON.parse(asExample(JSON.stringify(result.annotation)))).toEqual(JSON.parse(reference(example.pythonAnnotation!)))
    })
  })
})

describe('Converter', () => {
  it("names the CellML file after the source, as the CellDL Editor's Python tools do", async () => {
    const converter = new Converter(runtime as Runtime)
    expect(converter.loadFramework(frameworkSource())).toEqual([])
    const c = caseNamed('example_RC')
    const named = await converter.celldl2cellml(readSource(c), { sourceUri: c.baseIri, rdfSource: true, metadata: true })
    expect(triplesOf(named.metadata!)).toEqual(triplesOf(reference(c.pythonMetadata!)))
    const given = await converter.celldl2cellml(readSource(c), {
      sourceUri: c.baseIri,
      rdfSource: true,
      metadata: true,
      cellmlUri: 'https://example.org/rc.cellml',
    })
    expect(given.metadata).toContain('@prefix model: <https://example.org/rc.cellml#> .')
    const without = await converter.celldl2cellml(readSource(c), { sourceUri: c.baseIri, rdfSource: true })
    expect(without.metadata).toBeUndefined()
    expect(without.cellml).toBeDefined()
  })
})

//==============================================================================
// Hand-built cases

describe('cellmlUriFor', () => {
  it.each([
    ['https://example.org/models/rc.celldl', 'https://example.org/models/rc.cellml'],
    ['https://example.org/models/example_RC.ttl', 'https://example.org/models/example_RC.cellml'],
    ['file:///models/rc', 'file:///models/rc.cellml'],
  ])('%s gives %s', (source, cellml) => {
    expect(cellmlUriFor(source)).toBe(cellml)
  })
})

describe('labels and types', () => {
  it('labels elements and junctions that have labels, once each, and links only typed variables', () => {
    const element = {
      iri: 'https://example.org/test#R',
      symbol: 'R',
      label: 'A "resistor"\nwith two lines',
      prettyName: 'R (#R)',
      domain: { iri: 'https://example.org/test#Domain', constants: [] },
      variables: new Map([
        ['v', new ModelVariable({ name: 'v_R', units: 'C/s', type: 'https://bg-rdf.org/ontologies/bondgraph-framework#FlowVariable' })],
        ['R', new ModelVariable({ name: 'R_R', units: 'Ohm' })],
      ]),
    }
    const junction = {
      iri: 'https://example.org/test#I',
      symbol: 'I',
      variables: new Map([['', new ModelVariable({ name: 'I', units: 'C/s', type: 'https://bg-rdf.org/ontologies/bondgraph-framework#FlowVariable' })]]),
    }
    const model = {
      iri: 'https://example.org/test#model',
      elements: new Map([[element.iri, element]]),
      junctions: new Map([[junction.iri, junction]]),
      equations: [],
    } as unknown as BondgraphModel
    const build = buildCellMLModel(libcellml, model, new IssueLog())
    try {
      const triples = metadataTriples(build, model, 'https://example.org/test.cellml')
      expect(triples.filter((t) => t.predicate.endsWith('#label'))).toEqual([
        { subject: element.iri, predicate: 'http://www.w3.org/2000/01/rdf-schema#label', object: { literal: element.label } },
      ])
      // R_R has no bgf: type, so it isn't linked, but is in the annotation
      expect(triples.filter((t) => t.predicate.endsWith('isDerivedFrom')).map((t) => t.subject)).toEqual([
        'https://example.org/test.cellml#main-I',
        'https://example.org/test.cellml#main-v_R',
      ])
      expect(annotation(build)).toEqual([
        { 'https://example.org/test#I': { variables: ['main/I'] } },
        { 'https://example.org/test#R': { variables: ['main/R_R', 'main/v_R'] } },
      ])
      const turtle = toTurtle(triples, { rdfs: 'http://www.w3.org/2000/01/rdf-schema#' })
      expect(turtle).toContain('rdfs:label "A \\"resistor\\"\\nwith two lines"')
      expect(triplesOf(turtle)).toHaveLength(triples.length)
    } finally {
      freeBuild(build)
    }
  })
})

describe('toTurtle', () => {
  it('writes IRIs in full where a prefix would need escapes', () => {
    const turtle = toTurtle(
      [
        { subject: 'https://example.org/a#ok_name-1', predicate: 'https://example.org/a#p', object: { iri: 'https://example.org/a#has.dot' } },
        { subject: 'https://example.org/a#ok_name-1', predicate: 'https://example.org/a#p', object: { iri: 'https://example.org/a#-dash' } },
      ],
      { ex: 'https://example.org/a#' },
    )
    expect(turtle).toBe(
      '@prefix ex: <https://example.org/a#> .\n\nex:ok_name-1 ex:p <https://example.org/a#has.dot> ;\n    ex:p <https://example.org/a#-dash> .\n',
    )
    expect(triplesOf(turtle)).toHaveLength(2)
  })
})
