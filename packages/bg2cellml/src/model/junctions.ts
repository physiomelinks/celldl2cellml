/**
 * The junctions of a model: one, zero and transform nodes. From
 * `BondgraphJunction` in Python's `model_support.py`; their variables come
 * once the bond network is built.
 */

import { ci, divide, eq, times, type Equation } from '@physiomelinks/math-ast'

import type { BondgraphFramework } from '../framework/framework.js'
import { DeclarationError, cleanName, readValue, type CompatibleUnits, type Value } from '../framework/variables.js'
import type { IssueLog } from '../issues.js'
import type { RdfGraph } from '../rdf/graph.js'
import { BGF, NAMESPACES, curie } from '../rdf/namespaces.js'
import { modelJunctionsQuery } from '../rdf/queries.js'
import type { NetworkNode } from './bonds.js'
import { valueInUnits, type ConvertUnits } from './element-variables.js'
import { ModelVariable, type PowerPort } from './elements.js'
import { makeSymbolicName, prettyName, prettyUri } from './names.js'
import type { BondNetwork } from './network.js'
import { groupRows, singleTerm } from './rows.js'

/** The junction types a model can use. */
export const JUNCTION_TYPES: readonly string[] = [BGF.OneNode, BGF.ZeroNode, BGF.TransformNode]

/** A transform node's two ports, `0` (inward) and `1` (outward), as Python's `TRANSFORM_PORT_IDS`. */
export const TRANSFORM_PORT_IDS = ['0', '1'] as const

/** The name of a transform node's ratio among its variables, as Python's `TRANSFORM_RATIO_NAME`. */
export const TRANSFORM_RATIO_NAME = 'RATIO'

/**
 * A transform node's relation between ports in the same domain, in terms of
 * the names of its variables: `u_1 = RATIO u_0`, `v_1 = v_0 / RATIO`.
 */
export const TRANSFORMER_EQUATIONS: readonly Equation[] = [
  eq(ci('u_1'), times(ci(TRANSFORM_RATIO_NAME), ci('u_0'))),
  eq(ci('v_1'), divide(ci('v_0'), ci(TRANSFORM_RATIO_NAME))),
]

/** A transform node's relation between ports in different domains: `u_0 = RATIO v_1`, `u_1 = RATIO v_0`. */
export const GYRATOR_EQUATIONS: readonly Equation[] = [
  eq(ci('u_0'), times(ci(TRANSFORM_RATIO_NAME), ci('v_1'))),
  eq(ci('u_1'), times(ci(TRANSFORM_RATIO_NAME), ci('v_0'))),
]

export class BondgraphJunction {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
  /** `bgf:OneNode`, `bgf:ZeroNode` or `bgf:TransformNode`. */
  readonly type: string
  /** A transform node's ratio, or the initial value of a one or zero node's variable. */
  readonly value?: Value
  /**
   * Once the network has domains: a one node's flow or a zero node's
   * potential, by the name `''`; or a transform node's `RATIO`, and the
   * flows and potentials of its ports, `v_0`, `u_0`, `v_1` and `u_1`.
   */
  readonly variables = new Map<string, ModelVariable>()
  /** For a transform node, whether it is a transformer (its ports share a domain) or a gyrator. */
  transform?: 'transformer' | 'gyrator'
  /** For a transform node, `TRANSFORMER_EQUATIONS` or `GYRATOR_EQUATIONS`, in terms of the names in `variables`. */
  relation?: readonly Equation[]
  /** The junction's equations, once the model's are built. */
  readonly equations: Equation[] = []

  constructor(iri: string, type: string, options: { symbol: string; label?: string; value?: Value }) {
    this.iri = iri
    this.type = type
    this.symbol = options.symbol
    if (options.label !== undefined) this.label = options.label
    if (options.value !== undefined) this.value = options.value
  }

  /** `symbol (#fragment)`, for messages. */
  get prettyName(): string {
    return prettyName(this.symbol, this.iri)
  }

  /** The ids of the junction's nodes in the bond network: a transform node has two, `<iri>_0` and `<iri>_1`. */
  get nodeIds(): string[] {
    return this.type === BGF.TransformNode ? TRANSFORM_PORT_IDS.map((id) => `${this.iri}_${id}`) : [this.iri]
  }
}

