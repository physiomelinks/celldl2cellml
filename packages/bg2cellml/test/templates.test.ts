import { canonicalise, equals, variables } from '@physiomelinks/math-ast'
import { beforeAll, describe, expect, it } from 'vitest'

import { BGF, fragment, type BondgraphFramework, type ElementTemplate, type VariableDefinition } from '../src/index.js'
import {
  TEST_IRI,
  bgRdfFramework,
  domainTurtle,
  expectSameUnits,
  frameworkFrom,
  frameworkRuntime,
  mathml,
  messages,
} from './framework-fixtures.js'
import { loadPythonFramework, type PythonElementTemplate, type PythonVariable } from './reference.js'
import { pythonEquation } from './python-math.js'

const python = loadPythonFramework()
let framework: BondgraphFramework

beforeAll(async () => {
  await frameworkRuntime()
  framework = bgRdfFramework()
})

function expectVariable(ours: VariableDefinition | undefined, theirs: PythonVariable | null): void {
  expect(ours, theirs?.name).toBeDefined()
  expect(ours!.name).toBe(theirs!.name)
  expect(ours!.type ?? null).toBe(theirs!.type)
  expectSameUnits(ours!.units, theirs!.units)
  if (theirs!.value === null) {
    expect(ours!.value).toBeUndefined()
  } else {
    expect(ours!.value!.magnitude).toBe(theirs!.value.magnitude)
    expectSameUnits(ours!.value!.units!, theirs!.value.units)
  }
}

//==============================================================================

describe('BG-RDF element templates', () => {
  it('all load with no issues', () => {
    expect(messages(framework)).toEqual([])
    expect([...framework.elementTemplates.keys()]).toEqual(Object.keys(python.elementTemplates))
  })

  describe.each(Object.values(python.elementTemplates).map((t): [string, PythonElementTemplate] => [fragment(t.iri), t]))(
    '%s',
    (_name, theirs) => {
      let ours: ElementTemplate

      beforeAll(() => {
        ours = framework.elementTemplates.get(theirs.iri)!
      })

      it('has the class, domain and label Python has', () => {
        expect(ours.elementClass).toBe(theirs.elementClass)
        expect(ours.domain.iri).toBe(theirs.domain)
        // Python holds the label as the template's symbol, falling back to the IRI's fragment
        expect(ours.label ?? fragment(ours.iri)).toBe(theirs.symbol)
        expect(theirs.label).toBeNull()
      })

      it('has the ports Python has', () => {
        expect([...ours.ports.keys()]).toEqual(Object.keys(theirs.ports))
        for (const [id, port] of Object.entries(theirs.ports)) {
          const ourPort = ours.ports.get(id)!
          expect(ourPort).toMatchObject({ id, iri: port.iri, bondCount: port.bondCount })
          expect(ourPort.direction ?? null).toBe(port.direction)
          expect(ourPort.flow.name).toBe(port.flow.name)
          expect(ourPort.potential.name).toBe(port.potential.name)
          expectVariable(ourPort.flow, port.flow.variable)
          expectVariable(ourPort.potential, port.potential.variable)
        }
      })

      it('has the parameters, variables and intrinsic variable Python has', () => {
        for (const [ourMap, theirMap] of [
          [ours.parameters, theirs.parameters],
          [ours.variables, theirs.variables],
        ] as const) {
          expect([...ourMap.keys()].sort()).toEqual(Object.keys(theirMap).sort())
          for (const [name, variable] of Object.entries(theirMap)) expectVariable(ourMap.get(name), variable)
        }
        if (theirs.intrinsicVariable === null) expect(ours.intrinsicVariable).toBeUndefined()
        else expectVariable(ours.intrinsicVariable, theirs.intrinsicVariable)
      })

      it('has the constitutive relation Python has', () => {
        if (theirs.constitutiveRelation === null) {
          expect(ours.constitutiveRelation).toBeUndefined()
          return
        }
        const relation = ours.constitutiveRelation!
        expect(variables(...relation).sort()).toEqual([...theirs.constitutiveRelation.variables].sort())
        expect(relation).toHaveLength(theirs.constitutiveRelation.equations.length)
        theirs.constitutiveRelation.equations.forEach((equation, index) => {
          const ourEquation = canonicalise(relation[index]!)
          expect(equals(ourEquation, pythonEquation(equation.mathml)), equation.text).toBe(true)
        })
      })
    },
  )
})

//==============================================================================

const V_EQUALS_U_OVER_R = '<apply><eq/><ci>v</ci><apply><divide/><ci>u</ci><ci>R</ci></apply></apply>'
const PARAMETER_R = 'bgf:hasParameter [ bgf:varName "R" ; bgf:hasUnits "J.s.m-2"^^cdt:ucumunit ]'

