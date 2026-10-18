/**
 * The CellML 2.0 model for a bond graph model, built with libCellML: its
 * units, and one `main` component holding every variable. Ported from
 * `CellMLModel` in `cellml/__init__.py`, which wrote CellML 1.1 with lxml.
 *
 * As in Python, `main` holds the variable of integration, then the domain
 * constants of each element's domain, then every element and junction
 * variable sorted by `symbolSortKey`. A symbol is written once: the first
 * element or junction to have it, in model order, is the one recorded.
 *
 * Differences from Python, on purpose:
 * - Units are named as `@physiomelinks/cellml-units` names them (`C_per_s`,
 *   not `coulomb_per_second`), and a variable whose units are a CellML
 *   built-in (`coulomb`, `farad`) uses it without a definition.
 * - There is no `dim` units: CellML 2.0 has `dimensionless` built in.
 * - Prefixed and scaled units are defined (Python recurses forever), and
 *   initial values are in the variable's units (Python writes them as given).
 * - Domain constants come in the order the framework holds them, which is by
 *   name (`F`, `RT`), where Python's follows its query (`RT`, `F`).
 */

import {
  CELLML_BUILT_IN_UNITS,
  UcumError,
  compatible,
  convertValue,
  toCellMLUnits,
  unitsName,
  type Component,
  type LibCellML,
  type Model,
} from '@physiomelinks/cellml-units'

import { VOI_NAME } from '../framework/templates.js'
import { cleanName, type Value, type VariableDefinition } from '../framework/variables.js'
import type { IssueLog } from '../issues.js'
import type { BondgraphElement, ModelVariable } from '../model/elements.js'
import type { BondgraphJunction } from '../model/junctions.js'
import type { BondgraphModel } from '../model/model.js'
import { prettyUri } from '../model/names.js'

/** The one component, as in Python. */
export const MAIN_COMPONENT = 'main'

/** The variable of integration's units, as Python's `VOI_UCUMUNIT`. */
export const VOI_UNITS = 's'

/**
 * Python's `symbol_sort_key`: a flow or potential sorts with what it belongs
 * to, so `u_R_0` and `v_R_0` (keys `R_0u_`, `R_0v_`) come just before `R_R_0`.
 */
export function symbolSortKey(symbol: string): string {
  const head = symbol.slice(0, 2)
  return head === 'u_' || head === 'v_' ? symbol.slice(2) + head : symbol
}

/** Python sorts strings by code point; for the ASCII names of a model, that's UTF-16 order. */
const byKey = (a: string, b: string): number => {
  const [ka, kb] = [symbolSortKey(a), symbolSortKey(b)]
  return ka < kb ? -1 : ka > kb ? 1 : 0
}

/**
 * The CellML model's name: `BG_` and the last part of the model's IRI before
 * any `.`, as Python's `CellMLModel` (`#RC_circuit` gives `BG_RC_circuit`).
 * Anything still not allowed in a CellML identifier is dropped.
 */
export function cellmlModelName(iri: string): string {
  const fragment = iri.includes('#') ? iri.slice(iri.lastIndexOf('#') + 1) : iri.slice(iri.lastIndexOf('/') + 1)
  const name = cleanName(fragment.split('.')[0]!)
  return `BG_${name.replace(/[^A-Za-z0-9_]/g, '')}`
}

/** What a CellML variable was made from. */
export type CellMLVariableKind = 'voi' | 'constant' | 'variable'

/** A variable of the `main` component, and where it came from. */
export interface CellMLVariable {
  /** Its name in CellML: the model variable's symbol. */
  readonly name: string
  /** Its `id`, `main-<name>` as in Python; the metadata refers to it. */
  readonly id: string
  readonly kind: CellMLVariableKind
  /** The UCUM code of its units. */
  readonly ucum: string
  /** The name of its units in the CellML model: a built-in, or one the model defines. */
  readonly units: string
  /** Its initial value, in its units. */
  readonly initialValue?: number
  /** The `bgf:` type of a model variable, such as `bgf:FlowVariable`. */
  readonly type?: string
  /** The model variable, for elements' and junctions' variables. */
  readonly variable?: ModelVariable
  /** The first element or junction to have the variable. */
  readonly source?: BondgraphElement | BondgraphJunction
}

/**
 * Units definitions for a CellML model, one per distinct UCUM code, named by
 * `unitsName`. Codes with the same name and the same units (`mol/s`,
 * `s-1.mol`) share a definition; a different one gets a numbered name.
 */
