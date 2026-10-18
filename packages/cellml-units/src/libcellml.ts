/**
 * The parts of the libcellml.js API these packages use. libcellml.js ships
 * no type declarations, so we describe only what we call.
 *
 * The host application loads the WebAssembly module once and passes it in.
 * PhLynx does this through vue3-libcellml.js; in Node it is
 * `await (await import('libcellml.js')).default()`.
 */

export interface Units {
  name(): string
  setName(name: string): void
  unitCount(): number
  addUnitByReferenceStringPrefix(reference: string, prefix: string, exponent: number, multiplier: number, id: string): void
  addUnitByReferenceExponent(reference: string, exponent: number, id: string): void
  unitAttributeReference(index: number): string
  unitAttributePrefix(index: number): string
  unitAttributeExponent(index: number): number
  unitAttributeMultiplier(index: number): number
  delete?(): void
}

export interface UnitsConstructor {
  new (name?: string): Units
  compatible(a: Units, b: Units): boolean
  equivalent(a: Units, b: Units): boolean
  /**
   * The factor to multiply a value in `b` by to get it in `a`: `scalingFactor(uF, F)` is 1e6.
   * 0 when `checkCompatibility` is true and the units aren't compatible.
   */
  scalingFactor(a: Units, b: Units, checkCompatibility: boolean): number
}

/** A CellML variable. libcellml.js constructors take no arguments, so name it with `setName`. */
export interface Variable {
  name(): string
  setName(name: string): void
  id(): string
  setId(id: string): void
  units(): Units | null
  setUnitsByName(name: string): void
  setUnitsByUnits(units: Units): void
  initialValue(): string
  setInitialValueByDouble(value: number): void
  delete?(): void
}

export interface Component {
  name(): string
  setName(name: string): void
  id(): string
  setId(id: string): void
  addVariable(variable: Variable): boolean
  variableCount(): number
  variableByIndex(index: number): Variable | null
  variableByName(name: string): Variable | null
  delete?(): void
}

export interface Model {
  name(): string
  setName(name: string): void
  addUnits(units: Units): boolean
  unitsCount(): number
  unitsByIndex(index: number): Units | null
  unitsByName(name: string): Units | null
  hasUnitsByName(name: string): boolean
  addComponent(component: Component): boolean
  componentCount(): number
  componentByIndex(index: number): Component | null
  componentByName(name: string, searchEncapsulated: boolean): Component | null
  /** Points variables' units given by name at the model's units of that name. */
  linkUnits(): boolean
  hasUnlinkedUnits(): boolean
  delete?(): void
}

/** An issue from a Parser, Validator or Analyser. */
export interface LoggerIssue {
  description(): string
  delete?(): void
}

/** What Parser, Validator and Analyser share: a list of issues. */
export interface Logger {
  issueCount(): number
  issue(index: number): LoggerIssue
  delete?(): void
}

export interface Parser extends Logger {
  parseModel(cellml: string): Model
}

export interface Printer {
  printModel(model: Model, autoIds: boolean): string
  delete?(): void
}

export interface LibCellML {
  versionString(): string
  Units: UnitsConstructor
  Model: new () => Model
  Component: new () => Component
  Variable: new () => Variable
  /** `strict` false also reads CellML 1.0 and 1.1, converting them to CellML 2.0. */
  Parser: new (strict: boolean) => Parser
  Printer: new () => Printer
  // Validator, Analyser, ... are added as bg2cellml needs them.
  readonly [name: string]: unknown
}
