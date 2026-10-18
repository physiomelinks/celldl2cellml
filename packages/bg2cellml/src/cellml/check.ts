/**
 * Checking the CellML model with libCellML's Validator and Analyser (plan
 * chunk 6.3), which the Python bg2cellml doesn't do.
 *
 * Every message either gives is an issue, warnings included: the Analyser's
 * units messages are warnings, and bond graphs should be dimensionally
 * consistent, so a number that isn't dimensionless needs its units.
 *
 * A model the Analyser can't make runnable (underconstrained, overconstrained,
 * unsuitably constrained, invalid) is reported. ODE and DAE models are both
 * fine: like Python's, most models with junctions are DAEs, as some of their
 * equations form linear systems that libCellML leaves to be solved
 * numerically.
 */

import type { LibCellML, Logger, Model } from '@physiomelinks/cellml-units'

import type { IssueLog } from '../issues.js'

/** The Analyser's types of model that can be simulated. */
export const RUNNABLE_MODEL_TYPES: ReadonlySet<string> = new Set(['ode', 'dae', 'nla', 'algebraic'])

export interface CellMLCheck {
  /** The Analyser's type for the model, such as `ode` or `dae`; `invalid` if it didn't validate. */
  readonly type: string
  readonly stateCount: number
}

export type CellMLIssueLevel = 'error' | 'warning' | 'message'

/** Where a CellML issue comes from, and its level, as an issue's `cause`. */
export interface CellMLIssueCause {
  readonly checker: 'validator' | 'analyser'
  readonly level: CellMLIssueLevel
}

/** Validate and analyse a CellML model, reporting every message in `log`. */
export function checkCellMLModel(libcellml: LibCellML, model: Model, log: IssueLog): CellMLCheck {
  const validator = new libcellml.Validator()
  try {
    validator.validateModel(model)
    if (report(libcellml, validator, 'validator', 'CellML validation', log) > 0) return { type: 'invalid', stateCount: 0 }
  } finally {
    validator.delete?.()
  }

  const analyser = new libcellml.Analyser()
  try {
    analyser.analyseModel(model)
    const reported = report(libcellml, analyser, 'analyser', 'CellML analysis', log)
    const analysed = analyser.analyserModel()
    try {
      const type = libcellml.AnalyserModel.typeAsString(analysed.type())
      if (!RUNNABLE_MODEL_TYPES.has(type) && reported === 0) log.report(`CellML analysis: the model is ${type}`)
      return { type, stateCount: analysed.stateCount() }
    } finally {
      analysed.delete?.()
    }
  } finally {
    analyser.delete?.()
  }
}

/** Reports a Validator's or Analyser's messages, returning how many. */
function report(libcellml: LibCellML, logger: Logger, checker: CellMLIssueCause['checker'], prefix: string, log: IssueLog): number {
  const { Level } = libcellml.Issue
  const count = logger.issueCount()
  for (let index = 0; index < count; index += 1) {
    const issue = logger.issue(index)
    try {
      const level = issue.level().value
      const cause: CellMLIssueCause = {
        checker,
        level: level === Level.ERROR.value ? 'error' : level === Level.WARNING.value ? 'warning' : 'message',
      }
      log.report(`${prefix}: ${issue.description()}`, undefined, cause)
    } finally {
      issue.delete?.()
    }
  }
  return count
}
