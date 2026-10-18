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
 * - The unknown-variable check (`name not in name not in ...`) never fires.
 *   (Fixed in `elements.ts`.)
 * - Plain numeric literals such as `10.0` are rejected as values. (Fixed:
 *   `readValue` reads them.)
 */

import { compatible, type LibCellML } from '@physiomelinks/cellml-units'
import type { Equation, ParseOptions } from '@physiomelinks/math-ast'

import type { BondgraphFramework } from '../framework/framework.js'
import { IssueLog } from '../issues.js'
import { RdfGraph, type OxigraphModule } from '../rdf/graph.js'
import { BONDGRAPH_MODEL } from '../rdf/queries.js'
import { buildNetwork, inferBonds, loadBonds, type BondgraphBond, type NetworkNode } from './bonds.js'
import { assignDomains } from './domains.js'
import { loadElements, type BondgraphElement } from './elements.js'
import { assignJunctionVariables, loadJunctions, type BondgraphJunction } from './junctions.js'
import { prettyUri } from './names.js'
import { BondNetwork } from './network.js'

export { type BondgraphBond, type NetworkNode } from './bonds.js'
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

export interface ModelElement {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
}

export class BondgraphModel {
  readonly log = new IssueLog()
  /** `''` if the source has no single `bgf:BondgraphModel`. */
  readonly iri: string = ''
  readonly label?: string
  /** By IRI, in IRI order. */
  readonly elements = new Map<string, BondgraphElement>()
  /** By IRI. */
  readonly junctions = new Map<string, BondgraphJunction>()
  readonly bonds: BondgraphBond[] = []
  /** Element ports and junctions, joined by the bonds. */
  network = new BondNetwork<NetworkNode>()
  readonly equations: readonly Equation[] = []
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
   * the junctions' variables (5.3). Element variables and equations come next.
   */
  static fromTurtle(framework: BondgraphFramework, runtime: ModelRuntime, turtle: string, baseIri: string): BondgraphModel {
    const model = new BondgraphModel(new RdfGraph(runtime.oxigraph))
    try {
      model.graph.load(turtle, baseIri)
    } catch (error) {
      model.log.report(error instanceof Error ? error.message : String(error), undefined, error)
      return model
    }
    if (!model.#findModel()) return model

    const unitsCompatible = (a: string, b: string): boolean => compatible(runtime.libcellml, a, b)
    const elements = loadElements(model.iri, {
      framework,
      graph: model.graph,
      log: model.log,
      compatible: unitsCompatible,
      ...(runtime.domParser === undefined ? {} : { domParser: runtime.domParser }),
    })
    for (const [iri, element] of elements) model.elements.set(iri, element)
    if (model.elements.size === 0) {
      model.log.report(`Model ${prettyUri(model.iri)} has no valid elements`, model.iri)
      return model
    }

    for (const [iri, junction] of loadJunctions(model.iri, { framework, graph: model.graph, log: model.log })) {
      model.junctions.set(iri, junction)
    }
    const context = { graph: model.graph, oxigraph: runtime.oxigraph, log: model.log, elements: model.elements, junctions: model.junctions }
    inferBonds(model.iri, context)
    model.bonds.push(...loadBonds(model.iri, context))
    model.network = buildNetwork(context, model.bonds)
    assignDomains(model.elements, model.network, model.log)
    assignJunctionVariables(model.junctions, { log: model.log, compatible: unitsCompatible, network: model.network })
    return model
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
