"""
Generate reference results for the JavaScript bg2cellml from the Python bg2cellml.

For each case this:

1. converts the BG-RDF model to CellML with the Python bg2cellml,
2. simulates the CellML with libOpenCOR, and
3. writes the CellML and the simulated states, rates and algebraic variables
   to packages/bg2cellml/test/reference/.

It also writes framework.json: the BG-RDF framework as the Python version loads
it (domains, element templates, junctions and composites), for testing the
framework loader. `--framework-only` rewrites just that file.

And for each case the Python version can build, models/<case>.json: the model's
elements, junctions and bonds as loaded, its bond network, its variables and its
equations, for testing the model a stage at a time before any CellML exists.
`--fixtures-only` rewrites framework.json and these, without simulating.

Example models come from the bg-rdf submodule. Variant models in
packages/bg2cellml/test/models/ trigger bugs in the Python version; each names
the example it should simulate exactly like. For those, the Python result is
recorded in the manifest but the reference is the example's.

Run from the repository root:

    uv run --project tools/reference python tools/reference/generate.py --bg-tools ../bg-tools

`--bg-tools` is a checkout of https://github.com/CellDL/BG-Tools at the version
being used as the reference. The released wheel can't be used because it
doesn't include the `oximock` module that `bg2cellml.rdf` imports.
"""

import argparse
import asyncio
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import libopencor as loc

# ------------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
BG_RDF = REPO_ROOT / 'bg-rdf'
MODELS_DIR = REPO_ROOT / 'packages/bg2cellml/test/models'
OUTPUT_DIR = REPO_ROOT / 'packages/bg2cellml/test/reference'

BG_RDF_TEMPLATES = ['chemical.ttl', 'electrical.ttl', 'hydraulic.ttl', 'mechanical.ttl']

# Simulation settings, from the comments at the top of each BG-RDF example.
SIMULATIONS = {
    'RCR':                  (0.1,    100),
    'RCR_reduced':          (0.1,    100),
    'example_A1':           (100.0,  100),
    'example_A1_reduced':   (100.0,  100),
    'example_A2':           (1000.0, 1000),
    'example_A2_reduced':   (1000.0, 1000),
    'example_A3':           (0.5,    500),
    'example_A3_reduced':   (0.5,    500),
    'example_B1':           (40.0,   4000),
    'example_B1_reduced':   (40.0,   4000),
    'example_B2':           (4.0,    4000),
    'example_B2_reduced':   (4.0,    4000),
    'example_RC':           (0.1,    100),
    'example_RC_reduced':   (0.1,    100),
}

# Variants: model file (in MODELS_DIR) -> the example it should match.
VARIANTS = {
    'RC_labelled_bonds':  'example_RC',
    'RC_plain_number':    'example_RC',
    'RC_prefixed_values': 'example_RC',
}

# Independent checks of the Python output against hand-built models in PMR,
# as BG-Tools' own (currently broken) tests did.
PMR_CHECKS = {
    'example_A1': 'pmr/Simple_electrical_circuit/FAIRDO BG example 3.1',
    'example_B1': 'pmr/Simple_biochemical_reaction/FAIRDO BG example 3.4',
}

# Tolerances for comparing trajectories. These are what BG-Tools' tests used.
REL_TOLERANCE = 2e-4
ABS_TOLERANCE = 1e-6

# At most this many output points are stored per case; the simulation itself
# runs at the full number of steps.
MAX_RECORDED_POINTS = 100

SIGNIFICANT_DIGITS = 9

# ------------------------------------------------------------------------------

def source_iri(path: Path) -> str:
    """A stable base IRI, so generated CellML doesn't depend on where the repo is."""
    rel = path.relative_to(REPO_ROOT).as_posix()
    if rel.startswith('bg-rdf/'):
        return f'https://github.com/CellDL/BG-RDF/blob/{bg_rdf_tag()}/{rel[len("bg-rdf/"):]}'
    return f'https://github.com/physiomelinks/bg-2-cellml/blob/main/{rel}'

def git(path: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(path), *args], capture_output=True, text=True, check=True).stdout.strip()

_TAG = None
def bg_rdf_tag() -> str:
    global _TAG
    if _TAG is None:
        try:
            _TAG = git(BG_RDF, 'describe', '--tags', '--exact-match')
        except subprocess.CalledProcessError:
            _TAG = git(BG_RDF, 'rev-parse', 'HEAD')
    return _TAG

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

