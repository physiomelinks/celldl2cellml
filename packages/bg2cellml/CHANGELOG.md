# @physiomelinks/bg2cellml

## 0.6.0

### Minor Changes

- 39caf48: Naming rules, flows written with variables, and physiomelinks/BG-RDF's templates.
  
  - bg2cellml: `convert()` names variables by the model's `bgf:NamingRule`s and `bgf:VariableName`s (physiomelinks/BG-RDF, ported from Finbar Argus's BG-Tools). An explicit name wins, then the rule for the element's class and domain, its class, its domain, then neither; patterns take `{species}`, `{location}`, `{name}`, `{element}`, `{label}` and `{var}`. A renamed variable that would clash is numbered, and that and an explicit name CellML can't hold are warnings with the element's `elementId`. The CellML, the element manifest and `toViewerAnnotations()` use the final names, and a renamed variable's manifest entry has its bond graph name as `bondgraph`. `naming: false` turns them off.
  - bg2cellml: `convert()` writes a source or composite element in terms of its neighbours' flow and potential variables, so a store fed by a reaction has `v_q_S1_c = -v_Rx_R1_c` rather than the reaction's rate again, and solves a transform node's equation for its own variable where a neighbour's is already defined. Every manifest variable stays.
  - bg2cellml: a `bgf:TransformerNode` is a transformer and a `bgf:GyratorNode` a gyrator, whatever their ports' domains; the saturating reaction and store and the Bernoulli resistor are tested in models.
  - cellml-units: `rescaleUnits` writes a pressure as the system's energy per volume, so `kPa`, `mm[Hg]` and `bar` rescale into Cellular (`kPa.s/L` is `(fJ.pL-1).s/pL`).
  
  `celldl2cellml()` gives the same CellML as before for every model.

### Patch Changes

- Updated dependencies [39caf48]
  - @physiomelinks/cellml-units@0.6.0
  - @physiomelinks/math-ast@0.6.0

## 0.5.1

### Patch Changes

- d0ef561: convert() declares every variable public
- Updated dependencies [d0ef561]
  - @physiomelinks/cellml-units@0.5.1
  - @physiomelinks/math-ast@0.5.1

## 0.5.0

### Minor Changes

- 601a91c: Build a model in a unit system: SI (mol, L, J, C, as BG-RDF has them) or Cellular (fmol, pL, fJ, fC).
  
  - bg2cellml: `convert()` takes `unitSystem: 'si' | 'cellular'`, which overrides the model's own `pml:unitSystem pml:SI` or `pml:Cellular` (`pml:` is `https://physiomelinks.github.io/ns/celldl#`). A model with neither is SI. `result.unitSystem` says which system was used.
  - In Cellular, every units code of the framework is rescaled uniformly, so the CellML's variables are in `fmol`, `per_fmol`, `fmol_per_s`, `pL_per_fmol`, ... and libCellML finds its equations consistent. Codes whose scale doesn't change keep their names (`J_per_mol`, `J_per_C`), so `RT` and `F` keep their values. Values keep their physical value (`1 mol` is `1e15` fmol), and a source's numbers with units are rescaled the same way; one in units that can't be, such as `A`, is reported.
  - cellml-units: `UNIT_SYSTEMS`, `unitSystem`, `rescaleUnits`, `rescaleCode` and `rescaleFactor`, and the `unit-system` reason for a `UcumError`. bg2cellml re-exports them, with `UNIT_SYSTEM_PREDICATE`, `UNIT_SYSTEM_IRIS` and `unitSystemForIri`.
  
  Every model without a unit system, or in SI, gives the same CellML as before.

### Patch Changes

- Updated dependencies [601a91c]
  - @physiomelinks/cellml-units@0.5.0
  - @physiomelinks/math-ast@0.5.0

## 0.4.0

### Minor Changes

- ac20e94: Convert reactions as the CellDL editor's Reactions panel draws them: a composite `bgf:ChemicalReactionNode` bonded straight to its species, with each coefficient as the bond's `bgf:bondCount`, and a copy of a chemostat beside each reaction using it.
  
  - Drawn copies of an element (same symbol, species and location) are now separate elements with names of their own, as in Finbar Argus's BG-Tools: the first in IRI order (elements, then junctions) keeps the name and later copies are numbered, so a second chemostat `Se_ATP_c` is `Se_ATP_c_2` (BG-Tools names it from its IRI, such as `ID_00000007`). Before, the copies shared their variables, so the model was over- or underconstrained. Copies of a store are separate pools, and are reported as a warning.
  - A port bonded straight to a junction or a composite element now carries `n` times its flow or potential for a bond count `n`, and a flow is negated when the bond runs against the port, so a store bonded from itself to a reaction loses what the reaction carries away. Before, such a store gained it, whatever the count.
  
  Every BG-RDF example gives the same CellML. Other models change only if they have drawn copies, a bond count on a port bonded to a junction or composite element, or a port bonded against its direction.

### Patch Changes

- @physiomelinks/cellml-units@0.4.0
  - @physiomelinks/math-ast@0.4.0

## 0.3.2

### Patch Changes

