/**
 * Write a bond graph model as CellML 2.0 with libCellML. Ported from
 * `cellml/__init__.py`, which wrote CellML 1.1 by hand with lxml.
 *
 * The plan:
 * - build a libCellML Model with one `main` component, as now, with units
 *   from `@physiomelinks/cellml-units` and initial values in each variable's
 *   units (6.1, `model.ts`);
 * - write equations with `toMathML` from `@physiomelinks/math-ast`, using
 *   `cnUnits` to give every `<cn>` a `cellml:units` (6.2, `equations.ts`);
 * - validate with libCellML's Validator and Analyser, and return their
 *   messages as issues (6.3, `check.ts`);
 * - return metadata linking variables to bond graph elements (6.4, `metadata.ts`);
 * - print with libCellML's Printer.
 */

import type { LibCellML } from '@physiomelinks/cellml-units'

import { IssueLog, type Issue } from '../issues.js'
import type { BondgraphModel } from '../model/model.js'
import { checkCellMLModel, validateCellMLModel, type CellMLChecks } from './check.js'
import { equationSections, type EquationSection } from './equations.js'
import { elementManifest, type ElementManifest } from './manifest.js'
import { CELLML_MODEL_URI, annotation, metadataTurtle, type ElementAnnotation } from './metadata.js'
import { buildCellMLModel, freeBuild, type CellMLModelBuild } from './model.js'

export interface CellMLResult {
  readonly cellml?: string
  /** RDF Turtle linking CellML variables back to bond graph elements, when asked for. */
  readonly metadata?: string
  /** Each element's and junction's CellML variables, as Python's `annotation()`. */
  readonly annotation?: readonly ElementAnnotation[]
  /** Each element's and junction's CellML variables and their roles, by diagram id, once the model is built. */
  readonly elements?: ElementManifest
  /** The Analyser's type for the model, such as `ode` or `dae`, once it validates; `invalid` if the Validator found errors. */
  readonly modelType?: string
  /** The checks that ran: fewer than asked for if the build or the Validator found errors. */
  readonly checks: CellMLChecks
  /** Each units name the known units define differently, and the name the CellML gives those units instead. */
  readonly renamedUnits?: Readonly<Record<string, string>>
  /** With `sections`, once the model is built: the equations' sections, in order, each with its equations' left-side variables. */
  readonly sections?: readonly EquationSection[]
  readonly issues: readonly Issue[]
}

export interface GenerateOptions {
  /** The IRI the CellML file will have, used in the metadata. Python's placeholder, `file:///CELLML_MODEL_URI`, if not given. */
  cellmlUri?: string
  /** Also return metadata. */
  metadata?: boolean
  /** The component's name and id, a CellML identifier; `main` if not given. */
  componentName?: string
  /** CellML documents whose units the host already has: a name they give other units is numbered (`mmol_per_L_1`) and reported. */
  knownUnits?: string | readonly string[]
  /** libCellML's checks to run; `full`, the Validator and the Analyser, if not given. */
  checks?: CellMLChecks
  /** Declare every variable `interface="public"`; `celldl2cellml()` doesn't, as BG-Tools doesn't. */
  publicInterfaces?: boolean
  /**
   * Write the equations in sections by role, ODEs last, with no comments, and
   * return the sections; `celldl2cellml()` writes BG-Tools' groups, ODEs first.
   */
  sections?: boolean
}

/**
 * The CellML 2.0 for a model with no issues: its units, and the `main`
 * component's variables and equations, checked by libCellML's Validator and
 * Analyser, with the annotation, the element manifest (`manifest.ts`) and,
 * if asked for, the metadata (6.4, `metadata.ts`).
 *
 * Problems building the model (a variable or equation that had to be left
 * out) give only issues. Problems the Validator or Analyser find give issues
 * along with the CellML, so it can be looked at.
 */
export function generateCellML(libcellml: LibCellML, model: BondgraphModel, options: GenerateOptions = {}): CellMLResult {
  const log = new IssueLog('build', model.iri || undefined)
  const build = buildCellMLModel(libcellml, model, log, {
    ...(options.componentName === undefined ? {} : { componentName: options.componentName }),
    ...(options.knownUnits === undefined ? {} : { knownUnits: options.knownUnits }),
    ...(options.publicInterfaces === undefined ? {} : { publicInterfaces: options.publicInterfaces }),
    ...(options.sections === undefined ? {} : { sections: options.sections }),
  })
  try {
    const elements = elementManifest(build, model)
    const sections = options.sections ? { sections: equationSections(build.equations, model) } : {}
    const renamed = build.units.renamed.size === 0 ? {} : { renamedUnits: Object.fromEntries(build.units.renamed) }
    if (log.issues.some((issue) => issue.severity === 'error')) return { elements, ...renamed, ...sections, checks: 'none', issues: log.issues }
    const check = runChecks(libcellml, build.model, log, options.checks ?? 'full')
    const printer = new libcellml.Printer()
    try {
      const cellml = printer.printModel(build.model, false)
      const metadata = options.metadata ? { metadata: metadataTurtle(build, model, options.cellmlUri ?? CELLML_MODEL_URI) } : {}
      return { cellml, ...metadata, annotation: annotation(build), elements, ...renamed, ...sections, ...check, issues: log.issues }
    } finally {
      printer.delete?.()
    }
  } finally {
    freeBuild(build)
  }
}

/** Run the checks asked for, returning the model's type, if found, and the checks that ran. */
function runChecks(
  libcellml: LibCellML,
  model: CellMLModelBuild['model'],
  log: IssueLog,
  checks: CellMLChecks,
): { modelType?: string; checks: CellMLChecks } {
  if (checks === 'none') return { checks }
  if (checks === 'validate') return validateCellMLModel(libcellml, model, log) > 0 ? { modelType: 'invalid', checks } : { checks }
  const check = checkCellMLModel(libcellml, model, log)
  return { modelType: check.type, checks: check.analysed ? 'full' : 'validate' }
}
