import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'

import {
  ci,
  cn,
  diff,
  divide,
  eq,
  equals,
  exp,
  minus,
  MathMLError,
  parseMathML,
  readMathML,
  readMathMLElement,
  times,
  toEquations,
  variables,
  type AstNode,
  type DOMParserLike,
} from '../src/index.js'

const domParser = new DOMParser() as unknown as DOMParserLike
const parse = (source: string): AstNode[] => parseMathML(source, { domParser })
const read = (source: string) => readMathML(source, { domParser })
const one = (body: string): AstNode => {
  const [node] = parse(body)
  return node!
}

const M = 'xmlns="http://www.w3.org/1998/Math/MathML"'

//==============================================================================
// Every MathML block in BG-RDF

const BG_RDF = fileURLToPath(new URL('../../../bg-rdf/', import.meta.url))

/** The `"""<math>…</math>"""` literals in a Turtle file. */
function mathmlLiterals(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/"""\s*(<math[\s\S]*?<\/math>)\s*"""/g)].map((m) => m[1]!)
}

const bgRdfMathml = ['templates', 'examples'].flatMap((dir) =>
  readdirSync(`${BG_RDF}${dir}`)
    .filter((name) => name.endsWith('.ttl'))
    .sort()
    .flatMap((name) => mathmlLiterals(`${BG_RDF}${dir}/${name}`).map((mathml, i) => [`${dir}/${name} #${i + 1}`, mathml] as const)),
)

describe('BG-RDF MathML', () => {
  it('finds the 14 template relations and 2 example values', () => {
    expect(bgRdfMathml.filter(([name]) => name.startsWith('templates/'))).toHaveLength(14)
    expect(bgRdfMathml.filter(([name]) => name.startsWith('examples/'))).toHaveLength(2)
  })

  it.each(bgRdfMathml)('%s reads as equations', (_name, mathml) => {
    const read = readMathML(mathml, { domParser })
    expect(read.problems).toEqual([])
    const equations = toEquations(read.expressions as AstNode[])
    expect(equations.length).toBeGreaterThan(0)
    for (const equation of equations) {
      expect(['Identifier', 'Derivative']).toContain(equation.left.type)
    }
  })

  it('reads the ChemicalReaction relation exactly', () => {
    const [name, mathml] = bgRdfMathml.find(([, m]) => m.includes('<ci>kappa</ci>'))!
    expect(name).toMatch(/^templates\/chemical\.ttl/)
    const expected = eq(
      ci('v'),
      times(ci('kappa'), minus(exp(divide(ci('u_f'), ci('RT'))), exp(divide(ci('u_r'), ci('RT'))))),
    )
    expect(equals(parse(mathml)[0]!, expected)).toBe(true)
  })

  it('reads the ChemicalConcentration ODE with the derivative on the left', () => {
    const [, mathml] = bgRdfMathml.find(([, m]) => m.includes('<ci>K</ci>'))!
    const [ode, potential] = toEquations(parse(mathml))
    expect(equals(ode!, eq(diff('q', 't'), ci('v')))).toBe(true)
    expect(variables(potential!)).toEqual(['u', 'RT', 'K', 'q'])
  })
})

//==============================================================================

