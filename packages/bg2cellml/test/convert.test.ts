/**
 * `Converter.convert()`: CellML with its warnings, structured issues, the
 * component's name, and element ids that don't depend on the source's IRI.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import {
  BondgraphModel,
  Converter,
  DEFAULT_SOURCE_URI,
  GENERATOR,
  cellmlUriFor,
  elementIdOf,
  generateCellML,
  type ConvertOptions,
  type Runtime,
} from '../src/index.js'
import { SIN_UNITS_MESSAGE } from './known-issues.js'
import { frameworkSource, loadManifest, readSource, type ReferenceCase } from './reference.js'

const manifest = loadManifest()
const caseNamed = (name: string): ReferenceCase => manifest.cases.find((c) => c.name === name)!
const celldl = readFileSync(new URL('./models/rdf_error.celldl', import.meta.url), 'utf8')
/** rdf_error.celldl with its capacitor's class one the framework has no template for. */
const brokenCelldl = celldl.replace('bgf:MechanicalCapacitor', 'bgf:NoSuchCapacitor')
/** brokenCelldl saved with absolute IRIs. */
const SAVED_AS = 'https://example.org/models/saved.celldl'
const absoluteCelldl = brokenCelldl.replace('@prefix : <#> .', `@prefix : <${SAVED_AS}#> .`).replace('<> a celldl:Document', `<${SAVED_AS}> a celldl:Document`)

let runtime: Runtime
let converter: Converter

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource(manifest))).toEqual([])
})