/**
 * The model's junctions, by IRI in query order (Python's query has no ORDER
 * BY, and its oxigraph gives the same order). Each must have exactly one
 * `bgf:` type, a one, zero or transform node. Problems are reported in the log.
 *
 * A composite element, such as a `bgf:ChemicalStorageNode`, is a subclass of
 * the junction it acts as, so the CellDL editor also lists it under
 * `bgf:hasJunctionStructure`. One also listed under `bgf:hasBondElement` is
 * left out here: the element pass reads it, or reports why it can't, which
 * gives Python's CellML.
 */
export function loadJunctions(
  model: string,
  context: { readonly framework: BondgraphFramework; readonly graph: RdfGraph; readonly log: IssueLog },
): Map<string, BondgraphJunction> {
  const { framework, graph, log } = context
  const { namedNode } = graph.oxigraph
  const listedAsElement = (iri: string): boolean => graph.has(namedNode(model), namedNode(BGF.hasBondElement), namedNode(iri))
  const junctions = new Map<string, BondgraphJunction>()
  for (const [iri, rows] of groupRows(graph.select(modelJunctionsQuery(model)), 'uri')) {
    try {
      const value = (name: string, what: string): string | undefined =>
        singleTerm(rows, name, () => `Junction <${iri}> has more than one ${what}`)?.value
      const given = value('symbol', 'bgf:hasSymbol')
      const species = value('species', 'bgf:hasSpecies')
      const location = value('location', 'bgf:hasLocation')
      const label = value('label', 'rdfs:label')
      const valueTerm = singleTerm(rows, 'value', () => `Junction <${iri}> has more than one bgf:hasValue`)
      const symbol = makeSymbolicName({
        iri,
        ...(given === undefined ? {} : { symbol: given }),
        ...(species === undefined ? {} : { species }),
        ...(location === undefined ? {} : { location }),
      })
      const name = prettyName(symbol, iri)

      // As for elements, types outside bgf: are ignored
      const types = [...new Set(rows.map((row) => row.get('type')!.value))].filter((type) => type.startsWith(NAMESPACES.bgf)).sort()
      if (types.length !== 1) {
        throw new DeclarationError(
          types.length === 0 ? `Junction ${name} has no bgf: type` : `Junction ${name} has more than one type: ${types.map(curie).join(', ')}`,
        )
      }
      const type = types[0]!
      // The element pass reads (or reports) a composite element listed both ways
      if (!JUNCTION_TYPES.includes(type) && framework.compositeTemplates.has(type) && listedAsElement(iri)) continue
      if (framework.junction(type) === undefined) throw new DeclarationError(`Unknown Junction ${type} for node ${iri}`)
      if (!JUNCTION_TYPES.includes(type)) {
        throw new DeclarationError(`Junction ${name} is a ${curie(type)}: a model's junctions must be one, zero or transform nodes`)
      }

      let junctionValue: Value | undefined
      if (valueTerm !== undefined) {
        if (valueTerm.termType !== 'Literal') throw new DeclarationError(`The bgf:hasValue of junction ${name} must be a literal`)
        try {
          junctionValue = readValue(valueTerm)
        } catch (error) {
          if (error instanceof DeclarationError) throw new DeclarationError(`${error.message}, for junction ${name}`)
          throw error
        }
      }
      junctions.set(
        iri,
        new BondgraphJunction(iri, type, {
          symbol,
          ...(label === undefined ? {} : { label }),
          ...(junctionValue === undefined ? {} : { value: junctionValue }),
        }),
      )
    } catch (error) {
      if (!(error instanceof DeclarationError)) throw error
      log.report(error.message, iri)
    }
  }
  return junctions
}

//==============================================================================

interface VariableContext {
  readonly log: IssueLog
  readonly compatible: CompatibleUnits
  readonly convert: ConvertUnits
  readonly network: BondNetwork<NetworkNode>
}

/**
 * Python's `__assign_junction_domain_and_variables`: each one and zero node's
 * variable, then each transform node's, which uses its neighbours'.
 */
export function assignJunctionVariables(junctions: ReadonlyMap<string, BondgraphJunction>, context: VariableContext): void {
  for (const junction of junctions.values()) if (junction.type !== BGF.TransformNode) assignNodeVariable(junction, context)
  for (const junction of junctions.values()) if (junction.type === BGF.TransformNode) assignTransformVariables(junction, context)
}

