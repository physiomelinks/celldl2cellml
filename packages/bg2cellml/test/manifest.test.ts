/**
 * The element manifest `convert()` returns, and the `@celldl/viewer`
 * annotations made from it.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter, toViewerAnnotations, type ElementManifest, type ManifestElement } from '../src/index.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

const manifest = loadManifest()
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const celldl = readFileSync(new URL('./models/rdf_error.celldl', import.meta.url), 'utf8')
const SAVED_AS = 'https://example.org/models/saved.celldl'
/** rdf_error.celldl saved with absolute IRIs. */
const absoluteCelldl = celldl.replace('@prefix : <#> .', `@prefix : <${SAVED_AS}#> .`).replace('<> a celldl:Document', `<${SAVED_AS}> a celldl:Document`)

let converter: Converter

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
})

const elementsOf = async (c: ReferenceCase, source = readSource(c)): Promise<ElementManifest> => {
  const result = await converter.convert(source, { sourceUri: c.baseIri, rdfSource: true })
  expect(result.errors).toEqual([])
  return result.elements
}

/** Variable names by role. */
const roles = (element: ManifestElement): Record<string, string[]> => {
  const byRole: Record<string, string[]> = {}
  for (const { name, role } of element.variables) (byRole[role] ??= []).push(name)
  return byRole
}

