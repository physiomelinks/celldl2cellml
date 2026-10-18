# @physiomelinks/bg2cellml

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) (v0.11.2) so the CellDL Editor and PhLynx don't need Pyodide, which is about 24 MB of downloads. It keeps the `celldl2cellml()` interface of `@celldl/editor-python-tools`, so switching should only need a change of import.

> [!NOTE]
> Not yet published. The converter is complete: it reads the BG-RDF framework and models, builds the bond network and equations, and writes CellML 2.0 with libCellML, with metadata. Every BG-RDF example and variant simulates as the Python version's CellML does, or, where Python has a bug, as a hand-worked reference and the PMR model do (see below).

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
// or, from statements already in an RDF store, such as the CellDL Editor's:
converter.loadFramework({ quads: store.match(null, null, null, null) })

const { cellml, metadata, issues, exception } = await converter.celldl2cellml(celldlSvg, {
  sourceUri: 'https://example.org/rc.celldl',         // an absolute IRI: a file as file:///C:/My%20models/rc.celldl
  metadata: true,
})
```

## Layout

| Path | Contents | Python original | Status |
|---|---|---|---|
| `src/converter.ts` | `Converter`: loads the framework, runs `celldl2cellml` | `editor-python-tools` glue | Done |
| `src/celldl.ts` | `extractBgRdf`: Turtle from a CellDL SVG | `cli/bgtool get_bgrdf` | Done |
| `src/rdf/` | `RdfGraph` over oxigraph, namespaces, SPARQL queries | `rdf/`, query strings | Done |
| `src/framework/` | Domains, element templates, junctions, composites | `bondgraph/framework*.py` | Done |
| `src/model/network.ts` | `BondNetwork`, the directed graph of ports and junctions | networkx `DiGraph` | Done |
| `src/model/elements.ts`, `names.ts` | A model's elements: templates, symbols, ports, variables and values | `BondgraphElement`, `make_symbolic_name` | Done (5.1) |
| `src/model/junctions.ts`, `bonds.ts` | Junctions, bonds (listed or inferred) and the bond network | `BondgraphJunction`, `__generate_bonds`, `__make_bond_network` | Done (5.2) |
| `src/model/domains.ts`, `junctions.ts` | Domains through the network, and one, zero and transform node variables | `__check_and_assign_domains_to_bond_network`, `assign_node_variables`, `assign_transform_variables` | Done (5.3) |
| `src/model/element-variables.ts` | Element values, symbols and references, unit conversion, relations in the elements' symbols | `assign_variables` | Done (5.4) |
| `src/model/equations.ts` | The model's equations: constitutive relations, elements acting as junctions, junctions, transformers and gyrators | `build_expressions`, `build_equations` | Done (5.5) |
| `src/model/model.ts` | Loading a model (`until` stops at a stage, for tests) | `bondgraph/model*.py` | Done |
| `src/cellml/model.ts` | The CellML model's units and `main` component variables | `CellMLModel`, `symbol_sort_key` | Done (6.1) |
| `src/cellml/equations.ts` | The equations as MathML in `main`, grouped and ordered as Python | `__equations_to_mathml` | Done (6.2) |
| `src/cellml/check.ts` | libCellML's Validator and Analyser, their messages as issues | (none) | Done (6.3) |
| `src/cellml/metadata.ts`, `src/rdf/turtle.ts` | Metadata linking CellML variables to bond graph elements, as Turtle, and the element-to-variables annotation | `CellMLModel.metadata`, `annotation` | Done (6.4) |
| `src/cellml/generate.ts` | CellML 2.0 through libCellML, plus metadata | `cellml/__init__.py` | Done |

## Differences from the Python version

Each difference is deliberate. The parity tests (`test/parity.test.ts`) check that, apart from `example_B2` and `example_B2_reduced`, every BG-RDF example and variant simulates as Python's CellML does. `test/differences.test.ts` compares our CellML with Python's for each of them, and fails on any difference not of a kind listed under "In the CellML".

### In the CellML

- **CellML 2.0, written by libCellML.** The model is in the CellML 2.0 namespace, and the component and variables have CellML 2.0 `id`s (`main`, `main-q_1`) where Python's have the same values as `cmeta:id`. The CellML is validated and analysed: every message from libCellML's Validator and Analyser is an issue, warnings included, so units that aren't consistent are reported; `generateCellML` still returns the CellML with them, and `celldl2cellml` returns just the issues. `modelType` gives the Analyser's type: like Python's CellML, most models with junctions are DAEs rather than ODEs, as some junction equations form linear systems libCellML solves numerically. BG-RDF's `example_A3` and `example_A3_reduced` give the units warning; `test/models` has them with units.
- **No header comment.** Python's CellML starts with a comment saying it was generated by BG-Tools, its version, and the model's IRI. Ours has none (decided with Hugh): the CellML is as libCellML prints it.
- **Numbers are printed as libCellML prints them.** Initial values and numbers in equations have the same values, but whole numbers are written without a decimal point: `10` and `96485` where Python writes `10.0` and `96485.0`.
- **Units are named as `@physiomelinks/cellml-units` names them.** `C_per_s` rather than Python's `coulomb_per_second`; units that are a CellML built-in (`coulomb`, `farad`, `mole`) are used without a definition. There is no `dim` units, as CellML 2.0 has `dimensionless` built in. Two UCUM codes with one name share a definition if they are the same units (`mol/s`, `s-1.mol`), and otherwise the second is numbered (`mol_per_s_1`). Variable names, `main-<name>` ids and their order (`symbol_sort_key`) are Python's.
- **Numbers have units, `dimensionless` if not given.** In BG-RDF MathML a number's units are a UCUM code in `bgf:units` (`<cn bgf:units="V">50</cn>`, the `bgf` prefix needn't be declared), or `cellml:units`; Python ignores them. Every `<cn>` in the CellML gets `cellml:units`: those units, or `dimensionless` (Python's is its own `dim`). Bond graphs should be dimensionally consistent, so a number that isn't dimensionless needs its units: BG-RDF's `example_A3` and `example_A3_reduced` don't give them, so their voltage source isn't consistent; `A3_numbers_with_units` and `A3_reduced_numbers_with_units` in `test/models` are those examples with units.
- **Numbers are written as given.** `50 * 2` stays as it is, where sympy folds it to `100`.
- **Domain constants, and template parameters and variables, are sorted by name.** Python's order depends on its oxigraph build and how it orders blank nodes. So in CellML `F` comes before `RT`.
- **Equations are written in a different form.** They're the same mathematically, and in Python's groups (element ODEs, element algebraics, junction algebraics) and order (sorted by left side), one `<math>` each, but terms may be ordered or grouped differently: `v_R * R_R` for `R_R * v_R`, `u_V_in - V_C` for `-V_C + u_V_in`. Parity is checked by simulation.
- **Bond counts are used, so `example_B2` differs from Python.** Python passes a bond's `rdfs:label` and `bgf:bondCount` to `BondgraphBond` the wrong way round (model.py:233), so a labelled bond fails and a bond count is ignored. Here both are read, so a model with a `bgf:bondCount` on a bond, such as BG-RDF's `example_B2` and `example_B2_reduced` (two bonds each with a count of 2), gives different equations and results from the Python version and its references. They should agree once the bug is fixed in BG-Tools: the generator also builds each model with the Python bug patched (`models/*.bug3-fixed.json`), and our equations for both models match those. Their simulations are checked against a hand-worked reference (`test/hand-worked.ts`) and PMR's FAIRDO BG example 3.5 (`test/pmr.ts`) instead of Python's.
- **Metadata works for BG-RDF models.** Python's `metadata()` fails on every BG-RDF model: it adds a `diagram` prefix of the model's IRI with `#` appended, which isn't an IRI when the model's IRI has a fragment. Here `diagram` is the model's IRI up to its fragment. The triples are Python's; the Turtle is laid out differently. `generateCellML` also returns Python's `annotation()` (each element's CellML variables); `celldl2cellml` keeps `@celldl/editor-python-tools`' output and doesn't.

### Bugs fixed

- **Known bugs fixed.** Bond labels and bond counts work, ports with only outputs get the right expression, and plain numbers such as `10.0` are accepted as values (Python rejects them under oxigraph). They're listed at the top of `src/model/model.ts`.
- **Units are converted.** Prefixed units work, and values are scaled to their variable's units. See `@physiomelinks/cellml-units`.
- **Equations are tidied, and solved for a variable.** Every equation built from the network is canonicalised, as sympy tidies Python's. With bond counts, Python can make `2*v_r_1` an equation's left side, which isn't valid CellML; here that equation is `v_r_1 = -v_q_2/2`. A port with only outputs gets the negated sum of its outputs, where Python's gives 0 (bug 4); with bonds joined to reactions as they are, no model reaches that case.

### Reported where Python carries on

- **A source URI that isn't an absolute IRI is reported.** `celldl2cellml` checks `sourceUri`, and `cellmlUri` if given, before reading anything, and says what's wrong: `sourceUri isn't an absolute IRI: "C:\\Users\\Some One\\rc.celldl" (...)`, with how to give a file path. Python fails on such a URI with oxigraph's message alone, `Invalid IRI code point ' '`, as the CellDL Editor did on Windows (BG-Tools' `tests/models/rdf_error.celldl`).
- **Equations naming unknown variables are reported.** Python writes them anyway, giving CellML that can't be valid; this happens with a resistor or reaction whose port has no bond, whose relation keeps the template's potential.
- **Clashing variables are reported.** Python writes one CellML variable per symbol, keeping the first; so do we, but two variables with one symbol and different units or values, or a variable named as `t` or a domain constant, are reported (Python would write two variables with one name for the latter). Two domains whose constant of one name differs are reported too.
- **Symbols are substituted all at once.** Python renames a relation's names one at a time and fails if a symbol is already there; here a symbol that would give two variables one name is reported. A variable given another element's intrinsic variable must be in the same units, not just pint-equal ones. A source's MathML may use only its own variables, the domain's constants and `t`.
- **Elements in different domains joined by bonds are reported.** Python means to, but its check can never fire (it marks a node seen whenever it gives it a domain), so the first domain to arrive wins. Here each set of joined nodes takes the domain of its first element, and each other domain in it is reported once: `Node #R_m with domain bgf:Mechanical incompatible with bgf:Electrical`.
- **A transform node's ports are checked.** A port bonded to anything but one node, or to a node that isn't a one or zero node or an element acting as one, is reported; Python leaves the port without variables. A transform node with no ratio is reported as such, and a ratio given as a plain number is dimensionless (Python rejects it).
- **Junctions must be one, zero or transform nodes.** A junction of another class under `bgf:JunctionStructure`, such as `bgf:ZeroStorageNode`, or with two types, is reported and left out. Python accepts it and gives it no variables.
- **Bond problems Python skips are reported.** A bond with one end outside the model (Python silently ignores it), two bonds between the same nodes (networkx keeps the last), and a `bgf:bondCount` that isn't a positive integer.
- **A bad declaration doesn't sink the framework.** A domain or element template with a problem is reported and left out; the others still load. Python stops at the first problem.
- **Templates are checked more closely.** Every parameter and variable must appear in the constitutive relation (Python only compares counts), and ports without a direction, duplicate ports and duplicate names are reported (Python drops or overwrites them).
- **An ambiguous element class is reported.** An element given as a class and domain (`bgf:Reaction` in `bgf:Chemical`) where the domain has more than one template of that class finds nothing, and `templateIssue()` says which templates it could be. Python silently uses the last by IRI.
- **Each element must have exactly one template.** An element whose types give two templates, or that has two symbols, labels, domains, species or locations, is reported and left out. Python uses the first query row, or reports two templates but keeps the element.
- **Values an element can't use are reported.** A second `bgf:hasValue`, a value on an element with no intrinsic variable, and MathML as the value of anything but a source. Python ignores them. A `bgf:variableValue` or `bgf:parameterValue` for a name the element doesn't have is reported when the model is read.

### Other behaviour

- **An element's ports share its flow variable.** Python gives each port its own copy, with the same name.
- **A template's `rdfs:label` is its `label`.** Python holds it as the template's symbol, which nothing else uses.
- **The framework can come from any RDF store.** `loadFramework({ quads })` takes oxigraph quads or those of any RDF/JS library, from any named graphs, and gives the same framework as Turtle.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