describe('reading', () => {
  it('reads <math> elements, several equations each', () => {
    const nodes = parse(`<math ${M}><apply><eq/><ci>a</ci><cn>1</cn></apply><apply><eq/><ci>b</ci><cn>2</cn></apply></math>`)
    expect(nodes).toHaveLength(2)
  })

  it('reads bare fragments, with an undeclared cellml prefix', () => {
    expect(one('<cn cellml:units="second">2</cn>')).toEqual({ type: 'Number', value: 2, units: 'second' })
  })

  it('reads cellml:units in the CellML 1.1 namespace', () => {
    const node = one(`<math ${M} xmlns:c11="http://www.cellml.org/cellml/1.1#"><cn c11:units="volt">10</cn></math>`)
    expect(node).toEqual({ type: 'Number', value: 10, units: 'volt' })
  })

  it('reads units another way with a cnUnits hook, with extra undeclared prefixes', () => {
    const BGF = 'https://bg-rdf.org/ontologies/bondgraph-framework#'
    const options = {
      domParser: new DOMParser() as unknown as DOMParserLike,
      namespaces: { bgf: BGF },
      cnUnits: (cn: Element) => cn.getAttributeNS(BGF, 'units') ?? undefined,
    }
    const nodes = parseMathML(`<math ${M}><cn bgf:units="V">50</cn><cn cellml:units="volt">1</cn><cn bgf:units=" ">2</cn></math>`, options)
    expect(nodes).toEqual([
      { type: 'Number', value: 50, units: 'V' },
      { type: 'Number', value: 1 },
      { type: 'Number', value: 2 },
    ])
    // Without the hook, only cellml:units count
    expect(parseMathML(`<cn bgf:units="V">50</cn>`, { domParser: options.domParser, namespaces: { bgf: BGF } })).toEqual([{ type: 'Number', value: 50 }])
  })

  it('needs an undeclared prefix to be given', () => {
    expect(() => parseMathML(`<cn bgf:units="V">50</cn>`, { domParser: new DOMParser() as unknown as DOMParserLike })).toThrow(MathMLError)
  })

  it('reads e-notation, keeping the notation', () => {
    expect(one('<cn type="e-notation">1.5<sep/>-8</cn>')).toEqual({
      type: 'Number',
      value: 1.5e-8,
      scientific: { mantissa: '1.5', exponent: -8 },
    })
  })

  it('reads integers and negative numbers', () => {
    expect(one('<cn type="integer">3</cn>')).toEqual({ type: 'Number', value: 3 })
    expect(one('<cn>-0.25</cn>')).toEqual({ type: 'Number', value: -0.25 })
  })

  it('ignores comments and whitespace', () => {
    const node = one(`<apply>
      <!-- a comment -->
      <plus/>
      <ci> a </ci>
      <!-- another -->
      <ci>b</ci>
    </apply>`)
    expect(node).toEqual({ type: 'Add', children: [ci('a'), ci('b')] })
  })

  it('reads one-operand minus as Negate and two as Subtract', () => {
    expect(one('<apply><minus/><ci>a</ci></apply>').type).toBe('Negate')
    expect(one('<apply><minus/><ci>a</ci><ci>b</ci></apply>').type).toBe('Subtract')
  })

  it('names functions as FUNCTIONS does', () => {
    expect(one('<apply><arcsin/><ci>x</ci></apply>')).toEqual({ type: 'FunctionCall', name: 'asin', args: [ci('x')] })
    expect(one('<apply><max/><ci>a</ci><ci>b</ci><ci>c</ci></apply>')).toMatchObject({ name: 'max', args: [{}, {}, {}] })
  })

  it('reads log with a base, and root with a degree', () => {
    expect(one('<apply><log/><logbase><cn>2</cn></logbase><ci>x</ci></apply>')).toEqual({
      type: 'FunctionCall',
      name: 'log',
      args: [ci('x'), cn(2)],
    })
    expect(one('<apply><root/><degree><cn>3</cn></degree><ci>x</ci></apply>')).toEqual({
      type: 'Root',
      radicand: ci('x'),
      degree: cn(3),
    })
    expect(one('<apply><root/><ci>x</ci></apply>')).toEqual({ type: 'Root', radicand: ci('x'), degree: null })
  })

  it('reads constants', () => {
    expect(one('<pi/>')).toEqual({ type: 'Constant', name: 'pi' })
    expect(one('<notanumber/>')).toEqual({ type: 'Constant', name: 'notanumber' })
  })

  it('reads piecewise with comparisons and logic', () => {
    const node = one(`<piecewise>
      <piece><cn>1</cn><apply><and/><apply><lt/><ci>t</ci><cn>5</cn></apply><apply><geq/><ci>t</ci><cn>0</cn></apply></apply></piece>
      <otherwise><cn>0</cn></otherwise>
    </piecewise>`)
    expect(node).toEqual({
      type: 'Piecewise',
      pieces: [
        {
          value: cn(1),
          condition: {
            type: 'And',
            children: [
              { type: 'Less', left: ci('t'), right: cn(5) },
              { type: 'GreaterEqual', left: ci('t'), right: cn(0) },
            ],
          },
        },
      ],
      otherwise: cn(0),
    })
  })

  it('reads a derivative, with or without a degree of 1', () => {
    const expected = diff('q', 't')
    expect(equals(one('<apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>'), expected)).toBe(true)
    expect(
      equals(one('<apply><diff/><bvar><ci>t</ci><degree><cn>1</cn></degree></bvar><ci>q</ci></apply>'), expected),
    ).toBe(true)
  })

  it('reads a <math> element inside a CellML document', () => {
    const cellml = `<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="m">
      <component name="c"><math ${M}><apply><eq/><ci>x</ci><cn cellml:units="dimensionless">1</cn></apply></math></component>
    </model>`
    const doc = (domParser as unknown as DOMParser).parseFromString(cellml, 'application/xml')
    const math = doc.getElementsByTagNameNS('http://www.w3.org/1998/Math/MathML', 'math')[0]!
    const read = readMathMLElement(math as unknown as Element)
    expect(read.problems).toEqual([])
    expect(read.expressions[0]).toEqual(eq(ci('x'), cn(1, 'dimensionless')))
  })
})

