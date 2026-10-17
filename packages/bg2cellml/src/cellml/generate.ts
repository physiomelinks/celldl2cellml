/**
 * Write a bond graph model as CellML 2.0 with libCellML. Ported from
 * `cellml/__init__.py`, which wrote CellML 1.1 by hand with lxml.
 *
 * The plan:
 * - build a libCellML Model with one `main` component, as now;
 * - make units with `@physiomelinks/cellml-units`, converting initial values
 *   into each variable's units;
 * - write equations with `toMathML` from `@physiomelinks/math-ast`, using
 *   `cnUnits` to give every `<cn>` a `cellml:units`;
 * - validate with libCellML's Validator and Analyser, and return their
 *   messages as issues;
 * - print with libCellML's Printer.
 */

import type { LibCellML } from '@physiomelinks/cellml-units'

import type { Issue } from '../issues.js'
import type { BondgraphModel } from '../model/model.js'

export interface CellMLResult {
  readonly cellml?: string
  /** RDF Turtle linking CellML variables back to bond graph elements. */
  readonly metadata?: string
  readonly issues: readonly Issue[]
}

export interface GenerateOptions {
  /** The IRI the CellML file will have, used in the metadata. */
  cellmlUri?: string
  /** Also return metadata. */
  metadata?: boolean
}

export function generateCellML(
  _libcellml: LibCellML,
  _model: BondgraphModel,
  _options: GenerateOptions = {},
): CellMLResult {
  throw new Error('generateCellML() is not implemented yet')
}
