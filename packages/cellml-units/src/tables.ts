/**
 * UCUM atoms and prefixes, and their CellML 2.0 equivalents.
 *
 * CellML treats mole as a base unit. That's what we want: strict UCUM treats
 * mol as a dimensionless count, so a UCUM-only check would say `mol/s` is
 * compatible with `/s`.
 */

/** UCUM atom -> CellML 2.0 standard unit name. */
export const UCUM_TO_CELLML_UNIT: Readonly<Record<string, string>> = {
  // Base
  m: 'metre',
  g: 'gram',
  s: 'second',
  A: 'ampere',
  K: 'kelvin',
  mol: 'mole',
  cd: 'candela',
  // Derived
  rad: 'radian',
  sr: 'steradian',
  Hz: 'hertz',
  N: 'newton',
  Pa: 'pascal',
  J: 'joule',
  W: 'watt',
  C: 'coulomb',
  V: 'volt',
  F: 'farad',
  Ohm: 'ohm',
  S: 'siemens',
  Wb: 'weber',
  T: 'tesla',
  H: 'henry',
  lm: 'lumen',
  lx: 'lux',
  Bq: 'becquerel',
  Gy: 'gray',
  Sv: 'sievert',
  kat: 'katal',
  L: 'litre',
  l: 'litre',
  '1': 'dimensionless',
}

/** UCUM prefix -> CellML 2.0 prefix name. */
export const UCUM_TO_CELLML_PREFIX: Readonly<Record<string, string>> = {
  Y: 'yotta',
  Z: 'zetta',
  E: 'exa',
  P: 'peta',
  T: 'tera',
  G: 'giga',
  M: 'mega',
  k: 'kilo',
  h: 'hecto',
  da: 'deca',
  d: 'deci',
  c: 'centi',
  m: 'milli',
  u: 'micro',
  n: 'nano',
  p: 'pico',
  f: 'femto',
  a: 'atto',
  z: 'zepto',
  y: 'yocto',
}
