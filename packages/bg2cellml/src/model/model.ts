/**
 * A BG-RDF bond graph model: its elements, junctions and bonds, and the
 * equations they give. Ported from `bondgraph/model.py` and `model_support.py`.
 *
 * Bugs in the Python version that shouldn't be carried over:
 * - `BondgraphBond` is given the label and the bond count in the wrong order,
 *   so a labelled bond crashes and `bgf:bondCount` on bonds is ignored.
 * - When a port only has outputs, its expression is built from the empty
 *   inputs list and comes out as 0.
 * - The unknown-variable check (`name not in name not in ...`) never fires.
 * - Plain numeric literals such as `10.0` are rejected as values.
 */

import type { Equation } from '@physiomelinks/math-ast'

import type { BondgraphFramework } from '../framework/framework.js'
import { IssueLog } from '../issues.js'
import type { OxigraphModule } from '../rdf/graph.js'

export interface ModelElement {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
}

export class BondgraphModel {
  readonly log = new IssueLog()
  readonly iri: string = ''
  readonly label?: string
  readonly elements: readonly ModelElement[] = []
  readonly junctions: readonly ModelElement[] = []
  readonly equations: readonly Equation[] = []

  /**
   * Load a model from BG-RDF Turtle. The source must define exactly one
   * `bgf:BondgraphModel`. Problems are reported in `log` rather than thrown.
   *
   * To do: port `BondgraphModel.__init__` and `__initialise`, building a `BondNetwork`.
   */
  static fromTurtle(
    _framework: BondgraphFramework,
    _oxigraph: OxigraphModule,
    _turtle: string,
    _baseIri: string,
  ): BondgraphModel {
    throw new Error('BondgraphModel.fromTurtle() is not implemented yet')
  }
}
