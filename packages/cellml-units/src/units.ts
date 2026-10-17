import type { LibCellML, Units } from './libcellml.js'
import type { UcumTerm } from './ucum.js'

/**
 * A valid CellML identifier for a UCUM code, such as `mol/s` -> `mol_per_s`.
 * Equal codes must always give the same name.
 *
 * To do: decide the naming scheme. bg2cellml's current names come from pint's
 * formatting (`mole_per_second`); we don't have to keep them.
 */
export function unitsName(_code: string): string {
  throw new Error('unitsName() is not implemented yet')
}

/**
 * Build libCellML Units for a UCUM code. Atoms come from UCUM_TO_CELLML_UNIT,
 * prefixes from UCUM_TO_CELLML_PREFIX, and `10*n` becomes a multiplier.
 *
 * To do: atoms that aren't CellML standard units (`[pi]`, `%`, `Cel`) need their
 * own units definitions or should be reported as unsupported.
 */
export function toCellMLUnits(_libcellml: LibCellML, _code: string | readonly UcumTerm[], _name?: string): Units {
  throw new Error('toCellMLUnits() is not implemented yet')
}

/** True when values in the two codes can be converted, using libCellML's `Units.compatible`. */
export function compatible(_libcellml: LibCellML, _a: string, _b: string): boolean {
  throw new Error('compatible() is not implemented yet')
}

/**
 * Convert a value between two compatible codes, such as `1000 uF` to farads.
 * The Python bg2cellml only checks compatibility and never converts, so it
 * writes `1000` as an initial value in farads.
 */
export function convertValue(_libcellml: LibCellML, _value: number, _from: string, _to: string): number {
  throw new Error('convertValue() is not implemented yet')
}
