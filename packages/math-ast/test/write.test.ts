import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  ci,
  cn,
  constant,
  diff,
  divide,
  eq,
  equals,
  exp,
  fn,
  minus,
  MathMLWriteError,
  parseMathML,
  plus,
  power,
  times,
  toEquations,
  toMathML,
  toMathMLFragment,
  variables,
  type AstNode,
  type DOMParserLike,
} from '../src/index.js'

const domParser = new DOMParser() as unknown as DOMParserLike
const parse = (source: string): AstNode[] => parseMathML(source, { domParser })
const roundTrip = (nodes: readonly AstNode[]): AstNode[] => parse(toMathML(nodes))

const M = 'http://www.w3.org/1998/Math/MathML'
const C = 'http://www.cellml.org/cellml/2.0#'

// Every MathML block in BG-RDF, as in mathml.test.ts
const BG_RDF = fileURLToPath(new URL('../../../bg-rdf/', import.meta.url))
const bgRdfMathml = ['templates', 'examples'].flatMap((dir) =>
  readdirSync(`${BG_RDF}${dir}`)
    .filter((name) => name.endsWith('.ttl'))
    .sort()
    .flatMap((name) =>
      [...readFileSync(`${BG_RDF}${dir}/${name}`, 'utf8').matchAll(/"""\s*(<math[\s\S]*?<\/math>)\s*"""/g)].map(
        (m, i) => [`${dir}/${name} #${i + 1}`, m[1]!] as const,
      ),
    ),
)

/** One node of every type, with the variations the writer handles differently. */
const EVERY_KIND: [string, AstNode][] = [
  ['integer', cn(2)],
  ['decimal', cn(0.25)],
  ['negative', cn(-1.5)],
  ['with units', cn(10, 'volt')],
  ['e-notation as written', { type: 'Number', value: 1.5e-8, scientific: { mantissa: '1.5', exponent: -8 } }],
  ['identifier', ci('u_f_Re_r')],
  ['constants', plus(constant('pi'), constant('exponentiale'), constant('infinity'), constant('notanumber'))],
  ['booleans', { type: 'And', children: [constant('true'), constant('false')] }],
  ['add', plus(ci('a'), ci('b'), ci('c'))],
  ['multiply', times(ci('a'), ci('b'))],
  ['subtract', minus(ci('a'), ci('b'))],
  ['negate', minus(ci('a'))],
  ['divide', divide(ci('a'), ci('b'))],
  ['power', power(ci('a'), cn(2))],
  ['abs', { type: 'Abs', value: ci('a') }],
  ['square root', { type: 'Root', radicand: ci('a'), degree: null }],
  ['root with degree', { type: 'Root', radicand: ci('a'), degree: cn(3) }],
  ['exp and ln', exp(fn('ln', ci('a')))],
  ['log with base', fn('log', ci('a'), cn(2))],
  ['log without base', fn('log', ci('a'))],
  ['arcsin, named asin', fn('asin', ci('a'))],
  ['max', fn('max', ci('a'), ci('b'), ci('c'))],
  ['rem', fn('rem', ci('a'), ci('b'))],
  ['derivative', diff('q', 't')],
  ['comparisons', {
    type: 'Or',
    children: [
      { type: 'Less', left: ci('a'), right: ci('b') },
      { type: 'GreaterEqual', left: ci('a'), right: ci('b') },
      { type: 'NotEqual', left: ci('a'), right: ci('b') },
    ],
  }],
  ['not and xor', { type: 'Not', value: { type: 'Xor', children: [ci('a'), ci('b')] } }],
  ['piecewise', {
    type: 'Piecewise',
    pieces: [{ value: cn(1), condition: { type: 'Greater', left: ci('t'), right: cn(0) } }],
    otherwise: cn(0),
  }],
  ['piecewise without otherwise', {
    type: 'Piecewise',
    pieces: [{ value: cn(1), condition: { type: 'Less', left: ci('t'), right: cn(0) } }],
    otherwise: null,
  }],
  ['equation', eq(diff('q', 't'), ci('v'))],
]

describe('round trip', () => {
  it.each(EVERY_KIND)('%s', (_name, node) => {
    const [back] = roundTrip([node])
    // toEqual, not equals(): this also checks e-notation's mantissa and exponent survive
    expect(back).toEqual(node)
  })

  it.each(bgRdfMathml)('%s', (_name, mathml) => {
    const original = parse(mathml)
    const back = roundTrip(original)
    expect(back).toHaveLength(original.length)
    back.forEach((node, i) => expect(equals(node, original[i]!)).toBe(true))
  })

  it('keeps several equations in order', () => {
    const equations = [eq(ci('a'), cn(1)), eq(ci('b'), cn(2)), eq(ci('c'), cn(3))]
    expect(roundTrip(equations)).toEqual(equations)
  })
})