describe('convert()', () => {
  const rc = caseNamed('example_RC')

  it('converts example_RC, with the generator and framework versions', async () => {
    const result = await converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true })
    expect(result).toMatchObject({
      ok: true,
      runnable: true,
      modelType: 'ode',
      componentName: 'main',
      baseUri: rc.baseIri,
      modelIri: `${rc.baseIri}#RC_circuit`,
      issues: [],
      errors: [],
      warnings: [],
      generator: GENERATOR,
      framework: { version: '2026-04-12' },
    })
    expect(result.cellml).toContain('<component name="main" id="main">')
    expect(result.exception).toBeUndefined()
  })

  it('gives generateCellML\'s CellML with public interfaces, and celldl2cellml\'s otherwise', async () => {
    const source = readSource(rc)
    const model = BondgraphModel.fromTurtle(converter.framework!, runtime, source, rc.baseIri)
    const generated = generateCellML(runtime.libcellml, model, { metadata: true, cellmlUri: cellmlUriFor(rc.baseIri), publicInterfaces: true })
    const result = await converter.convert(source, { sourceUri: rc.baseIri, rdfSource: true, metadata: true })
    const output = await converter.celldl2cellml(source, { sourceUri: rc.baseIri, rdfSource: true, metadata: true })
    expect(result.cellml).toBe(generated.cellml)
    expect(result.cellml!.replaceAll(' interface="public"', '')).toBe(output.cellml)
    expect(result.metadata).toBe(output.metadata)
  })

  it('declares every variable public', async () => {
    const result = await converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true })
    const variables = [...result.cellml!.matchAll(/<variable [^>]*>/g)].map(([tag]) => tag)
    expect(variables.length).toBeGreaterThan(0)
    for (const tag of variables) expect(tag).toContain('interface="public"')
  })

  it('leaves celldl2cellml() without interfaces, as BG-Tools', async () => {
    const output = await converter.celldl2cellml(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true })
    expect(output.cellml).toContain('<variable ')
    expect(output.cellml).not.toContain('interface=')
  })

  it('gives components that can be joined by equivalences as they are', async () => {
    const source = readSource(rc)
    const converted = async (componentName: string): Promise<string> =>
      (await converter.convert(source, { sourceUri: rc.baseIri, rdfSource: true, componentName })).cellml!
    const bgTools = async (componentName: string): Promise<string> =>
      (await converter.celldl2cellml(source, { sourceUri: rc.baseIri, rdfSource: true })).cellml!.replaceAll('"main', `"${componentName}`)
    const joined = await join(await converted('a'), await converted('b'))
    expect(joined.issues).toEqual([])
    expect(joined.type).toBe('ode')
    // Without interfaces, as celldl2cellml() gives, the same join is invalid.
    const unjoinable = await join(await bgTools('a'), await bgTools('b'))
    expect(unjoinable.issues.some((issue) => /interface/.test(issue))).toBe(true)
  })

  it('names the component and its variable ids', async () => {
    const result = await converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true, componentName: 'rc', metadata: true })
    expect(result.ok).toBe(true)
    expect(result.componentName).toBe('rc')
    expect(result.cellml).toContain('<component name="rc" id="rc">')
    expect(result.cellml).toContain('id="rc-q_1"')
    expect(result.cellml).not.toMatch(/"main/)
    expect(result.metadata).toContain('model:rc-q_1')
  })

  it('reports a componentName that is not a CellML identifier', async () => {
    for (const componentName of ['', '1rc', 'r c', 'rc-1', '__']) {
      const result = await converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true, componentName })
      expect(result.ok).toBe(false)
      expect(result.cellml).toBeUndefined()
      expect(result.errors).toEqual([expect.objectContaining({ stage: 'input', message: expect.stringMatching(/^componentName isn't a CellML identifier/) })])
    }
    expect((await converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true, componentName: '_rc2' })).ok).toBe(true)
  })

  it('returns the CellML with the Analyser warning for example_A3', async () => {
    const a3 = caseNamed('example_A3')
    const result = await converter.convert(readSource(a3), { sourceUri: a3.baseIri, rdfSource: true })
    expect(result.cellml).toContain('<model ')
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatchObject({ severity: 'warning', stage: 'analyser', message: expect.stringMatching(SIN_UNITS_MESSAGE) })
  })

  it("converts a CellDL document under the default sourceUri", async () => {
    const result = await converter.convert(celldl)
    expect(result).toMatchObject({ ok: true, baseUri: DEFAULT_SOURCE_URI, modelIri: DEFAULT_SOURCE_URI, issues: [] })
  })

  it("reports a model error with the diagram element's id, and no exception", async () => {
    const result = await converter.convert(brokenCelldl, { sourceUri: 'file:///C:/Users/Some%20One/rdf_error.celldl' })
    expect(result.exception).toBeUndefined()
    expect(result.ok).toBe(false)
    expect(result.cellml).toBeUndefined()
    expect(result.errors[0]).toMatchObject({ severity: 'error', stage: 'model', elementId: 'ID-00000032' })
  })

  it('reports Turtle that does not parse as an input error, with no CellML or exception', async () => {
    const result = await converter.convert('this is not Turtle', { rdfSource: true })
    expect(result).toMatchObject({ ok: false, runnable: false, errors: [{ severity: 'error', stage: 'input' }] })
    expect(result.cellml).toBeUndefined()
    expect(result.modelIri).toBeUndefined()
    expect(result.exception).toBeUndefined()
  })

  it('reports a sourceUri or cellmlUri that is not an absolute IRI as an input error', async () => {
    const bad = await converter.convert(celldl, { sourceUri: 'C:\\Users\\Some One\\rdf_error.celldl' })
    expect(bad.errors).toEqual([expect.objectContaining({ stage: 'input', message: expect.stringMatching(/^sourceUri isn't an absolute IRI: /) })])
    expect(bad).toMatchObject({ ok: false, baseUri: 'C:\\Users\\Some One\\rdf_error.celldl' })
    expect(bad.exception).toBeUndefined()
    const cellmlUri = await converter.convert(celldl, { cellmlUri: 'rdf_error.cellml' })
    expect(cellmlUri.errors).toEqual([expect.objectContaining({ stage: 'input', message: expect.stringMatching(/^cellmlUri isn't an absolute IRI: /) })])
  })

  it('reports a framework that has not been loaded', async () => {
    const result = await new Converter(runtime).convert(celldl)
    expect(result).toMatchObject({ ok: false, framework: {}, errors: [{ stage: 'framework' }] })
  })
})

describe('knownUnits', () => {
  const rc = caseNamed('example_RC')
  /** A CellML document defining `units`, as a host's other module would. */
  const knownCellML = (units: string): string =>
    `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://www.cellml.org/cellml/2.0#" name="host">${units}</model>`
  const convertRC = (options: ConvertOptions = {}) => converter.convert(readSource(rc), { sourceUri: rc.baseIri, rdfSource: true, ...options })

  it('changes nothing when not given, or when the known units agree', async () => {
    const plain = await convertRC()
    expect(plain.units).toEqual({ renamed: {} })
    for (const knownUnits of [[], knownCellML('<units name="C_per_s"><unit units="ampere"/></units>')]) {
      const result = await convertRC({ knownUnits })
      expect(result.cellml).toBe(plain.cellml)
      expect(result).toMatchObject({ ok: true, units: { renamed: {} }, issues: [] })
    }
  })

  it('numbers units a known name gives other units, and the variables use them', async () => {
    const result = await convertRC({ knownUnits: knownCellML('<units name="J_per_C"><unit prefix="milli" units="volt"/></units>') })
    expect(result).toMatchObject({ ok: true, units: { renamed: { J_per_C: 'J_per_C_1' } }, errors: [], warnings: [] })
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'info', stage: 'units', message: expect.stringMatching(/J_per_C are named J_per_C_1/) })])
    expect(result.cellml).toContain('<units name="J_per_C_1">')
    expect(result.cellml).not.toMatch(/"J_per_C"/)
    expect(result.cellml).toContain('<variable name="V_C" units="J_per_C_1"')
    expect(result.elements['V_C']?.variables).toContainEqual(expect.objectContaining({ units: 'J_per_C_1' }))
  })

  it('warns of known units that are not CellML', async () => {
    const result = await convertRC({ knownUnits: ['not CellML'] })
    expect(result).toMatchObject({ ok: true, units: { renamed: {} } })
    expect(result.warnings).toEqual([expect.objectContaining({ stage: 'units', message: expect.stringMatching(/^knownUnits\[0\] isn't valid CellML/) })])
  })
})

describe('element ids', () => {
  const elementIds = async (source: string, sourceUri?: string): Promise<(string | undefined)[]> => {
    const result = await converter.convert(source, sourceUri === undefined ? {} : { sourceUri })
    expect(result.errors.length).toBeGreaterThan(0)
    return result.errors.map((issue) => issue.elementId)
  }

  it('are the same whatever sourceUri relative IRIs are read under, and for absolute IRIs', async () => {
    const expected = ['ID-00000032', 'ID-00000034']
    expect(await elementIds(brokenCelldl)).toEqual(expected)
    expect(await elementIds(brokenCelldl, 'file:///C:/Users/Some%20One/rdf_error.celldl')).toEqual(expected)
    expect(await elementIds(absoluteCelldl)).toEqual(expected)
    expect(await elementIds(absoluteCelldl, 'file:///elsewhere.celldl')).toEqual(expected)
    expect((await converter.convert(absoluteCelldl)).modelIri).toBe(SAVED_AS)
  })

  it("are the fragments of IRIs in the model's document", () => {
    expect(elementIdOf(`${SAVED_AS}#R_1`, `${SAVED_AS}#model`)).toBe('R_1')
    expect(elementIdOf(`${SAVED_AS}#R_1`, SAVED_AS)).toBe('R_1')
    expect(elementIdOf(SAVED_AS, SAVED_AS)).toBeUndefined()
    expect(elementIdOf(`${SAVED_AS}#`, SAVED_AS)).toBeUndefined()
    expect(elementIdOf('https://example.org/other.celldl#R_1', SAVED_AS)).toBeUndefined()
  })
})

/**
 * The CellDL editor lists each composite element, such as a
 * `bgf:ChemicalStorageNode`, under both `bgf:hasBondElement` and
 * `bgf:hasJunctionStructure`, as its class is a subclass of the junction it
 * acts as. Such a node converts as the element, as in Python.
 */
describe('composite elements the editor also lists as junctions', () => {
  const PREFIXES = `@prefix : <#> .
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix cdt: <https://w3id.org/cdt/> .
@prefix celldl: <http://celldl.org/ontologies/celldl#> .
`
  const editorModel = (nodes: string[], body: string): string => `${PREFIXES}
<> a celldl:Document, bgf:BondgraphModel ;
  bgf:hasBondElement ${nodes.join(', ')} ;
  bgf:hasJunctionStructure ${nodes.join(', ')} .
${body}`
  const connection = (id: string, source: string, target: string): string =>
    `:${id} a celldl:Connection ; celldl:hasSource :${source} ; celldl:hasTarget :${target} ; bgf:hasSource :${source} ; bgf:hasTarget :${target} .\n`
  const storage = (id: string, location: string, amount: string): string => `:${id} a celldl:Component, bgf:ChemicalStorageNode ;
  bgf:hasLocation "${location}" ; bgf:hasSpecies "i" ; bgf:hasSymbol "q" ;
  bgf:hasValue "${amount} mol"^^cdt:ucum ;
  bgf:parameterValue [ bgf:hasValue "1 mol-1"^^cdt:ucum ; bgf:varName "K" ] .
`
  const reaction = editorModel(
    [':ID-00000001', ':ID-00000002', ':ID-00000003'],
    storage('ID-00000001', 'j', '1') +
      storage('ID-00000002', 'k', '0') +
      `:ID-00000003 a celldl:Component, bgf:ChemicalReactionNode ;
  bgf:hasSymbol "Re" ;
  bgf:parameterValue [ bgf:hasValue "0.1 mol/s"^^cdt:ucum ; bgf:varName "kappa" ] .
` +
      connection('ID-00000004', 'ID-00000001', 'ID-00000003') +
      connection('ID-00000005', 'ID-00000003', 'ID-00000002'),
  )
  const rcCircuit = editorModel(
    [':ID-00000001', ':ID-00000002'],
    `:ID-00000001 a celldl:Component, bgf:ElectricalCapacitiveNode ;
  bgf:hasSpecies "e" ; bgf:hasSymbol "q" ;
  bgf:hasValue "1 C"^^cdt:ucum ;
  bgf:parameterValue [ bgf:hasValue "0.001 F"^^cdt:ucum ; bgf:varName "C" ] .
:ID-00000002 a celldl:Component, bgf:ElectricalResistiveNode ;
  bgf:hasSpecies "e" ; bgf:hasSymbol "R" ;
  bgf:parameterValue [ bgf:hasValue "1000 Ohm"^^cdt:ucum ; bgf:varName "R" ] .
` + connection('ID-00000003', 'ID-00000001', 'ID-00000002'),
  )

  it('converts a storage-reaction-storage chain to runnable CellML', async () => {
    const result = await converter.convert(reaction, { rdfSource: true })
    expect(result).toMatchObject({ ok: true, runnable: true, checks: 'full', issues: [] })
    expect(Object.values(result.elements).map((element) => element.kind).sort()).toEqual(['element', 'element', 'element'])
  })

  it('converts an RC circuit of capacitive and resistive nodes to runnable CellML', async () => {
    const result = await converter.convert(rcCircuit, { rdfSource: true })
    expect(result).toMatchObject({ ok: true, runnable: true, checks: 'full', issues: [] })
    expect(Object.values(result.elements).map((element) => element.kind)).toEqual(['element', 'element'])
  })

  it('gives the same CellML for BG-RDF example_B1_reduced with its stores also listed as junctions', async () => {
    const b1 = caseNamed('example_B1_reduced')
    const source = readSource(b1)
    const doubled = source.replace('bgf:hasBondElement :q_1, :q_2, :Re .', 'bgf:hasBondElement :q_1, :q_2, :Re ;\n    bgf:hasJunctionStructure :q_1, :q_2, :Re .')
    expect(doubled).not.toBe(source)
    const [plain, listed] = await Promise.all([source, doubled].map((text) => converter.convert(text, { sourceUri: b1.baseIri, rdfSource: true })))
    expect(listed).toMatchObject({ ok: true, runnable: true, issues: [] })
    expect(listed!.cellml).toBe(plain!.cellml)
  })
})

/**
 * Put two one-component models' components in one model, and join them as a
 * host would: one time, and `b`'s source voltage given by `a`'s capacitor.
 * The Validator's and Analyser's issues, and the model's type.
 */
async function join(first: string, second: string): Promise<{ issues: string[]; type: string }> {
  const lib = runtime.libcellml as any
  const model = new lib.Model()
  model.setName('joined')
  for (const cellml of [first, second]) {
    const parsed = new lib.Parser(false).parseModel(cellml)
    for (let i = 0; i < parsed.unitsCount(); i++) {
      const units = parsed.unitsByIndex(i)
      if (!model.hasUnitsByName(units.name())) model.addUnits(units.clone())
    }
    model.addComponent(parsed.componentByIndex(0).clone())
  }
  const variable = (component: string, name: string): unknown => model.componentByName(component, false).variableByName(name)
  ;(variable('b', 'u_V_in') as { removeInitialValue(): void }).removeInitialValue()
  lib.Variable.addEquivalence(variable('a', 't'), variable('b', 't'))
  lib.Variable.addEquivalence(variable('a', 'u_q_1'), variable('b', 'u_V_in'))
  model.linkUnits()
  const issues: string[] = []
  const validator = new lib.Validator()
  validator.validateModel(model)
  for (let i = 0; i < validator.issueCount(); i++) issues.push(validator.issue(i).description())
  if (issues.length > 0) return { issues, type: 'invalid' }
  const analyser = new lib.Analyser()
  analyser.analyseModel(model)
  for (let i = 0; i < analyser.issueCount(); i++) issues.push(analyser.issue(i).description())
  return { issues, type: lib.AnalyserModel.typeAsString(analyser.analyserModel().type()) }
}
