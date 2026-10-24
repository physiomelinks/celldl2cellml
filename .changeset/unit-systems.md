---
'@physiomelinks/bg2cellml': minor
'@physiomelinks/cellml-units': minor
---

Build a model in a unit system: SI (mol, L, J, C, as BG-RDF has them) or Cellular (fmol, pL, fJ, fC).

- bg2cellml: `convert()` takes `unitSystem: 'si' | 'cellular'`, which overrides the model's own `pml:unitSystem pml:SI` or `pml:Cellular` (`pml:` is `https://physiomelinks.github.io/ns/celldl#`). A model with neither is SI. `result.unitSystem` says which system was used.
- In Cellular, every units code of the framework is rescaled uniformly, so the CellML's variables are in `fmol`, `per_fmol`, `fmol_per_s`, `pL_per_fmol`, ... and libCellML finds its equations consistent. Codes whose scale doesn't change keep their names (`J_per_mol`, `J_per_C`), so `RT` and `F` keep their values. Values keep their physical value (`1 mol` is `1e15` fmol), and a source's numbers with units are rescaled the same way; one in units that can't be, such as `A`, is reported.
- cellml-units: `UNIT_SYSTEMS`, `unitSystem`, `rescaleUnits`, `rescaleCode` and `rescaleFactor`, and the `unit-system` reason for a `UcumError`. bg2cellml re-exports them, with `UNIT_SYSTEM_PREDICATE`, `UNIT_SYSTEM_IRIS` and `unitSystemForIri`.

Every model without a unit system, or in SI, gives the same CellML as before.