# JSON has no infinities or NaN, so they're stored as these strings. Keeping
# them distinct matters: a chemical potential RT*ln(K*q) is -Infinity when q is
# 0, which is expected, while NaN would mean something has gone wrong.
NON_FINITE = {math.inf: 'Infinity', -math.inf: '-Infinity'}

def encode(v: float) -> float | str:
    return NON_FINITE.get(v, 'NaN') if not math.isfinite(v) else v

def decode(v: float | str) -> float:
    return float(v.replace('Infinity', 'inf')) if isinstance(v, str) else v

def rounded(values) -> list[float | str]:
    out = []
    for v in values:
        v = float(v)
        if not math.isfinite(v):
            out.append(encode(v))
        elif v == 0.0:
            out.append(0.0)
        else:
            out.append(float(f'{v:.{SIGNIFICANT_DIGITS}g}'))
    return out

_NUMBER_ARRAY = re.compile(r'\[\s*((?:[-+0-9.eE,\s]|"-?Infinity"|"NaN")*?)\s*\]')

def to_json(data) -> str:
    """Indented JSON, with arrays of numbers kept on one line."""
    text = json.dumps(data, indent=1)
    return _NUMBER_ARRAY.sub(lambda m: '[' + ', '.join(v.strip() for v in m.group(1).split(',')) + ']', text) + '\n'

def short_name(name: str) -> str:
    """`main/q_1` -> `q_1`, `main/q_1'` -> `q_1`."""
    return name.split('/')[-1].rstrip("'")

# ------------------------------------------------------------------------------

def load_framework(bg_tools_modules):
    RdfGraph, BondgraphFramework, BGF_ONTOLOGY_URI, BGF_TEMPLATE_URI_PREFIX = bg_tools_modules
    framework = BondgraphFramework()
    graph = RdfGraph()
    graph.load(BGF_ONTOLOGY_URI, (BG_RDF / 'schema/ontology.ttl').read_text())
    for name in BG_RDF_TEMPLATES:
        graph.load(BGF_TEMPLATE_URI_PREFIX + name, (BG_RDF / 'templates' / name).read_text())
    framework.add_statements(graph.statements())
    if framework.has_issues:
        raise RuntimeError(f'Issues loading the BG-RDF framework: {[i.reason for i in framework.issues]}')
    return framework

# ------------------------------------------------------------------------------

BASE_DIMENSIONS = {
    '[length]': 'm', '[mass]': 'kg', '[time]': 's', '[current]': 'A', '[substance]': 'mol',
    '[temperature]': 'K', '[luminosity]': 'cd',
}

def units_fixture(units) -> dict | None:
    """Python's units as pint names them, and as a scale and SI base units written in UCUM."""
    if units is None:
        return None
    unit = units._Units__units
    base = (1 * unit).to_base_units()
    dimensions = {d: e for d, e in dict(base.dimensionality).items() if e}
    unknown = set(dimensions) - set(BASE_DIMENSIONS)
    if unknown:
        raise RuntimeError(f'No UCUM base units for {unknown} in {unit}')
    terms = [f'{BASE_DIMENSIONS[d]}{"" if e == 1 else int(e)}' for d, e in sorted(dimensions.items())]
    return {'pint': str(unit), 'scale': float(f'{base.magnitude:.15g}'), 'base': '.'.join(terms) or '1'}

def term_value(term):
    """An IRI or literal as a string. Variable types can be left as named nodes."""
    return term if term is None or isinstance(term, (str, int, float)) else term.value

def variable_fixture(variable) -> dict | None:
    if variable is None:
        return None
    value = variable.value
    return {
        'name': variable.name,
        'symbol': variable.symbol,
        'type': term_value(variable.type),
        'units': units_fixture(variable.units),
        'value': None if value is None else {'magnitude': value.value, 'units': units_fixture(value.units)},
    }

def labelled_fixture(labelled) -> dict:
    # Python passes labels where symbols belong, and some are literals rather than strings
    return {'iri': labelled.uri.value, 'symbol': term_value(labelled.symbol), 'label': term_value(labelled.label)}

