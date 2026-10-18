import type { LibCellML, Units } from './libcellml.js'
import { PREFIX_NAMES } from './tables.js'
import { UcumError, nameUnits, parseUcum, type UcumUnits } from './ucum.js'

/**
 * The CellML built-in units a single resolved symbol is exactly, if any:
 * `F` is `farad`, `s` is `second`, `kg` is `kilogram`. A prefix, an exponent
 * or a scale (`mF`, `s2`, `min`, `%`) means it isn't.
 */
export function builtInUnits(units: UcumUnits): string | undefined {
  const [only] = units.symbols
  if (units.symbols.length !== 1 || units.factor !== 1 || only!.exponent !== 1) return undefined
  const atom = only!.atom
  if (atom === undefined || atom.factor !== 1) return undefined
  if (only!.prefix === 0) return atom.units
  // kilogram is CellML's one prefixed built-in units
  return atom.units === 'gram' && only!.prefix === 3 ? 'kilogram' : undefined
}

/**
 * The CellML name for a UCUM units expression.
 *
 * - An expression that is exactly a CellML built-in units is that units, so it
 *   needs no definition: `F` is `farad`, `mol` is `mole`, `kg` is `kilogram`.
 * - Otherwise the name is PhLynx's: `mol/s` is `mol_per_s`, `L2.s-1.J-1` is
 *   `L2_per_s_per_J`, `mm[Hg]` is `mmHg`, `10*9/L` is `giga_per_L`.
 * - An expression that is exactly a units name the caller already has
 *   (`names`), or an affine temperature (`Cel`), is that name.
 * - An expression whose symbols cancel to nothing (`1`, `m/m`) is `dimensionless`.
 * - Every name is a valid CellML identifier. Equal expressions give equal names;
 *   making names unique within a model is the caller's job (`uniqueName`).
 */
