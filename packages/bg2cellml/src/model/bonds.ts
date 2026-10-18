/**
 * The power bonds of a model and the bond network they make. From
 * `__generate_bonds`, the bond loop of `__initialise` and
 * `__make_bond_network` in Python's `model.py`.
 *
 * Python gives `BondgraphBond` its label and bond count in the wrong order
 * (model.py:233), so a labelled bond fails and `bgf:bondCount` on a bond is
 * ignored. Here both are read as BG-RDF means them, so models with bond
 * counts, such as BG-RDF's example_B2, differ from Python's output until
 * that is fixed there.
 */

import type { Domain } from '../framework/framework.js'
import type { IssueLog } from '../issues.js'
import type { OxigraphModule, RdfGraph, ResultRow, Term } from '../rdf/graph.js'
import { BGF, xsd } from '../rdf/namespaces.js'
import { BONDGRAPH_BONDS, modelBondsQuery } from '../rdf/queries.js'
import type { BondgraphElement, ElementPort } from './elements.js'
import { TRANSFORM_PORT_IDS, type BondgraphJunction } from './junctions.js'
import { prettyUri } from './names.js'
import { BondNetwork } from './network.js'
import { groupRows, singleTerm } from './rows.js'

export interface BondgraphBond {
  /** The bond's IRI, or a blank node's label. */
  readonly iri: string
  /** The node in the bond network it leaves: a port of an element, or a junction or one of a transform node's ports. */
  readonly source: string
  /** The node in the bond network it enters. */
  readonly target: string
  readonly label?: string
  /** `bgf:bondCount`, 1 if not given. */
  readonly bondCount: number
}

/** A node of the bond network: a port of an element, or a junction (a transform node has two, one per port). */
export interface NetworkNode {
  readonly id: string
  /** The element's template, or the junction's type. */
  readonly type: string
  /** The element's or junction's symbol. */
  readonly label: string
  readonly element?: BondgraphElement
  readonly junction?: BondgraphJunction
  /** An element's port. A transform node's ports get theirs once domains are known. */
  port?: ElementPort
  /** The element's class, for an element's port. */
  portType?: string
  /** Spread through the network from the elements. */
  domain?: Domain
}

interface BondContext {
  readonly graph: RdfGraph
  readonly oxigraph: OxigraphModule
  readonly log: IssueLog
  readonly elements: ReadonlyMap<string, BondgraphElement>
  readonly junctions: ReadonlyMap<string, BondgraphJunction>
}

/**
 * Python's `__generate_bonds`: anything with a `bgf:hasSource` and
 * `bgf:hasTarget` that are both the model's elements or junctions is one of
 * its bonds, whether the model lists it with `bgf:hasPowerBond` or not.
 * Python ignores a bond with only one end in the model; here it is reported.
 */
export function inferBonds(model: string, context: Pick<BondContext, 'graph' | 'oxigraph' | 'log'>): void {
  const { graph, oxigraph, log } = context
  const declared = (term: Term): boolean =>
    term.termType === 'NamedNode' &&
    (graph.has(null, oxigraph.namedNode(BGF.hasBondElement), term) || graph.has(null, oxigraph.namedNode(BGF.hasJunctionStructure), term))
  const modelNode = oxigraph.namedNode(model)
  const hasPowerBond = oxigraph.namedNode(BGF.hasPowerBond)
  for (const row of graph.select(BONDGRAPH_BONDS)) {
    const bond = row.get('uri')!
    const source = row.get('source')!
    const target = row.get('target')!
    const inModel = [declared(source), declared(target)]
    if (inModel[0] && inModel[1]) {
      if (bond.termType === 'NamedNode' || bond.termType === 'BlankNode') {
        graph.add(oxigraph.quad(modelNode, hasPowerBond, bond, oxigraph.defaultGraph()))
      }
    } else if (inModel[0] || inModel[1]) {
      const outside = inModel[0] ? target : source
      log.report(`Bond ${prettyUri(bond.value)} joins ${prettyUri(outside.value)}, which isn't an element or junction of the model`, bond.value)
    }
  }
}

/**
 * The model's bonds, in query order (Python's query has no ORDER BY, and its
 * oxigraph gives the same order). A bond to a reaction is joined to its
 * inward or outward port, and one to a transform node to its port `0` or `1`.
 */