def relation_fixture(relation, sympy_to_mathml) -> dict | None:
    if relation is None:
        return None
    return {
        'variables': relation.variables,
        'equations': [{'text': str(eq), 'mathml': sympy_to_mathml(eq.sympy_equation())} for eq in relation.equations],
    }

def framework_fixture(framework, sympy_to_mathml) -> dict:
    """The framework as the Python version loads it, read through its private attributes."""
    private = lambda name: getattr(framework, f'_BondgraphFramework__{name}')
    domains = {}
    for iri, domain in private('domains').items():
        domains[iri] = {
            **labelled_fixture(domain),
            'name': domain.name,
            'flow': variable_fixture(domain.flow),
            'potential': variable_fixture(domain.potential),
            'quantity': variable_fixture(domain.quantity),
            'constants': [variable_fixture(c) for c in domain.constants],
            'intrinsicSymbols': domain.intrinsic_symbols,
        }
    templates = {}
    for iri, template in private('element_templates').items():
        ports = {}
        for port_id, port in template.power_ports.items():
            direction = port.direction
            ports[port_id] = {
                'iri': port._PowerPort__uri.value,
                'direction': term_value(direction),
                'bondCount': port._PowerPort__bond_count,
                'flow': {'name': port.flow.name, 'variable': variable_fixture(port.flow.variable)},
                'potential': {'name': port.potential.name, 'variable': variable_fixture(port.potential.variable)},
            }
        templates[iri] = {
            **labelled_fixture(template),
            'elementClass': term_value(template.element_class),
            'domain': template.domain.uri.value,
            'ports': ports,
            'parameters': {n: variable_fixture(v) for n, v in template.parameters.items()},
            'variables': {n: variable_fixture(v) for n, v in template.variables.items()},
            'intrinsicVariable': variable_fixture(template.intrinsic_variable),
            'constitutiveRelation': relation_fixture(template.constitutive_relation, sympy_to_mathml),
        }
    return {
        'issues': [issue.reason for issue in framework.issues],
        'domains': domains,
        'elementTemplates': templates,
        'junctions': {iri: labelled_fixture(j) for iri, j in private('junctions').items()},
        'compositeTemplates': {iri: {**labelled_fixture(c), 'template': c.template.uri.value}
                               for iri, c in private('composite_elements').items()},
        'elementDomains': [{'elementClass': term_value(element_class), 'domain': term_value(domain), 'template': template.uri.value}
                           for (element_class, domain), template in private('element_domains').items()],
    }

EXAMPLE_ELEMENTS = """
    SELECT DISTINCT ?uri ?type ?domain
    WHERE {
        ?model a bgf:BondgraphModel ; bgf:hasBondElement ?uri .
        ?uri a ?type .
        OPTIONAL { ?uri bgf:hasDomain ?domain }
    } ORDER BY ?uri ?type"""

EXAMPLE_JUNCTIONS = """
    SELECT DISTINCT ?uri ?type
    WHERE {
        ?model a bgf:BondgraphModel ; bgf:hasJunctionStructure ?uri .
        ?uri a ?type .
    } ORDER BY ?uri ?type"""

def lookups_fixture(framework, rdf) -> dict:
    """What `element_template()` and `junction()` give, for every template and composite, and in each example."""
    RdfGraph, namedNode, NAMESPACES = rdf
    bgf = NAMESPACES['bgf']
    found = lambda template: None if template is None else template.uri.value
    private = lambda name: getattr(framework, f'_BondgraphFramework__{name}')
    by_type = {iri: found(framework.element_template(namedNode(iri), None))
               for iri in [*private('element_templates'), *private('composite_elements')]}
    by_class_and_domain = []
    classes = sorted({t.element_class for t in private('element_templates').values()})
    for element_class in classes:
        for domain in private('domains'):
            by_class_and_domain.append({'elementClass': element_class, 'domain': domain,
                                        'template': found(framework.element_template(namedNode(element_class), namedNode(domain)))})
    examples = []
    for name in SIMULATIONS:
        path = BG_RDF / 'examples' / f'{name}.ttl'
        graph = RdfGraph(NAMESPACES)
        graph.load(source_iri(path), path.read_text())
        for row in graph.query(EXAMPLE_ELEMENTS):
            if row['type'].value.startswith(bgf):
                domain = row.get('domain')
                examples.append({'example': name, 'element': row['uri'].value, 'type': row['type'].value,
                                 'domain': None if domain is None else domain.value,
                                 'template': found(framework.element_template(row['type'], domain))})
        for row in graph.query(EXAMPLE_JUNCTIONS):
            if row['type'].value.startswith(bgf):
                examples.append({'example': name, 'junction': row['uri'].value, 'type': row['type'].value,
                                 'known': framework.junction(row['type'].value) is not None})
    return {'byType': by_type, 'byClassAndDomain': by_class_and_domain, 'examples': examples}

