/**
 * UCUM symbols and prefixes, and what each one is in CellML's built-in units.
 *
 * Ported from PhLynx (`src/utils/unitExpression.js`, `src/utils/units.js`), so
 * both read units expressions the same way.
 *
 * CellML treats mole as a base unit. That's what we want: strict UCUM treats
 * mol as a dimensionless count, so a UCUM-only check would say `mol/s` is
 * compatible with `/s`.
 */

/** A UCUM symbol as `factor × CellML built-in units`. Only metric symbols take a prefix. */
export interface UcumAtom {
  /** A CellML 2.0 built-in units name. */
  readonly units: string
  readonly factor: number
  readonly metric: boolean
}

const metric = (units: string, factor = 1): UcumAtom => ({ units, factor, metric: true })
const plain = (units: string, factor = 1): UcumAtom => ({ units, factor, metric: false })

// prettier-ignore
const ATOMS: [string, UcumAtom][] = Object.entries({
  m: metric('metre'), g: metric('gram'), s: metric('second'), A: metric('ampere'), K: metric('kelvin'),
  mol: metric('mole'), cd: metric('candela'), L: metric('litre'), l: metric('litre'), Hz: metric('hertz'),
  N: metric('newton'), Pa: metric('pascal'), J: metric('joule'), W: metric('watt'), C: metric('coulomb'),
  V: metric('volt'), F: metric('farad'), Ohm: metric('ohm'), S: metric('siemens'), Wb: metric('weber'),
  T: metric('tesla'), H: metric('henry'), lm: metric('lumen'), lx: metric('lux'), Bq: metric('becquerel'),
  Gy: metric('gray'), Sv: metric('sievert'), kat: metric('katal'), rad: metric('radian'), sr: metric('steradian'),
  eq: metric('mole'), osm: metric('mole'),
  min: plain('second', 60), h: plain('second', 3600), d: plain('second', 86400),
  'm[Hg]': metric('pascal', 133322), 'm[H2O]': metric('pascal', 9806.65),
  cal: metric('joule', 4.184), bar: metric('pascal', 1e5), atm: plain('pascal', 101325),
  '%': plain('dimensionless', 0.01), '[ppm]': plain('dimensionless', 1e-6), '[pi]': plain('dimensionless', Math.PI),
})

/** UCUM symbols. Bracketed symbols also match without their brackets, so `mmHg` and `cmH2O` are understood. */
export const UCUM_ATOMS: ReadonlyMap<string, UcumAtom> = new Map([
  ...ATOMS,
  ...ATOMS.filter(([symbol]) => symbol.includes('[')).map(([symbol, atom]) => [symbol.replace(/[[\]]/g, ''), atom] as [string, UcumAtom]),
])

/** UCUM's prefix symbols and the CellML prefix each one names. */
// prettier-ignore
export const UCUM_PREFIXES: ReadonlyMap<string, string> = new Map(Object.entries({
  Y: 'yotta', Z: 'zetta', E: 'exa', P: 'peta', T: 'tera', G: 'giga', M: 'mega', k: 'kilo', h: 'hecto', da: 'deca',
  d: 'deci', c: 'centi', m: 'milli', u: 'micro', n: 'nano', p: 'pico', f: 'femto', a: 'atto', z: 'zepto', y: 'yocto',
}))

/** Each CellML prefix name's power of ten. */
// prettier-ignore
export const PREFIX_POWERS: ReadonlyMap<string, number> = new Map(Object.entries({
  yotta: 24, zetta: 21, exa: 18, peta: 15, tera: 12, giga: 9, mega: 6, kilo: 3, hecto: 2, deca: 1, deka: 1,
  deci: -1, centi: -2, milli: -3, micro: -6, nano: -9, pico: -12, femto: -15, atto: -18, zepto: -21, yocto: -24,
}))

/** Each power of ten's CellML prefix name. */
export const PREFIX_NAMES: ReadonlyMap<number, string> = new Map(
  [...PREFIX_POWERS].filter(([name]) => name !== 'deka').map(([name, power]) => [power, name]),
)

/** UCUM's affine temperature symbols and the units each one names. CellML 2.0 has no built-in units for these. */
export const AFFINE_SYMBOLS: ReadonlyMap<string, string> = new Map([
  ['Cel', 'celsius'],
  ['[degF]', 'fahrenheit'],
  ['degF', 'fahrenheit'],
])

/**
 * UCUM's arbitrary units: amounts of a substance measured by its effect,
 * which have no fixed relation to any other units. They take prefixes.
 */
// prettier-ignore
export const ARBITRARY_SYMBOLS: ReadonlySet<string> = new Set([
  '[iU]', '[IU]', "[arb'U]", "[USP'U]", "[GPL'U]", "[MPL'U]", "[APL'U]", "[beth'U]", "[anti'Xa'U]", "[todd'U]",
  "[dye'U]", "[smgy'U]", "[bdsk'U]", "[ka'U]", "[knk'U]", "[mclg'U]", "[tb'U]", '[CCID_50]', '[TCID_50]', '[EID_50]',
  '[PFU]', '[FFU]', '[CFU]', '[IR]', '[BAU]', '[AU]', "[Amb'a'1'U]", '[PNU]', '[Lf]', "[D'ag'U]", '[FEU]', '[ELU]', '[EU]',
])

/** UCUM's logarithmic units, which no CellML units multiplier can express. Neper and bel take prefixes (`dB`). */
// prettier-ignore
export const LOGARITHMIC_SYMBOLS: ReadonlySet<string> = new Set([
  '[pH]', 'Np', 'B', 'B[SPL]', 'B[V]', 'B[mV]', 'B[uV]', 'B[10.nV]', 'B[W]', 'B[kW]',
])

/** CellML 2.0's built-in units. */
export const CELLML_BUILT_IN_UNITS: ReadonlySet<string> = new Set([
  'ampere', 'becquerel', 'candela', 'coulomb', 'dimensionless', 'farad', 'gram', 'gray', 'henry', 'hertz', 'joule',
  'katal', 'kelvin', 'kilogram', 'litre', 'lumen', 'lux', 'metre', 'mole', 'newton', 'ohm', 'pascal', 'radian',
  'second', 'siemens', 'sievert', 'steradian', 'tesla', 'volt', 'watt', 'weber',
])
