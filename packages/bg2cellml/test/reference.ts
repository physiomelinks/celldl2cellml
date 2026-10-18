/**
 * Access to the reference results made by tools/reference/generate.py from the
 * Python bg2cellml. See test/reference/README.md.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const BG_RDF = `${REPO_ROOT}bg-rdf/`
const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url))

/**
 * A value in a reference file. JSON has no infinities or NaN, so they're stored
 * as these strings. A chemical potential RT*ln(K*q) is -Infinity when q is 0.
 */
export type ReferenceValue = number | 'Infinity' | '-Infinity' | 'NaN'

export type Trajectories = Record<string, ReferenceValue[]>

export function decodeValue(value: ReferenceValue | null | undefined): number {
  return typeof value === 'number' ? value : value == null ? Number.NaN : Number(value)
}

export interface SimulationResult {
  simulation: { start: number; end: number; steps: number; recordedEvery: number }
  voi: { name: string; units: string; values: number[] }
  states: Trajectories
  rates: Trajectories
  algebraics: Trajectories
}

export interface ReferenceCase {
  name: string
  kind: 'example' | 'variant'
  /** Relative to the repository root. */
  source: string
  sourceSha256: string
  /** The base IRI the Python version used. Use the same one so model and variable names match. */
  baseIri: string
  /** File in test/reference/ to compare against. A variant uses its example's. */
  reference: string
  pythonCellml?: string
  pmrCheck?: { model: string; agrees: boolean; problems: string[] }
  /** What the Python bg2cellml did with a variant. */
  python?: { status: 'matches' | 'differs' | 'error'; problems?: string[]; error?: string }
  /** File in test/reference/ with the model as Python builds it. Absent where Python can't build the model. */
  intermediate?: string
  /**
   * File in test/reference/ with the model as Python builds it with its bug 3
   * (bond labels and counts swapped) fixed, where that differs: models with
   * bond counts or labels.
   */
  intermediateBug3Fixed?: string
}

export interface Manifest {
  generator: { bg2cellml: string; bgToolsCommit: string; libopencor: string }
  bgRdf: { tag: string; commit: string; files: Record<string, string> }
  tolerance: { relative: number; absolute: number }
  framework: { reference: string }
  cases: ReferenceCase[]
}

//==============================================================================
// The framework as the Python bg2cellml loads it (framework.json)

/** Python's units: pint's name, and the same units as `scale` × `base`, with `base` in SI base units written in UCUM. */
export interface PythonUnits {
  pint: string
  scale: number
  base: string
}

export interface PythonVariable {
  name: string
  symbol: string
  type: string | null
  units: PythonUnits | null
  value: { magnitude: number; units: PythonUnits | null } | null
}

/** Python passes labels where symbols belong, so `symbol` is often a label. */
export interface PythonLabelled {
  iri: string
  symbol: string
  label: string | null
}

export interface PythonDomain extends PythonLabelled {
  name: string
  flow: PythonVariable
  potential: PythonVariable
  quantity: PythonVariable
  constants: PythonVariable[]
  intrinsicSymbols: string[]
}

export interface PythonPort {
  iri: string
  direction: string | null
  bondCount: number
  flow: { name: string; variable: PythonVariable }
  potential: { name: string; variable: PythonVariable }
}

export interface PythonElementTemplate extends PythonLabelled {
  elementClass: string
  domain: string
  /** By port id; a template with no ports has one, with id `''`. */
  ports: Record<string, PythonPort>
  parameters: Record<string, PythonVariable>
  variables: Record<string, PythonVariable>
  intrinsicVariable: PythonVariable | null
  /** `variables` are in order of first appearance; each equation as sympy prints it, and as sympy's Content MathML. */
  constitutiveRelation: { variables: string[]; equations: { text: string; mathml: string }[] } | null
}

export interface PythonFramework {
  issues: string[]
  domains: Record<string, PythonDomain>
  elementTemplates: Record<string, PythonElementTemplate>
  junctions: Record<string, PythonLabelled>
  compositeTemplates: Record<string, PythonLabelled & { template: string }>
  /** The template `element_template(class, domain)` gives. */
  elementDomains: { elementClass: string; domain: string; template: string }[]
  /** What Python's `element_template()` and `junction()` give, as IRIs; `null` for nothing. */
  lookups: {
    /** `element_template(iri, None)` for every element template and composite. */
    byType: Record<string, string | null>
    /** `element_template(class, domain)` for every element class and domain. */
    byClassAndDomain: { elementClass: string; domain: string; template: string | null }[]
    /** Each `bgf:` type of each element and junction in the 14 examples. */
    examples: (
      | { example: string; element: string; type: string; domain: string | null; template: string | null }
      | { example: string; junction: string; type: string; known: boolean }
    )[]
  }
}

//==============================================================================
// Models as the Python bg2cellml builds them (models/<case>.json)

/** An RDF term, as a model gave it. */
export type PythonTerm = { iri: string } | { literal: string; datatype: string | null }

/** An equation as sympy prints it, and as sympy's Content MathML. */
export interface PythonEquation {
  text: string
  mathml: string
}

/** An element as `BondgraphElement.__init__` leaves it, before the bond network is built. */
export interface PythonModelElement {
  iri: string
  symbol: string
  label: string | null
  /** The element template; for a composite, the template it wraps. */
  template: string
  elementClass: string
  domain: string
  /** `bgf:OneNode` or `bgf:ZeroNode` for sources and composites. */
  impliedJunction: string | null
  /** By the port's IRI in the model: the element's IRI, with `_` and the port id if the template names its ports. */
  ports: Record<string, PythonPort>
  /** By name as the template declares it. */
  variables: Record<string, PythonVariable>
  portVariableNames: string[]
  /** Parameter and variable values as read, by name. Python assigns them once the network is built. */
  values: Record<string, { value: PythonTerm; symbol: string | null }>
  intrinsicVariable: PythonVariable | null
  /** Symbols of the domain's flow and potential among the element's variables. */
  flow: string | null
  potential: string | null
  constitutiveRelation: PythonEquation[] | null
}