def write_framework(framework, sympy_to_mathml, rdf) -> dict:
    fixture = framework_fixture(framework, sympy_to_mathml)
    fixture['lookups'] = lookups_fixture(framework, rdf)
    (OUTPUT_DIR / 'framework.json').write_text(json.dumps(fixture, indent=1) + '\n')
    print(f'framework: {len(fixture["domains"])} domains, {len(fixture["elementTemplates"])} element templates, '
          f'{len(fixture["junctions"])} junctions, {len(fixture["compositeTemplates"])} composites')
    return {'reference': 'framework.json'}

# ------------------------------------------------------------------------------
# Intermediate fixtures: each model as the Python version builds it, before any
# CellML, so the model can be tested a stage at a time (plan chunk 5.0).

def term_fixture(term):
    """An RDF term: `{'iri': ...}`, or `{'literal': ..., 'datatype': ...}`."""
    if term is None:
        return None
    if hasattr(term, 'datatype'):
        datatype = term.datatype
        return {'literal': term.value, 'datatype': None if datatype is None else datatype.value}
    return {'iri': term.value}

def equation_fixture(equation, sympy_to_mathml) -> dict:
    return {'text': str(equation), 'mathml': sympy_to_mathml(equation.sympy_equation())}

def port_fixture(port) -> dict:
    return {
        'iri': port._PowerPort__uri.value,
        'direction': term_value(port.direction),
        'bondCount': port._PowerPort__bond_count,
        'flow': {'name': port.flow.name, 'variable': variable_fixture(port.flow.variable)},
        'potential': {'name': port.potential.name, 'variable': variable_fixture(port.potential.variable)},
    }

def loaded_element_fixture(element, sympy_to_mathml) -> dict:
    """An element as `BondgraphElement.__init__` leaves it, before the bond network exists."""
    private = lambda name, default=None: getattr(element, f'_BondgraphElement__{name}', default)
    relation = private('constitutive_relation')
    return {
        'iri': element.uri.value,
        'symbol': element.symbol,
        'label': term_value(element.label),
        # For a composite, Python keeps the element template it wraps
        'template': element.type,
        'elementClass': element.element_class,
        'domain': element.domain.uri.value,
        'impliedJunction': element.implied_junction,
        'ports': {port_id: port_fixture(port) for port_id, port in element.power_ports.items()},
        'variables': {name: variable_fixture(v) for name, v in element.variables.items()},
        'portVariableNames': sorted(private('port_variable_names')),
        # Parameter and variable values, as read: assigned once the network is built
        'values': {name: {'value': term_fixture(v.value), 'symbol': v.symbol}
                   for name, v in private('variable_values').items()},
        'intrinsicVariable': variable_fixture(private('intrinsic_variable')),
        'flow': None if element.flow is None else element.flow.symbol,
        'potential': None if element.potential is None else element.potential.symbol,
        'constitutiveRelation': None if relation is None
                                else [equation_fixture(eq, sympy_to_mathml) for eq in relation.equations],
    }

def loaded_junction_fixture(junction) -> dict:
    return {
        'iri': junction.uri.value,
        'type': junction.type,
        'symbol': junction.symbol,
        'label': term_value(junction.label),
        'value': term_fixture(junction._BondgraphJunction__value),
    }

def bond_fixture(bond) -> dict:
    # Python swaps a bond's label and count (model.py:233): `label` holds the
    # bgf:bondCount, and `bondCount` is always 1
    return {'iri': term_value(bond.uri), 'source': bond.source_id, 'target': bond.target_id,
            'label': term_value(bond.label), 'bondCount': bond.bond_count}

