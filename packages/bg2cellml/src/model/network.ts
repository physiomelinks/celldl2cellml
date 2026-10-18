/**
 * The directed graph of element ports and junctions joined by power bonds.
 * This replaces networkx's DiGraph. Only the operations bg2cellml uses are here.
 */
export class BondNetwork<N> {
  readonly #nodes = new Map<string, N>()
  readonly #out = new Map<string, Map<string, number>>() // source -> target -> bond count
  readonly #in = new Map<string, Map<string, number>>() // target -> source -> bond count

  addNode(id: string, data: N): void {
    this.#nodes.set(id, data)
    if (!this.#out.has(id)) this.#out.set(id, new Map())
    if (!this.#in.has(id)) this.#in.set(id, new Map())
  }

  hasNode(id: string): boolean {
    return this.#nodes.has(id)
  }

  node(id: string): N | undefined {
    return this.#nodes.get(id)
  }

  nodes(): IterableIterator<[string, N]> {
    return this.#nodes.entries()
  }

  addEdge(source: string, target: string, bondCount = 1): void {
    if (!this.hasNode(source) || !this.hasNode(target)) {
      throw new Error(`Both ends of a bond must be added first: ${source} -> ${target}`)
    }
    this.#out.get(source)!.set(target, bondCount)
    this.#in.get(target)!.set(source, bondCount)
  }

  bondCount(source: string, target: string): number | undefined {
    return this.#out.get(source)?.get(target)
  }

  predecessors(id: string): string[] {
    return [...(this.#in.get(id)?.keys() ?? [])]
  }

  successors(id: string): string[] {
    return [...(this.#out.get(id)?.keys() ?? [])]
  }

  /** Neighbours ignoring direction, as networkx's undirected view gives them. */
  neighbours(id: string): string[] {
    return [...new Set([...this.predecessors(id), ...this.successors(id)])]
  }

  /** Every edge as `[source, target, bondCount]`, in the order networkx's `DiGraph.edges()` gives them: by source node, then target, in the order they were added. */
  edges(): [string, string, number][] {
    return [...this.#out].flatMap(([source, targets]) => [...targets].map(([target, count]): [string, string, number] => [source, target, count]))
  }

    /** In-degree plus out-degree, as networkx's `DiGraph.degree`. */
  degree(id: string): number {
    return (this.#in.get(id)?.size ?? 0) + (this.#out.get(id)?.size ?? 0)
  }
}
