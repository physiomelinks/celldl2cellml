# @physiomelinks/bg2cellml

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
