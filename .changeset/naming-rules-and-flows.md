---
"@physiomelinks/bg2cellml": minor
"@physiomelinks/cellml-units": minor
---

Naming rules, flows written with variables, and physiomelinks/BG-RDF's templates.

- bg2cellml: `convert()` names variables by the model's `bgf:NamingRule`s and `bgf:VariableName`s (physiomelinks/BG-RDF, ported from Finbar Argus's BG-Tools). An explicit name wins, then the rule for the element's class and domain, its class, its domain, then neither; patterns take `{species}`, `{location}`, `{name}`, `{element}`, `{label}` and `{var}`. A renamed variable that would clash is numbered, and that and an explicit name CellML can't hold are warnings with the element's `elementId`. The CellML, the element manifest and `toViewerAnnotations()` use the final names, and a renamed variable's manifest entry has its bond graph name as `bondgraph`. `naming: false` turns them off.
- bg2cellml: `convert()` writes a source or composite element in terms of its neighbours' flow and potential variables, so a store fed by a reaction has `v_q_S1_c = -v_Rx_R1_c` rather than the reaction's rate again, and solves a transform node's equation for its own variable where a neighbour's is already defined. Every manifest variable stays.
- bg2cellml: a `bgf:TransformerNode` is a transformer and a `bgf:GyratorNode` a gyrator, whatever their ports' domains; the saturating reaction and store and the Bernoulli resistor are tested in models.
- cellml-units: `rescaleUnits` writes a pressure as the system's energy per volume, so `kPa`, `mm[Hg]` and `bar` rescale into Cellular (`kPa.s/L` is `(fJ.pL-1).s/pL`).

`celldl2cellml()` gives the same CellML as before for every model.