describe('toEquations', () => {
  it('moves a derivative on the right to the left', () => {
    const [equation] = toEquations(parse('<apply><eq/><ci>v</ci><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply></apply>'))
    expect(equals(equation!, eq(diff('q', 't'), ci('v')))).toBe(true)
  })

  it('rejects expressions that aren’t equations, and derivatives on both sides', () => {
    expect(() => toEquations([ci('x')])).toThrow(/Expected an equation, got Identifier/)
    expect(() => toEquations([eq(diff('a', 't'), diff('b', 't'))])).toThrow(/derivative on only one side/)
  })
})

//==============================================================================

describe('problems', () => {
  const problem = (body: string): string => {
    const { problems } = read(body)
    expect(problems.length).toBeGreaterThan(0)
    return problems[0]!.message
  }

  it('names an unsupported element', () => {
    expect(problem('<apply><sum/><ci>x</ci></apply>')).toBe("<sum> isn't supported in CellML's MathML")
    expect(problem('<csymbol>f</csymbol>')).toBe("<csymbol> isn't supported in CellML's MathML")
  })

  it('rejects the wrong number of operands', () => {
    expect(problem('<apply><minus/><ci>a</ci><ci>b</ci><ci>c</ci></apply>')).toBe('<minus> needs 1 or 2 operands, not 3')
    expect(problem('<apply><divide/><ci>a</ci></apply>')).toBe('<divide> needs 2 operands, not 1')
    expect(problem('<apply><sin/><ci>a</ci><ci>b</ci></apply>')).toBe('<sin> needs 1 operand, not 2')
  })

  it('rejects higher derivatives and misplaced qualifiers', () => {
    expect(problem('<apply><diff/><bvar><ci>t</ci><degree><cn>2</cn></degree></bvar><ci>q</ci></apply>')).toBe(
      'Only first derivatives are supported: the <degree> must be 1',
    )
    expect(problem('<apply><diff/><ci>q</ci></apply>')).toBe('<diff> needs a <bvar>')
    expect(problem('<apply><sin/><bvar><ci>t</ci></bvar><ci>q</ci></apply>')).toBe("<bvar> can't qualify <sin>")
  })

  it('rejects invalid names, numbers and stray text', () => {
    expect(problem('<ci>2x</ci>')).toBe(`"2x" isn't a valid CellML variable name`)
    expect(problem('<cn>ten</cn>')).toBe(`"ten" isn't a number`)
    expect(problem('<cn type="rational">1<sep/>2</cn>')).toBe(`<cn type="rational"> isn't supported in CellML's MathML`)
    expect(problem('<cn base="2">101</cn>')).toBe(`<cn base="2"> isn't supported; numbers must be base 10`)
    expect(one('<cn base="10">101</cn>')).toEqual(cn(101))
    expect(problem('<apply><plus/>oops<ci>a</ci></apply>')).toBe('Unexpected text "oops" in <apply>')
  })

  it('rejects elements outside the MathML namespace', () => {
    expect(problem('<x:ci xmlns:x="urn:other">a</x:ci>')).toBe("<x:ci> isn't in the MathML namespace")
  })

  it('reports every problem, and keeps the expressions that are fine', () => {
    const result = read(`<math ${M}>
      <apply><eq/><ci>a</ci><cn>1</cn></apply>
      <apply><eq/><ci>b</ci><apply><sum/></apply></apply>
      <apply><eq/><ci>2c</ci><cn>bad</cn></apply>
    </math>`)
    expect(result.expressions[0]).toEqual(eq(ci('a'), cn(1)))
    expect(result.expressions.slice(1)).toEqual([null, null])
    expect(result.problems.map((p) => p.expression)).toEqual([1, 2, 2])
  })

  it('throws them all from parseMathML', () => {
    try {
      parse('<apply><plus/><ci>2a</ci><cn>x</cn></apply>')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(MathMLError)
      expect((error as MathMLError).problems).toHaveLength(2)
    }
  })

  it('throws for XML that isn’t well-formed', () => {
    expect(() => parse('<apply><plus/>')).toThrow(MathMLError)
  })
})
