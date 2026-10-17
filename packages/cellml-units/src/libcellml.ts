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
  delete?(): void
}

export interface UnitsConstructor {
  new (name?: string): Units
  compatible(a: Units, b: Units): boolean
  equivalent(a: Units, b: Units): boolean
  /** The factor to multiply a value in `a` by to get it in `b`. Check the direction against the tests. */
  scalingFactor(a: Units, b: Units, checkCompatibility: boolean): number
}

export interface LibCellML {
  versionString(): string
  Units: UnitsConstructor
  // Model, Component, Variable, Printer, Validator, ... are added as bg2cellml needs them.
  readonly [name: string]: unknown
}