export function loadBonds(model: string, context: BondContext): BondgraphBond[] {
  const { graph, log, elements, junctions } = context
  const bonds: BondgraphBond[] = []
  for (const [iri, rows] of groupRows(graph.select(modelBondsQuery(model)), 'powerBond')) {
    const bond = readBond(iri, rows, context)
    if (typeof bond === 'string') log.report(bond, iri)
    else if (bond !== undefined) bonds.push(bond)
  }
  return bonds

  function readBond(iri: string, rows: readonly ResultRow[], context: BondContext): BondgraphBond | string | undefined {
    const name = prettyUri(iri)
    const term = (key: string, what: string): Term | undefined => singleTerm(rows, key, () => `Bond ${name} has more than one ${what}`)
    let source: Term | undefined, target: Term | undefined, label: Term | undefined, count: Term | undefined
    try {
      source = term('source', 'bgf:hasSource')
      target = term('target', 'bgf:hasTarget')
      label = term('label', 'rdfs:label')
      count = term('bondCount', 'bgf:bondCount')
    } catch (error) {
      return (error as Error).message
    }
    if (source?.termType !== 'NamedNode' || target?.termType !== 'NamedNode') {
      return `Bond ${name} is missing source and/or target node`
    }
    const problems: string[] = []
    if (!elements.has(source.value) && !junctions.has(source.value)) {
      problems.push(`No element or junction for source ${prettyUri(source.value)} of bond ${name}`)
    }
    if (!elements.has(target.value) && !junctions.has(target.value)) {
      problems.push(`No element or junction for target ${prettyUri(target.value)} of bond ${name}`)
    }
    for (const problem of problems.slice(0, -1)) context.log.report(problem, iri)
    if (problems.length > 0) return problems.at(-1)

    const bondCount = readBondCount(count)
    if (bondCount === undefined) return `Bond ${name} has a bgf:bondCount that isn't a positive integer: ${count!.value}`
    return {
      iri,
      source: networkEnd(source.value, BGF.OutwardPort, TRANSFORM_PORT_IDS[1]),
      target: networkEnd(target.value, BGF.InwardPort, TRANSFORM_PORT_IDS[0]),
      ...(label === undefined ? {} : { label: label.value }),
      bondCount,
    }
  }

  /** The network node a bond end joins: a reaction's port in that direction, or a transform node's port. */
  function networkEnd(iri: string, direction: string, transformPort: string): string {
    const element = elements.get(iri)
    if (element !== undefined && element.elementClass === BGF.Reaction) {
      for (const port of element.ports.values()) if (port.template.direction === direction) return port.iri
    } else if (junctions.get(iri)?.type === BGF.TransformNode) {
      return `${iri}_${transformPort}`
    }
    return iri
  }
}

const INTEGER_DATATYPES = new Set(
  ['integer', 'int', 'long', 'short', 'byte', 'positiveInteger', 'nonNegativeInteger', 'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte'].map(xsd),
)

/** 1 if not given, the count if it is a positive integer, otherwise `undefined`. */
function readBondCount(term: Term | undefined): number | undefined {
  if (term === undefined) return 1
  if (term.termType !== 'Literal' || !INTEGER_DATATYPES.has(term.datatype.value) || !/^\+?\d+$/.test(term.value.trim())) return undefined
  const count = Number.parseInt(term.value, 10)
  return count > 0 ? count : undefined
}

/**
 * Python's `__make_bond_network`: a node for each element port and junction
 * (two for a transform node), and an edge for each bond, with its count.
 */
export function buildNetwork(context: BondContext, bonds: readonly BondgraphBond[]): BondNetwork<NetworkNode> {
  const { log, elements, junctions } = context
  const network = new BondNetwork<NetworkNode>()
  for (const element of elements.values()) {
    for (const port of element.ports.values()) {
      network.addNode(port.iri, {
        id: port.iri,
        type: element.elementTemplate.iri,
        label: element.symbol,
        element,
        port,
        portType: element.elementClass,
      })
    }
  }
  for (const junction of junctions.values()) {
    for (const id of junction.nodeIds) {
      if (network.hasNode(id)) {
        log.report(`Junction ${junction.prettyName} has the same IRI as an element's port: ${prettyUri(id)}`, junction.iri)
        continue
      }
      network.addNode(id, { id, type: junction.type, label: junction.symbol, junction })
    }
  }

  const joined = new Map<string, string>()
  for (const bond of bonds) {
    const { source, target } = bond
    const name = prettyUri(bond.iri)
    if (!network.hasNode(source) && !network.hasNode(target)) {
      log.report(`No element or junction for source ${prettyUri(source)} and target ${prettyUri(target)} of bond ${name}`, bond.iri)
    } else if (!network.hasNode(source)) {
      log.report(`No element or junction for source ${prettyUri(source)} of bond ${name}`, bond.iri)
    } else if (!network.hasNode(target)) {
      log.report(`No element or junction for target ${prettyUri(target)} of bond ${name}`, bond.iri)
    } else if (joined.has(`${source} ${target}`)) {
      // Python's networkx keeps only the last of two bonds between the same nodes
      log.report(`Bonds ${prettyUri(joined.get(`${source} ${target}`)!)} and ${name} both join ${prettyUri(source)} to ${prettyUri(target)}`, bond.iri)
    } else {
      joined.set(`${source} ${target}`, bond.iri)
      network.addEdge(source, target, bond.bondCount)
    }
  }
  return network
}