def network_fixture(graph) -> dict:
    nodes = {}
    for node, data in graph.nodes(data=True):
        port = data.get('power_port')
        nodes[node] = {
            'type': data.get('type'),
            'label': data.get('label'),
            'portType': data.get('port_type'),
            'element': None if 'element' not in data else data['element'].uri.value,
            'junction': None if 'junction' not in data else data['junction'].uri.value,
            'domain': None if 'domain' not in data else data['domain'].uri.value,
            'powerPort': None if port is None else {'flow': port.flow.variable.symbol,
                                                    'potential': port.potential.variable.symbol},
        }
    edges = [{'source': s, 'target': t, 'bondCount': d.get('bond_count')} for s, t, d in graph.edges(data=True)]
    return {'nodes': nodes, 'edges': edges}

def model_fixture(framework, BondgraphModel, sympy_to_mathml, name: str, path: Path) -> dict:
    """
    A model as the Python version builds it: its elements, junctions and bonds
    as loaded (5.1, 5.2), the bond network (5.2, 5.3), every element and
    junction variable once assigned (5.3, 5.4), and the equations (5.5).
    """
    loaded = {}
    make_bond_network = BondgraphModel._BondgraphModel__make_bond_network
    def snapshot(model):
        private = lambda name: getattr(model, f'_BondgraphModel__{name}')
        loaded['elements'] = [loaded_element_fixture(e, sympy_to_mathml) for e in private('elements').values()]
        loaded['junctions'] = [loaded_junction_fixture(j) for j in private('junctions').values()]
        loaded['bonds'] = [bond_fixture(b) for b in private('bonds')]
        make_bond_network(model)
    BondgraphModel._BondgraphModel__make_bond_network = snapshot
    try:
        model = framework.make_bondgraph_model(source_iri(path), path.read_text())
    finally:
        BondgraphModel._BondgraphModel__make_bond_network = make_bond_network
    return {
        'case': name,
        'sourceSha256': sha256(path),
        'model': {'iri': model.uri.value, 'label': term_value(model.label)},
        'issues': [issue.reason for issue in model.issues],
        **loaded,
        'network': network_fixture(model.network_graph),
        'variables': {
            'elements': {e.uri.value: {n: variable_fixture(v) for n, v in e.variables.items()} for e in model.elements},
            'junctions': {j.uri.value: {n: variable_fixture(v) for n, v in j.variables.items()} for j in model.junctions},
        },
        'equations': [{'provenance': eq.provenance, **equation_fixture(eq, sympy_to_mathml)} for eq in model.equations],
    }

def write_model_fixture(case: dict, python) -> None:
    """Write `models/<case>.json`, and name it in the case. Cases Python can't build get none."""
    framework, BondgraphModel, sympy_to_mathml = python
    path = REPO_ROOT / case['source']
    case.pop('intermediate', None)
    try:
        fixture = model_fixture(framework, BondgraphModel, sympy_to_mathml, case['name'], path)
    except Exception as e:
        print(f'{case["name"]}: no intermediate fixture ({type(e).__name__}: {e})')
        return
    (OUTPUT_DIR / 'models').mkdir(exist_ok=True)
    (OUTPUT_DIR / 'models' / f'{case["name"]}.json').write_text(json.dumps(fixture, indent=1) + '\n')
    case['intermediate'] = f'models/{case["name"]}.json'

# ------------------------------------------------------------------------------

def python_cellml(framework, path: Path) -> str:
    model = framework.make_bondgraph_model(source_iri(path), path.read_text())
    if model.has_issues:
        raise RuntimeError('; '.join(issue.reason for issue in model.issues))
    cellml = model.make_cellml_model().to_xml()
    # Drop the generation timestamp so reruns give identical files
    return re.sub(r'This CellML file was generated at \S+', 'This CellML file was generated', cellml)

# ------------------------------------------------------------------------------

