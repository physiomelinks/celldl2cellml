---
'@physiomelinks/bg2cellml': minor
---

`convert()` takes `knownUnits`: the CellML of units the host already has, such as its other modules'. Units the converted model would name as a known units name but define differently get the next free name (`mmol_per_L_1`), listed in the result's `units.renamed` with an `info` issue at the `units` stage; units defined the same keep their name. The CellML still defines all its units. `generateCellML()` and `buildCellMLModel()` take `knownUnits` too, and `KnownUnits` reads them. Without `knownUnits`, the CellML is unchanged, as is `celldl2cellml()`.
