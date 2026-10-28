/**
 * A BG-RDF bond graph model: its elements, junctions and bonds, and the
 * equations they give. Ported from `bondgraph/model.py` and `model_support.py`.
 *
 * Bugs in the Python version that shouldn't be carried over:
 * - `BondgraphBond` is given the label and the bond count in the wrong order,
 *   so a labelled bond crashes and `bgf:bondCount` on bonds is ignored.
 *   (Fixed in `bonds.ts`. Models with bond counts give different results
 *   from Python's until it is fixed there.)
 * - When a port only has outputs, its expression is built from the empty
 *   inputs list and comes out as 0.
 * - A port of an element bonded straight to a source or composite element
 *   gets no equation for the potential (zero node) or flow (one node) it
 *   shares with it. (Fixed in `equations.ts`.)
 * - The unknown-variable check (`name not in name not in ...`) never fires.
 *   (Fixed in `elements.ts`.)
 * - Plain numeric literals such as `10.0` are rejected as values. (Fixed:
 *   `readValue` reads them.)
 * - Two elements or junctions with one symbol, species and location, such
 *   as drawn copies of a chemostat, share their variables, which over- or
 *   underconstrains the model. (Fixed in `names.ts` as Finbar Argus's
 *   BG-Tools fixes it, but numbered: later copies are named `_2`, `_3`, ...
 *   Each copy is a separate element, so copies of a store are separate
 *   pools.)
 * - Values are checked for compatible units but not converted, so `1000 uF`
 *   is written as 1000 farads. (Fixed in `element-variables.ts`, and for
 *   one and zero nodes in `junctions.ts`.)
 */

import { compatible, convertValue, unitSystem, type LibCellML, type UnitSystemId } from '@physiomelinks/cellml-units'
import type { ParseOptions } from '@physiomelinks/math-ast'

import type { BondgraphFramework } from '../framework/framework.js'
import { DEFAULT_UNIT_SYSTEM, Rescaler, UNIT_SYSTEM_IRIS, UNIT_SYSTEM_PREDICATE, unitSystemForIri } from '../framework/unit-system.js'
import { IssueLog, documentOf } from '../issues.js'
import { RdfGraph, type OxigraphModule } from '../rdf/graph.js'
import { BONDGRAPH_MODEL, modelUnitSystemQuery } from '../rdf/queries.js'
import { buildNetwork, inferBonds, loadBonds, type BondgraphBond, type NetworkNode } from './bonds.js'
import { assignDomains } from './domains.js'
import { assignElementVariables } from './element-variables.js'
import { loadElements, type BondgraphElement } from './elements.js'
import { buildEquations, type ModelEquation } from './equations.js'
import { assignJunctionVariables, loadJunctions, type BondgraphJunction } from './junctions.js'
import { UniqueNames, prettyUri } from './names.js'
import { BondNetwork } from './network.js'

export { type BondgraphBond, type NetworkNode } from './bonds.js'
export { type EquationProvenance, type ModelEquation } from './equations.js'
export { BondgraphElement, ModelVariable, type ElementPort, type PowerPort, type ValueAssignment } from './elements.js'
export {
  BondgraphJunction,
  GYRATOR_EQUATIONS,
  JUNCTION_TYPES,
  TRANSFORMER_EQUATIONS,
  TRANSFORM_PORT_IDS,
  TRANSFORM_RATIO_NAME,
} from './junctions.js'

/** What a model needs from the host: oxigraph, libCellML, and an XML parser where there's no `DOMParser`. */
export interface ModelRuntime {
  readonly oxigraph: OxigraphModule
  readonly libcellml: LibCellML
  readonly domParser?: ParseOptions['domParser']
}

/**
 * How far to load a model, for testing a stage at a time: its elements; its
 * junctions, bonds and network; domains and junction variables; element
 * variables; or (the default) everything, including the equations.
 */
export type ModelStage = 'elements' | 'network' | 'domains' | 'variables' | 'equations'

