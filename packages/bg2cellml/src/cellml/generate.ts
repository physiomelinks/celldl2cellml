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
 * - return metadata linking variables to bond graph elements (6.4);
 * - print with libCellML's Printer.
 */

import type { LibCellML } from '@physiomelinks/cellml-units'

import { IssueLog, type Issue } from '../issues.js'
import type { BondgraphModel } from '../model/model.js'
import { checkCellMLModel } from './check.js'
import { buildCellMLModel, freeBuild } from './model.js'

export interface CellMLResult {
  readonly cellml?: string
  /** RDF Turtle linking CellML variables back to bond graph elements. */
  readonly metadata?: string
  /** The Analyser's type for the model, such as `ode` or `dae`, once it validates. */
  readonly modelType?: string
  readonly issues: readonly Issue[]
}

export interface GenerateOptions {
  /** The IRI the CellML file will have, used in the metadata. */
  cellmlUri?: string
  /** Also return metadata. */
  metadata?: boolean
}

/**
 * The CellML 2.0 for a model with no issues: its units, and the `main`
 * component's variables and equations, checked by libCellML's Validator and
 * Analyser. Not yet with metadata (6.4).
 *
 * Problems building the model (a variable or equation that had to be left
 * out) give only issues. Problems the Validator or Analyser find give issues
 * along with the CellML, so it can be looked at.
 */
export function generateCellML(libcellml: LibCellML, model: BondgraphModel, _options: GenerateOptions = {}): CellMLResult {
  const log = new IssueLog()
  const build = buildCellMLModel(libcellml, model, log)
  try {
    if (log.hasIssues) return { issues: log.issues }
    const check = checkCellMLModel(libcellml, build.model, log)
    const printer = new libcellml.Printer()
    try {
      return { cellml: printer.printModel(build.model, false), modelType: check.type, issues: log.issues }
    } finally {
      printer.delete?.()
    }
  } finally {
    freeBuild(build)
  }
}