/** A template in the test domain, with any of its parts replaced. */
function templateTurtle(
  name: string,
  parts: { elementClass?: string; domain?: string; relation?: string | null; extra?: string } = {},
): string {
  const lines = [
    `:${name} a bgf:ElementTemplate`,
    `rdfs:subClassOf ${parts.elementClass ?? 'bgf:Resistance'}`,
    `bgf:hasDomain ${parts.domain ?? ':Test'}`,
    parts.relation === null ? undefined : `bgf:constitutiveRelation ${parts.relation ?? mathml(V_EQUALS_U_OVER_R)}`,
    parts.extra ?? PARAMETER_R,
  ]
  return `${lines.filter(Boolean).join(' ;\n    ')} .\n`
}

/** The framework from the test domain, with a constant `k`, and these templates. */
function templatesFrom(...templates: string[]): BondgraphFramework {
  return frameworkFrom(domainTurtle('Test', { extra: 'bgf:hasConstant [ bgf:varName "k" ; bgf:hasValue "2 J"^^cdt:ucum ]' }), ...templates)
}

const iri = (name: string): string => `${TEST_IRI}${name}`

describe('element template declarations', () => {
  it('load a template with a label, parameter values and a single default port', () => {
    const framework = templatesFrom(
      templateTurtle('Good', {
        extra: `rdfs:label "A resistor" ; bgf:hasParameter [ bgf:varName "R" ; bgf:hasUnits "J.s.m-2"^^cdt:ucumunit ; bgf:hasValue "3 kJ.s.m-2"^^cdt:ucum ]`,
      }),
    )
    expect(messages(framework)).toEqual([])
    const template = framework.elementTemplates.get(iri('Good'))!
    expect(template.label).toBe('A resistor')
    expect(template.parameters.get('R')).toEqual({ name: 'R', units: 'J.s.m-2', value: { magnitude: 3, units: 'kJ.s.m-2' } })
    expect([...template.ports.values()]).toEqual([
      { id: '', iri: iri('Good'), bondCount: 1, flow: { name: 'v', units: 'm/s', type: BGF.FlowVariable }, potential: { name: 'u', units: 'J/m', type: BGF.PotentialVariable } },
    ])
    expect(template.intrinsicVariable).toBeUndefined()
  })

  it('read ports with ids, directions and bond counts', () => {
    const framework = templatesFrom(
      templateTurtle('Reaction', {
        elementClass: 'bgf:Reaction',
        relation: mathml('<apply><eq/><ci>v</ci><apply><times/><ci>R</ci><apply><minus/><ci>u_f</ci><ci>u_r</ci></apply></apply></apply>'),
        extra: `${PARAMETER_R} ;
          bgf:hasPort [ bgf:portId "r" ; bgf:direction bgf:OutwardPort ; bgf:bondCount 2 ],
                      [ bgf:portId "f" ; bgf:direction bgf:InwardPort ; bgf:bondCount "3" ]`,
      }),
    )
    expect(messages(framework)).toEqual([])
    const ports = framework.elementTemplates.get(iri('Reaction'))!.ports
    expect([...ports.keys()]).toEqual(['f', 'r'])
    expect(ports.get('f')).toMatchObject({ iri: iri('Reaction_f'), direction: BGF.InwardPort, bondCount: 1, flow: { name: 'v' }, potential: { name: 'u_f' } })
    expect(ports.get('r')).toMatchObject({ iri: iri('Reaction_r'), direction: BGF.OutwardPort, bondCount: 2, potential: { name: 'u_r' } })
  })

  it.each([
    ['bgf:QuantityStore', 'q', '<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>v</ci></apply><apply><eq/><ci>u</ci><apply><times/><ci>R</ci><ci>q</ci></apply></apply>'],
    ['bgf:FlowStore', 'v', '<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>v</ci></apply><apply><divide/><ci>u</ci><ci>R</ci></apply></apply>'],
  ])('give a %s its intrinsic variable %s', (elementClass, name, relation) => {
    const framework = templatesFrom(templateTurtle('Store', { elementClass, relation: mathml(relation) }))
    expect(messages(framework)).toEqual([])
    expect(framework.elementTemplates.get(iri('Store'))!.intrinsicVariable).toMatchObject({ name })
  })

  it.each([
    ['bgf:FlowSource', 'v'],
    ['bgf:PotentialSource', 'u'],
  ])('ignore the relation of a %s, and give it its intrinsic variable %s', (elementClass, name) => {
    const framework = templatesFrom(templateTurtle('Source', { elementClass, relation: mathml('<apply><eq/><ci>x</ci><ci>y</ci></apply>'), extra: 'rdfs:label "A source"' }))
    expect(messages(framework)).toEqual([])
    const template = framework.elementTemplates.get(iri('Source'))!
    expect(template.constitutiveRelation).toBeUndefined()
    expect(template.intrinsicVariable).toMatchObject({ name })
  })

  it('move a derivative on the right of an equation to the left', () => {
    const framework = templatesFrom(
      templateTurtle('Store', {
        elementClass: 'bgf:QuantityStore',
        relation: mathml(
          '<apply><eq/><ci>v</ci><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply></apply>',
          '<apply><eq/><ci>u</ci><apply><times/><ci>R</ci><ci>q</ci></apply></apply>',
        ),
      }),
    )
    expect(messages(framework)).toEqual([])
    expect(framework.elementTemplates.get(iri('Store'))!.constitutiveRelation![0]!.left.type).toBe('Derivative')
  })

  // Python's messages, except where noted
  it.each([
    ['no constitutive relation', { relation: null }, `BondElement ${iri('Bad')} has no constitutive relation`],
    ['a constitutive relation that is an IRI', { relation: ':relation' }, `BondElement ${iri('Bad')} has no constitutive relation`],
    [
      // Python keeps whichever it reads last
      'two parameters with one name',
      { extra: `${PARAMETER_R} ; bgf:hasParameter [ bgf:varName "R" ; bgf:hasUnits "kJ.s.m-2"^^cdt:ucumunit ]` },
      `Duplicate name \`R\` for <${iri('Bad')}>`,
    ],
    [
      'a domain symbol as a parameter',
      { extra: 'bgf:hasParameter [ bgf:varName "u" ; bgf:hasUnits "J/m"^^cdt:ucumunit ]' },
      `Cannot specify domain symbol u as a variable for <${iri('Bad')}>`,
    ],
    [
      'a parameter that is also a variable',
      { extra: `${PARAMETER_R} ; bgf:hasVariable [ bgf:varName "R" ; bgf:hasUnits "J.s.m-2"^^cdt:ucumunit ]` },
      `Duplicate name \`R\` for <${iri('Bad')}>`,
    ],
    [
      'an undeclared name in its relation',
      { extra: 'rdfs:label "No R"' },
      `Constitutive relation of <${iri('Bad')}> has undeclared name R`,
    ],
    [
      // Python's check counts names, so it misses this one; its message also says "it's"
      'a parameter not in its relation',
      { relation: mathml('<apply><eq/><ci>v</ci><apply><times/><ci>k</ci><ci>u</ci></apply></apply>') },
      `<${iri('Bad')}> has variables that are not in its constitutive relation: R`,
    ],
    [
      'a parameter with no units',
      { extra: 'bgf:hasParameter [ bgf:varName "R" ]' },
      `Variable R for <${iri('Bad')}> has no Units specified`,
    ],
    [
      'a parameter value in incompatible units',
      { extra: 'bgf:hasParameter [ bgf:varName "R" ; bgf:hasUnits "J.s.m-2"^^cdt:ucumunit ; bgf:hasValue "3 V"^^cdt:ucum ]' },
      'Value for variable R has incompatible units (V != J.s.m-2)',
    ],
    [
      // Not reported by Python, which drops the port
      'a port with no direction',
      { extra: `${PARAMETER_R} ; bgf:hasPort [ bgf:portId "f" ]` },
      `<${iri('Bad')}> has a port without both a bgf:portId and a bgf:direction`,
    ],
    [
      'two ports with one id',
      { extra: `${PARAMETER_R} ; bgf:hasPort [ bgf:portId "f" ; bgf:direction bgf:InwardPort ], [ bgf:portId "f" ; bgf:direction bgf:OutwardPort ]` },
      `<${iri('Bad')}> has more than one port with id f`,
    ],
    [
      'MathML that is not an equation',
      { relation: mathml('<apply><plus/><ci>v</ci><ci>R</ci></apply>') },
      `<${iri('Bad')}>: Expected an equation, got Add`,
    ],
    [
      'an equation with an expression on its left',
      { relation: mathml('<apply><eq/><apply><times/><ci>R</ci><ci>v</ci></apply><ci>u</ci></apply>') },
      `<${iri('Bad')}>: Unsupported form of equation: its left side must be a variable or a derivative`,
    ],
    [
      'an unknown domain',
      { domain: ':Elsewhere' },
      `Unknown domain <${iri('Elsewhere')}> for <${iri('Bad')}> element`,
    ],
    [
      'two labels',
      { extra: `${PARAMETER_R} ; rdfs:label "One", "Two"` },
      `<${iri('Bad')}> has more than one element class, domain, constitutive relation or label`,
    ],
  ])('report a template with %s and leave it out', (_case, parts, message) => {
    const framework = templatesFrom(templateTurtle('Good'), templateTurtle('Bad', parts))
    expect(messages(framework)).toEqual([message])
    expect(framework.log.issues[0]!.subject).toBe(iri('Bad'))
    expect([...framework.elementTemplates.keys()]).toEqual([iri('Good')])
  })
})
