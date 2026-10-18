/**
 * Variables declared by BG-RDF domains and templates, and the literals that
 * give their units and values. Ported from `Variable`, `Units.from_ucum` and
 * `Value.from_literal` in the Python bg2cellml.
 *
 * Units are kept as UCUM codes, checked with `@physiomelinks/cellml-units`.
 */

import { UcumError, parseUcum } from '@physiomelinks/cellml-units'

import type { Term } from '../rdf/graph.js'
import { CDT, xsd } from '../rdf/namespaces.js'

/** A problem with a declaration, reported as an issue by whatever was loading it. */
export class DeclarationError extends Error {
  override name = 'DeclarationError'
}

/** A number with the UCUM units it was given in, if it was given any. */
export interface Value {
  readonly magnitude: number
  readonly units?: string
}

/** A variable declared by a domain or template. `units` is a UCUM code. */
export interface VariableDefinition {
  readonly name: string
  readonly units: string
  readonly value?: Value
  /** The variable's `bgf:` type, such as `bgf:FlowVariable`. */
  readonly type?: string
}

/** A name usable as a symbol: `:`, `-`, `.` and spaces become `_`, as in Python's `clean_name`. */
export function cleanName(name: string): string {
  return name.replace(/[:\-. ]/g, '_')
}

/** `<iri>`, the way the Python messages print a named node. */
const angled = (iri: string): string => `<${iri}>`

/** Checks a UCUM code, turning a `UcumError` into a `DeclarationError`. */
function checkUcum(code: string, context: string): string {
  try {
    parseUcum(code)
  } catch (error) {
    if (error instanceof UcumError) throw new DeclarationError(`${context} has no valid units: ${error.message}`)
    throw error
  }
  return code
}

/** The UCUM code in a `cdt:ucumunit` literal, such as `"mol/s"^^cdt:ucumunit`. */
export function readUnits(term: Term, context = 'Units value'): string {
  if (term.termType !== 'Literal' || term.datatype.value !== CDT.ucumunit) {
    const datatype = term.termType === 'Literal' ? angled(term.datatype.value) : term.termType
    throw new DeclarationError(`Units value has unexpected datatype: ${datatype}`)
  }
  return checkUcum(term.value.trim(), context)
}

/** XML Schema's numeric datatypes, which Turtle gives plain numbers such as `10.0`. */
const NUMERIC_DATATYPES = new Set(
  [
    'decimal', 'double', 'float', 'integer', 'int', 'long', 'short', 'byte',
    'nonNegativeInteger', 'nonPositiveInteger', 'positiveInteger', 'negativeInteger',
    'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte',
  ].map(xsd),
)

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function readNumber(text: string, literal: string): number {
  if (!NUMBER.test(text)) throw new DeclarationError(`Can't read a number from "${literal}"`)
  return Number(text)
}

/**
 * The value in a literal: a `cdt:ucum` literal such as
 * `"2578.73058 J/mol"^^cdt:ucum` gives a magnitude and units, and a plain
 * number (`10.0`, any XML Schema numeric type) gives a magnitude alone.
 *
 * The Python version rejects plain numbers when run with oxigraph, which
 * types them, so it can never take its no-units branch.
 */
export function readValue(term: Term, context = 'Value'): Value {
  if (term.termType !== 'Literal') throw new DeclarationError(`Literal value has unexpected datatype: ${term.termType}`)
  const datatype = term.datatype.value
  if (datatype === CDT.ucum) {
    const parts = term.value.trim().split(/\s+/)
    if (parts.length !== 2) throw new DeclarationError(`Can't read "${term.value}" as a number and its units`)
    return { magnitude: readNumber(parts[0]!, term.value), units: checkUcum(parts[1]!, context) }
  }
  if (NUMERIC_DATATYPES.has(datatype)) return { magnitude: readNumber(term.value.trim(), term.value) }
  throw new DeclarationError(`Literal value has unexpected datatype: ${angled(datatype)}`)
}

/**
 * A variable from its declaration. Its units are `units` if given, otherwise
 * those of its value; a variable with neither is an error. A value with no
 * units of its own takes the variable's.
 *
 * Checking that a value's units are compatible with the variable's needs
 * libCellML, and comes with the templates that need it (chunk 4.2).
 */
export function makeVariable(
  owner: string,
  name: string,
  declaration: { readonly units?: Term; readonly value?: Term; readonly type?: string },
): VariableDefinition {
  const context = `Variable ${name} for ${angled(owner)}`
  let units = declaration.units === undefined ? undefined : readUnits(declaration.units, context)
  let value = declaration.value === undefined ? undefined : readValue(declaration.value, context)
  units ??= value?.units
  if (units === undefined) throw new DeclarationError(`Variable ${name} for ${angled(owner)} has no Units specified`)
  if (value !== undefined && value.units === undefined) value = { ...value, units }

  return {
    name: cleanName(name),
    units,
    ...(value === undefined ? {} : { value }),
    ...(declaration.type === undefined ? {} : { type: declaration.type }),
  }
}
