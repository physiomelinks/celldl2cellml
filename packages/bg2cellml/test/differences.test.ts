/**
 * Plan chunk 7.3: every difference between our CellML and the Python
 * bg2cellml's is one the README explains.
 *
 * Each case's CellML is compared with Python's (test/reference/python), a
 * variant's with its example's, and every difference found is sorted into a
 * kind in DIFFERENCES. Each kind names its entry under "Differences from the
 * Python version" in the README, which must be there, and each must still
 * turn up somewhere, so the list stays true. A difference of no listed kind
 * fails the case.
 *
 * This is about what differs, not whether ours is right: units, values and
 * equations are checked as mathematics by cellml-model.test.ts and
 * cellml-equations.test.ts, and results by parity.test.ts.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { LibCellML } from '@physiomelinks/cellml-units'
import { canonicalise, equals, parseMathML, toEquations, walk, type AstNode, type DOMParserLike, type Equation } from '@physiomelinks/math-ast'
import { DOMParser, type Element } from '@xmldom/xmldom'
import * as oxigraph from 'oxigraph'
import { beforeAll, describe, expect, it } from 'vitest'

import { BondgraphModel, EQUATION_GROUPS, generateCellML, type BondgraphFramework, type ModelRuntime } from '../src/index.js'
import { bgRdfFramework, frameworkRuntime } from './framework-fixtures.js'
import { expectKnownIssues } from './known-issues.js'
import { pythonEquation } from './python-math.js'
import { loadManifest, readSource, type ReferenceCase } from './reference.js'

/** Each kind of difference, and the title of its entry in the README. */
const DIFFERENCES = {
  cellml2: 'CellML 2.0, written by libCellML',
  noHeader: 'No header comment',
  numberText: 'Numbers are printed as libCellML prints them',
  unitsNames: 'Units are named as `@physiomelinks/cellml-units` names them',
  numberUnits: 'Numbers have units, `dimensionless` if not given',
  numbersAsGiven: 'Numbers are written as given',
  constantsOrder: 'Domain constants, and template parameters and variables, are sorted by name',
  equationForm: 'Equations are written in a different form',
  bondCounts: 'Bond counts are used, so `example_B2` differs from Python',
} as const

type Kind = keyof typeof DIFFERENCES

const README = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')
const REFERENCE_DIR = fileURLToPath(new URL('./reference/', import.meta.url))
const CELLML_1_1 = 'http://www.cellml.org/cellml/1.1#'
const CELLML_2_0 = 'http://www.cellml.org/cellml/2.0#'
/** Python's first comment, before the model. */
const PYTHON_HEADER = /^\s*This CellML file was generated\s/
const GROUP_OF_COMMENT = new Map<string, string>(EQUATION_GROUPS.map(({ group, description }) => [description, group]))

const manifest = loadManifest()
const domParser = new DOMParser() as unknown as DOMParserLike
let framework: BondgraphFramework
let runtime: ModelRuntime
let constantNames: Set<string>

/** The kinds of difference found in each case, and anything that fits none of them. */
const found = new Map<string, { kinds: Set<Kind>; unexplained: string[] }>()

beforeAll(async () => {
  runtime = { ...(await frameworkRuntime()), oxigraph }
  framework = bgRdfFramework()
  constantNames = new Set([...framework.domains.values()].flatMap((domain) => domain.constants.map((constant) => constant.name)))
  for (const c of manifest.cases) found.set(c.name, compare(c))
})

//==============================================================================
// Reading a CellML document

interface Variable {
  name: string
  units: string
  initialValue?: string
  id?: string
  /** The id is `cmeta:id`, in a namespace, as CellML 1.1 needs. */
  namespacedId: boolean
  otherAttributes: string[]
}

interface CellMLDocument {
  namespace: string | null
  name: string | null
  /** Comments before the model. */
  header: string[]
  units: string[]
  components: { name: string | null; id?: string; namespacedId: boolean }[]
  variables: Variable[]
  /** Each `<math>`'s source, by the group comment before it. */
  groups: Map<string, string[]>
  /** Comments in the component that aren't a group's. */
  otherComments: string[]
}

const elements = (parent: Element, name: string): Element[] =>
  Array.from(parent.childNodes).filter((node): node is Element => node.nodeType === 1 && (node as Element).localName === name)

function idOf(element: Element): { id?: string; namespacedId: boolean } {
  const attribute = Array.from(element.attributes).find((a) => a.localName === 'id')
  return attribute === undefined ? { namespacedId: false } : { id: attribute.value, namespacedId: attribute.namespaceURI !== null }
}

