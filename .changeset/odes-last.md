---
"@physiomelinks/bg2cellml": patch
---

`convert()` writes the ODEs last.

- bg2cellml: `convert()` writes a component's algebraic equations first (element, then junction) and its ODEs (`d(q)/dt = v_q`) after them, as a reader expects, rather than first. Each group keeps its order, and the model simulates the same. `generateCellML()` and `buildCellMLModel()` take it as `odesLast`.

`celldl2cellml()` gives the same CellML as before for every model.
