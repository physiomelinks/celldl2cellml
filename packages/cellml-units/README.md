# @physiomelinks/cellml-units

Turns [UCUM](https://ucum.org/) units expressions into CellML 2.0 units, names them, and compares and converts them with [libCellML](https://libcellml.org/).

It replaces pint and ucumvert in the Python [bg2cellml](https://github.com/CellDL/BG-Tools). Reading and naming units is ported from [PhLynx](https://github.com/physiomelinks/PhLynx) (`src/utils/unitExpression.js`), so units read and named here match PhLynx's. Compatibility and scaling come from libCellML, so mole is a base unit, as CellML has it; strict UCUM treats mol as a dimensionless count. It has no runtime dependencies; libcellml.js is a peer dependency.

> [!WARNING]
> Work in progress: reading and naming work. `toCellMLUnits` (3.2), and `compatible` and `convertValue` (3.3), aren't implemented yet.

## Usage

```js
import { parseUcum, unitsName } from '@physiomelinks/cellml-units'

unitsName('mol/s')        // 'mol_per_s'
unitsName('L2.s-1.J-1')   // 'L2_per_s_per_J'
unitsName('mm[Hg]')       // 'mmHg'
unitsName('10*9/L')       // 'giga_per_L'

parseUcum('mL/s')         // { code, factor: 1, symbols: [{ label: 'mL', exponent: 1, atom: { units: 'litre', … }, prefix: -3 }, …] }
```

## What it covers

| Area | Functions | Status |
|---|---|---|
| Reading UCUM | `parseUnitExpression`, `resolveSymbol` (PhLynx's), `parseUcum` (throws a `UcumError`) | Done |
| Symbols | `UCUM_ATOMS`, `UCUM_PREFIXES`, `PREFIX_POWERS`, `AFFINE_SYMBOLS`, `CELLML_BUILT_IN_UNITS` | Done |
| Naming | `unitsName`, `builtInUnits`, `nameUnits`, `sanitiseName`, `uniqueName` | Done |
| Building units | `toCellMLUnits` | To do (3.2) |
| Comparing and converting | `compatible`, `convertValue` | To do (3.3) |

## Reading

As PhLynx reads them:

- **Operators:** `.` multiplies and `/` divides, left to right, so `mmol/L.s` is (mmol/L)·s. Brackets group, and a leading `/` is one over.
- **Exponents** follow their symbol: `m2`, `s-1`. `10*3` and plain integers are factors.
- **Annotations** such as `{RBC}` are dropped; one on its own counts as 1, as in `{cells}/mL`.
- **Symbols:** the SI units, `L`, `eq` and `osm`, and the non-SI units `min`, `h`, `d`, `mm[Hg]`, `cm[H2O]`, `cal`, `bar`, `atm`, `%` and `[ppm]`, each with its factor in CellML's built-in units. Bracketed symbols also work without brackets (`mmHg`). Only metric symbols take a prefix.
- **Known names:** a units name the caller already has, such as one from a units library, is passed in `names` and takes precedence over UCUM.
- **Affine temperatures:** `Cel` and `[degF]` are recognised, but CellML 2.0 has no built-in units for them.

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

## Bugs in the Python version that this package fixes

- **Prefixed units.** `mmol`, `mL` and `uF` make the Python CellML writer recurse forever.
- **Values aren't converted.** A value given in `uF` for a variable in farads is written without being scaled.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