function readCellML(source: string): CellMLDocument {
  const document = new DOMParser().parseFromString(source, 'text/xml')
  const model = document.documentElement!
  const header = Array.from(document.childNodes)
    .filter((node) => node.nodeType === 8)
    .map((node) => node.nodeValue ?? '')
  const components = elements(model, 'component')
  const result: CellMLDocument = {
    namespace: model.namespaceURI,
    name: model.getAttribute('name'),
    header,
    units: elements(model, 'units').map((u) => u.getAttribute('name')!),
    components: components.map((c) => ({ name: c.getAttribute('name'), ...idOf(c) })),
    variables: [],
    groups: new Map(),
    otherComments: [],
  }
  let current: string[] | undefined
  for (const node of Array.from(components[0]?.childNodes ?? [])) {
    if (node.nodeType === 8) {
      const group = GROUP_OF_COMMENT.get((node.nodeValue ?? '').trim())
      if (group === undefined) {
        result.otherComments.push((node.nodeValue ?? '').trim())
      } else {
        current = []
        result.groups.set(group, current)
      }
    } else if (node.nodeType === 1) {
      const element = node as Element
      if (element.localName === 'variable') {
        const initialValue = element.getAttribute('initial_value')
        result.variables.push({
          name: element.getAttribute('name')!,
          units: element.getAttribute('units')!,
          ...(initialValue === null ? {} : { initialValue }),
          ...idOf(element),
          otherAttributes: Array.from(element.attributes)
            .map((a) => a.localName!)
            .filter((name) => !['name', 'units', 'initial_value', 'id'].includes(name)),
        })
      } else if (element.localName === 'math') {
        if (current === undefined) result.otherComments.push('<math> before any group comment')
        current?.push(element.toString())
      } else {
        result.otherComments.push(`<${element.localName}> in the component`)
      }
    }
  }
  return result
}

//==============================================================================
// Comparing

/** Ours, as libCellML prints it, for the case. The A3 examples' CellML comes with their units warnings. */
function ourCellML(c: ReferenceCase): string {
  const model = BondgraphModel.fromTurtle(framework, runtime, readSource(c), c.baseIri)
  expect(model.log.issues.map((issue) => issue.message)).toEqual([])
  const result = generateCellML(runtime.libcellml as LibCellML, model)
  expectKnownIssues(c.name, result.issues.map((issue) => issue.message))
  return result.cellml!
}

const pythonCellML = (c: ReferenceCase): string => {
  const example = c.kind === 'example' ? c.name : c.reference.replace(/\.json$/, '')
  return readFileSync(`${REFERENCE_DIR}python/${example}.cellml`, 'utf8')
}

