/**
 * `Converter.convert()`: a CellDL document, or BG-RDF Turtle, to CellML 2.0,
 * with everything an application needs to use or show the result. Unlike
 * `celldl2cellml()`, it returns the CellML whenever it can be printed, with
 * any warnings, and gives every issue its severity, stage and `elementId`.
 */

import { extractBgRdf } from './celldl.js'
import { RUNNABLE_MODEL_TYPES } from './cellml/check.js'
import { generateCellML } from './cellml/generate.js'
import type { ElementManifest } from './cellml/manifest.js'
import { cellmlUriFor } from './cellml/metadata.js'
import { MAIN_COMPONENT } from './cellml/model.js'
import type { Runtime } from './converter.js'
import type { BondgraphFramework } from './framework/framework.js'
import type { Issue } from './issues.js'
import { BondgraphModel } from './model/model.js'
import { LOCAL_MODEL_BASE } from './model/names.js'
import type { OxigraphModule } from './rdf/graph.js'
import { GENERATOR } from './version.js'

/** The source's IRI when none is given, as for a model the CellDL Editor makes. */
export const DEFAULT_SOURCE_URI = `${LOCAL_MODEL_BASE}model.celldl`

export interface ConvertOptions {
  /**
   * The source's IRI, the base for its relative IRIs: an absolute IRI, such as
   * `file:///C:/Models/My%20model.celldl`. `DEFAULT_SOURCE_URI` if not given.
   */
  sourceUri?: string
  /** The CellML component's name and id, a CellML identifier; `main` if not given. */
  componentName?: string
  /** Also return metadata linking the CellML variables to the bond graph. */
  metadata?: boolean
  /** The CellML file's IRI, for the metadata. The source's with `.cellml` if not given. */
  cellmlUri?: string
  /** The source is BG-RDF Turtle rather than a CellDL document. */
  rdfSource?: boolean
  /**
   * The CellML of units the host already has, such as its other modules'. A
   * name they give other units is numbered (`mM_1`) and listed in
   * `units.renamed`; the CellML still defines all its units.
   */
  knownUnits?: string | string[]
}

export interface ConversionResult {
  /** There is CellML that can run, and no errors. */
  readonly ok: boolean
  /** The CellML, whenever it could be printed: with warnings, and with Validator or Analyser errors, so it can be looked at. */
  readonly cellml?: string
  /** The Analyser's type for the model, such as `ode` or `dae`. */
  readonly modelType?: string
  /** `modelType` is one that can be simulated. */
  readonly runnable: boolean
  readonly componentName: string
  /** The source IRI the model was read with. */
  readonly baseUri: string
  /** The model's IRI, once the source has been read. Its fragments are issues' `elementId`s. */
  readonly modelIri?: string
  /**
   * Each element's and junction's CellML variables and their roles, by its id
   * in the diagram (its IRI if it isn't in the source); empty if the model
   * couldn't be built. `toViewerAnnotations()` makes `@celldl/viewer` annotations of it.
   */
  readonly elements: ElementManifest
  /** `renamed`: each units name `knownUnits` defines differently, and the name the CellML gives those units instead. */
  readonly units: { readonly renamed: Readonly<Record<string, string>> }
  readonly issues: readonly Issue[]
  readonly errors: readonly Issue[]
  readonly warnings: readonly Issue[]
  /** What made the CellML, to tell whether a stored conversion is out of date. */
  readonly generator: typeof GENERATOR
  /** The loaded BG-RDF framework's `owl:versionInfo`. */
  readonly framework: { readonly version?: string }
  readonly metadata?: string
  /** An unexpected failure: a bug in the converter rather than a problem with the source. */
  readonly exception?: string
}

/** What `convert()` needs from its `Converter`. */
export interface ConvertContext {
  readonly runtime: Runtime
  readonly framework: BondgraphFramework | undefined
}

/**
 * Why `iri` can't be the base or name of a document, or `undefined` if it
 * can. oxigraph checks it as it does a base IRI: a Windows path or one with
 * a space isn't an IRI, as the CellDL Editor found on Windows (BG-Tools'
 * tests/models/rdf_error.celldl).
 */
export function iriIssue(oxigraph: Pick<OxigraphModule, 'namedNode'>, option: string, iri: string): string | undefined {
  try {
    oxigraph.namedNode(iri)
    return undefined
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return `${option} isn't an absolute IRI: ${JSON.stringify(iri)} (${reason}). A file path must be given as a file: URL, with characters such as spaces percent-encoded.`
  }
}

