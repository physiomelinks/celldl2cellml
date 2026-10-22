# @physiomelinks/bg2cellml

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) (v0.11.2) so the CellDL Editor and PhLynx don't need Pyodide, which is about 24 MB of downloads. It keeps the `celldl2cellml()` interface of `@celldl/editor-python-tools`, so switching should only need a change of import.

> [!NOTE]
> The converter is complete: it reads the BG-RDF framework and models, builds the bond network and equations, and writes CellML 2.0 with libCellML, with metadata. Every BG-RDF example and variant simulates as the Python version's CellML does, or, where Python has a bug, as a hand-worked reference and the PMR model do (see below).

## Usage

```sh
npm install @physiomelinks/bg2cellml libcellml.js oxigraph
```

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
// or, from N-Quads text, such as another converter's converter.frameworkNQuads():
converter.loadFramework({ nquads })

const { cellml, metadata, issues, exception } = await converter.celldl2cellml(celldlSvg, {
  sourceUri: 'https://example.org/rc.celldl',         // an absolute IRI: a file as file:///C:/My%20models/rc.celldl
  metadata: true,
})
```

`celldl2cellml` keeps `@celldl/editor-python-tools`' output: CellML only when there are no issues, and issues as strings. `convert` is for applications that show the result, such as PhLynx:

```js
const result = await converter.convert(celldlSvg, {
  sourceUri: 'https://example.org/rc.celldl',         // optional: DEFAULT_SOURCE_URI, under https://bg-rdf.org/models/local/
  componentName: 'rc',                               // the CellML component's name and id prefix; `main` by default
})
// result.ok: there is CellML, the Analyser can run it, and there are no errors
// result.cellml comes back with warnings too; result.issues, .errors and .warnings are { message, severity, stage, subject?, elementId? }
// result.modelIri, .baseUri, .modelType, .runnable, .generator ({ name, version }) and .framework.version (BG-RDF's owl:versionInfo)
```

`checks` chooses libCellML's checks, which are nearly all of a conversion's time (about 15 ms an element): `full` (the default) runs the Validator and the Analyser, `validate` the Validator alone, and `none` neither, giving the CellML, the element manifest and the issues found building the model in a tenth of the time. Without the Analyser, `result.runnable` is `undefined` (unless the Validator found errors, when it is `false`), and `result.checks` says which checks ran: fewer than asked for when the model had errors before them. A host converting as the user edits can run `none` after each edit and `full` once editing stops. `celldl2cellml` always runs both.

An issue's `elementId` is its subject's IRI fragment, such as a CellDL diagram's `<g id>`, and is the same whether the document's Turtle uses relative or absolute IRIs (`elementIdOf`).

`result.elements` is the element manifest, keyed the same way (by IRI for an element outside the source): each element's and junction's `{ iri, kind, symbol, template?, label?, primary?, variables }`, where `kind` is `element`, `one`, `zero` or `transform`, and each variable written to the CellML is `{ name, role, ucum, units }` with `role` one of `flow`, `potential`, `quantity`, `parameter`, `ratio` or `other`. A variable two elements share, such as a one node's flow that a transform node's port takes, is listed for both. `primary` is a one or zero node's own variable, a transform node's ratio, an element's intrinsic variable (a capacitor's `q`, a source's potential or flow), or else its first port's flow. `toViewerAnnotations(result.elements)` turns it into `@celldl/viewer` annotations, `{ [svgId]: { label, primary, variables, tooltip } }`, with a tooltip line such as `v_1 (flow, C/s)` for each variable unless `{ tooltip }` gives another.

In Node, also pass a `domParser` (`new DOMParser()` from `@xmldom/xmldom`); browsers have their own. With Vite, keep both modules out of dependency pre-bundling (`optimizeDeps: { exclude: ['libcellml.js', 'oxigraph'] }`), as each finds its `.wasm` from its own URL. [`examples/browser`](https://github.com/physiomelinks/celldl2cellml/tree/main/examples/browser) in the repository is a complete page.

### In a Web Worker

`@physiomelinks/bg2cellml/worker` converts in a module worker, so the checks never hold up the page. The worker has its own libCellML and oxigraph; its script imports them, so it works with any bundler:

```js
// convert-worker.js
import createLibCellML from 'libcellml.js'
import initOxigraph, * as oxigraph from 'oxigraph/web.js'
import { startConversionWorker } from '@physiomelinks/bg2cellml/worker'

