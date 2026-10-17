# bg-2-cellml

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript, without Pyodide.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) so that [PhLynx](https://github.com/physiomelinks/PhLynx) and the [CellDL Editor](https://github.com/CellDL/CellDLEditor) can convert bond graphs in the browser. The Python version has to run in Pyodide, which needs about 24 MB of WebAssembly and wheels.

> [!WARNING]
> This is an early skeleton. The layout, interfaces and some building blocks exist; the conversion itself doesn't work yet.

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

To work on one package, use `yarn workspace @physiomelinks/math-ast test:watch`.

`bg-rdf` is a git submodule of [CellDL/BG-RDF](https://github.com/CellDL/BG-RDF), pinned to a release tag. Tests load the framework from `bg-rdf/schema/ontology.ttl` and `bg-rdf/templates/`, and use `bg-rdf/examples/` as test models. The packages don't bundle it: at run time the host application supplies the framework.

Each package is self-contained, with its own `package.json`, `README.md` and `LICENSE`, so it can move to its own repository later.

## Plan

1. **Reference outputs.** Run the Python bg2cellml on the BG-RDF examples in `bg-rdf/examples`, plus variants that trigger its known bugs, and keep the simulated states and rates as the reference.
2. **math-ast.** Implement `parseMathML`, `toMathML` and `canonicalise`.
3. **cellml-units.** Implement `unitsName`, `toCellMLUnits`, `compatible` and `convertValue`.
4. **bg2cellml.** Port the framework loader, then the model, then the CellML writer.
5. **Parity.** Simulate both outputs with libOpenCOR and compare.
6. **Adoption.** Replace `@celldl/editor-python-tools` in the CellDL Editor, and use the package in PhLynx.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
