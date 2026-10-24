# @physiomelinks/cellml-units

Turns [UCUM](https://ucum.org/) units expressions into CellML 2.0 units, names them, and compares and converts them with [libCellML](https://libcellml.org/).

It replaces pint and ucumvert in the Python [bg2cellml](https://github.com/CellDL/BG-Tools). Reading and naming units is ported from [PhLynx](https://github.com/physiomelinks/PhLynx) (`src/utils/unitExpression.js`), so units read and named here match PhLynx's. Compatibility and scaling come from libCellML, so mole is a base unit, as CellML has it; strict UCUM treats mol as a dimensionless count. It has no runtime dependencies; libcellml.js is a peer dependency.

## Usage

```sh
npm install @physiomelinks/cellml-units libcellml.js
```

```js
import { compatible, convertValue, parseUcum, toCellMLUnits, unitsName } from '@physiomelinks/cellml-units'

unitsName('mol/s')        // 'mol_per_s'
unitsName('L2.s-1.J-1')   // 'L2_per_s_per_J'
unitsName('mm[Hg]')       // 'mmHg'
unitsName('10*9/L')       // 'giga_per_L'

parseUcum('mL/s')         // { code, factor: 1, symbols: [{ label: 'mL', exponent: 1, atom: { units: 'litre', … }, prefix: -3 }, …] }

// libcellml is the loaded libcellml.js module
toCellMLUnits(libcellml, 'mmol/s')          // Units mmol_per_s: milli mole, second^-1
toCellMLUnits(libcellml, 'F')               // undefined: farad is built in
compatible(libcellml, 'mol/s', '/s')        // false
convertValue(libcellml, 1000, 'uF', 'F')    // 0.001
```

## What it covers

| Area | Functions | Status |
|---|---|---|
| Reading UCUM | `parseUnitExpression`, `resolveSymbol` (PhLynx's), `parseUcum` (throws a `UcumError`) | Done |
| Symbols | `UCUM_ATOMS`, `UCUM_PREFIXES`, `PREFIX_POWERS`, `AFFINE_SYMBOLS`, `ARBITRARY_SYMBOLS`, `LOGARITHMIC_SYMBOLS`, `CELLML_BUILT_IN_UNITS` | Done |
| Naming | `unitsName`, `builtInUnits`, `nameUnits`, `sanitiseName`, `uniqueName` | Done |
| Building units | `toCellMLUnits` | Done |
| Comparing and converting | `compatible`, `convertValue` | Done |
| Unit systems | `UNIT_SYSTEMS`, `unitSystem`, `rescaleUnits`, `rescaleCode`, `rescaleFactor` | Done |

## Reading

As PhLynx reads them:

- **Operators:** `.` multiplies and `/` divides, left to right, so `mmol/L.s` is (mmol/L)·s. Brackets group, and a leading `/` is one over.
- **Exponents** follow their symbol: `m2`, `s-1`. `10*3` and plain integers are factors.
- **Annotations** such as `{RBC}` are dropped; one on its own counts as 1, as in `{cells}/mL`.
- **Symbols:** the SI units, `L`, `eq` and `osm`, and the non-SI units `min`, `h`, `d`, `mm[Hg]`, `cm[H2O]`, `cal`, `bar`, `atm`, `%`, `[ppm]` and `[pi]`, each with its factor in CellML's built-in units. Bracketed symbols also work without brackets (`mmHg`). Only metric symbols take a prefix.
- **Known names:** a units name the caller already has, such as one from a units library, is passed in `names` and takes precedence over UCUM.
- **Affine temperatures:** `Cel` and `[degF]` are read and named (`celsius`), but can't be turned into CellML units (see below).

## Naming

`unitsName` names units as PhLynx does: the symbols as written, positive powers first, then `per_` and each negative power. The one deliberate difference: a code that is exactly a CellML built-in units, such as `F`, is named as that units (`farad`), so the model needs no units definition for it. PhLynx names it `F` and defines `F` as farad. `builtInUnits` gives the built-in name, if there is one. A prefix, an exponent, a scale or a second symbol (`mF`, `s2`, `min`, `C/s`) still needs a definition. Compound codes keep the names the modeller wrote, even when they equal a built-in units: `C/s` is `C_per_s`, not `ampere`. libCellML compares units by what they are, not by name.

| Code | Name |
|---|---|
| `F`, `mol`, `kg` | `farad`, `mole`, `kilogram` (CellML built-in units) |
| `mol/s` | `mol_per_s` |
| `L2.s-1.J-1` | `L2_per_s_per_J` |
| `J.s.C-1.m-1` | `J_s_per_C_per_m` |
| `mol-1` | `per_mol` |
| `uF` | `uF` |
| `m.m/s` | `m2_per_s` (repeated symbols combine) |
| `10*9/L` | `giga_per_L` (a factor gets a prefix word where there is one) |
| `mm[Hg]` | `mmHg` |
| `1`, `m/m` | `dimensionless` |

Every name is a valid CellML identifier, and equal expressions get equal names. `uniqueName` adds `_1`, `_2`, ... when a name is already taken in a model.

A test checks `unitsName` against PhLynx's own output for every BG-RDF units code and 15 harder cases (`test/fixtures/phlynx-names.json`, from PhLynx commit 68bf007), except the 11 codes that are built-in units.

## Building units

`toCellMLUnits` gives the libCellML `Units` to add to a model, named `unitsName(code)` unless given a name.

- Each symbol is a CellML built-in units with its prefix and exponent: `mmol/s` is milli `mole` and `second` to the -1.
- Every factor, from `10*n`, integers and symbols such as `min` and `mm[Hg]`, goes in the first unit's multiplier. CellML applies a prefix before the exponent and the multiplier after it.
- A factor with no symbols (`10*3`) is a scaled `dimensionless`.
- A code that is a built-in units (`F`, `kg`) or dimensionless (`1`, `m/m`) gives `undefined`: there is nothing to define, and the variable uses `unitsName(code)`.
- A symbol named in `names` refers to those units by name.
- Affine temperatures (`Cel`) throw a `UcumError`.

A test builds a model with the units for every BG-RDF code, and for `mmol/s`, `mL`, `uF` and other harder codes, and libCellML's Validator finds no issues.

## Comparing and converting

`compatible` and `convertValue` use libCellML's `Units.compatible` and `Units.scalingFactor`, so units are compared by what they are, not by name: `C/s` is compatible with `A`, and `mol/s` isn't with `/s`.

- `convertValue(libcellml, value, from, to)` gives the value in `to`: 1000 `uF` is 0.001 `F`, 0.01 `kOhm` is 10 `Ohm`, 10000 `mV` is 10 `V`. Incompatible codes throw a `UcumError`.
- Results are rounded to 15 significant figures, so floating-point noise (0.29 × 100 = 28.999999999999996) doesn't reach the CellML.
- `scalingFactor(a, b)` is the factor that takes a value in `b` to `a`; a test pins this down.
- libCellML 0.7.1 gives a scaling factor of 1 between bare `kilogram` and bare `gram`, so both sides are always built as definitions that refer to the built-in units.
- Codes are read as UCUM only. Units from a library can't be resolved here, so a `UcumUnits` holding one throws.

## Unit systems

`rescaleUnits(code, system)` gives a code in a unit system's units, and the factor for its values. The presets in `UNIT_SYSTEMS` are `si` (mol, L, J, C) and `cellular` (fmol, pL, fJ, fC).

```js
rescaleUnits('mol', 'cellular')          // { code: 'fmol', factor: 1e15 }
rescaleCode('L2.s-1.J-1', 'cellular')    // 'pL2.s-1.fJ-1'
rescaleCode('J/mol', 'cellular')         // 'J/mol': fJ/fmol has the same scale
rescaleFactor('mol-1', 'cellular')       // 1e-15
```

- Each mol, L, J and C symbol, with any prefix, becomes the system's; `eq` and `osm` are amounts. Other symbols and the code's layout are kept.
- A code whose scale doesn't change is returned as given, with a factor of 1, so potentials keep their names.
- Other symbols the system would scale, such as `A`, `F` or `N` in Cellular, throw a `UcumError` with `reason` `unit-system`.
- SI unprefixes: `rescaleUnits('mmol/s', 'si')` is `{ code: 'mol/s', factor: 1e-3 }`.

## Units CellML can't express

Every failure throws a `UcumError` whose message names the symbol and the code, with `reason`, `code` and `symbol` properties for the caller:

| `reason` | Example | Thrown by |
|---|---|---|
| `syntax` | `m^2` | reading |
| `unknown` | `furlong` | reading |
| `arbitrary` | `[iU]/L`, `m[IU]`, `[CFU]` | reading |
| `logarithmic` | `[pH]`, `dB`, `B[SPL]` | reading |
| `affine` | `Cel`, `[degF]` | `toCellMLUnits`, `compatible`, `convertValue` |
| `library` | a library units passed to `compatible` | `compatible`, `convertValue` |
| `incompatible` | `F` to `H` | `convertValue` |
| `unit-system` | `A` in Cellular, or an unknown system | `rescaleUnits` |

- **Arbitrary units** (`[iU]`, `[arb'U]`, `[PFU]` and the rest of UCUM's list) have no fixed relation to any other units.
- **Logarithmic units** (`[pH]`, neper and bel, with any prefix) can't be written with a multiplier.
- **Affine temperatures** have an offset zero, which CellML 2.0 units can't express. Use `K`.
- `%` and `[pi]` aren't errors: they are `dimensionless` with a multiplier of 0.01 and π.

## Bugs in the Python version that this package fixes

- **Prefixed units.** `mmol`, `mL` and `uF` make the Python CellML writer recurse forever.
- **Values aren't converted.** A value given in `uF` for a variable in farads is written without being scaled.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