export interface ModelLoadOptions {
  readonly until?: ModelStage
  /**
   * The unit system to build the model in, overriding the model's own
   * `pml:unitSystem`: a preset id, `si` or `cellular`. A model with neither is SI.
   */
  readonly unitSystem?: string
  /**
   * Write sources and composite elements in terms of their neighbours' flow
   * and potential variables, not their relations' right sides
   * (`EquationOptions.flowVariables`). Python doesn't, so `celldl2cellml()` doesn't.
   */
  readonly flowVariables?: boolean
  /** Solve transform nodes' equations for their own variables where they must be (`EquationOptions.solveTransforms`). */
  readonly solveTransforms?: boolean
}

export interface ModelElement {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
}

export class BondgraphModel {
  readonly log = new IssueLog('model')
  /** `''` if the source has no single `bgf:BondgraphModel`. */
  readonly iri: string = ''
  readonly label?: string
  /** The unit system the model is built in: the option's, the model's `pml:unitSystem`, or SI; `undefined` until found. */
  readonly unitSystem?: UnitSystemId
  /** By IRI, in IRI order. */
  readonly elements = new Map<string, BondgraphElement>()
  /** By IRI. */
  readonly junctions = new Map<string, BondgraphJunction>()
  readonly bonds: BondgraphBond[] = []
  /** Element ports and junctions, joined by the bonds. */
  network = new BondNetwork<NetworkNode>()
  /** For each element its constitutive relation and own equations, then each junction's, as Python orders them. */
  readonly equations: ModelEquation[] = []
  readonly graph: RdfGraph

  private constructor(graph: RdfGraph) {
    this.graph = graph
  }

