# Reference generator

`generate.py` runs the Python bg2cellml on the BG-RDF examples and on the variant models in `packages/bg2cellml/test/models`. It simulates the CellML with libOpenCOR and writes the results to `packages/bg2cellml/test/reference`.

Rerun it when the `bg-rdf` submodule moves to a new BG-RDF release, or when a variant model is added or changed. The `reference.test.ts` tests fail if any of those inputs no longer match what the references were made from.

## Running

You need [uv](https://docs.astral.sh/uv/) and a checkout of [BG-Tools](https://github.com/CellDL/BG-Tools) at the version to use as the reference (currently v0.11.2). From the repository root:

```sh
uv run --project tools/reference python tools/reference/generate.py --bg-tools ../bg-tools
```

The first run creates `tools/reference/.venv` with the Python bg2cellml's dependencies and libOpenCOR.

The script imports bg2cellml from the checkout, not from the released wheel. The 0.11.2 wheel can't be imported outside Pyodide, because it doesn't include the `oximock` module that `bg2cellml.rdf` imports.

The framework is always loaded from this repository's `bg-rdf` submodule, not the copy bundled with BG-Tools, so the references match the templates the JavaScript tests use.

## Adding a variant

1. Add the model to `packages/bg2cellml/test/models/`. Start with a comment saying which example it should match and which bug it triggers.
2. Add it to `VARIANTS` in `generate.py`, mapped to that example.
3. Rerun the generator, and add a row to the table in `packages/bg2cellml/test/reference/README.md`.
