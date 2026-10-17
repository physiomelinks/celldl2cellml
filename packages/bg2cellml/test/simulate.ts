/**
 * Simulate CellML with libOpenCOR's WebAssembly build, returning results in
 * the same form as the reference files, so `compareResults()` can compare them.
 *
 * It mirrors `simulate_document()` in tools/reference/generate.py: the same
 * simulation settings, solver tolerances and recorded points.
 */

import createLibOpenCOR, { type MainModule, type SolverCvode } from '@opencor/libopencor'

import type { SimulationResult, Trajectories } from './reference.js'

export type LibOpenCOR = MainModule

/** The simulation settings stored with each reference. */
export type SimulationSettings = SimulationResult['simulation'] & {
  relativeTolerance?: number | null
  absoluteTolerance?: number | null
}

let libOpenCOR: Promise<LibOpenCOR> | undefined

/** Load libOpenCOR once per test worker. */
export function loadLibOpenCOR(): Promise<LibOpenCOR> {
  libOpenCOR ??= createLibOpenCOR()
  return libOpenCOR
}

export class SimulationError extends Error {
  override name = 'SimulationError'
}

/** `main/q_1` -> `q_1`, `main/q_1'` -> `q_1`, as the reference generator names them. */
export function shortName(name: string): string {
  return name.split('/').at(-1)!.replace(/'$/, '')
}

/**
 * The output points the reference generator records: every `recordedEvery`th
 * point from 0, plus the last point if the stride doesn't land on it.
 */
export function recordedIndices(steps: number, recordedEvery: number): number[] {
  const indices: number[] = []
  for (let i = 0; i <= steps; i += recordedEvery) indices.push(i)
  if (indices.at(-1) !== steps) indices.push(steps)
  return indices
}

function issueMessages(logger: { issueCount: number; issue(i: number): { description: string } | null }): string[] {
  const messages: string[] = []
  for (let i = 0; i < logger.issueCount; i += 1) messages.push(logger.issue(i)?.description ?? 'Unknown issue')
  return messages
}

let fileCount = 0

/**
 * Simulate a CellML document (1.1 or 2.0). Throws `SimulationError` with
 * libOpenCOR's messages if the CellML can't be loaded, instantiated or run.
 */
export function simulate(loc: LibOpenCOR, cellml: string, settings: SimulationSettings): Omit<SimulationResult, 'simulation'> {
  // libOpenCOR's file manager keys files by name, so each simulation gets its own
  fileCount += 1
  const file = new loc.File(`bg2cellml-${fileCount}.cellml`)
  // The contents must be set before the SED-ML document is made from the file
  file.setContents(new TextEncoder().encode(cellml))
  const document = new loc.SedDocument(file)
  let instance: ReturnType<typeof document.instantiate> = null
  try {
    if (file.hasIssues) throw new SimulationError(`CellML issues: ${issueMessages(file).join('; ')}`)
    if (document.hasIssues) throw new SimulationError(`SED-ML issues: ${issueMessages(document).join('; ')}`)

    const simulation = document.simulations.get(0) as unknown as {
      outputStartTime: number
      outputEndTime: number
      numberOfSteps: number
      odeSolver: SolverCvode | null
    }
    simulation.outputStartTime = settings.start
    simulation.outputEndTime = settings.end
    simulation.numberOfSteps = settings.steps
    if (simulation.odeSolver !== null) {
      if (settings.relativeTolerance != null) simulation.odeSolver.relativeTolerance = settings.relativeTolerance
      if (settings.absoluteTolerance != null) simulation.odeSolver.absoluteTolerance = settings.absoluteTolerance
    }

    try {
      instance = document.instantiate()
      if (instance === null) throw new SimulationError('libOpenCOR could not instantiate the simulation')
      if (instance.hasIssues) throw new SimulationError(`Instantiation issues: ${issueMessages(instance).join('; ')}`)
      instance.run()
    } catch (error) {
      // libOpenCOR's WebAssembly build 1.20261016.1 traps, instead of reporting an
      // issue, on some models the Python build reports (a model with no components)
      if (error instanceof WebAssembly.RuntimeError) {
        throw new SimulationError(`libOpenCOR crashed while simulating: ${error.message}`, { cause: error })
      }
      throw error
    }
    if (instance.hasIssues) throw new SimulationError(`Simulation issues: ${issueMessages(instance).join('; ')}`)

    const task = instance.tasks.get(0)
    if (task == null) throw new SimulationError('The simulation has no task')
    const indices = recordedIndices(settings.steps, settings.recordedEvery)
    const pick = (values: ArrayLike<number>): number[] => indices.map((i) => values[i]!)
    const collect = (count: number, name: (i: number) => string, values: (i: number) => ArrayLike<number>): Trajectories => {
      const result: Trajectories = {}
      for (let i = 0; i < count; i += 1) result[shortName(name(i))] = pick(values(i))
      return result
    }
    return {
      voi: { name: shortName(task.voiName), units: task.voiUnit, values: pick(task.voi) },
      states: collect(task.stateCount, (i) => task.stateName(i), (i) => task.state(i)),
      rates: collect(task.rateCount, (i) => task.rateName(i), (i) => task.rate(i)),
      algebraics: collect(task.algebraicVariableCount, (i) => task.algebraicVariableName(i), (i) => task.algebraicVariable(i)),
    }
  } finally {
    // Clean-up mustn't hide the error being thrown, so failures here are ignored
    for (const release of [
      () => instance?.delete(),
      () => document.delete(),
      () => loc.FileManager.instance().unmanage(file),
      () => file.delete(),
    ]) {
      try {
        release()
      } catch {
        // already released, or the module trapped
      }
    }
  }
}