/** A CellML 2.0 identifier: Basic Latin letters, digits and `_`, with a letter, not starting with a digit. */
const CELLML_IDENTIFIER = /^(?=.*[A-Za-z])[A-Za-z_][A-Za-z0-9_]*$/

/** Convert a CellDL document, or BG-RDF Turtle with `rdfSource: true`, to CellML 2.0. */
export function convert(context: ConvertContext, source: string, options: ConvertOptions = {}): ConversionResult {
  const baseUri = options.sourceUri ?? DEFAULT_SOURCE_URI
  const componentName = options.componentName ?? MAIN_COMPONENT
  const framework = context.framework
  const fields = { componentName, baseUri, framework: framework?.version === undefined ? {} : { version: framework.version } }
  if (framework === undefined) {
    return result(fields, [{ message: 'The BG-RDF framework has not been loaded', severity: 'error', stage: 'framework' }])
  }

  const input = [
    ...(CELLML_IDENTIFIER.test(componentName)
      ? []
      : [`componentName isn't a CellML identifier: ${JSON.stringify(componentName)}. It must be letters, digits and _, with a letter, and not start with a digit.`]),
    ...(options.sourceUri === undefined ? [] : [iriIssue(context.runtime.oxigraph, 'sourceUri', options.sourceUri)]),
    ...(options.cellmlUri === undefined ? [] : [iriIssue(context.runtime.oxigraph, 'cellmlUri', options.cellmlUri)]),
  ].filter((message) => message !== undefined)
  if (input.length > 0) return result(fields, input.map((message): Issue => ({ message, severity: 'error', stage: 'input' })))

  let modelIri: string | undefined
  const issues: Issue[] = []
  try {
    const bgRdf = options.rdfSource ? source : extractBgRdf(source, context.runtime.domParser)
    const model = BondgraphModel.fromTurtle(framework, context.runtime, bgRdf, baseUri)
    if (model.iri !== '') modelIri = model.iri
    issues.push(...model.log.issues)
    if (issues.some((issue) => issue.severity === 'error')) return result({ ...fields, ...iriField(modelIri) }, issues)

    const generated = generateCellML(context.runtime.libcellml, model, {
      metadata: options.metadata ?? false,
      cellmlUri: options.cellmlUri ?? cellmlUriFor(baseUri),
      componentName,
      ...(options.knownUnits === undefined ? {} : { knownUnits: options.knownUnits }),
    })
    issues.push(...generated.issues)
    return result(
      {
        ...fields,
        ...iriField(modelIri),
        ...(generated.cellml === undefined ? {} : { cellml: generated.cellml }),
        ...(generated.elements === undefined ? {} : { elements: generated.elements }),
        ...(generated.modelType === undefined ? {} : { modelType: generated.modelType }),
        ...(generated.renamedUnits === undefined ? {} : { units: { renamed: generated.renamedUnits } }),
        ...(generated.metadata === undefined ? {} : { metadata: generated.metadata }),
      },
      issues,
    )
  } catch (error) {
    const exception = error instanceof Error ? (error.stack ?? String(error)) : String(error)
    return result({ ...fields, ...iriField(modelIri), exception }, issues)
  }
}

const iriField = (modelIri: string | undefined): { modelIri?: string } => (modelIri === undefined ? {} : { modelIri })

type ResultFields = Omit<ConversionResult, 'ok' | 'runnable' | 'elements' | 'units' | 'issues' | 'errors' | 'warnings' | 'generator'> & {
  readonly elements?: ElementManifest
  readonly units?: ConversionResult['units']
}

/** The result, with `ok`, `runnable`, `elements`, `units` and the issues split by severity. */
function result(fields: ResultFields, issues: readonly Issue[]): ConversionResult {
  const runnable = fields.modelType !== undefined && RUNNABLE_MODEL_TYPES.has(fields.modelType)
  const errors = issues.filter((issue) => issue.severity === 'error')
  return {
    ok: fields.cellml !== undefined && runnable && errors.length === 0 && fields.exception === undefined,
    runnable,
    elements: {},
    units: { renamed: {} },
    ...fields,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
    generator: GENERATOR,
  }
}
