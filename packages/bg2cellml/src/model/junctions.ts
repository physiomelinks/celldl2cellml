/**
 * The junctions of a model: one, zero and transform nodes. From
 * `BondgraphJunction` in Python's `model_support.py`; their variables come
 * once the bond network is built.
 */

import type { BondgraphFramework } from '../framework/framework.js'
import { DeclarationError, readValue, type Value } from '../framework/variables.js'
import type { IssueLog } from '../issues.js'
import type { RdfGraph } from '../rdf/graph.js'
import { BGF, NAMESPACES, curie } from '../rdf/namespaces.js'
import { modelJunctionsQuery } from '../rdf/queries.js'
import { makeSymbolicName, prettyName } from './names.js'
import { groupRows, singleTerm } from './rows.js'

/** The junction types a model can use. */
export const JUNCTION_TYPES: readonly string[] = [BGF.OneNode, BGF.ZeroNode, BGF.TransformNode]

/** A transform node's two ports, `0` (inward) and `1` (outward), as Python's `TRANSFORM_PORT_IDS`. */
export const TRANSFORM_PORT_IDS = ['0', '1'] as const

export class BondgraphJunction {
  readonly iri: string
  readonly symbol: string
  readonly label?: string
  /** `bgf:OneNode`, `bgf:ZeroNode` or `bgf:TransformNode`. */
  readonly type: string
  /** A transform node's ratio, or the initial value of a one or zero node's variable. */
  readonly value?: Value

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
 */
export function loadJunctions(
  model: string,
  context: { readonly framework: BondgraphFramework; readonly graph: RdfGraph; readonly log: IssueLog },
): Map<string, BondgraphJunction> {
  const { framework, graph, log } = context
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