export class UnitsDefinitions {
  readonly #libcellml: LibCellML
  readonly #model: Model
  /** UCUM code to CellML name. */
  readonly #names = new Map<string, string>()

  constructor(libcellml: LibCellML, model: Model) {
    this.#libcellml = libcellml
    this.#model = model
  }

  /** The CellML units for a UCUM code, adding a definition to the model if it needs one. Throws a `UcumError` for codes CellML can't express. */
  unitsFor(code: string): string {
    const known = this.#names.get(code)
    if (known !== undefined) return known

    const libcellml = this.#libcellml
    const name = unitsName(code)
    const units = toCellMLUnits(libcellml, code, name)
    if (units === undefined) {
      // A built-in, or dimensionless
      this.#names.set(code, name)
      return name
    }
    try {
      // The first of name, name_1, name_2, ... that is these units or is free
      const taken = new Set(this.#definedNames())
      for (let counter = 0; ; counter += 1) {
        const candidate = counter === 0 ? name : `${name}_${counter}`
        if (CELLML_BUILT_IN_UNITS.has(candidate)) continue
        if (!taken.has(candidate)) {
          units.setName(candidate)
          this.#model.addUnits(units)
          this.#names.set(code, candidate)
          return candidate
        }
        const existing = this.#model.unitsByName(candidate)!
        const same = libcellml.Units.equivalent(existing, units)
        existing.delete?.()
        if (same) {
          this.#names.set(code, candidate)
          return candidate
        }
      }
    } finally {
      units.delete?.()
    }
  }

  #definedNames(): string[] {
    const names: string[] = []
    for (let index = 0; index < this.#model.unitsCount(); index += 1) {
      const units = this.#model.unitsByIndex(index)
      if (units === null) continue
      names.push(units.name())
      units.delete?.()
    }
    return names
  }
}

/** The CellML model being built for a bond graph model. Later stages add equations and metadata to it. */
export interface CellMLModelBuild {
  /** The libCellML model. The caller frees it with `delete()`. */
  readonly model: Model
  readonly component: Component
  /** The `main` component's variables, in order. */
  readonly variables: readonly CellMLVariable[]
  readonly units: UnitsDefinitions
}

interface Candidate {
  readonly name: string
  readonly kind: CellMLVariableKind
  readonly ucum: string
  readonly value?: Value
  readonly type?: string
  readonly variable?: ModelVariable
  readonly source?: BondgraphElement | BondgraphJunction
  /** For messages: `variable k of b (#model_b)`, `constant RT of #Chemical`. */
  readonly label: string
}

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * Build the CellML model's units and its `main` component's variables
 * (plan chunk 6.1). Problems are reported in `log`; a variable with one is
 * left out.
 */
export function buildCellMLModel(libcellml: LibCellML, model: BondgraphModel, log: IssueLog): CellMLModelBuild {
  const cellml = new libcellml.Model()
  cellml.setName(cellmlModelName(model.iri))
  const component = new libcellml.Component()
  component.setName(MAIN_COMPONENT)
  component.setId(MAIN_COMPONENT)
  cellml.addComponent(component)
  const units = new UnitsDefinitions(libcellml, cellml)

  const variables: CellMLVariable[] = []
  for (const candidate of collectVariables(libcellml, model, log)) {
    const variable = makeVariable(libcellml, component, units, candidate, log)
    if (variable !== undefined) variables.push(variable)
  }
  cellml.linkUnits()
  return { model: cellml, component, variables, units }
}

/** The variables for `main`, in Python's order, each symbol once. */
function collectVariables(libcellml: LibCellML, model: BondgraphModel, log: IssueLog): Candidate[] {
  const fixed = new Map<string, Candidate>()
  fixed.set(VOI_NAME, { name: VOI_NAME, kind: 'voi', ucum: VOI_UNITS, label: `the variable of integration ${VOI_NAME}` })

  for (const element of model.elements.values()) {
    for (const constant of element.domain.constants) {
      const candidate = constantCandidate(constant, element)
      const known = fixed.get(constant.name)
      if (known === undefined) fixed.set(constant.name, candidate)
      else checkSame(libcellml, known, candidate, log)
    }
  }

  const found = new Map<string, Candidate>()
  const add = (variable: ModelVariable, source: BondgraphElement | BondgraphJunction): void => {
    const candidate: Candidate = {
      name: variable.symbol,
      kind: 'variable',
      ucum: variable.units,
      ...(variable.value === undefined ? {} : { value: variable.value }),
      ...(variable.type === undefined ? {} : { type: variable.type }),
      variable,
      source,
      label: `variable ${variable.symbol} of ${source.symbol} (${prettyUri(source.iri)})`,
    }
    const clash = fixed.get(candidate.name)
    if (clash !== undefined) {
      log.report(`${capitalise(candidate.label)} has the same name as ${clash.label}`, source.iri)
      return
    }
    const known = found.get(candidate.name)
    if (known === undefined) found.set(candidate.name, candidate)
    else if (known.variable !== variable) checkSame(libcellml, known, candidate, log)
  }
  for (const element of model.elements.values()) {
    for (const variable of element.variables.values()) add(variable, element)
  }
  for (const junction of model.junctions.values()) {
    for (const variable of junction.variables.values()) add(variable, junction)
  }

  const sorted = [...found.values()].sort((a, b) => byKey(a.name, b.name))
  return [...fixed.values(), ...sorted]
}

