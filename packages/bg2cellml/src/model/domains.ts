/**
 * Spreading physical domains through the bond network, from Python's
 * `__check_and_assign_domains_to_bond_network`.
 *
 * Every node joined by bonds to an element's port, other than through a
 * transform node, is in that element's domain. A transform node's two ports
 * are separate nodes, so each side of a gyrator has its own domain.
 *
 * Python means to report nodes reached from elements in different domains,
 * but marks a node as seen whenever it gives it a domain, so its check can
 * never fire and the first domain to arrive wins. Here each set of nodes
 * joined by bonds takes the domain of its first element (in IRI order), and
 * each element in it with another domain is reported, once per domain:
 * `Node #R_m with domain bgf:Mechanical incompatible with bgf:Electrical`.
 */

import type { IssueLog } from '../issues.js'
import { curie } from '../rdf/namespaces.js'
import type { NetworkNode } from './bonds.js'
import type { BondgraphElement } from './elements.js'
import { prettyUri } from './names.js'
import type { BondNetwork } from './network.js'

export function assignDomains(
  elements: ReadonlyMap<string, BondgraphElement>,
  network: BondNetwork<NetworkNode>,
  log: IssueLog,
): void {
  for (const element of elements.values()) {
    for (const id of element.ports.keys()) network.node(id)!.domain = element.domain
  }
  const seen = new Set<string>()
  for (const element of elements.values()) {
    for (const start of element.ports.keys()) {
      if (seen.has(start)) continue
      // Every node joined to this port, in the order they're reached
      const joined: NetworkNode[] = []
      const stack = [start]
      seen.add(start)
      while (stack.length > 0) {
        const id = stack.shift()!
        joined.push(network.node(id)!)
        for (const next of network.neighbours(id)) {
          if (!seen.has(next)) {
            seen.add(next)
            stack.push(next)
          }
        }
      }
      const domain = element.domain
      const reported = new Set([domain])
      for (const node of joined) {
        if (node.domain !== undefined && !reported.has(node.domain)) {
          reported.add(node.domain)
          log.report(`Node ${prettyUri(node.id)} with domain ${curie(node.domain.iri)} incompatible with ${curie(domain.iri)}`, node.id)
        }
        node.domain ??= domain
      }
    }
  }
}
