/**
 * Hand-worked references for cases whose Python references are wrong, so
 * parity can't be checked against them (plan chunk 7.1).
 *
 * example_B2 and example_B2_reduced are FAIRDO BG example 3.5,
 * A + 2B ⇌ C + 2D: the bonds from q_2 and to q_4 have `bgf:bondCount 2`,
 * which the Python version ignores (model.py:233), so its references are for
 * A + B ⇌ C + D. Patched Python writes `2*v_r_1 = -v_q_2`, which isn't valid
 * CellML, so it can't give a reference either.
 *
 * Worked from the models (bg-rdf/examples/example_B2*.ttl) and the chemical
 * template: every storage has K = 2 /mol and u = RT ln(K q), and the reaction
 * has κ = 0.1 mol/s and v = κ (exp(u_f/RT) − exp(u_r/RT)), with
 * u_f = u_1 + 2 u_2 and u_r = u_3 + 2 u_4. With the extent of reaction ξ
 * (q_1 = 1 − ξ, q_2 = 1 − 2ξ, q_3 = ξ, q_4 = 2ξ, from q = 1, 1, 0, 0 mol),
 * RT cancels in the flux:
 *
 *     dξ/dt = v = κ (K q_1 (K q_2)² − K q_3 (K q_4)²)
 *
 * which is integrated here with fixed-step RK4. Everything else follows from
 * ξ and v.
 *
 * Ours is simulated with CVODE's tolerances at 1e-10 rather than the
 * references' 1e-7. At 1e-7 the error in q is about 1e-6 mol, which
 * u = RT ln(K q) turns into about 4e-3 J/mol (RT ≈ 2579 J/mol): more than
 * the comparison allows where u is near 0, since its tolerance there is
 * almost all absolute. Python's references carry the same solver error, so
 * comparing with them hides it; this reference has none.
 */

import { recordedIndices, type SimulationSettings } from './simulate.js'
import type { SimulationResult, Trajectories } from './reference.js'

/** RT in the chemical template, J/mol. */
const RT = 2578.73058
const K = 2
const KAPPA = 0.1
/** Each species' initial amount (mol) and stoichiometry: −1 for a reactant, +1 for a product, times its bond count. */
const SPECIES = [
  { name: 'q_1', initial: 1, stoichiometry: -1 },
  { name: 'q_2', initial: 1, stoichiometry: -2 },
  { name: 'q_3', initial: 0, stoichiometry: 1 },
  { name: 'q_4', initial: 0, stoichiometry: 2 },
] as const

/** CVODE's relative and absolute tolerances for simulating ours. */
const SOLVER_TOLERANCE = 1e-10

/** RK4 steps per output step. */
const SUBSTEPS = 10

const amount = (i: number, extent: number): number => SPECIES[i]!.initial + SPECIES[i]!.stoichiometry * extent
const potential = (q: number): number => RT * Math.log(K * q)

/** The reaction's flux at an extent of reaction. */
function flux(extent: number): number {
  const [q1, q2, q3, q4] = SPECIES.map((_s, i) => amount(i, extent)) as [number, number, number, number]
  return KAPPA * (K * q1 * (K * q2) ** 2 - K * q3 * (K * q4) ** 2)
}

/** Extent of reaction at each output step, from 0 to `settings.end`. */
function extents(settings: SimulationResult['simulation']): number[] {
  const h = (settings.end - settings.start) / settings.steps / SUBSTEPS
  const result = [0]
  let x = 0
  for (let step = 0; step < settings.steps; step += 1) {
    for (let sub = 0; sub < SUBSTEPS; sub += 1) {
      const k1 = flux(x)
      const k2 = flux(x + (h / 2) * k1)
      const k3 = flux(x + (h / 2) * k2)
      const k4 = flux(x + h * k3)
      x += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
    }
    result.push(x)
  }
  return result
}

/**
 * The hand-worked result for FAIRDO BG example 3.5, with Python's reference's
 * simulation settings and variable names (which are the same in ours).
 * Variables named in `python` that this doesn't work out are an error.
 */
export function mixedReaction(python: SimulationResult): SimulationResult {
  const settings: SimulationSettings = {
    ...python.simulation,
    relativeTolerance: SOLVER_TOLERANCE,
    absoluteTolerance: SOLVER_TOLERANCE,
  }
  const indices = recordedIndices(settings.steps, settings.recordedEvery)
  const all = extents(settings)
  const xi = indices.map((i) => all[i]!)
  const v = xi.map(flux)
  const q = SPECIES.map((_s, i) => xi.map((x) => amount(i, x)))
  const rate = SPECIES.map((s) => v.map((f) => s.stoichiometry * f))
  const u = q.map((values) => values.map(potential))
  const sum = (a: number[], b: number[]): number[] => a.map((x, i) => x + 2 * b[i]!)

  const known: Trajectories = {
    v_Re_c: v,
    // The one nodes either side of the reaction (example_B2 only)
    v_r_1: v,
    v_r_2: v,
    u_f_Re_c: sum(u[0]!, u[1]!),
    u_r_Re_c: sum(u[2]!, u[3]!),
  }
  const states: Trajectories = {}
  const rates: Trajectories = {}
  SPECIES.forEach((s, i) => {
    states[s.name] = q[i]!
    rates[s.name] = rate[i]!
    known[`v_${s.name}`] = rate[i]!
    known[`u_${s.name}`] = u[i]!
    // The zero node at each storage (example_B2 only)
    known[`u_${i + 1}`] = u[i]!
  })

  const algebraics: Trajectories = {}
  for (const name of Object.keys(python.algebraics)) {
    const values = known[name]
    if (values === undefined) throw new Error(`No hand-worked value for ${name}`)
    algebraics[name] = values
  }
  for (const name of [...Object.keys(python.states), ...Object.keys(python.rates)]) {
    if (states[name] === undefined) throw new Error(`No hand-worked value for ${name}`)
  }
  const voi = { ...python.voi, values: indices.map((i) => settings.start + (i * (settings.end - settings.start)) / settings.steps) }
  return { simulation: settings, voi, states, rates, algebraics }
}
