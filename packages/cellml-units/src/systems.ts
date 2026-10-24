/**
 * Unit systems: the prefixes a model's amount, volume, energy and charge are
 * in, such as fmol, pL, fJ and fC for a cell. Rescaling a code into a system
 * substitutes its symbols for those quantities, uniformly, so every
 * consistent units expression stays consistent: `mol/s` is `fmol/s` and
 * `L/mol` is `pL/fmol`.
 */

import { PREFIX_POWERS, UCUM_PREFIXES } from './tables.js'
import { UcumError, parseUcum, resolveSymbol, type ResolvedSymbol } from './ucum.js'

/** A quantity a unit system sets the prefix of. */
export type UnitKind = 'amount' | 'volume' | 'energy' | 'charge'

/** The preset unit systems' ids. */
export type UnitSystemId = 'si' | 'cellular'

export interface UnitSystem {
  readonly id: UnitSystemId
  readonly label: string
  /** Each kind's prefix, as a power of ten. */
  readonly prefixes: Readonly<Record<UnitKind, number>>
}

/**
 * The preset unit systems: SI (mol, L, J, C), and Cellular (fmol, pL, fJ,
 * fC). Energy and charge follow the amount, so potentials keep their scale:
 * fJ/fmol is J/mol and fJ/fC is V.
 */
export const UNIT_SYSTEMS: ReadonlyMap<UnitSystemId, UnitSystem> = new Map([
  ['si', { id: 'si', label: 'SI (mol, L)', prefixes: { amount: 0, volume: 0, energy: 0, charge: 0 } }],
  ['cellular', { id: 'cellular', label: 'Cellular (fmol, pL)', prefixes: { amount: -15, volume: -12, energy: -15, charge: -15 } }],
])

/** The preset with an id, or `undefined` for an unknown id. */
export function unitSystem(id: string): UnitSystem | undefined {
  return UNIT_SYSTEMS.get(id as UnitSystemId)
}

/** Whether a system leaves every code as it is. */
export function isStockUnitSystem(system: UnitSystem | UnitSystemId): boolean {
  const { prefixes } = systemOf(system)
  return Object.values(prefixes).every((power) => power === 0)
}

/** The symbol for each kind, and the CellML units its symbols resolve to. */
const KIND_SYMBOLS: Readonly<Record<UnitKind, string>> = { amount: 'mol', volume: 'L', energy: 'J', charge: 'C' }
const BASE_KINDS: ReadonlyMap<string, UnitKind> = new Map([
  ['mole', 'amount'],
  ['litre', 'volume'],
  ['joule', 'energy'],
  ['coulomb', 'charge'],
])

/**
 * Other CellML units made of energy, charge or amount, as powers of each.
 * A code using one can't be rescaled by substitution unless the system
 * leaves it unscaled, as Cellular leaves volt (fJ/fC).
 */
const DERIVED_KINDS: ReadonlyMap<string, Partial<Record<UnitKind, number>>> = new Map(
  Object.entries({
    joule: { energy: 1 },
    newton: { energy: 1 },
    pascal: { energy: 1 },
    watt: { energy: 1 },
    gray: { energy: 1 },
    sievert: { energy: 1 },
    ampere: { charge: 1 },
    volt: { energy: 1, charge: -1 },
    weber: { energy: 1, charge: -1 },
    tesla: { energy: 1, charge: -1 },
    farad: { charge: 2, energy: -1 },
    siemens: { charge: 2, energy: -1 },
    ohm: { energy: 1, charge: -2 },
    henry: { energy: 1, charge: -2 },
    katal: { amount: 1 },
    mole: { amount: 1 },
    litre: { volume: 1 },
    coulomb: { charge: 1 },
  }),
)

/** Each power of ten's UCUM prefix symbol. */
const PREFIX_SYMBOLS: ReadonlyMap<number, string> = new Map([...UCUM_PREFIXES].map(([symbol, name]) => [PREFIX_POWERS.get(name)!, symbol]))