startConversionWorker({ libcellml: createLibCellML, oxigraph, initOxigraph })
```

```js
// the page
import { createConversionWorker } from '@physiomelinks/bg2cellml/worker'

const worker = createConversionWorker(new Worker(new URL('./convert-worker.js', import.meta.url), { type: 'module' }), {
  framework: { nquads: converter.frameworkNQuads() },  // or { ontology, templates }: text, as it is posted
  wasm: { libcellml: libcellmlWasmUrl, oxigraph: oxigraphWasmUrl },  // optional: the .wasm files' URLs, such as Vite's `?url` imports
  defaults: { rdfSource: true, knownUnits },          // optional: options every conversion gets unless it gives its own
})
await worker.ready                                    // { framework: { version }, timings }; rejects if the worker couldn't start

const { result, timings } = await worker.convert(turtle, { sourceUri, checks: 'none' })

const quick = worker.latest()                         // latest wins: one request in the worker at a time,
const full = worker.latest()                          // each latest() its own lane
const conversion = await quick(turtle, { checks: 'none' })  // undefined if a later quick() call overtook it
worker.setDefaults({ rdfSource: true, knownUnits: newUnits })
worker.terminate()
```

The worker gets a DOMParser for the framework's MathML and CellDL sources from `@xmldom/xmldom`, a dependency, when it has none. `createConversionHandler(setup)` is the worker's message handler on its own, for another transport or a test: it takes the `WorkerRequest`s `init`, `defaults` and `convert` (`{ seq, source, rdfSource?, options?, lane? }`) and resolves to the `WorkerResponse`s `ready`, `result` (`{ seq, result, timings }`), `superseded` or `error`. A request that hasn't started when a newer one in its lane arrives is `superseded`.

## Layout

| Path | Contents | Python original | Status |
|---|---|---|---|
| `src/converter.ts` | `Converter`: loads the framework, runs `celldl2cellml` | `editor-python-tools` glue | Done |
| `src/convert.ts`, `src/version.ts` | `convert`: CellML with warnings, structured issues, the component's name; `GENERATOR` | (none) | Done |
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
| `src/cellml/model.ts` | The CellML model's units and component variables (`main` by default) | `CellMLModel`, `symbol_sort_key` | Done (6.1) |
| `src/cellml/equations.ts` | The equations as MathML in `main`, grouped and ordered as Python | `__equations_to_mathml` | Done (6.2) |
| `src/cellml/check.ts` | libCellML's Validator and Analyser, their messages as issues | (none) | Done (6.3) |
| `src/cellml/metadata.ts`, `src/rdf/turtle.ts` | Metadata linking CellML variables to bond graph elements, as Turtle, and the element-to-variables annotation | `CellMLModel.metadata`, `annotation` | Done (6.4) |
| `src/cellml/manifest.ts` | The element manifest, and `toViewerAnnotations` | (none) | Done |
| `src/cellml/generate.ts` | CellML 2.0 through libCellML, plus metadata | `cellml/__init__.py` | Done |
| `src/worker/` | `@physiomelinks/bg2cellml/worker`: the worker's message handler and the page's client | (none) | Done |

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
- **An element bonded straight to one acting as a junction shares its value.** A port of an element that isn't acting as a junction, bonded straight to a source or composite element, takes its potential when it acts as a zero node and its flow when it acts as a one node, as it would through that junction: a `bgf:ChemicalReaction` bonded straight to a `bgf:ChemicalStorageNode` takes the store's potential at that port. Python gives the port no equation, so such a model is underconstrained; the BG-RDF examples don't have one, so their CellML is unchanged.
- **Bond counts and bond directions reach an element's port.** A port bonded `n` times (`bgf:bondCount`) to a junction or to an element acting as one carries `n` times its flow (one node) or potential (zero node), and a flow is negated when the bond runs against the port: out of an inward or undirected port, such as a store's, or into an outward one. So a store bonded with a count of 2 from itself to a composite `bgf:ChemicalReactionNode`, as the CellDL editor's Reactions panel draws a substrate with coefficient 2, loses twice the reaction's flow. Python sets the port's flow or potential equal to the junction's whatever the count and direction. No BG-RDF example has such a bond, so their CellML is unchanged.
- **Copies get names of their own (as in Finbar Argus's BG-Tools).** Two elements or junctions with one symbol, species and location, such as two drawings of a chemostat, would share their variables in Python v0.11.2, which over- or underconstrains the model. As in his BG-Tools (`feat/constitutive-laws`, `__unique_name`), the first in IRI order (elements, then junctions) keeps the name and a later one is named from its IRI's fragment (`Se_A_2`, or a CellDL id such as `ID_00000007`), numbered `_2`, `_3` if that is taken too. Each copy is a separate element: copies of a chemostat hold the same potential, each with its own flow, and copies of a store are separate pools, which is reported as a warning since a store drawn twice is more likely a mistake.

### Reported where Python carries on

- **A source URI that isn't an absolute IRI is reported.** `celldl2cellml` checks `sourceUri`, and `cellmlUri` if given, before reading anything, and says what's wrong: `sourceUri isn't an absolute IRI: "C:\\Users\\Some One\\rc.celldl" (...)`, with how to give a file path. Python fails on such a URI with oxigraph's message alone, `Invalid IRI code point ' '`, as the CellDL Editor did on Windows (BG-Tools' `tests/models/rdf_error.celldl`).
- **Equations naming unknown variables are reported.** Python writes them anyway, giving CellML that can't be valid; this happens with a resistor or reaction whose port has no bond, whose relation keeps the template's potential.
- **Clashing variables are reported.** Python writes one CellML variable per symbol, keeping the first; so do we (elements and junctions now have names of their own, so this is down to template and domain names), but two variables with one symbol and different units or values, or a variable named as `t` or a domain constant, are reported (Python would write two variables with one name for the latter). Two domains whose constant of one name differs are reported too.
- **Symbols are substituted all at once.** Python renames a relation's names one at a time and fails if a symbol is already there; here a symbol that would give two variables one name is reported. A variable given another element's intrinsic variable must be in the same units, not just pint-equal ones. A source's MathML may use only its own variables, the domain's constants and `t`.
- **Elements in different domains joined by bonds are reported.** Python means to, but its check can never fire (it marks a node seen whenever it gives it a domain), so the first domain to arrive wins. Here each set of joined nodes takes the domain of its first element, and each other domain in it is reported once: `Node #R_m with domain bgf:Mechanical incompatible with bgf:Electrical`.
- **A transform node's ports are checked.** A port bonded to anything but one node, or to a node that isn't a one or zero node or an element acting as one, is reported; Python leaves the port without variables. A transform node with no ratio is reported as such, and a ratio given as a plain number is dimensionless (Python rejects it).
- **Junctions must be one, zero or transform nodes.** A junction of another class under `bgf:JunctionStructure`, such as `bgf:ZeroStorageNode`, or with two types, is reported and left out. Python accepts it and gives it no variables. The exception is a composite element, such as a `bgf:ChemicalStorageNode`, that is also listed under `bgf:hasBondElement`, as the CellDL editor writes it: it is read as the element and not as a junction, which gives Python's CellML.
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