def simulate_document(document, end_time: float, steps: int) -> dict:
    if document.has_issues:
        raise RuntimeError(f'SED-ML issues: {[i.description for i in document.issues]}')
    simulation = document.simulations[0]
    simulation.output_start_time = 0.0
    simulation.output_end_time = end_time
    simulation.number_of_steps = steps
    instance = document.instantiate()
    instance.run()
    if instance.has_issues:
        raise RuntimeError(f'Simulation issues: {[i.description for i in instance.issues]}')
    task = instance.tasks[0]

    stride = max(1, math.ceil(steps / MAX_RECORDED_POINTS))
    indices = list(range(0, steps + 1, stride))
    if indices[-1] != steps:
        indices.append(steps)
    pick = lambda values: rounded([values[i] for i in indices])

    solver = simulation.ode_solver
    return {
        'simulation': {
            'start': 0.0,
            'end': end_time,
            'steps': steps,
            'recordedEvery': stride,
            'odeSolver': solver.name,
            'relativeTolerance': getattr(solver, 'relative_tolerance', None),
            'absoluteTolerance': getattr(solver, 'absolute_tolerance', None),
        },
        'voi': {'name': short_name(task.voi_name), 'units': task.voi_unit, 'values': pick(task.voi)},
        'states': {short_name(task.state_name(i)): pick(task.state(i)) for i in range(task.state_count)},
        'rates': {short_name(task.rate_name(i)): pick(task.rate(i)) for i in range(task.rate_count)},
        'algebraics': {short_name(task.algebraic_variable_name(i)): pick(task.algebraic_variable(i))
                       for i in range(task.algebraic_variable_count)},
    }

def simulate_cellml(cellml: str, end_time: float, steps: int) -> dict:
    file = loc.File('model.cellml', False)
    file.contents = [ord(c) for c in cellml]
    if file.has_issues:
        raise RuntimeError(f'CellML issues: {[i.description for i in file.issues]}')
    return simulate_document(loc.SedDocument(file), end_time, steps)

def close(a, b) -> bool:
    a, b = decode(a), decode(b)
    if not (math.isfinite(a) and math.isfinite(b)):
        return (math.isnan(a) and math.isnan(b)) or a == b
    return abs(a - b) <= ABS_TOLERANCE + REL_TOLERANCE * abs(b)

def compare(actual: dict, expected: dict, groups=('states', 'rates', 'algebraics')) -> list[str]:
    """Differences between two results, comparing variables by name."""
    problems = []
    for group in groups:
        missing = sorted(set(expected[group]) - set(actual[group]))
        if missing:
            problems.append(f'{group} missing: {", ".join(missing)}')
        for name, values in expected[group].items():
            if name in actual[group]:
                bad = [i for i, (a, e) in enumerate(zip(actual[group][name], values)) if not close(a, e)]
                if bad:
                    i = bad[0]
                    problems.append(f'{group}.{name} differs at {len(bad)} points, '
                                    f'first at t={expected["voi"]["values"][i]}: {actual[group][name][i]} != {values[i]}')
    return problems

def compare_states_by_index(actual: dict, expected: dict) -> list[str]:
    """For PMR models, whose variable names differ: compare sorted state trajectories."""
    a = sorted(actual['states'].values(), key=lambda v: decode(v[-1]))
    e = sorted(expected['states'].values(), key=lambda v: decode(v[-1]))
    if len(a) != len(e):
        return [f'{len(a)} states != {len(e)} states']
    problems = []
    for n, (av, ev) in enumerate(zip(a, e)):
        bad = [i for i, (x, y) in enumerate(zip(av, ev)) if not close(x, y)]
        if bad:
            problems.append(f'state {n} differs at {len(bad)} points')
    return problems

