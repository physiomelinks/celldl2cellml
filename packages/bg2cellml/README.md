# @physiomelinks/bg2cellml

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) (v0.11.2) so the CellDL Editor and PhLynx don't need Pyodide, which is about 24 MB of downloads. It keeps the `celldl2cellml()` interface of `@celldl/editor-python-tools`, so switching should only need a change of import.

> [!WARNING]
> This is an early skeleton. The RDF wrapper, SPARQL queries, bond network and CellDL extraction work, and the framework loads its domains. Loading element templates and models, and generating CellML, aren't implemented yet.

## Usage

The WebAssembly modules, libcellml.js and oxigraph, are peer dependencies. The host application loads them once and passes them in.

```js
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'                 // in a browser: oxigraph/web.js, after `await init()`
import { Converter } from '@physiomelinks/bg2cellml'

const converter = new Converter({ libcellml: await createLibCellML(), oxigraph })

converter.loadFramework({
  ontology: ontologyTurtle,                          // BG-RDF schema/ontology.ttl
  templates: { 'electrical.ttl': electricalTurtle },  // BG-RDF templates/*.ttl
})

const { cellml, metadata, issues, exception } = await converter.celldl2cellml(celldlSvg, {
  sourceUri: 'https://example.org/rc.celldl',
  metadata: true,
})
```

## Layout

| Path | Contents | Python original | Status |
|---|---|---|---|
| `src/converter.ts` | `Converter`: loads the framework, runs `celldl2cellml` | `editor-python-tools` glue | Done (calls stubs) |
| `src/celldl.ts` | `extractBgRdf`: Turtle from a CellDL SVG | `cli/bgtool get_bgrdf` | Done |
| `src/rdf/` | `RdfGraph` over oxigraph, namespaces, SPARQL queries | `rdf/`, query strings | Done |
| `src/framework/` | Domains, element templates, junctions, composites | `bondgraph/framework*.py` | Domains done |
| `src/model/network.ts` | `BondNetwork`, the directed graph of ports and junctions | networkx `DiGraph` | Done |
| `src/model/model.ts` | Elements, junctions, bonds and their equations | `bondgraph/model*.py` | Stub |
| `src/cellml/` | CellML 2.0 through libCellML, plus metadata | `cellml/__init__.py` | Stub |

## Differences from the Python version

- **CellML 2.0, written by libCellML.** It is validated and analysed before it's returned.
- **Units are converted.** Prefixed units work, and values are scaled to their variable's units. See `@physiomelinks/cellml-units`.
- **Known bugs fixed.** Bond labels and bond counts work, ports with only outputs get the right expression, and plain numbers such as `10.0` are accepted as values (Python rejects them under oxigraph). They're listed at the top of `src/model/model.ts`.
- **A bad declaration doesn't sink the framework.** A domain with a problem is reported and left out; the others still load. Python stops at the first problem.
- **Domain constants are sorted by name.** Python's order depends on its oxigraph build.
- **Output text differs.** The equations are the same mathematically, but terms may be ordered differently. Parity is checked by simulation.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
