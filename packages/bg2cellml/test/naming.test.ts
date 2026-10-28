/**
 * A model's own names for its variables: BG-RDF's `bgf:NamingRule` and
 * `bgf:VariableName` (physiomelinks/BG-RDF), which `convert()` applies and
 * `celldl2cellml()`, as Python 0.11.2, ignores.
 */

import { readFileSync } from 'node:fs'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import type { LibCellML } from '@physiomelinks/cellml-units'

import { Converter, toViewerAnnotations, type ConversionResult, type Runtime } from '../src/index.js'
import { renderPattern, ruleFor, validName, type NamingRule } from '../src/model/naming.js'
import { bgf } from '../src/rdf/namespaces.js'
import { REPO_ROOT, frameworkSource } from './reference.js'

let converter: Converter

beforeAll(async () => {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  const runtime: Runtime = { libcellml, oxigraph, domParser: new DOMParser() as never }
  converter = new Converter(runtime)
  expect(converter.loadFramework(frameworkSource())).toEqual([])
})

/** S1 -> Rx R1 -> S2: stores `q_S1_c` and `q_S2_c` with zero nodes, and the reaction `Rx_R1_c`. */
const ONE_REACTION = readFileSync(`${REPO_ROOT}packages/bg2cellml/test/models/flows/one_reaction.ttl`, 'utf8')
const SOURCE_URI = 'https://example.org/models/named.ttl'

/** The model with these statements about it, and any others. */
const named = (model: string, others = ''): string => `${ONE_REACTION}\n:model ${model} .\n${others}\n`
const rule = (parts: string): string => `bgf:hasNamingRule [ ${parts} ]`

const run = (turtle: string): Promise<ConversionResult> => converter.convert(turtle, { sourceUri: SOURCE_URI, rdfSource: true })

/** Each element's CellML variable names, by element id. */
const names = (result: ConversionResult): Record<string, string[]> =>
  Object.fromEntries(Object.entries(result.elements).map(([id, element]) => [id, element.variables.map((variable) => variable.name)]))

describe('naming helpers', () => {
  it('makes names CellML can hold', () => {
    expect(validName('n_Na^+_c', 'q')).toBe('n_Na_c')
    expect(validName('__a__b__', 'q')).toBe('a_b')
    expect(validName('2nd', 'q')).toBe('q_2nd')
    expect(validName('^+', 'u')).toBe('u')
  })

  it('fills every placeholder, leaving out unknown ones', () => {
    const values = { var: 'q', element: 'q_G6P_c', label: 'q', species: 'G6P', location: 'c', name: 'G6P' }
    expect(renderPattern('{var}|{element}|{label}|{species}|{location}|{name}', values)).toBe('q_q_G6P_c_q_G6P_c_G6P')
    expect(renderPattern('n_{species}_{nope}_{location}', values)).toBe('n_G6P_c')
  })

  it('takes the most specific rule: class and domain, class, domain, then neither', () => {
    const [QS, CHEM] = [bgf('QuantityStore'), bgf('Chemical')]
    const rules: NamingRule[] = [
      { variable: 'q', pattern: 'any' },
      { variable: 'q', domain: CHEM, pattern: 'domain' },
      { variable: 'q', elementClass: QS, pattern: 'class' },
      { variable: 'q', elementClass: QS, domain: CHEM, pattern: 'both' },
    ]
    expect(ruleFor(rules, QS, CHEM, 'q')?.pattern).toBe('both')
    expect(ruleFor(rules.slice(0, 3), QS, CHEM, 'q')?.pattern).toBe('class')
    expect(ruleFor(rules.slice(0, 2), QS, CHEM, 'q')?.pattern).toBe('domain')
    expect(ruleFor(rules.slice(0, 1), QS, CHEM, 'q')?.pattern).toBe('any')
    expect(ruleFor(rules, bgf('Reaction'), CHEM, 'q')?.pattern).toBe('domain')
    expect(ruleFor(rules, QS, bgf('Electrical'), 'q')?.pattern).toBe('class')
    expect(ruleFor(rules, QS, CHEM, 'u')).toBeUndefined()
  })
})

