/**
 * FAIRDO BG example 3.5 from PMR, the hand-built CellML 1.1 model BG-RDF's
 * example_B2 and example_B2_reduced are based on, as an independent check of
 * them (https://models.physiomeproject.org/e/b55/FAIRDO%20BG%20example%203.5.cellml).
 * The generator checks example_A1 and example_B1 against PMR models the same
 * way, but Python's results for B2 are wrong (it ignores `bgf:bondCount`), so
 * this one is checked here, against ours.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { SimulationResult, Trajectories } from './reference.js'

/** test/models/FAIRDO BG example 3.5.cellml, as downloaded from PMR. */
export const PMR_MIXED_REACTION = fileURLToPath(new URL('./models/FAIRDO BG example 3.5.cellml', import.meta.url))

/**
 * The PMR model, made valid for libCellML's Analyser, which libOpenCOR uses:
 * - its numbers have `cellml:units="dim"`, but it defines no `dim` units, so
 *   this adds the definition PMR's FAIRDO BG example 3.1.1 has;
 * - it gives `t`, the variable of integration, an initial value, so this
 *   removes it, as in PMR's examples 3.1 and 3.4.
 * Nothing else is changed.
 */
export function pmrMixedReaction(): string {
  const original = readFileSync(PMR_MIXED_REACTION, 'utf8')
  const fixed = original
    .replace(/(<model [^>]*>)/, '$1\n    <units name="dim">\n        <unit units="dimensionless"/>\n    </units>')
    .replace('<variable initial_value="0" name="t" units="second"/>', '<variable name="t" units="second"/>')
  // Both must have applied: if the file in PMR is fixed, these should go
  if (original.includes('<units name="dim">') || fixed.includes('initial_value="0" name="t"')) {
    throw new Error(`${PMR_MIXED_REACTION} has changed: check the fixes in test/pmr.ts`)
  }
  return fixed
}

/** PMR's names for the variables it shares with ours. States and rates have the same names. */
export const PMR_NAMES: Readonly<Record<string, string>> = {
  u_1: 'u_q_1',
  u_2: 'u_q_2',
  u_3: 'u_q_3',
  u_4: 'u_q_4',
  u_f: 'u_f_Re_c',
  u_r: 'u_r_Re_c',
  v_r: 'v_Re_c',
}

/**
 * A simulation of the PMR model with our names, keeping only the variables
 * the two have in common, so it can be the expected side of `compareResults()`.
 */
export function withOurNames(result: Omit<SimulationResult, 'simulation'>, simulation: SimulationResult['simulation']): SimulationResult {
  const algebraics: Trajectories = {}
  for (const [pmr, ours] of Object.entries(PMR_NAMES)) {
    const values = result.algebraics[pmr]
    if (values === undefined) throw new Error(`The PMR model has no ${pmr}`)
    algebraics[ours] = values
  }
  return { simulation, voi: result.voi, states: result.states, rates: result.rates, algebraics }
}
