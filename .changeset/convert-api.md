---
'@physiomelinks/bg2cellml': minor
---

Add `Converter.convert()`, which returns the CellML whenever it can be printed, with any warnings, along with `ok`, `runnable`, `modelType`, the issues (and their `errors` and `warnings`), the model's IRI and the base IRI it was read with, `generator` (the package's name and version, also exported as `GENERATOR`) and the BG-RDF framework's `owl:versionInfo`. `sourceUri` is optional, defaulting to `DEFAULT_SOURCE_URI`, and `componentName` names the CellML component and prefixes its variables' ids (`main` by default). `elementIdOf()` gives an element's diagram id whether the source's Turtle uses relative or absolute IRIs. `BondgraphFramework.version` is the ontology's `owl:versionInfo`. `celldl2cellml()` is unchanged.
