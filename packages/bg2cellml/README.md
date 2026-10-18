# @physiomelinks/bg2cellml

Generates CellML 2.0 from [BG-RDF](https://github.com/CellDL/BG-RDF) bond graph models, in JavaScript.

It ports the Python [bg2cellml](https://github.com/CellDL/BG-Tools) (v0.11.2) so the CellDL Editor and PhLynx don't need Pyodide, which is about 24 MB of downloads. It keeps the `celldl2cellml()` interface of `@celldl/editor-python-tools`, so switching should only need a change of import.

> [!WARNING]
> This is an early skeleton. The RDF wrapper, SPARQL queries, bond network and CellDL extraction work, and the framework loads in full: domains, element templates, junctions and composites. Models load as far as their elements, junctions, bonds and bond network, with domains spread through the network, junction and element variables assigned, values converted into their variables' units, constitutive relations in the elements' symbols, and the model's equations built; CellML generation isn't implemented yet.

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
| `src/framework/` | Domains, element templates, junctions, composites | `bondgraph/framework*.py` | Done |
| `src/model/network.ts` | `BondNetwork`, the directed graph of ports and junctions | networkx `DiGraph` | Done |
| `src/model/elements.ts`, `names.ts` | A model's elements: templates, symbols, ports, variables and values | `BondgraphElement`, `make_symbolic_name` | Done (5.1) |
| `src/model/junctions.ts`, `bonds.ts` | Junctions, bonds (listed or inferred) and the bond network | `BondgraphJunction`, `__generate_bonds`, `__make_bond_network` | Done (5.2) |
| `src/model/domains.ts`, `junctions.ts` | Domains through the network, and one, zero and transform node variables | `__check_and_assign_domains_to_bond_network`, `assign_node_variables`, `assign_transform_variables` | Done (5.3) |
| `src/model/element-variables.ts` | Element values, symbols and references, unit conversion, relations in the elements' symbols | `assign_variables` | Done (5.4) |
| `src/model/equations.ts` | The model's equations: constitutive relations, elements acting as junctions, junctions, transformers and gyrators | `build_expressions`, `build_equations` | Done (5.5) |
| `src/model/model.ts` | Loading a model (`until` stops at a stage, for tests) | `bondgraph/model*.py` | Done |
| `src/cellml/` | CellML 2.0 through libCellML, plus metadata | `cellml/__init__.py` | Stub |

## Differences from the Python version

- **CellML 2.0, written by libCellML.** It is validated and analysed before it's returned.
- **Units are converted.** Prefixed units work, and values are scaled to their variable's units. See `@physiomelinks/cellml-units`.
- **Known bugs fixed.** Bond labels and bond counts work, ports with only outputs get the right expression, and plain numbers such as `10.0` are accepted as values (Python rejects them under oxigraph). They're listed at the top of `src/model/model.ts`.
- **Symbols are substituted all at once.** Python renames a relation's names one at a time and fails if a symbol is already there; here a symbol that would give two variables one name is reported. A variable given another element's intrinsic variable must be in the same units, not just pint-equal ones. A source's MathML may use only its own variables, the domain's constants and `t`.
- **Equations are tidied, and solved for a variable.** Every equation built from the network is canonicalised, as sympy tidies Python's. With bond counts, Python can make `2*v_r_1` an equation's left side, which isn't valid CellML; here that equation is `v_r_1 = -v_q_2/2`. A port with only outputs gets the negated sum of its outputs, where Python's gives 0 (bug 4); with bonds joined to reactions as they are, no model reaches that case.
- **Bond counts are used, so `example_B2` differs from Python.** Python passes a bond's `rdfs:label` and `bgf:bondCount` to `BondgraphBond` the wrong way round (model.py:233), so a labelled bond fails and a bond count is ignored. Here both are read, so a model with a `bgf:bondCount` on a bond, such as BG-RDF's `example_B2` and `example_B2_reduced` (two bonds each with a count of 2), gives different equations and results from the Python version and its references. They should agree once the bug is fixed in BG-Tools: the generator also builds each model with the Python bug patched (`models/*.bug3-fixed.json`), and our equations for both models match those.
- **Elements in different domains joined by bonds are reported.** Python means to, but its check can never fire (it marks a node seen whenever it gives it a domain), so the first domain to arrive wins. Here each set of joined nodes takes the domain of its first element, and each other domain in it is reported once: `Node #R_m with domain bgf:Mechanical incompatible with bgf:Electrical`.
- **A transform node's ports are checked.** A port bonded to anything but one node, or to a node that isn't a one or zero node or an element acting as one, is reported; Python leaves the port without variables. A transform node with no ratio is reported as such, and a ratio given as a plain number is dimensionless (Python rejects it).
- **Junctions must be one, zero or transform nodes.** A junction of another class under `bgf:JunctionStructure`, such as `bgf:ZeroStorageNode`, or with two types, is reported and left out. Python accepts it and gives it no variables.
- **Bond problems Python skips are reported.** A bond with one end outside the model (Python silently ignores it), two bonds between the same nodes (networkx keeps the last), and a `bgf:bondCount` that isn't a positive integer.
- **A bad declaration doesn't sink the framework.** A domain or element template with a problem is reported and left out; the others still load. Python stops at the first problem.
- **Templates are checked more closely.** Every parameter and variable must appear in the constitutive relation (Python only compares counts), and ports without a direction, duplicate ports and duplicate names are reported (Python drops or overwrites them).
- **An ambiguous element class is reported.** An element given as a class and domain (`bgf:Reaction` in `bgf:Chemical`) where the domain has more than one template of that class finds nothing, and `templateIssue()` says which templates it could be. Python silently uses the last by IRI.
- **Each element must have exactly one template.** An element whose types give two templates, or that has two symbols, labels, domains, species or locations, is reported and left out. Python uses the first query row, or reports two templates but keeps the element.
- **Values an element can't use are reported.** A second `bgf:hasValue`, a value on an element with no intrinsic variable, and MathML as the value of anything but a source. Python ignores them. A `bgf:variableValue` or `bgf:parameterValue` for a name the element doesn't have is reported when the model is read.
- **An element's ports share its flow variable.** Python gives each port its own copy, with the same name.
- **A template's `rdfs:label` is its `label`.** Python holds it as the template's symbol, which nothing else uses.
- **Domain constants, and template parameters and variables, are sorted by name.** Python's order depends on its oxigraph build and how it orders blank nodes.
- **The framework can come from any RDF store.** `loadFramework({ quads })` takes oxigraph quads or those of any RDF/JS library, from any named graphs, and gives the same framework as Turtle.
- **Output text differs.** The equations are the same mathematically, but terms may be ordered differently. Parity is checked by simulation.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
