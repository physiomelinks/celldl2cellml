# Reference generator

`generate.py` runs the Python bg2cellml on the BG-RDF examples and on the variant models in `packages/bg2cellml/test/models`. It simulates the CellML with libOpenCOR and writes the results to `packages/bg2cellml/test/reference`, along with the framework as Python loads it (`framework.json`) and each model as Python builds it (`models/<case>.json`).

Rerun it when the `bg-rdf` submodule moves to a new BG-RDF release, or when a variant model is added or changed. The `reference.test.ts` tests fail if any of those inputs no longer match what the references were made from.

## Running

You need [uv](https://docs.astral.sh/uv/) and a checkout of [BG-Tools](https://github.com/CellDL/BG-Tools) at the version to use as the reference (currently v0.11.2). From the repository root:

```sh
uv run --project tools/reference python tools/reference/generate.py --bg-tools ../bg-tools
```

Where patching the Python bg2cellml's bug 3 (it gives `BondgraphBond` a bond's label and count the wrong way round) changes a model, `models/<case>.bug3-fixed.json` is the model as the patched version builds it. The patch is applied only while building those.

To rewrite only `framework.json`, the framework as Python loads it, add `--framework-only`. To rewrite `framework.json` and the `models/` fixtures without simulating, add `--fixtures-only`. Both need the same BG-Tools commit as the other references.

Simulating on another platform can change the last of the 9 stored digits, which is well within the tolerance but shows up as changes to commit. `--fixtures-only` avoids that when only the fixtures need regenerating.

The first run creates `tools/reference/.venv` with the Python bg2cellml's dependencies and libOpenCOR.

The script imports bg2cellml from the checkout, not from the released wheel. The 0.11.2 wheel can't be imported outside Pyodide, because it doesn't include the `oximock` module that `bg2cellml.rdf` imports.

The framework is always loaded from this repository's `bg-rdf` submodule, not the copy bundled with BG-Tools, so the references match the templates the JavaScript tests use.

## Adding a variant

1. Add the model to `packages/bg2cellml/test/models/`. Start with a comment saying which example it should match and which bug it triggers.
2. Add it to `VARIANTS` in `generate.py`, mapped to that example.
3. Rerun the generator, and add a row to the table in `packages/bg2cellml/test/reference/README.md`.