describe('element manifest', () => {
  it("gives example_RC's elements and junctions by diagram id, with roles and primary variables", async () => {
    const rc = caseNamed('example_RC')
    const elements = await elementsOf(rc)
    expect(Object.keys(elements).sort()).toEqual(['I_R', 'R_0', 'V_C', 'V_in', 'q_1'])
    expect(elements['q_1']).toMatchObject({
      iri: `${rc.baseIri}#q_1`,
      kind: 'element',
      template: 'https://bg-rdf.org/ontologies/bondgraph-framework#ElectricalCapacitor',
      primary: 'q_1',
    })
    expect(roles(elements['q_1']!)).toEqual({ flow: ['v_q_1'], potential: ['u_q_1'], parameter: ['C_q_1'], quantity: ['q_1'] })
    expect(elements['R_0']).toMatchObject({ primary: 'v_R_0' })
    expect(roles(elements['R_0']!)).toEqual({ flow: ['v_R_0'], potential: ['u_R_0'], parameter: ['R_R_0'] })
    expect(elements['V_C']).toMatchObject({ kind: 'zero', primary: 'V_C', variables: [{ name: 'V_C', role: 'potential' }] })
    expect(elements['I_R']).toMatchObject({ kind: 'one', primary: 'I_R', variables: [{ name: 'I_R', role: 'flow' }] })
  })

  it("makes a capacitor's quantity its primary variable", async () => {
    const elements = await elementsOf(caseNamed('example_A1'))
    expect(elements['C']).toMatchObject({ kind: 'element', primary: 'q_C' })
    expect(roles(elements['C']!)).toMatchObject({ quantity: ['q_C'], parameter: ['C_C'] })
  })

  it("makes a source's own potential or flow its primary variable", async () => {
    const elements = await elementsOf(caseNamed('example_RC'))
    expect(elements['V_in']).toMatchObject({ primary: 'u_V_in' })
    expect(roles(elements['V_in']!)).toEqual({ flow: ['v_V_in'], potential: ['u_V_in'] })
  })

  it("gives a transform node's ratio and ports' variables, and credits a shared variable to each owner", async () => {
    const elements = await elementsOf(caseNamed('example_A3'))
    expect(elements['GY']).toMatchObject({ kind: 'transform', symbol: 'Bl', primary: 'Bl' })
    expect(roles(elements['GY']!)).toEqual({ ratio: ['Bl'], flow: ['v_1_e', 'v_2_m'], potential: ['u_Bl_0', 'u_Bl_1'] })
    // The gyrator's ports take the flows of the one nodes they're bonded to
    expect(elements['v_1_e']).toMatchObject({ kind: 'one', variables: [{ name: 'v_1_e', role: 'flow' }] })
    expect(elements['v_2_m']).toMatchObject({ kind: 'one', variables: [{ name: 'v_2_m', role: 'flow' }] })

    // Reduced, they take the flows of the resistors that act as one nodes
    const reduced = await elementsOf(caseNamed('example_A3_reduced'))
    expect(roles(reduced['GY']!)).toMatchObject({ flow: ['v_R_e', 'v_R_m'] })
    expect(roles(reduced['R_e']!)).toMatchObject({ flow: ['v_R_e'] })
    expect(roles(reduced['R_m']!)).toMatchObject({ flow: ['v_R_m'] })
  })

  it('lists only variables written to the CellML, with their units', async () => {
    const elements = await elementsOf(caseNamed('example_RC'))
    expect(elements['I_R']!.variables).toEqual([{ name: 'I_R', role: 'flow', ucum: 'C/s', units: 'C_per_s' }])
    const result = await converter.convert(readSource(caseNamed('example_RC')), { sourceUri: caseNamed('example_RC').baseIri, rdfSource: true })
    for (const element of Object.values(result.elements)) {
      for (const { name } of element.variables) expect(result.cellml).toContain(`<variable name="${name}" `)
    }
  })

  it('has the same keys for relative and absolute IRIs, whatever the sourceUri', async () => {
    const keys = async (source: string, sourceUri?: string): Promise<string[]> =>
      Object.keys((await converter.convert(source, sourceUri === undefined ? {} : { sourceUri })).elements).sort()
    const expected = await keys(celldl)
    expect(expected.length).toBeGreaterThan(0)
    expect(expected.every((key) => key.startsWith('ID-'))).toBe(true)
    expect(await keys(celldl, 'file:///C:/Users/Some%20One/rdf_error.celldl')).toEqual(expected)
    expect(await keys(absoluteCelldl)).toEqual(expected)
    expect(await keys(absoluteCelldl, 'file:///elsewhere.celldl')).toEqual(expected)
  })

  it("keys an element outside the model's document by its IRI", async () => {
    const rc = caseNamed('example_RC')
    const other = 'https://example.org/other.ttl#R_0'
    const elements = await elementsOf(rc, readSource(rc).replaceAll(':R_0', `<${other}>`))
    expect(elements[other]).toMatchObject({ iri: other, primary: 'v_R_0' })
    expect(elements['R_0']).toBeUndefined()
  })

  it('is given when the CellML could not be built', async () => {
    // A one node named `t` clashes with the variable of integration
    const rc = caseNamed('example_RC')
    const result = await converter.convert(readSource(rc).replaceAll(':I_R', ':t'), { sourceUri: rc.baseIri, rdfSource: true })
    expect(result.cellml).toBeUndefined()
    expect(result.errors.map((issue) => issue.stage)).toContain('build')
    expect(Object.keys(result.elements).sort()).toEqual(['R_0', 'V_C', 'V_in', 'q_1', 't'])
    expect(result.elements['t']!.variables).toEqual([])
    expect(result.elements['q_1']).toMatchObject({ primary: 'q_1' })
  })

  it('is empty when the source could not be read', async () => {
    const result = await converter.convert('this is not Turtle', { rdfSource: true })
    expect(result.elements).toEqual({})
  })

  /** A line per element: its kind, primary variable, and variables with roles and units. */
  const summary = (elements: ElementManifest): string[] =>
    Object.entries(elements).map(
      ([id, e]) => `${id} ${e.kind} ${e.primary ?? '-'}: ${e.variables.map((v) => `${v.name} ${v.role} ${v.ucum}`).join(', ')}`,
    )

  for (const c of manifest.cases.filter((c) => c.kind === 'example')) {
    it(`matches the snapshot for ${c.name}`, async () => {
      expect(summary(await elementsOf(c))).toMatchSnapshot()
    })
  }
})

describe('toViewerAnnotations()', () => {
  it("gives @celldl/viewer's annotations shape, with a tooltip line per variable", async () => {
    const annotations = toViewerAnnotations(await elementsOf(caseNamed('example_RC')))
    expect(Object.keys(annotations).sort()).toEqual(['I_R', 'R_0', 'V_C', 'V_in', 'q_1'])
    expect(annotations['I_R']).toEqual({ label: 'I_R', primary: 'I_R', variables: ['I_R'], tooltip: 'I_R (flow, C/s)' })
    expect(annotations['q_1']).toMatchObject({ primary: 'q_1', variables: ['v_q_1', 'u_q_1', 'C_q_1', 'q_1'] })
    expect(annotations['q_1']!.tooltip.split('\n')).toHaveLength(4)
  })

  it('takes a tooltip function', async () => {
    const annotations = toViewerAnnotations(await elementsOf(caseNamed('example_RC')), { tooltip: (e) => e.primary ?? '' })
    expect(annotations['R_0']!.tooltip).toBe('v_R_0')
  })
})
