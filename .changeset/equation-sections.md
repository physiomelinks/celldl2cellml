---
"@physiomelinks/bg2cellml": patch
---

`convert()` writes its equations in sections and returns them.

- bg2cellml: `convert()` writes a component's equations in sections by role, the ODEs last, with no comments: potentials, port potentials, element flows, junction flows, any other relations, then conservation (`Chemical potentials`, `Reaction affinities`, `Reaction flux`, `Species flux`, `Mass conservation` for a chemical model). `result.sections` (`{ title, variables }[]`, also from the worker) lists them, with each equation's left-side variable, so a host can lay the CellML out. Empty sections are left out, and the model simulates the same. `generateCellML()` and `buildCellMLModel()` take it as `sections`.

`celldl2cellml()` gives the same CellML as before for every model.