  /**
   * Load a model from BG-RDF Turtle. The source must define exactly one
   * `bgf:BondgraphModel`. Problems are reported in `log` rather than thrown.
   *
   * So far this finds the model's elements (5.1), and its junctions and bonds,
   * and builds the bond network (5.2), spreads domains through it and assigns
   * the junctions' variables (5.3), then the elements' variables, with
   * values in their units and relations in their symbols (5.4), and builds
   * the equations (5.5).
   */
  static fromTurtle(
    stockFramework: BondgraphFramework,
    runtime: ModelRuntime,
    turtle: string,
    baseIri: string,
    options: ModelLoadOptions = {},
  ): BondgraphModel {
    const until = options.until ?? 'equations'
    const model = new BondgraphModel(new RdfGraph(runtime.oxigraph))
    model.log.document = documentOf(baseIri)
    try {
      model.graph.load(turtle, baseIri)
    } catch (error) {
      model.log.reportIssue({ message: error instanceof Error ? error.message : String(error), stage: 'input', cause: error })
      return model
    }
    if (!model.#findModel()) return model
    model.log.document = documentOf(model.iri)
    const system = model.#findUnitSystem(options.unitSystem)
    if (system === undefined) return model
    const framework = stockFramework.withUnitSystem(system)
    if (framework !== stockFramework) {
      for (const issue of framework.log.issues) {
        const subject = issue.subject === undefined ? {} : { subject: issue.subject }
        model.log.reportIssue({ message: issue.message, severity: 'warning', stage: 'units', ...subject })
      }
    }

    const unitsCompatible = (a: string, b: string): boolean => compatible(runtime.libcellml, a, b)
    const convert = (value: number, from: string, to: string): number => convertValue(runtime.libcellml, value, from, to)
    // Elements, then junctions, share one set of names, so copies get names of their own
    const names = new UniqueNames()
    const elements = loadElements(model.iri, {
      framework,
      names,
      graph: model.graph,
      log: model.log,
      compatible: unitsCompatible,
      ...(runtime.domParser === undefined ? {} : { domParser: runtime.domParser }),
      ...(framework === stockFramework ? {} : { rescaler: new Rescaler(system) }),
    })
    for (const [iri, element] of elements) model.elements.set(iri, element)
    if (model.elements.size === 0) {
      model.log.report(`Model ${prettyUri(model.iri)} has no valid elements`, model.iri)
      return model
    }
    if (until === 'elements') return model

    for (const [iri, junction] of loadJunctions(model.iri, { framework, graph: model.graph, log: model.log, names })) {
      model.junctions.set(iri, junction)
    }
    const context = { graph: model.graph, oxigraph: runtime.oxigraph, log: model.log, elements: model.elements, junctions: model.junctions }
    inferBonds(model.iri, context)
    model.bonds.push(...loadBonds(model.iri, context))
    model.network = buildNetwork(context, model.bonds)
    if (until === 'network') return model

    assignDomains(model.elements, model.network, model.log)
    const units = { log: model.log, compatible: unitsCompatible, convert, network: model.network }
    assignJunctionVariables(model.junctions, units)
    if (until === 'domains') return model

    const all = { ...units, elements: model.elements, junctions: model.junctions }
    assignElementVariables(all)
    if (until === 'variables') return model

    model.equations.push(...buildEquations(all, { flowVariables: options.flowVariables ?? false, solveTransforms: options.solveTransforms ?? false }))
    return model
  }

  /**
   * The unit system to build in: `option` if given, else the model's
   * `pml:unitSystem`, else SI. An unknown one is reported, giving `undefined`.
   */
  #findUnitSystem(option: string | undefined): UnitSystemId | undefined {
    let system: UnitSystemId | undefined
    if (option !== undefined) {
      system = unitSystem(option)?.id
      if (system === undefined) {
        const ids = Object.keys(UNIT_SYSTEM_IRIS).map((id) => `"${id}"`).join(' or ')
        this.log.reportIssue({ message: `Unknown unit system "${option}": use ${ids}`, stage: 'input' })
      }
    } else {
      const terms = this.graph.select(modelUnitSystemQuery(this.iri)).map((row) => row.get('system')!)
      const given = [...new Map(terms.map((term) => [`${term.termType} ${term.value}`, term])).values()]
      if (given.length === 0) {
        system = DEFAULT_UNIT_SYSTEM
      } else if (given.length > 1) {
        this.log.report(`Model <${this.iri}> has more than one <${UNIT_SYSTEM_PREDICATE}>`, this.iri)
      } else {
        const term = given[0]!
        system = term.termType === 'NamedNode' ? unitSystemForIri(term.value) : undefined
        if (system === undefined) {
          const given = term.termType === 'NamedNode' ? `<${term.value}>` : JSON.stringify(term.value)
          const choices = Object.values(UNIT_SYSTEM_IRIS).map((iri) => `<${iri}>`).join(' or ')
          this.log.reportIssue({ message: `Model <${this.iri}> has an unknown unit system ${given}: use ${choices}`, stage: 'units', subject: this.iri })
        }
      }
    }
    if (system !== undefined) (this as { unitSystem: UnitSystemId }).unitSystem = system
    return system
  }

  /** The source's one `bgf:BondgraphModel`, as Python's `__load_rdf`. */
  #findModel(): boolean {
    const rows = this.graph.select(BONDGRAPH_MODEL)
    const iris = [...new Set(rows.map((row) => row.get('uri')!.value))]
    if (iris.length === 0) {
      this.log.report('No BondgraphModels defined in RDF source')
      return false
    }
    if (iris.length > 1) {
      this.log.report("Multiple BondgraphModels defined in RDF source -- a model's URI must be given")
      return false
    }
    const labels = [...new Set(rows.flatMap((row) => (row.has('label') ? [row.get('label')!.value] : [])))]
    if (labels.length > 1) {
      this.log.report(`Model <${iris[0]}> has more than one rdfs:label`, iris[0])
      return false
    }
    const self = this as { -readonly [K in 'iri' | 'label']: BondgraphModel[K] }
    self.iri = iris[0]!
    if (labels.length === 1) self.label = labels[0]!
    return true
  }
}
