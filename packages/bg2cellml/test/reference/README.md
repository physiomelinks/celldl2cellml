# Reference results

Results from the Python [bg2cellml](https://github.com/CellDL/BG-Tools) 0.11.2, simulated with libOpenCOR. The JavaScript bg2cellml should give the same results.

**Don't edit these files.** Regenerate them with [`tools/reference/generate.py`](../../../../tools/reference/).

## Files

| File | Contents |
|---|---|
| `manifest.json` | Generator versions, the bg-rdf tag, commit and file hashes, tolerances, and every case |
| `<example>.json` | Simulation settings, and the states, rates and algebraic variables by name, at up to 101 time points |
| `python/<example>.cellml` | The CellML 1.1 the Python version generated, for inspection |

## Cases

- **Examples:** the 14 models in `bg-rdf/examples`, simulated for the times given in their comments. `example_A1` and `example_B1` are also checked against the hand-built CellML models in `bg-rdf/pmr`, and both agree.
- **Variants:** the models in [`../models`](../models) are copies of `example_RC` that trigger bugs in the Python version. Each should simulate exactly like `example_RC`, so that's its reference. The manifest records what Python did instead:

| Variant | Python 0.11.2 |
|---|---|
| `RC_labelled_bonds` | Fails: `int('source to current')` |
| `RC_plain_number` | Fails: rejects the `xsd:decimal` value |
| `RC_prefixed_values` | Wrong: `1000 uF`, `0.01 kOhm` and `10000 mV` are used unconverted |

The prefixed-units recursion bug isn't covered here. It needs a template with prefixed units, so it belongs in `@physiomelinks/cellml-units`'s tests.

## Comparing

Variables are compared by name, without the component name: `q_1`, not `main/q_1`. A value passes if `|actual - expected| <= 1e-6 + 2e-4 * |expected|`, the tolerance BG-Tools' own tests used. `test/reference.ts` has `compareResults()` for this.

Numbers are rounded to 9 significant figures. Regenerating on a different platform may change the last digits; that's well within the tolerance.