describe('layout', () => {
  it('indents with two spaces, and declares only the namespaces it uses', () => {
    expect(toMathML([eq(ci('x'), plus(ci('a'), ci('b')))])).toBe(
      [
        `<math xmlns="${M}">`,
        '  <apply>',
        '    <eq/>',
        '    <ci>x</ci>',
        '    <apply>',
        '      <plus/>',
        '      <ci>a</ci>',
        '      <ci>b</ci>',
        '    </apply>',
        '  </apply>',
        '</math>',
      ].join('\n'),
    )
  })

  it('declares the cellml prefix when a number has units', () => {
    expect(toMathML([cn(2, 'second')], { indent: '' })).toBe(
      `<math xmlns="${M}" xmlns:cellml="${C}"><cn cellml:units="second">2</cn></math>`,
    )
  })

  it('writes everything on one line with an empty indent', () => {
    const text = toMathML([eq(diff('q', 't'), ci('v'))], { indent: '' })
    expect(text).not.toContain('\n')
    expect(text).toBe(`<math xmlns="${M}"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>v</ci></apply></math>`)
  })

  it('writes a fragment without <math>', () => {
    expect(toMathMLFragment(minus(ci('a')), { indent: '' })).toBe('<apply><minus/><ci>a</ci></apply>')
  })
})

describe('numbers', () => {
  const written = (node: AstNode, options = {}) => toMathMLFragment(node, { indent: '', ...options })

  it('uses e-notation only where JavaScript would print an exponent', () => {
    expect(written(cn(1e-8))).toBe('<cn type="e-notation">1<sep/>-8</cn>')
    expect(written(cn(2.5e21))).toBe('<cn type="e-notation">2.5<sep/>21</cn>')
    expect(written(cn(0.1))).toBe('<cn>0.1</cn>')
    expect(written(cn(2578.73058))).toBe('<cn>2578.73058</cn>')
  })

  it('writes non-finite values as constants', () => {
    expect(written(cn(Number.NaN))).toBe('<notanumber/>')
    expect(written(cn(Infinity))).toBe('<infinity/>')
    expect(written(cn(-Infinity))).toBe('<apply><minus/><infinity/></apply>')
  })

  it("takes units from cnUnits, then the number's own", () => {
    const options = { cnUnits: (n: { value: number }) => (n.value === 1 ? 'second' : undefined) }
    expect(written(cn(1, 'volt'), options)).toBe('<cn cellml:units="second">1</cn>')
    expect(written(cn(2, 'volt'), options)).toBe('<cn cellml:units="volt">2</cn>')
    expect(written(cn(3), options)).toBe('<cn>3</cn>')
  })

  it('escapes text and attributes', () => {
    expect(written(cn(1, 'a"b<c'))).toBe('<cn cellml:units="a&quot;b&lt;c">1</cn>')
    expect(written(ci('a&b'))).toBe('<ci>a&amp;b</ci>')
  })

  it('refuses functions it has no MathML for', () => {
    expect(() => written(fn('gamma', ci('x')))).toThrow(MathMLWriteError)
  })
})

//==============================================================================

describe('libCellML accepts what is written', () => {
  type Logger = { issueCount(): number; issue(i: number): { description(): string } }
  let lc: {
    Parser: new (strict: boolean) => Logger & { parseModel(text: string): unknown }
    Validator: new () => Logger & { validateModel(model: unknown): void }
  }

  beforeAll(async () => {
    lc = (await createLibCellML()) as unknown as typeof lc
  })

  /** Issues from libCellML's strict parser and validator, for the math in a one-component model. */
  function cellmlIssues(math: string, names: readonly string[]): string[] {
    const declarations = names.map((name) => `<variable name="${name}" units="dimensionless" interface="none"/>`).join('')
    const model = `<model xmlns="${C}" name="m"><component name="c">${declarations}${math}</component></model>`
    const parser = new lc.Parser(true)
    const parsed = parser.parseModel(model)
    const validator = new lc.Validator()
    validator.validateModel(parsed)
    const issues: string[] = []
    for (const logger of [parser, validator]) {
      for (let i = 0; i < logger.issueCount(); i += 1) issues.push(logger.issue(i).description())
    }
    return issues
  }

  it.each(bgRdfMathml)('%s', (_name, mathml) => {
    const equations = toEquations(parse(mathml))
    const math = toMathML(equations, { cnUnits: () => 'dimensionless' })
    expect(cellmlIssues(math, variables(...equations))).toEqual([])
  })

  it('accepts e-notation and negative numbers', () => {
    const equation = eq(ci('x'), plus(cn(-0.25), cn(1e-8), cn(3.5e30)))
    expect(cellmlIssues(toMathML([equation], { cnUnits: () => 'dimensionless' }), ['x'])).toEqual([])
  })

  it('rejects numbers without units, as CellML 2.0 requires', () => {
    expect(cellmlIssues(toMathML([eq(ci('x'), cn(2))]), ['x'])).not.toEqual([])
  })
})