export function unitsName(code: string | UcumUnits, names: ReadonlySet<string> = new Set()): string {
  const units = typeof code === 'string' ? parseUcum(code, names) : code
  const builtIn = builtInUnits(units)
  if (builtIn !== undefined) return builtIn
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

//==============================================================================
// libCellML units

/** CellML's prefix name for a power of ten; `''` for none. */
const prefixName = (power: number): string => (power === 0 ? '' : PREFIX_NAMES.get(power)!)

/** Rounds away floating-point noise, as in `0.29 × 100 = 28.999999999999996`. */
const roundValue = (value: number): number => Number(value.toPrecision(15))

/**
 * libCellML Units holding the expression's symbols as CellML units: each
 * built-in units with its prefix and exponent, and every factor (the
 * expression's own, and those of symbols such as `min` and `mm[Hg]`) in the
 * first unit's multiplier. CellML applies a prefix before the exponent and
 * the multiplier after it, so `mm[Hg]2` is `133322² × (milli pascal)²`.
 * Symbols from a units library are referenced by name.
 */
function buildUnits(libcellml: LibCellML, units: UcumUnits, name: string): Units {
  const affine = units.symbols.find((symbol) => symbol.affine !== undefined)
  if (affine !== undefined) {
    throw new UcumError(`"${affine.label}" in "${units.code}" is an affine temperature, which CellML 2.0 can't express; use K`, {
      reason: 'affine',
      code: units.code,
      symbol: affine.label,
    })
  }

  let multiplier = units.factor
  for (const { atom, exponent } of units.symbols) multiplier *= (atom?.factor ?? 1) ** exponent

  const cellml = new libcellml.Units(name)
  const parts =
    units.symbols.length > 0
      ? units.symbols.map((s) => ({ reference: s.library ?? s.atom!.units, prefix: s.prefix ?? 0, exponent: s.exponent }))
      : [{ reference: 'dimensionless', prefix: 0, exponent: 1 }]
  parts.forEach(({ reference, prefix, exponent }, index) => {
    cellml.addUnitByReferenceStringPrefix(reference, prefixName(prefix), exponent, index === 0 ? multiplier : 1, '')
  })
  return cellml
}

/**
 * The libCellML Units to add to a model for a UCUM code, named `name`
 * (`unitsName(code)` by default), or `undefined` when the code is exactly a
 * CellML built-in units (`F`, `mol`, `kg`) or is dimensionless (`1`, `m/m`):
 * there is nothing to define, and a variable just uses `unitsName(code)`.
 *
 * Symbols are CellML built-in units with a prefix and exponent; `10*n`,
 * integers and the factors of symbols such as `min` and `mm[Hg]` become the
 * first unit's multiplier (libCellML's Printer writes it to 15 significant
 * figures); a factor with no symbols (`10*3`) is a scaled `dimensionless`.
 * A symbol that is a units name in `names` refers to those units.
 *
 * Throws a `UcumError` for codes CellML can't express: arbitrary units
 * (`[iU]`) and logarithmic units (`[pH]`) when parsed, and affine
 * temperatures (`Cel`) here; `error.reason` says which.
 */
export function toCellMLUnits(
  libcellml: LibCellML,
  code: string | UcumUnits,
  name?: string,
  names: ReadonlySet<string> = new Set(),
): Units | undefined {
  const units = typeof code === 'string' ? parseUcum(code, names) : code
  const defaultName = unitsName(units)
  if (builtInUnits(units) !== undefined || defaultName === 'dimensionless') return undefined
  return buildUnits(libcellml, units, name ?? defaultName)
}

/** Runs `use` on libCellML Units for two codes, then frees them. Library units can't be resolved here, so they throw. */
function withUnits<T>(libcellml: LibCellML, a: string | UcumUnits, b: string | UcumUnits, use: (a: Units, b: Units) => T): T {
  const parse = (code: string | UcumUnits): UcumUnits => {
    const units = typeof code === 'string' ? parseUcum(code) : code
    const library = units.symbols.find((symbol) => symbol.library !== undefined)
    if (library !== undefined) {
      throw new UcumError(`Can't compare "${units.code}": "${library.label}" is a library units`, {
        reason: 'library',
        code: units.code,
        symbol: library.label,
      })
    }
    return units
  }
  // Always build a definition, even for a built-in: libCellML 0.7.1 gives a
  // scaling factor of 1 between bare kilogram and bare gram.
  const unitsA = buildUnits(libcellml, parse(a), 'a')
  try {
    const unitsB = buildUnits(libcellml, parse(b), 'b')
    try {
      return use(unitsA, unitsB)
    } finally {
      unitsB.delete?.()
    }
  } finally {
    unitsA.delete?.()
  }
}

/** True when values in the two codes can be converted, by libCellML's `Units.compatible`: `mmol/s` and `mol/s` are, `mol/s` and `/s` aren't. */
export function compatible(libcellml: LibCellML, a: string | UcumUnits, b: string | UcumUnits): boolean {
  return withUnits(libcellml, a, b, (unitsA, unitsB) => libcellml.Units.compatible(unitsA, unitsB))
}

/**
 * Convert a value between two compatible codes, using libCellML's
 * `Units.scalingFactor`: `1000 uF` is `0.001 F`. The result is rounded to 15
 * significant figures so floating-point noise doesn't reach the CellML.
 * Incompatible codes throw a `UcumError`.
 *
 * The Python bg2cellml only checks compatibility and never converts, so it
 * writes `1000` as an initial value in farads.
 */
export function convertValue(libcellml: LibCellML, value: number, from: string | UcumUnits, to: string | UcumUnits): number {
  return withUnits(libcellml, from, to, (unitsFrom, unitsTo) => {
    if (!libcellml.Units.compatible(unitsFrom, unitsTo)) {
      throw new UcumError(`Can't convert from "${codeOf(from)}" to "${codeOf(to)}": the units aren't compatible`, {
        reason: 'incompatible',
        code: codeOf(from),
      })
    }
    // scalingFactor(a, b) multiplies a value in b to give it in a
    return roundValue(value * libcellml.Units.scalingFactor(unitsTo, unitsFrom, false))
  })
}

const codeOf = (code: string | UcumUnits): string => (typeof code === 'string' ? code : code.code)
