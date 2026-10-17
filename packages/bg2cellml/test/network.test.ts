import { describe, expect, it } from 'vitest'

import { BondNetwork } from '../src/index.js'

describe('BondNetwork', () => {
  // The RC circuit: V_in -> I_R -> R_0, I_R -> V_C -> q_1
  const network = new BondNetwork<{ label: string }>()
  for (const id of ['V_in', 'I_R', 'R_0', 'V_C', 'q_1']) network.addNode(id, { label: id })
  network.addEdge('V_in', 'I_R')
  network.addEdge('I_R', 'R_0')
  network.addEdge('I_R', 'V_C')
  network.addEdge('V_C', 'q_1', 2)

  it('gives predecessors, successors and degree like networkx', () => {
    expect(network.predecessors('I_R')).toEqual(['V_in'])
    expect(network.successors('I_R')).toEqual(['R_0', 'V_C'])
    expect(network.degree('I_R')).toBe(3)
    expect(network.neighbours('V_C')).toEqual(['I_R', 'q_1'])
  })

  it('keeps bond counts', () => {
    expect(network.bondCount('V_C', 'q_1')).toBe(2)
    expect(network.bondCount('I_R', 'V_C')).toBe(1)
  })

  it('refuses bonds to unknown nodes', () => {
    expect(() => network.addEdge('V_in', 'nowhere')).toThrow()
  })
})