export interface PythonModelJunction {
  iri: string
  type: string
  symbol: string
  label: string | null
  value: PythonTerm | null
}

/** Python swaps a bond's label and count, so `label` holds any `bgf:bondCount` and `bondCount` is always 1. */
export interface PythonBond {
  iri: string
  source: string
  target: string
  label: string | number | null
  bondCount: number
}

export interface PythonNetworkNode {
  type: string
  label: string
  portType: string | null
  element: string | null
  junction: string | null
  domain: string | null
  powerPort: { flow: string; potential: string } | null
}

export interface PythonModel {
  case: string
  sourceSha256: string
  model: { iri: string; label: string | null }
  issues: string[]
  /** As loaded, in Python's order (elements by IRI). */
  elements: PythonModelElement[]
  junctions: PythonModelJunction[]
  bonds: PythonBond[]
  network: { nodes: Record<string, PythonNetworkNode>; edges: { source: string; target: string; bondCount: number }[] }
  /** Every element's and junction's variables once assigned, by IRI then name. */
  variables: { elements: Record<string, Record<string, PythonVariable>>; junctions: Record<string, Record<string, PythonVariable>> }
  /** `cr`: a constitutive relation, `be`: a bond element's, `js`: a junction's. */
  equations: (PythonEquation & { provenance: 'cr' | 'be' | 'js' })[]
}

export function loadPythonModel(c: ReferenceCase): PythonModel {
  if (c.intermediate === undefined) throw new Error(`Python can't build ${c.name}, so it has no intermediate fixture`)
  return JSON.parse(readFileSync(`${REFERENCE_DIR}${c.intermediate}`, 'utf8')) as PythonModel
}

/**
 * The model as Python builds it with bug 3 fixed: the bug-3-fixed fixture
 * where there is one, otherwise the usual one, which it would be the same as.
 * This is what this version should match.
 */
export function loadFixedPythonModel(c: ReferenceCase): PythonModel {
  if (c.intermediateBug3Fixed === undefined) return loadPythonModel(c)
  return JSON.parse(readFileSync(`${REFERENCE_DIR}${c.intermediateBug3Fixed}`, 'utf8')) as PythonModel
}

export function loadPythonFramework(manifest: Manifest = loadManifest()): PythonFramework {
  return JSON.parse(readFileSync(`${REFERENCE_DIR}${manifest.framework.reference}`, 'utf8')) as PythonFramework
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

export function requireBgRdf(): void {
  if (!existsSync(`${BG_RDF}schema/ontology.ttl`)) {
    throw new Error('The bg-rdf submodule is missing. Run `git submodule update --init`.')
  }
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(`${REFERENCE_DIR}manifest.json`, 'utf8')) as Manifest
}

export function loadReference(c: ReferenceCase): SimulationResult {
  return JSON.parse(readFileSync(`${REFERENCE_DIR}${c.reference}`, 'utf8')) as SimulationResult
}

export function readSource(c: ReferenceCase): string {
  return readFileSync(`${REPO_ROOT}${c.source}`, 'utf8')
}

/** The BG-RDF ontology and templates, as `Converter.loadFramework()` takes them. */
export function frameworkSource(manifest: Manifest = loadManifest()): { ontology: string; templates: Record<string, string> } {
  requireBgRdf()
  const templates: Record<string, string> = {}
  for (const file of Object.keys(manifest.bgRdf.files)) {
    if (file.startsWith('templates/')) templates[file.slice('templates/'.length)] = readFileSync(`${BG_RDF}${file}`, 'utf8')
  }
  return { ontology: readFileSync(`${BG_RDF}schema/ontology.ttl`, 'utf8'), templates }
}

/**
 * Differences between a simulation of generated CellML and a reference,
 * comparing variables by name. An empty list means they agree.
 */
export function compareResults(
  actual: Pick<SimulationResult, 'states' | 'rates' | 'algebraics'>,
  expected: SimulationResult,
  tolerance: Manifest['tolerance'],
  groups: readonly ('states' | 'rates' | 'algebraics')[] = ['states', 'rates', 'algebraics'],
): string[] {
  // Infinities must match exactly, and NaN only matches NaN
  const close = (actualValue: ReferenceValue | undefined, expectedValue: ReferenceValue): boolean => {
    if (actualValue === undefined) return false
    const a = decodeValue(actualValue)
    const e = decodeValue(expectedValue)
    if (!Number.isFinite(a) || !Number.isFinite(e)) return Object.is(a, e) || (Number.isNaN(a) && Number.isNaN(e))
    return Math.abs(a - e) <= tolerance.absolute + tolerance.relative * Math.abs(e)
  }
  const problems: string[] = []
  for (const group of groups) {
    for (const [name, values] of Object.entries(expected[group])) {
      const got = actual[group][name]
      if (got === undefined) {
        problems.push(`${group}.${name} is missing`)
        continue
      }
      const bad = values.flatMap((e, i) => (close(got[i], e) ? [] : [i]))
      if (bad.length > 0) {
        const i = bad[0]!
        problems.push(
          `${group}.${name} differs at ${bad.length} points, first at ${expected.voi.name}=${expected.voi.values[i]}: ${got[i]} != ${values[i]}`,
        )
      }
    }
  }
  return problems
}
