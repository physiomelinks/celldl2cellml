"""
Generate reference results for the JavaScript bg2cellml from the Python bg2cellml.

For each case this:

1. converts the BG-RDF model to CellML with the Python bg2cellml,
2. simulates the CellML with libOpenCOR, and
3. writes the CellML and the simulated states, rates and algebraic variables
   to packages/bg2cellml/test/reference/.

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

def rounded(values) -> list[float | None]:
    out = []
    for v in values:
        v = float(v)
        if not math.isfinite(v):
            out.append(None)
        elif v == 0.0:
            out.append(0.0)
        else:
            out.append(float(f'{v:.{SIGNIFICANT_DIGITS}g}'))
    return out

_NUMBER_ARRAY = re.compile(r'\[\s*([-+0-9.eE,\snul]*?)\s*\]')

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
    if a is None or b is None:
        return a is b
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
    a = sorted(actual['states'].values(), key=lambda v: (v[-1] or 0.0))
    e = sorted(expected['states'].values(), key=lambda v: (v[-1] or 0.0))
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
    args = parser.parse_args()

    bg_tools = args.bg_tools.resolve()
    sys.path.insert(0, str(bg_tools))      # for `bg2cellml` and its `oximock` module
    from bg2cellml import __version__ as bg2cellml_version
    from bg2cellml.bondgraph.framework import (BGF_ONTOLOGY_URI, BGF_TEMPLATE_URI_PREFIX,
                                               BondgraphFramework)
    from bg2cellml.rdf import RdfGraph

    framework = load_framework((RdfGraph, BondgraphFramework, BGF_ONTOLOGY_URI, BGF_TEMPLATE_URI_PREFIX))

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
        'cases': cases,
    }
    (OUTPUT_DIR / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Wrote {len(cases)} cases to {OUTPUT_DIR.relative_to(REPO_ROOT)}')

if __name__ == '__main__':
    main()
