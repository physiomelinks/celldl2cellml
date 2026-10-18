import type { LibCellML, Units } from './libcellml.js'
import { nameUnits, parseUcum, type UcumUnits } from './ucum.js'

/**
 * The CellML name for a UCUM units expression, as PhLynx names it:
 * `mol/s` is `mol_per_s`, `L2.s-1.J-1` is `L2_per_s_per_J`, `mm[Hg]` is
 * `mmHg`, `10*9/L` is `giga_per_L`.
 *
 * - An expression that is exactly a units name the caller already has
 *   (`names`), or an affine temperature (`Cel`), is that name.
 * - An expression whose symbols cancel to nothing (`1`, `m/m`) is `dimensionless`.
 * - Every name is a valid CellML identifier. Equal expressions give equal names;
 *   making names unique within a model is the caller's job (`uniqueName`).
 */
export function unitsName(code: string | UcumUnits, names: ReadonlySet<string> = new Set()): string {
  const units = typeof code === 'string' ? parseUcum(code, names) : code
  const [only] = units.symbols
  if (units.symbols.length === 1 && units.factor === 1 && only!.exponent === 1 && only!.atom === undefined) {
    return only!.library ?? only!.affine!
  }
  if (units.factor === 1 && cancelsOut(units)) return 'dimensionless'
  return nameUnits(units.symbols, units.factor) || 'units'
}

/** Whether every UCUM symbol cancels, as in `m/m` or `1`. Library units are never assumed to cancel. */
function cancelsOut(units: UcumUnits): boolean {
  const totals = new Map<string, number>()
  let scale = 1
  for (const s of units.symbols) {
    if (s.atom === undefined) return false
    scale *= s.atom.factor ** s.exponent
    if (s.atom.units === 'dimensionless') continue
    const key = `${s.atom.units}:${s.prefix ?? 0}`
    totals.set(key, (totals.get(key) ?? 0) + s.exponent)
  }
  return Number(scale.toPrecision(12)) === 1 && [...totals.values()].every((exponent) => Math.abs(exponent) < 1e-12)
}

/**
 * Build libCellML Units for a UCUM code: CellML built-in units with their
 * prefixes and exponents, and any scale as the first unit's multiplier.
 *
 * To do (chunk 3.2).
 */
export function toCellMLUnits(_libcellml: LibCellML, _code: string | UcumUnits, _name?: string): Units {
  throw new Error('toCellMLUnits() is not implemented yet')
}

/** True when values in the two codes can be converted, using libCellML's `Units.compatible`. To do (chunk 3.3). */
export function compatible(_libcellml: LibCellML, _a: string, _b: string): boolean {
  throw new Error('compatible() is not implemented yet')
}

/**
 * Convert a value between two compatible codes, such as `1000 uF` to farads.
 * The Python bg2cellml only checks compatibility and never converts, so it
 * writes `1000` as an initial value in farads. To do (chunk 3.3).
 */
export function convertValue(_libcellml: LibCellML, _value: number, _from: string, _to: string): number {
  throw new Error('convertValue() is not implemented yet')
}
