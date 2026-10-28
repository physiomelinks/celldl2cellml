# BG-RDF 2 CellML

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript, without Pyodide.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) so that [PhLynx](https://github.com/physiomelinks/PhLynx) and the [CellDL Editor](https://github.com/CellDL/CellDLEditor) can convert bond graphs in the browser. The Python version has to run in Pyodide, which needs about 24 MB of WebAssembly and wheels.

> [!NOTE]
> The converter is complete and checked against the Python version (see the bg2cellml README); [`examples/browser`](examples/browser) checks it in browsers.

## Packages

| Package | What it does | Replaces |
|---|---|---|
| [`@physiomelinks/math-ast`](packages/math-ast) | An expression tree for Content MathML: read, build, compare, rename, tidy, write | sympy, MathML parts of lxml |
| [`@physiomelinks/cellml-units`](packages/cellml-units) | UCUM codes to CellML 2.0 units, compared and converted with libCellML | pint, ucumvert |
| [`@physiomelinks/bg2cellml`](packages/bg2cellml) | BG-RDF to bond graph model to CellML 2.0, with metadata | the rest of bg2cellml, networkx |

`bg2cellml` depends on the other two. `math-ast` and `cellml-units` don't depend on each other, and neither knows about bond graphs, so other tools can use them.

WebAssembly modules (libcellml.js, oxigraph) are peer dependencies. The host application loads each one once and passes it in, which fits how PhLynx already loads libCellML.

## Development

This is a Yarn 4 workspace, run through Corepack.

```sh
git submodule update --init   # fetches bg-rdf, the BG-RDF ontology, templates and examples
corepack enable
yarn install
yarn build        # tsc --build, in dependency order
yarn test         # Vitest in every package
```

To work on one package, use `yarn workspace @physiomelinks/math-ast test:watch`. `yarn stats` writes a [rollup-plugin-visualizer](https://github.com/btd/rollup-plugin-visualizer) treemap of each package, bundled as an application would bundle it, to `stats/<package>.html`.

Releases use [Changesets](https://github.com/changesets/changesets): add one with `yarn changeset` alongside a change. [RELEASING.md](RELEASING.md) covers versions, changelogs and publishing to npm.

`bg-rdf` is a git submodule of [physiomelinks/BG-RDF](https://github.com/physiomelinks/BG-RDF), our fork of [CellDL/BG-RDF](https://github.com/CellDL/BG-RDF), pinned to a commit. The fork adds Finbar Argus's templates and terms (saturating laws, a Bernoulli resistor, transformer and gyrator nodes, naming rules) and takes in upstream's changes from time to time. Tests load the framework from `bg-rdf/schema/ontology.ttl` and `bg-rdf/templates/`, and use `bg-rdf/examples/` as test models. The packages don't bundle it: at run time the host application supplies the framework.

[`examples/browser`](examples/browser) is a private workspace, never published: a Vite page that runs the converter in a browser with oxigraph's web build and libcellml.js, with a Playwright check in Chromium, Firefox and WebKit (`yarn workspace @physiomelinks/browser-check test:browsers`). Its README records the browsers checked and the download size against Pyodide's.

Each package is self-contained, with its own `package.json`, `README.md` and `LICENSE`, so it can move to its own repository later.

## Plan

1. **Reference outputs.** Done: `packages/bg2cellml/test/reference` holds the Python bg2cellml's results for the 14 BG-RDF examples and 3 bug-triggering variants. Regenerate them with `yarn reference --bg-tools ../bg-tools`; see `tools/reference/README.md`.
2. **math-ast.** Implement `parseMathML`, `toMathML` and `canonicalise`.
3. **cellml-units.** Implement `unitsName`, `toCellMLUnits`, `compatible` and `convertValue`.
4. **bg2cellml.** Port the framework loader, then the model, then the CellML writer.
5. **Parity.** Simulate both outputs with libOpenCOR and compare.
6. **Adoption.** Check the converter in browsers (`examples/browser`), then replace `@celldl/editor-python-tools` in the CellDL Editor, and use the package in PhLynx.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
