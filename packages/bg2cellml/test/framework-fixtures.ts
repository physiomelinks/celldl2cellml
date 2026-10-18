/**
 * Helpers for the framework tests: loading the BG-RDF framework, small
 * hand-written domains and templates, and comparing units with Python's.
 */

import { compatible, convertValue, type LibCellML } from '@physiomelinks/cellml-units'
import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { expect } from 'vitest'

import { BondgraphFramework, RdfGraph, type FrameworkRuntime } from '../src/index.js'
import { BGF_ONTOLOGY_IRI, BGF_TEMPLATE_IRI_PREFIX } from '../src/rdf/namespaces.js'
import { frameworkSource, type PythonUnits } from './reference.js'

let runtime: FrameworkRuntime | undefined

/** libCellML and an XML parser, loaded once. */
export async function frameworkRuntime(): Promise<FrameworkRuntime> {
  runtime ??= {
    libcellml: (await createLibCellML()) as unknown as LibCellML,
    domParser: new DOMParser() as unknown as NonNullable<FrameworkRuntime['domParser']>,
  }
  return runtime
}

/** Our UCUM code is the units Python has: `scale` × its SI base units. */
export function expectSameUnits(code: string, python: PythonUnits | null): void {
  const { libcellml } = runtime!
  expect(python, code).not.toBeNull()
  expect(compatible(libcellml, code, python!.base), `${code} is ${python!.pint}`).toBe(true)
  expect(convertValue(libcellml, 1, code, python!.base), `${code} is ${python!.pint}`).toBe(python!.scale)
}

/** The framework from the BG-RDF ontology and templates in the bg-rdf submodule. */
export function bgRdfFramework(): BondgraphFramework {
  const { ontology, templates } = frameworkSource()
  const graph = new RdfGraph(oxigraph)
  graph.load(ontology, BGF_ONTOLOGY_IRI)
  for (const [name, turtle] of Object.entries(templates)) graph.load(turtle, `${BGF_TEMPLATE_IRI_PREFIX}${name}`)
  return BondgraphFramework.fromGraph(graph, runtime!)
}

export const TEST_IRI = 'https://example.org/test#'

const PREFIXES = `
@prefix bgf: <https://bg-rdf.org/ontologies/bondgraph-framework#> .
@prefix cdt: <https://w3id.org/cdt/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix : <${TEST_IRI}> .
`

/** A domain declaration, with any of its parts replaced. Its flow, potential and quantity are `v`, `u` and `q`. */
export function domainTurtle(
  name: string,
  parts: { flow?: string; potential?: string; quantity?: string; extra?: string } = {},
): string {
  const flow = parts.flow ?? `bgf:hasFlow [ bgf:varName "v" ; bgf:hasUnits "m/s"^^cdt:ucumunit ]`
  const potential = parts.potential ?? `bgf:hasPotential [ bgf:varName "u" ; bgf:hasUnits "J/m"^^cdt:ucumunit ]`
  const quantity = parts.quantity ?? `bgf:hasQuantity [ bgf:varName "q" ; bgf:hasUnits "m"^^cdt:ucumunit ]`
  return `:${name} a bgf:PhysicalDomain ; ${[flow, potential, quantity, parts.extra].filter(Boolean).join(' ; ')} .\n`
}

/** MathML equations as a `bgf:mathml` literal. */
export function mathml(...equations: string[]): string {
  return `"""<math xmlns="http://www.w3.org/1998/Math/MathML">${equations.join('')}</math>"""^^bgf:mathml`
}

/** The framework from hand-written Turtle, with the BG-RDF ontology so element classes are known. */
export function frameworkFrom(...turtle: string[]): BondgraphFramework {
  const graph = new RdfGraph(oxigraph)
  graph.load(frameworkSource().ontology, BGF_ONTOLOGY_IRI)
  graph.load(PREFIXES + turtle.join('\n'), 'https://example.org/test')
  return BondgraphFramework.fromGraph(graph, runtime!)
}

export const messages = (framework: BondgraphFramework): string[] => framework.log.issues.map((issue) => issue.message)