function constantCandidate(constant: VariableDefinition, element: BondgraphElement): Candidate {
  return {
    name: constant.name,
    kind: 'constant',
    ucum: constant.units,
    ...(constant.value === undefined ? {} : { value: constant.value }),
    label: `constant ${constant.name} of ${prettyUri(element.domain.iri)}`,
  }
}

/**
 * Two variables with one symbol become one CellML variable, as in Python,
 * which keeps the first. That's only right if they have the same units and
 * value; report it if they don't.
 */
function checkSame(libcellml: LibCellML, first: Candidate, second: Candidate, log: IssueLog): void {
  let same: boolean
  try {
    same =
      (first.ucum === second.ucum ||
        (compatible(libcellml, first.ucum, second.ucum) && convertValue(libcellml, 1, first.ucum, second.ucum) === 1)) &&
      (first.value === undefined || second.value === undefined
        ? first.value === second.value
        : valueIn(libcellml, first.value, first.ucum) === valueIn(libcellml, second.value, first.ucum))
  } catch {
    same = false
  }
  if (!same) {
    log.report(`${capitalise(second.label)} differs from ${first.label}: ${describe(second)} != ${describe(first)}`, second.source?.iri)
  }
}

const describe = (candidate: Candidate): string =>
  candidate.value === undefined
    ? `units ${candidate.ucum}, no value`
    : `units ${candidate.ucum}, value ${candidate.value.magnitude} ${candidate.value.units ?? candidate.ucum}`

function makeVariable(
  libcellml: LibCellML,
  component: Component,
  units: UnitsDefinitions,
  candidate: Candidate,
  log: IssueLog,
): CellMLVariable | undefined {
  const subject = candidate.source?.iri
  let unitsNameInModel: string
  let initialValue: number | undefined
  try {
    unitsNameInModel = units.unitsFor(candidate.ucum)
    if (candidate.value !== undefined) initialValue = valueIn(libcellml, candidate.value, candidate.ucum)
  } catch (error) {
    const message = error instanceof UcumError ? error.message : String(error)
    log.report(`${capitalise(candidate.label)}: ${message}`, subject, error)
    return undefined
  }
  if (initialValue !== undefined && !Number.isFinite(initialValue)) {
    log.report(`${capitalise(candidate.label)} has a value that isn't a finite number`, subject)
    return undefined
  }

  const id = `${MAIN_COMPONENT}-${candidate.name}`
  const variable = new libcellml.Variable()
  variable.setName(candidate.name)
  variable.setId(id)
  variable.setUnitsByName(unitsNameInModel)
  if (initialValue !== undefined) variable.setInitialValueByDouble(initialValue)
  component.addVariable(variable)
  variable.delete?.()

  return {
    name: candidate.name,
    id,
    kind: candidate.kind,
    ucum: candidate.ucum,
    units: unitsNameInModel,
    ...(initialValue === undefined ? {} : { initialValue }),
    ...(candidate.type === undefined ? {} : { type: candidate.type }),
    ...(candidate.variable === undefined ? {} : { variable: candidate.variable }),
    ...(candidate.source === undefined ? {} : { source: candidate.source }),
  }
}

/** A value in the variable's units. Model values already are (5.4); a constant's may not be. */
function valueIn(libcellml: LibCellML, value: Value, units: string): number {
  return value.units === undefined || value.units === units ? value.magnitude : convertValue(libcellml, value.magnitude, value.units, units)
}

/** Frees a build's libCellML objects. */
export function freeBuild(build: CellMLModelBuild): void {
  build.component.delete?.()
  build.model.delete?.()
}