describe('convert() with naming rules', () => {
  it("gives a model without naming the bond graph's names", async () => {
    const result = await run(ONE_REACTION)
    expect(names(result)['S1']).toEqual(['v_q_S1_c', 'u_q_S1_c', 'K_q_S1_c', 'q_S1_c'])
    expect(result.elements['S1']!.variables.every((variable) => variable.bondgraph === undefined)).toBe(true)
  })

  it('names variables by the most specific rule, and an explicit name over any rule', async () => {
    const result = await run(
      named(
        [
          rule('bgf:forVariable "q" ; bgf:namePattern "amount_{name}"'),
          rule('bgf:forVariable "q" ; bgf:forDomain bgf:Chemical ; bgf:namePattern "chem_{name}"'),
          rule('bgf:forVariable "q" ; bgf:forElementClass bgf:QuantityStore ; bgf:namePattern "store_{name}"'),
          rule('bgf:forVariable "q" ; bgf:forElementClass bgf:QuantityStore ; bgf:forDomain bgf:Chemical ; bgf:namePattern "n_{species}_{location}"'),
          rule('bgf:forVariable "u" ; bgf:forElementClass bgf:QuantityStore ; bgf:namePattern "mu_{species}_{location}"'),
          rule('bgf:forVariable "v" ; bgf:forElementClass bgf:Reaction ; bgf:namePattern "v_{name}"'),
          rule('bgf:forVariable "kappa" ; bgf:forDomain bgf:Electrical ; bgf:namePattern "nope_{name}"'),
        ].join(' ;\n    '),
        ':S2 bgf:hasVariableName [ bgf:forVariable "q" ; bgf:cellmlName "product" ] .',
      ),
    )
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
    expect(names(result)['S1']).toEqual(['v_q_S1_c', 'mu_S1_c', 'K_q_S1_c', 'n_S1_c'])
    expect(names(result)['S2']).toEqual(['v_q_S2_c', 'mu_S2_c', 'K_q_S2_c', 'product'])
    expect(names(result)['R1']).toEqual(['v_R1', 'u_f_Rx_R1_c', 'u_r_Rx_R1_c', 'kappa_Rx_R1_c'])
    // The equations use the new names, and the old ones are gone
    expect(result.cellml).toContain('<ci>n_S1_c</ci>')
    expect(result.cellml).not.toMatch(/"q_S1_c"|<ci>q_S1_c<\/ci>|<ci>v_Rx_R1_c<\/ci>/)
    expect(result.cellml).toContain('<variable name="v_R1"')
  })

  it("fills a pattern's placeholders from the element", async () => {
    const result = await run(
      named(
        [
          rule('bgf:forVariable "q" ; bgf:namePattern "{label}-{species}-{location}-{var}"'),
          rule('bgf:forVariable "K" ; bgf:namePattern "{element}_{var}"'),
          rule('bgf:forVariable "kappa" ; bgf:namePattern "k_{name}"'),
        ].join(' ;\n    '),
      ),
    )
    expect(result.issues).toEqual([])
    expect(names(result)['S1']).toEqual(['v_q_S1_c', 'u_q_S1_c', 'q_S1_c_K', 'q_S1_c_q'])
    // {name} is the species, here R1, else the element's identifier
    expect(names(result)['R1']).toContain('k_R1')
  })

  it("uses the element's identifier for {name} when it has no species", async () => {
    const turtle = named(rule('bgf:forVariable "kappa" ; bgf:namePattern "k_{name}"')).replace('bgf:hasSymbol "Rx" ; bgf:hasSpecies "R1" ;', 'bgf:hasSymbol "Rx" ;')
    const result = await run(turtle)
    expect(names(result)['R1']).toContain('k_R1')
  })

  it('reports a clash, numbering the later name, with the elementId', async () => {
    const result = await run(named(rule('bgf:forVariable "q" ; bgf:namePattern "n_{location}"')))
    expect(result.ok).toBe(true)
    expect(names(result)['S1']).toContain('n_c')
    expect(names(result)['S2']).toContain('n_c_2')
    expect(result.warnings).toMatchObject([{ elementId: 'S2', stage: 'model', message: expect.stringMatching(/named n_c_2, not n_c .* taken by variable q of q_S1_c/) }])
  })

  it("numbers a renamed variable rather than one no rule names, and keeps time and the constants", async () => {
    const result = await run(
      named(
        [rule('bgf:forVariable "q" ; bgf:forElementClass bgf:QuantityStore ; bgf:namePattern "u_q_S2_c"'), rule('bgf:forVariable "K" ; bgf:namePattern "RT"')].join(
          ' ;\n    ',
        ),
      ),
    )
    expect(result.ok).toBe(true)
    // S2's potential keeps its name
    expect(names(result)['S2']).toContain('u_q_S2_c')
    expect(names(result)['S1']).toEqual(['v_q_S1_c', 'u_q_S1_c', 'RT_2', 'u_q_S2_c_2'])
    expect(result.warnings.map((issue) => issue.elementId)).toEqual(['S1', 'S1', 'S2', 'S2'])
  })

  it("reports an explicit name CellML can't hold, and one for a variable the element doesn't have", async () => {
    const result = await run(
      named('bgf:hasNamingRule []', ':S1 bgf:hasVariableName [ bgf:forVariable "q" ; bgf:cellmlName "1 S1 (cyto)" ], [ bgf:forVariable "x" ; bgf:cellmlName "x_S1" ] .'),
    )
    expect(result.ok).toBe(true)
    expect(names(result)['S1']).toContain('q_1_S1_cyto')
    expect(result.warnings).toMatchObject([
      { elementId: 'S1', message: expect.stringMatching(/has no variable x/) },
      { elementId: 'S1', message: expect.stringMatching(/names q "1 S1 \(cyto\)", which isn't a CellML name: it is named q_1_S1_cyto/) },
    ])
  })

  it('gives the final names in the manifest, with their bond graph names, and in the viewer annotations', async () => {
    const result = await run(
      named(
        [rule('bgf:forVariable "q" ; bgf:namePattern "n_{species}"'), rule('bgf:forVariable "v" ; bgf:forElementClass bgf:Reaction ; bgf:namePattern "J_{species}"')].join(
          ' ;\n    ',
        ),
      ),
    )
    const store = result.elements['S1']!
    expect(store.primary).toBe('n_S1')
    expect(store.variables.find((variable) => variable.name === 'n_S1')).toMatchObject({ role: 'quantity', bondgraph: 'q_S1_c' })
    expect(store.variables.find((variable) => variable.name === 'u_q_S1_c')!.bondgraph).toBeUndefined()
    expect(result.elements['R1']!.variables.find((variable) => variable.name === 'J_R1')).toMatchObject({ role: 'flow', bondgraph: 'v_Rx_R1_c' })
    const annotations = toViewerAnnotations(result.elements)
    expect(annotations['S1']!.primary).toBe('n_S1')
    expect(annotations['R1']!.variables).toContain('J_R1')
    expect(annotations['R1']!.tooltip).toContain('J_R1 (flow, mol/s)')
  })

  it('can be turned off', async () => {
    const turtle = named(rule('bgf:forVariable "q" ; bgf:namePattern "n_{species}"'))
    const result = await converter.convert(turtle, { sourceUri: SOURCE_URI, rdfSource: true, naming: false })
    expect(names(result)['S1']).toContain('q_S1_c')
  })

  it("doesn't change celldl2cellml(), which keeps Python's names", async () => {
    const plain = await converter.celldl2cellml(ONE_REACTION, { sourceUri: SOURCE_URI, rdfSource: true })
    const withRules = await converter.celldl2cellml(
      named(rule('bgf:forVariable "q" ; bgf:namePattern "n_{species}"'), ':S2 bgf:hasVariableName [ bgf:forVariable "q" ; bgf:cellmlName "product" ] .'),
      { sourceUri: SOURCE_URI, rdfSource: true },
    )
    expect(plain.cellml).toBeDefined()
    expect(withRules.cellml).toBe(plain.cellml)
  })
})
