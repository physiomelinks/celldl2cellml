/**
 * The element manifest: each element's and junction's CellML variables, by
 * its id in the diagram, with what each variable is to it. An application
 * uses it to go from a clicked diagram element to a variable to plot, and to
 * label the diagram, as `toViewerAnnotations()` does for `@celldl/viewer`.
 */

import { elementIdOf } from '../issues.js'
import type { BondgraphElement, ModelVariable } from '../model/elements.js'
import { TRANSFORM_RATIO_NAME, type BondgraphJunction } from '../model/junctions.js'
import type { BondgraphModel } from '../model/model.js'
import { BGF } from '../rdf/namespaces.js'
import type { CellMLModelBuild, CellMLVariable } from './model.js'

/** What a diagram element is: a bond element, or a one, zero or transform node. */
export type ManifestKind = 'element' | 'one' | 'zero' | 'transform'

/**
 * What a variable is to its element: a port's flow or potential, the
 * domain's quantity (a store's `q`), a template parameter, a transform
 * node's ratio, or another of the template's variables.
 */
export type VariableRole = 'flow' | 'potential' | 'quantity' | 'parameter' | 'ratio' | 'other'

export interface ManifestVariable {
  /** Its name in the CellML. */
  readonly name: string
  readonly role: VariableRole
  /** The UCUM code of its units. */
  readonly ucum: string
  /** The name of its units in the CellML. */
  readonly units: string
}

export interface ManifestElement {
  readonly iri: string
  readonly kind: ManifestKind
  readonly symbol: string
  /** A bond element's template's IRI. */
  readonly template?: string
  readonly label?: string
  /**
   * The variable that best stands for it: a one or zero node's flow or
   * potential, a transform node's ratio, an element's intrinsic variable (a
   * store's quantity, a source's flow or potential), or else its first port's flow.
   */
  readonly primary?: string
  /** Its variables in the CellML. A variable two elements share is listed for both. */
  readonly variables: readonly ManifestVariable[]
}

/** Each element's and junction's entry, by its id in the diagram, or by its IRI if it isn't in the model's document. */
export type ElementManifest = Readonly<Record<string, ManifestElement>>

const JUNCTION_KINDS: ReadonlyMap<string, ManifestKind> = new Map([
  [BGF.OneNode, 'one'],
  [BGF.ZeroNode, 'zero'],
  [BGF.TransformNode, 'transform'],
])

/** The manifest of a built model. Only variables written to the CellML are listed. */
export function elementManifest(build: CellMLModelBuild, model: BondgraphModel): ElementManifest {
  const written = new Map<string, CellMLVariable>()
  for (const variable of build.variables) if (variable.kind === 'variable') written.set(variable.name, variable)

  const manifest: Record<string, ManifestElement> = {}
  const add = (iri: string, entry: Omit<ManifestElement, 'iri' | 'primary' | 'variables'>, roles: Iterable<[ModelVariable, VariableRole]>, primary?: ModelVariable): void => {
    const variables = new Map<string, ManifestVariable>()
    for (const [variable, role] of roles) {
      const cellml = written.get(variable.symbol)
      if (cellml !== undefined && !variables.has(cellml.name)) variables.set(cellml.name, { name: cellml.name, role, ucum: cellml.ucum, units: cellml.units })
    }
    manifest[(model.iri === '' ? undefined : elementIdOf(iri, model.iri)) ?? iri] = {
      iri,
      ...entry,
      ...(primary !== undefined && variables.has(primary.symbol) ? { primary: primary.symbol } : {}),
      variables: [...variables.values()],
    }
  }

  for (const element of model.elements.values()) {
    add(
      element.iri,
      { kind: 'element', symbol: element.symbol, template: element.template.iri, ...labelOf(element) },
      elementRoles(element),
      element.intrinsicVariable ?? element.ports.values().next().value?.flow,
    )
  }
  for (const junction of model.junctions.values()) {
    const kind = JUNCTION_KINDS.get(junction.type)
    if (kind === undefined) continue
    add(
      junction.iri,
      { kind, symbol: junction.symbol, ...labelOf(junction) },
      junctionRoles(junction, kind),
      junction.variables.get(kind === 'transform' ? TRANSFORM_RATIO_NAME : ''),
    )
  }
  return manifest
}

const labelOf = (source: BondgraphElement | BondgraphJunction): { label?: string } => (source.label === undefined ? {} : { label: source.label })

/** An element's variables with their roles: its ports' first, then parameters, then the rest. */
function* elementRoles(element: BondgraphElement): Iterable<[ModelVariable, VariableRole]> {
  for (const port of element.ports.values()) {
    yield [port.flow, 'flow']
    yield [port.potential, 'potential']
  }
  const { domain, elementTemplate } = element
  const parameters = new Set(elementTemplate.parameters.keys())
  for (const [name, variable] of element.variables) {
    if (parameters.has(name)) yield [variable, 'parameter']
  }
  for (const [name, variable] of element.variables) {
    if (parameters.has(name)) continue
    yield [
      variable,
      name === domain.flow.name ? 'flow' : name === domain.potential.name ? 'potential' : name === domain.quantity.name ? 'quantity' : 'other',
    ]
  }
}

/** A junction's variables with their roles: a node's own flow or potential, or a transform node's ratio and its ports' flows and potentials. */
function* junctionRoles(junction: BondgraphJunction, kind: ManifestKind): Iterable<[ModelVariable, VariableRole]> {
  for (const [name, variable] of junction.variables) {
    if (name === '') yield [variable, kind === 'one' ? 'flow' : 'potential']
    else if (name === TRANSFORM_RATIO_NAME) yield [variable, 'ratio']
    else yield [variable, name.startsWith('v_') ? 'flow' : name.startsWith('u_') ? 'potential' : 'other']
  }
}

//==============================================================================

/** An element's annotation for `@celldl/viewer`, whose `options.tooltip` names the field to show on hover. */
export interface ViewerAnnotation {
  readonly label: string
  readonly primary?: string
  readonly variables: readonly string[]
  readonly tooltip: string
}

/** `@celldl/viewer`'s `annotations`, by SVG id. */
export type ViewerAnnotations = Record<string, ViewerAnnotation>

export interface ViewerAnnotationOptions {
  /** An element's tooltip; by default a line for each variable, such as `v_1 (flow, C/s)`. */
  tooltip?: (element: ManifestElement) => string
}

/** A line for each variable: its name, role and UCUM units. */
export const defaultTooltip = (element: ManifestElement): string =>
  element.variables.map((variable) => `${variable.name} (${variable.role}, ${variable.ucum})`).join('\n')

/** The manifest as `@celldl/viewer` annotations: a label, primary variable, variable names and tooltip for each element. */
export function toViewerAnnotations(elements: ElementManifest, options: ViewerAnnotationOptions = {}): ViewerAnnotations {
  const tooltip = options.tooltip ?? defaultTooltip
  const annotations: ViewerAnnotations = {}
  for (const [id, element] of Object.entries(elements)) {
    annotations[id] = {
      label: element.label ?? element.symbol,
      ...(element.primary === undefined ? {} : { primary: element.primary }),
      variables: element.variables.map((variable) => variable.name),
      tooltip: tooltip(element),
    }
  }
  return annotations
}
