# @physiomelinks/cellml-units

Turns [UCUM](https://ucum.org/) unit codes into CellML 2.0 units, and compares and converts them with [libCellML](https://libcellml.org/).

It replaces pint and ucumvert in the Python [bg2cellml](https://github.com/CellDL/BG-Tools). Parsing UCUM is done by [`@atomic-ehr/ucum`](https://www.npmjs.com/package/@atomic-ehr/ucum). Compatibility and scaling come from libCellML's `Units.compatible` and `Units.scalingFactor`, so mole is treated as a base unit, as CellML does. Strict UCUM treats mol as a dimensionless count.

> [!WARNING]
> This is an early skeleton. `parseUcum` and the unit tables work. `unitsName`, `toCellMLUnits`, `compatible` and `convertValue` aren't implemented yet.

## Usage

libcellml.js is a peer dependency. The host application loads it once and passes the instance in.

```js
import createLibCellML from 'libcellml.js'
import { convertValue, parseUcum, toCellMLUnits } from '@physiomelinks/cellml-units'

const libcellml = await createLibCellML()

parseUcum('mL/s')                                   // [{ atom: 'L', prefix: 'm', exponent: 1 }, { atom: 's', exponent: -1 }]
const units = toCellMLUnits(libcellml, 'mmol/s')     // libCellML Units: millimole^1 . second^-1
convertValue(libcellml, 1000, 'uF', 'C2/J')          // 0.001
```

## What it covers

| Area | Functions | Status |
|---|---|---|
| Parsing UCUM | `parseUcum`, giving atom, prefix, exponent and annotation | Done |
| Mapping to CellML | `UCUM_TO_CELLML_UNIT`, `UCUM_TO_CELLML_PREFIX` | Done |
| Building units | `toCellMLUnits`, `unitsName` | To do |
| Comparing and converting | `compatible`, `convertValue` | To do |

## Bugs in the Python version that this package fixes

- **Prefixed units.** `mmol`, `mL` and `uF` make the Python CellML writer recurse forever.
- **Values aren't converted.** A value given in `uF` for a variable in farads is written without being scaled.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