- ee810ca: Convert an element bonded straight to a composite element, such as a `bgf:ChemicalReaction` bonded to a `bgf:ChemicalStorageNode` with no zero node between them. The reaction's port now takes the store's potential, as it would through the zero node the store acts as; before, the port's potential had no equation and the model was underconstrained. Likewise, an element bonded straight to a composite resistance or reaction node, or to a source, shares its flow or potential. Output for models that already converted is unchanged.
- @physiomelinks/cellml-units@0.3.2
  - @physiomelinks/math-ast@0.3.2

## 0.3.1

### Patch Changes

- 2509088: Convert composite elements, such as `bgf:ChemicalStorageNode`, `bgf:ChemicalReactionNode` and `bgf:ElectricalCapacitiveNode`, that a model also lists under `bgf:hasJunctionStructure`, as the CellDL editor writes them. Such a node is read as the element and not as a junction, which gives Python's CellML; before, it was reported as a junction that isn't a one, zero or transform node, so no diagram with storage, resistance or reaction nodes converted. A node of another junction class that isn't also an element is still reported. Output for other models is unchanged.
- @physiomelinks/cellml-units@0.3.1
  - @physiomelinks/math-ast@0.3.1

## 0.3.0

### Minor Changes

- baad752: Convert as the user edits. `convert()` takes `checks`: `full` (the default, as before), `validate` for libCellML's Validator alone, or `none` for neither, which gives the CellML and element manifest in a tenth of the time. The result's `checks` says which ran, and `runnable` is `undefined` when the Analyser wasn't asked for. `loadFramework()` takes `{ nquads }`, and `frameworkNQuads()` gives a loaded framework as N-Quads. The new `@physiomelinks/bg2cellml/worker` entry converts in a Web Worker: `startConversionWorker()` in the worker script, with the host's libcellml.js and oxigraph, and `createConversionWorker()` on the page, with latest-wins lanes. `@xmldom/xmldom` is now a dependency, for the worker's DOMParser. `celldl2cellml()` is unchanged.

### Patch Changes

- @physiomelinks/cellml-units@0.3.0
  - @physiomelinks/math-ast@0.3.0

## 0.2.0

### Minor Changes

- b3de644: Add `Converter.convert()`, which returns the CellML whenever it can be printed, with any warnings, along with `ok`, `runnable`, `modelType`, the issues (and their `errors` and `warnings`), the model's IRI and the base IRI it was read with, `generator` (the package's name and version, also exported as `GENERATOR`) and the BG-RDF framework's `owl:versionInfo`. `sourceUri` is optional, defaulting to `DEFAULT_SOURCE_URI`, and `componentName` names the CellML component and prefixes its variables' ids (`main` by default). `elementIdOf()` gives an element's diagram id whether the source's Turtle uses relative or absolute IRIs. `BondgraphFramework.version` is the ontology's `owl:versionInfo`. `celldl2cellml()` is unchanged.
- ac81c89: `convert()` returns `elements`, the element manifest: each element's and junction's CellML variables by its diagram id, with each variable's role (`flow`, `potential`, `quantity`, `parameter`, `ratio` or `other`) and units, and its `primary` variable. A variable two elements share is listed for both. `generateCellML()` returns it too, and `toViewerAnnotations()` makes `@celldl/viewer` annotations of it. `celldl2cellml()` is unchanged.
- 3ee7481: `convert()` takes `knownUnits`: the CellML of units the host already has, such as its other modules'. Units the converted model would name as a known units name but define differently get the next free name (`mmol_per_L_1`), listed in the result's `units.renamed` with an `info` issue at the `units` stage; units defined the same keep their name. The CellML still defines all its units. `generateCellML()` and `buildCellMLModel()` take `knownUnits` too, and `KnownUnits` reads them. Without `knownUnits`, the CellML is unchanged, as is `celldl2cellml()`.
- 21617ec: Give each issue a `severity` (`error`, `warning` or `info`), the `stage` that found it (`input`, `framework`, `model`, `units`, `build`, `validator` or `analyser`; values in incompatible units and units CellML can't express are `units`), and, when its subject is in the model's document, the subject's IRI fragment as `elementId`. libCellML's levels become severities, with `message` as `info`. Validator warnings alone no longer stop a model being analysed, and a model type that can't run is reported as an error. `IssueLog.reportIssue()` reports an issue with these fields; `report()` is unchanged and reports an error.

### Patch Changes

- 5adf018: Point the package repository, homepage and issue links at `physiomelinks/celldl2cellml`, the repository's new name.
- @physiomelinks/cellml-units@0.2.0
  - @physiomelinks/math-ast@0.2.0

## 0.1.0

### Minor Changes

- First release. `@physiomelinks/bg2cellml` generates CellML 2.0 from BG-RDF bond graph models (CellDL documents or BG-RDF Turtle) in JavaScript, with libcellml.js and oxigraph as peer dependencies, keeping the `celldl2cellml()` interface of `@celldl/editor-python-tools`. Every BG-RDF example and variant simulates as the Python bg2cellml 0.11.2's CellML does, or, where Python has a bug, as a hand-worked reference does; the differences are listed in its README. `@physiomelinks/math-ast` reads, tidies and writes CellML's Content MathML, and `@physiomelinks/cellml-units` turns UCUM codes into CellML 2.0 units and compares and converts them with libCellML.

### Patch Changes

- Updated dependencies
  - @physiomelinks/math-ast@0.1.0
  - @physiomelinks/cellml-units@0.1.0