/** An equation as written, numbers' units removed, not tidied. */
const asWritten = (math: string): Equation =>
  toEquations(parseMathML(math.replace(/ cellml:units="[^"]*"/g, ''), { domParser }))[0]!

const numberUnits = (math: string): string[] => [...math.matchAll(/<cn\b[^>]*cellml:units="([^"]*)"/g)].map((m) => m[1]!)
const numberTexts = (math: string): string[] => [...math.matchAll(/<cn\b[^>]*>([^<]*)<\/cn>/g)].map((m) => m[1]!.trim())
const numberCount = (node: AstNode): number => [...walk(node)].filter((n) => n.type === 'Number').length

function compare(c: ReferenceCase): { kinds: Set<Kind>; unexplained: string[] } {
  const kinds = new Set<Kind>()
  const unexplained: string[] = []
  const python = readCellML(pythonCellML(c))
  const ours = readCellML(ourCellML(c))
  const same = (what: string, a: unknown, b: unknown): boolean => {
    if (JSON.stringify(a) === JSON.stringify(b)) return true
    unexplained.push(`${what}: Python's ${JSON.stringify(a)}, ours ${JSON.stringify(b)}`)
    return false
  }

  // The model and its one component
  if (python.namespace === CELLML_1_1 && ours.namespace === CELLML_2_0) kinds.add('cellml2')
  else same('namespace', python.namespace, ours.namespace)
  same('model name', python.name, ours.name)
  same('component names', python.components.map((x) => x.name), ours.components.map((x) => x.name))
  same('component ids', python.components.map((x) => x.id), ours.components.map((x) => x.id))
  if (python.components.some((x) => x.namespacedId) && !ours.components.some((x) => x.namespacedId)) kinds.add('cellml2')

  // Comments
  if (python.header.length === 1 && PYTHON_HEADER.test(python.header[0]!) && ours.header.length === 0) kinds.add('noHeader')
  else same('comments before the model', python.header, ours.header)
  same('other comments', python.otherComments, ours.otherComments)

  // Units: Python's dim is CellML 2.0's dimensionless; others are named differently
  const pythonUnits = python.units.filter((name) => name !== 'dim')
  if (python.units.includes('dim')) kinds.add('numberUnits')
  const unitsNames = new Map<string, string>()
  for (const name of new Set([...pythonUnits, ...ours.units])) if (!(pythonUnits.includes(name) && ours.units.includes(name))) kinds.add('unitsNames')

  // Variables: the same, but for constants' order, units names, how numbers are printed, and CellML 2.0 ids
  const byName = new Map(ours.variables.map((v) => [v.name, v]))
  if (same('variables', python.variables.map((v) => v.name).sort(), ours.variables.map((v) => v.name).sort())) {
    const order = (variables: Variable[]): string[] => variables.map((v) => v.name)
    if (JSON.stringify(order(python.variables)) !== JSON.stringify(order(ours.variables))) {
      const moved = python.variables.map((v, i) => [v.name, ours.variables[i]!.name] as const).filter(([a, b]) => a !== b)
      if (moved.every(([a, b]) => constantNames.has(a) && constantNames.has(b))) kinds.add('constantsOrder')
      else unexplained.push(`variable order: ${moved.map(([a, b]) => `${a}/${b}`).join(', ')}`)
    }
  }
  for (const p of python.variables) {
    const o = byName.get(p.name)
    if (o === undefined) continue
    // Each of Python's units names stands for one of ours (that they're the same units is checked elsewhere)
    const mapped = unitsNames.get(p.units)
    if (mapped === undefined) unitsNames.set(p.units, o.units)
    else same(`units of ${p.name}`, mapped, o.units)
    if (p.namespacedId && !o.namespacedId) kinds.add('cellml2')
    same(`id of ${p.name}`, p.id, o.id)
    same(`attributes of ${p.name}`, p.otherAttributes, o.otherAttributes)
    if (same(`initial value of ${p.name}`, p.initialValue === undefined ? null : Number(p.initialValue), o.initialValue === undefined ? null : Number(o.initialValue))) {
      if (p.initialValue !== o.initialValue) kinds.add('numberText')
    }
  }
  if (new Set(unitsNames.values()).size !== unitsNames.size) unexplained.push('two of Python units names are one of ours')

  // Equations, group by group, in order
  if (same('equation groups', [...python.groups.keys()], [...ours.groups.keys()])) {
    for (const [group, pythons] of python.groups) {
      const ourMaths = ours.groups.get(group)!
      if (!same(`number of ${group}`, pythons.length, ourMaths.length)) continue
      pythons.forEach((p, i) => {
        const o = ourMaths[i]!
        const label = `${group} ${i + 1}`
        // Python's numbers are all in its dim units; ours in dimensionless, or the units a source gives them
        const units = numberUnits(o)
        if (numberUnits(p).some((u) => u !== 'dim')) unexplained.push(`${label}: Python's numbers have units ${numberUnits(p)}`)
        if (units.length > 0 && numberUnits(p).length > 0) kinds.add('numberUnits')
        const pythonAsWritten = asWritten(p)
        const oursAsWritten = asWritten(o)
        if (equals(pythonAsWritten, oursAsWritten)) {
          if (JSON.stringify(numberTexts(p)) !== JSON.stringify(numberTexts(o))) kinds.add('numberText')
          return
        }
        if (equals(pythonEquation(p.replaceAll(' cellml:units="dim"', '')), canonicalise(oursAsWritten) as Equation)) {
          kinds.add(numberCount(pythonAsWritten) === numberCount(oursAsWritten) ? 'equationForm' : 'numbersAsGiven')
        } else if (c.intermediateBug3Fixed !== undefined) {
          // Checked against Python with its bug fixed in cellml-equations.test.ts
          kinds.add('bondCounts')
        } else {
          unexplained.push(`${label} differs as mathematics`)
        }
      })
    }
  }
  return { kinds, unexplained }
}

//==============================================================================

describe("our CellML and Python's", { timeout: 30_000 }, () => {
  it.each(manifest.cases.map((c) => c.name))('%s differ only as the README explains', (name) => {
    expect(found.get(name)!.unexplained).toEqual([])
  })

  it.each(Object.entries(DIFFERENCES))('the README explains %s', (_kind, title) => {
    const section = README.slice(README.indexOf('## Differences from the Python version'))
    expect(section).toContain(`**${title}.**`)
  })

  it.each(Object.keys(DIFFERENCES))('%s turns up', (kind) => {
    const cases = [...found].filter(([, result]) => result.kinds.has(kind as Kind)).map(([name]) => name)
    expect(cases.length, `no case differs from Python as ${kind}`).toBeGreaterThan(0)
  })

  it('finds bond counts only where Python has its bug 3', () => {
    const cases = [...found].filter(([, result]) => result.kinds.has('bondCounts')).map(([name]) => name)
    expect(cases.sort()).toEqual(['example_B2', 'example_B2_reduced'])
  })
})