# ------------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--bg-tools', required=True, type=Path, help='Checkout of CellDL/BG-Tools to use as the reference')
    parser.add_argument('--framework-only', action='store_true', help='Only rewrite framework.json')
    parser.add_argument('--fixtures-only', action='store_true',
                        help='Only rewrite framework.json and the models/ fixtures, without simulating')
    args = parser.parse_args()

    bg_tools = args.bg_tools.resolve()
    sys.path.insert(0, str(bg_tools))      # for `bg2cellml` and its `oximock` module
    from bg2cellml import __version__ as bg2cellml_version
    from bg2cellml.bondgraph.framework import (BGF_ONTOLOGY_URI, BGF_TEMPLATE_URI_PREFIX,
                                               BondgraphFramework)
    from bg2cellml.bondgraph.model import BondgraphModel
    from bg2cellml.mathml import sympy_to_mathml
    from bg2cellml.rdf import RdfGraph

    framework = load_framework((RdfGraph, BondgraphFramework, BGF_ONTOLOGY_URI, BGF_TEMPLATE_URI_PREFIX))
    from bg2cellml.bondgraph.namespaces import NAMESPACES
    from bg2cellml.rdf import namedNode
    framework_entry = write_framework(framework, sympy_to_mathml, (RdfGraph, namedNode, NAMESPACES))
    python = (framework, BondgraphModel, sympy_to_mathml)
    if args.framework_only or args.fixtures_only:
        manifest_path = OUTPUT_DIR / 'manifest.json'
        manifest = json.loads(manifest_path.read_text())
        if manifest['generator']['bgToolsCommit'] != git(bg_tools, 'rev-parse', 'HEAD'):
            raise RuntimeError(f'--{"framework" if args.framework_only else "fixtures"}-only needs the BG-Tools commit the other references came from')
        manifest['framework'] = framework_entry
        if args.fixtures_only:
            for case in manifest['cases']:
                write_model_fixture(case, python)
        manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
        return

    (OUTPUT_DIR / 'python').mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}
    cases = []

    for name, (end_time, steps) in SIMULATIONS.items():
        path = BG_RDF / 'examples' / f'{name}.ttl'
        cellml = python_cellml(framework, path)
        (OUTPUT_DIR / 'python' / f'{name}.cellml').write_text(cellml)
        result = simulate_cellml(cellml, end_time, steps)
        results[name] = result
        (OUTPUT_DIR / f'{name}.json').write_text(to_json({'case': name, **result}))
        case = {
            'name': name,
            'kind': 'example',
            'source': path.relative_to(REPO_ROOT).as_posix(),
            'sourceSha256': sha256(path),
            'baseIri': source_iri(path),
            'reference': f'{name}.json',
            'pythonCellml': f'python/{name}.cellml',
        }
        if name in PMR_CHECKS:
            pmr = BG_RDF / PMR_CHECKS[name]
            pmr_result = simulate_document(loc.SedDocument(loc.File(f'{pmr}.cellml')), end_time, steps)
            problems = compare_states_by_index(result, pmr_result)
            case['pmrCheck'] = {'model': f'bg-rdf/{PMR_CHECKS[name]}.cellml', 'agrees': not problems, 'problems': problems}
        cases.append(case)
        print(f'{name}: {len(result["states"])} states, {len(result["algebraics"])} algebraics'
              + (f', PMR check {"passed" if not case["pmrCheck"]["problems"] else "FAILED"}' if 'pmrCheck' in case else ''))

    for name, expected in VARIANTS.items():
        path = MODELS_DIR / f'{name}.ttl'
        end_time, steps = SIMULATIONS[expected]
        try:
            cellml = python_cellml(framework, path)
            problems = compare(simulate_cellml(cellml, end_time, steps), results[expected])
            python = {'status': 'differs', 'problems': problems} if problems else {'status': 'matches'}
        except Exception as e:
            python = {'status': 'error', 'error': f'{type(e).__name__}: {e}'}
        cases.append({
            'name': name,
            'kind': 'variant',
            'source': path.relative_to(REPO_ROOT).as_posix(),
            'sourceSha256': sha256(path),
            'baseIri': source_iri(path),
            'reference': f'{expected}.json',
            'python': python,
        })
        print(f'{name}: Python {python["status"]}')

    for case in cases:
        write_model_fixture(case, python)

    bg_rdf_files = (['schema/ontology.ttl'] + [f'templates/{t}' for t in BG_RDF_TEMPLATES])
    manifest = {
        'description': 'Reference results from the Python bg2cellml. Regenerate with tools/reference/generate.py.',
        'generator': {
            'bg2cellml': bg2cellml_version,
            'bgToolsCommit': git(bg_tools, 'rev-parse', 'HEAD'),
            'libopencor': loc.version_string(),
        },
        'bgRdf': {
            'tag': bg_rdf_tag(),
            'commit': git(BG_RDF, 'rev-parse', 'HEAD'),
            'files': {f: sha256(BG_RDF / f) for f in bg_rdf_files},
        },
        'tolerance': {'relative': REL_TOLERANCE, 'absolute': ABS_TOLERANCE},
        'framework': framework_entry,
        'cases': cases,
    }
    (OUTPUT_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Wrote {len(cases)} cases to {OUTPUT_DIR.relative_to(REPO_ROOT)}')

if __name__ == '__main__':
    main()
