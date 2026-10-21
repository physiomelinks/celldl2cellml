---
'@physiomelinks/bg2cellml': minor
---

Convert as the user edits. `convert()` takes `checks`: `full` (the default, as before), `validate` for libCellML's Validator alone, or `none` for neither, which gives the CellML and element manifest in a tenth of the time. The result's `checks` says which ran, and `runnable` is `undefined` when the Analyser wasn't asked for. `loadFramework()` takes `{ nquads }`, and `frameworkNQuads()` gives a loaded framework as N-Quads. The new `@physiomelinks/bg2cellml/worker` entry converts in a Web Worker: `startConversionWorker()` in the worker script, with the host's libcellml.js and oxigraph, and `createConversionWorker()` on the page, with latest-wins lanes. `@xmldom/xmldom` is now a dependency, for the worker's DOMParser. `celldl2cellml()` is unchanged.