const systemOf = (system: UnitSystem | UnitSystemId): UnitSystem => {
  if (typeof system !== 'string') return system
  const found = UNIT_SYSTEMS.get(system)
  if (found === undefined) throw new UcumError(`Unknown unit system "${system}"`, { reason: 'unit-system', code: '' })
  return found
}

/** The kind a symbol is, if it is one a system substitutes: mol, L, J or C with any prefix, but not `cal`. */
function baseKind(symbol: ResolvedSymbol): UnitKind | undefined {
  return symbol.atom !== undefined && symbol.atom.factor === 1 ? BASE_KINDS.get(symbol.atom.units) : undefined
}

/** A code in a system, and the factor that takes a value in the code to one in the new code. */
export interface RescaledUnits {
  readonly code: string
  readonly factor: number
}

/**
 * A UCUM code in a unit system's units, and the factor for its values.
 *
 * - Each mol, L, J or C symbol, with any prefix, becomes the system's (`mol-1`
 *   is `fmol-1`, `L2.s-1.J-1` is `pL2.s-1.fJ-1`); `eq` and `osm` are amounts.
 *   Other symbols are kept, as is the code's own layout.
 * - A code the substitution leaves with the same scale is returned as it was
 *   given, so `J/mol` stays `J/mol` in Cellular, not `fJ/fmol`, and `factor` is 1.
 * - A value `x` in `code` is `x × factor` in the new code: 1 mol is 1e15 fmol.
 * - SI maps prefixed symbols to unprefixed ones: `mmol` is `mol`, with a factor of 1e-3.
 *
 * Throws a `UcumError` for a code it can't read, and (with `reason`
 * `unit-system`) for one with other symbols the system scales, such as `A`
 * or `N` in Cellular: write those in mol, L, J and C.
 */
export function rescaleUnits(code: string, system: UnitSystem | UnitSystemId): RescaledUnits {
  const { prefixes } = systemOf(system)
  const units = parseUcum(code)

  let shift = 0
  for (const symbol of units.symbols) {
    const kind = baseKind(symbol)
    if (kind !== undefined) {
      shift += (prefixes[kind] - (symbol.prefix ?? 0)) * symbol.exponent
      continue
    }
    const kinds = symbol.atom === undefined ? undefined : DERIVED_KINDS.get(symbol.atom.units)
    const scale = Object.entries(kinds ?? {}).reduce((total, [k, power]) => total + prefixes[k as UnitKind] * power, 0)
    if (scale !== 0) {
      throw new UcumError(`"${symbol.label}" in "${code}" can't be rescaled into the unit system; write it in mol, L, J and C`, {
        reason: 'unit-system',
        code,
        symbol: symbol.label,
      })
    }
  }
  if (shift === 0) return { code, factor: 1 }

  const rewritten = code.replace(/\{[^{}]*\}|(?:\[[^[\]]*\]|[A-Za-z0-9_%])+(?:[+-]\d+)?/g, (token) => {
    if (token.startsWith('{') || /^\d+$/.test(token)) return token
    const symbol = resolveSymbol(token)
    const kind = symbol === null ? undefined : baseKind(symbol)
    if (kind === undefined) return token
    return `${PREFIX_SYMBOLS.get(prefixes[kind]) ?? ''}${KIND_SYMBOLS[kind]}${token.slice(symbol!.label.length)}`
  })
  return { code: rewritten, factor: Number(`1e${-shift}`) }
}

/** A UCUM code in a unit system's units; see `rescaleUnits`. */
export function rescaleCode(code: string, system: UnitSystem | UnitSystemId): string {
  return rescaleUnits(code, system).code
}

/** The factor that takes a value in a UCUM code to one in `rescaleCode(code, system)`; see `rescaleUnits`. */
export function rescaleFactor(code: string, system: UnitSystem | UnitSystemId): number {
  return rescaleUnits(code, system).factor
}