/** A one node's flow, or a zero node's potential, named by the junction's symbol, in its domain's units. */
function assignNodeVariable(junction: BondgraphJunction, context: VariableContext): void {
  const { log, network } = context
  const domain = network.node(junction.iri)?.domain
  if (domain === undefined) {
    log.report(`Cannot find domain for junction ${junction.prettyName}. Are there bonds to it?`, junction.iri)
    return
  }
  const definition = junction.type === BGF.OneNode ? domain.flow : domain.potential
  const variable = new ModelVariable(definition, cleanName(junction.symbol))
  if (junction.value !== undefined) {
    const value = junction.value
    if (value.units !== undefined && !unitsCompatible(context, variable.units, value.units)) {
      log.reportIssue({
        message: `Value for variable ${variable.name} has incompatible units (${value.units} != ${variable.units})`,
        stage: 'units',
        subject: junction.iri,
      })
    } else {
      // In the variable's units, which Python doesn't convert to
      const converted = valueInUnits(value, variable, context, junction.iri)
      if (converted !== undefined) variable.value = converted
    }
  }
  junction.variables.set('', variable)
}

/**
 * Python's `assign_transform_variables`. The ratio is the junction's value,
 * named by its symbol. Each port takes the flow (beside a one node) or the
 * potential (beside a zero node) of the node it is bonded to, and gets a new
 * variable for the other, so `v_0` may be a one node's `v_1_e` and `u_0` the
 * new `u_Bl_0`. With both ports in one domain it is a transformer, otherwise
 * a gyrator.
 *
 * Python silently leaves a port with nothing it can use; here that is
 * reported. A ratio given as a plain number is dimensionless; Python rejects it.
 */
function assignTransformVariables(junction: BondgraphJunction, context: VariableContext): void {
  const { log, network } = context
  const name = junction.prettyName
  if (junction.value === undefined) {
    log.report(`Transform node ${name} has no bgf:hasValue for its ratio`, junction.iri)
  } else {
    const units = junction.value.units ?? '1'
    const ratio = new ModelVariable({ name: cleanName(junction.symbol), units })
    ratio.value = { ...junction.value, units }
    junction.variables.set(TRANSFORM_RATIO_NAME, ratio)
  }

  const domains = []
  for (const portId of TRANSFORM_PORT_IDS) {
    const id = `${junction.iri}_${portId}`
    const node = network.node(id)!
    if (node.domain === undefined) {
      log.report(`Cannot find domain for port ${portId} of transform node ${name}. Are there bonds to it?`, junction.iri)
      return
    }
    const domain = node.domain
    domains.push(domain)

    const neighbours = network.neighbours(id)
    if (neighbours.length !== 1) {
      log.report(`Port ${portId} of transform node ${name} must be bonded to one node, not ${neighbours.length}`, junction.iri)
      continue
    }
    const neighbour = network.node(neighbours[0]!)!
    let type: string | undefined
    let shared: ModelVariable | undefined
    if (neighbour.element !== undefined) {
      type = neighbour.element.impliedJunction
      shared = type === BGF.OneNode ? neighbour.element.flow : type === BGF.ZeroNode ? neighbour.element.potential : undefined
    } else if (neighbour.junction !== undefined) {
      type = neighbour.junction.type
      shared = type === BGF.TransformNode ? undefined : neighbour.junction.variables.get('')
    }
    if (shared === undefined) {
      log.report(
        `Port ${portId} of transform node ${name} is bonded to ${prettyUri(neighbours[0]!)}: it must be a one or zero node, or an element that acts as one`,
        junction.iri,
      )
      continue
    }

    const flowName = cleanName(`v_${junction.symbol}_${portId}`)
    const potentialName = cleanName(`u_${junction.symbol}_${portId}`)
    let port: PowerPort
    if (type === BGF.OneNode) {
      port = { flow: shared, potential: new ModelVariable({ name: potentialName, units: domain.potential.units }) }
    } else {
      port = { flow: new ModelVariable({ name: flowName, units: domain.flow.units }), potential: shared }
    }
    junction.variables.set(`v_${portId}`, port.flow)
    junction.variables.set(`u_${portId}`, port.potential)
    node.port = port
    node.portType = BGF.TransformNode
  }
  junction.transform = domains[0] === domains[1] ? 'transformer' : 'gyrator'
  junction.relation = junction.transform === 'transformer' ? TRANSFORMER_EQUATIONS : GYRATOR_EQUATIONS
}

function unitsCompatible(context: VariableContext, a: string, b: string): boolean {
  try {
    return a === b || context.compatible(a, b)
  } catch {
    return false
  }
}
