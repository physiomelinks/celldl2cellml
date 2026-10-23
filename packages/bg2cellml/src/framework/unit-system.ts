/**
 * A model's unit system, such as Cellular's fmol, pL, fJ and fC: every units
 * code of the framework is rescaled into it before the model is built, so the
 * CellML's variables are in those units themselves and its equations stay
 * consistent. See `rescaleUnits` in `@physiomelinks/cellml-units`.
 */

import { UcumError, rescaleUnits, unitSystem, type UnitSystem, type UnitSystemId } from '@physiomelinks/cellml-units'
import { mapChildren, type AstNode, type Equation } from '@physiomelinks/math-ast'

import { NAMESPACES } from '../rdf/namespaces.js'
import type { Domain } from './framework.js'
import type { ElementTemplate, PortTemplate } from './templates.js'
import { DeclarationError, type Value, type VariableDefinition } from './variables.js'

/** The predicate on a `bgf:BondgraphModel` giving its unit system: `pml:unitSystem pml:Cellular`. */
export const UNIT_SYSTEM_PREDICATE = `${NAMESPACES.pml}unitSystem`

/** Each preset's IRI, the object of `UNIT_SYSTEM_PREDICATE`. */
export const UNIT_SYSTEM_IRIS: Readonly<Record<UnitSystemId, string>> = {
  si: `${NAMESPACES.pml}SI`,
  cellular: `${NAMESPACES.pml}Cellular`,
}

/** The unit system a model without `UNIT_SYSTEM_PREDICATE` is in. */
export const DEFAULT_UNIT_SYSTEM: UnitSystemId = 'si'

/** The preset id for a unit system IRI, or `undefined` if it isn't one. */
export function unitSystemForIri(iri: string): UnitSystemId | undefined {
  return (Object.keys(UNIT_SYSTEM_IRIS) as UnitSystemId[]).find((id) => UNIT_SYSTEM_IRIS[id] === iri)
}

/** A value to 15 significant figures, as `convertValue` rounds. */
const round = (value: number): number => Number(value.toPrecision(15))

/** Rescales codes and values into a system, turning a `UcumError` into a `DeclarationError` naming `context`. */
export class Rescaler {
  readonly system: UnitSystem

  constructor(system: UnitSystem | UnitSystemId) {
    const found = typeof system === 'string' ? unitSystem(system) : system
    if (found === undefined) throw new DeclarationError(`Unknown unit system "${String(system)}"`)
    this.system = found
  }

  /** A code in the system, and the factor for values in it. */
  units(code: string, context: string): { code: string; factor: number } {
    try {
      return rescaleUnits(code, this.system)
    } catch (error) {
      if (error instanceof UcumError) throw new DeclarationError(`${context}: ${error.message}`)
      throw error
    }
  }

  /** A value in the system's units, keeping its physical value. */
  value(value: Value, fallback: string, context: string): Value {
    const { code, factor } = this.units(value.units ?? fallback, context)
    return { magnitude: factor === 1 ? value.magnitude : round(value.magnitude * factor), units: code }
  }

  variable(variable: VariableDefinition, context: string): VariableDefinition {
    const where = `Variable ${variable.name} of ${context}`
    return {
      ...variable,
      units: this.units(variable.units, where).code,
      ...(variable.value === undefined ? {} : { value: this.value(variable.value, variable.units, where) }),
    }
  }

  /** Equations with each number that has units in the system's units, keeping its physical value. */
  equations(equations: readonly Equation[], context: string): Equation[] {
    const rescale = (node: AstNode): AstNode => {
      if (node.type !== 'Number') return mapChildren(node, rescale)
      if (node.units === undefined) return node
      const { code, factor } = this.units(node.units, `A number in ${context}`)
      if (factor === 1 && code === node.units) return node
      return { type: 'Number', value: round(node.value * factor), units: code }
    }
    return equations.map((equation) => rescale(equation) as Equation)
  }

  domain(domain: Domain): Domain {
    const context = `<${domain.iri}>`
    return {
      ...domain,
      flow: this.variable(domain.flow, context),
      potential: this.variable(domain.potential, context),
      quantity: this.variable(domain.quantity, context),
      constants: domain.constants.map((constant) => this.variable(constant, context)),
    }
  }

  /** A template in the system, in its rescaled domain. */
  template(template: ElementTemplate, domain: Domain): ElementTemplate {
    const context = `<${template.iri}>`
    const variables = (map: ReadonlyMap<string, VariableDefinition>): Map<string, VariableDefinition> =>
      new Map([...map].map(([name, variable]) => [name, this.variable(variable, context)]))
    const ports = new Map<string, PortTemplate>(
      [...template.ports].map(([id, port]) => [
        id,
        { ...port, flow: this.variable(port.flow, context), potential: this.variable(port.potential, context) },
      ]),
    )
    return {
      ...template,
      domain,
      ports,
      parameters: variables(template.parameters),
      variables: variables(template.variables),
      ...(template.intrinsicVariable === undefined ? {} : { intrinsicVariable: this.variable(template.intrinsicVariable, context) }),
      ...(template.constitutiveRelation === undefined
        ? {}
        : { constitutiveRelation: this.equations(template.constitutiveRelation, `the constitutive relation of ${context}`) }),
    }
  }
}
