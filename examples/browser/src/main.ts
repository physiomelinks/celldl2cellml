/**
 * The browser check page (work plan chunk 8.1). It loads the converter, then
 * converts the bundled cases, or a file you choose, and shows the results.
 * `window.browserCheck` is what the Playwright test drives.
 */

import { CASES, type Case, type CaseResult } from './cases.js'
import { loadConverter, type Loaded, type LoadTimes } from './runtime.js'

export interface BrowserCheck {
  /** Resolves once the converter and framework are loaded. */
  ready: Promise<{ times: LoadTimes; frameworkIssues: string[]; userAgent: string }>
  /** Convert every bundled case, one after another. */
  convertAll(): Promise<CaseResult[]>
}

declare global {
  interface Window {
    browserCheck: BrowserCheck
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const status = $<HTMLParagraphElement>('status')
const rows = $<HTMLTableSectionElement>('rows')
const output = $<HTMLPreElement>('output')
const outputTitle = $<HTMLHeadingElement>('output-title')
const convertAllButton = $<HTMLButtonElement>('convert-all')
const fileInput = $<HTMLInputElement>('file')

const ms = (value: number): string => `${value.toFixed(0)} ms`

function outcome(result: CaseResult): { text: string; className: string } {
  if (result.exception !== undefined) return { text: 'exception', className: 'bad' }
  if (result.issues !== undefined) return { text: `${result.issues.length} issue${result.issues.length === 1 ? '' : 's'}`, className: 'warn' }
  return { text: 'CellML', className: 'good' }
}

function show(result: CaseResult): void {
  outputTitle.textContent = result.name
  const parts: string[] = []
  if (result.exception !== undefined) parts.push(`Exception:\n${result.exception}`)
  if (result.issues !== undefined) parts.push(`Issues:\n${result.issues.map((issue) => `- ${issue}`).join('\n')}`)
  if (result.cellml !== undefined) parts.push(result.cellml)
  if (result.metadata !== undefined) parts.push(`Metadata:\n${result.metadata}`)
  output.textContent = parts.join('\n\n')
}

function addRow(kind: string, result: CaseResult): void {
  const row = document.createElement('tr')
  const { text, className } = outcome(result)
  const cells = [result.name, kind, text, result.cellml === undefined ? '' : `${(result.cellml.length / 1024).toFixed(1)} kB`, ms(result.ms)]
  for (const [index, value] of cells.entries()) {
    const cell = document.createElement('td')
    cell.textContent = value
    if (index === 2) cell.className = className
    if (index >= 3) cell.className = 'number'
    row.append(cell)
  }
  row.tabIndex = 0
  row.addEventListener('click', () => show(result))
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') show(result)
  })
  rows.append(row)
}

async function convert(loaded: Loaded, name: string, source: string, options: Pick<Case, 'sourceUri' | 'rdfSource'>): Promise<CaseResult> {
  const start = performance.now()
  const result = await loaded.converter.celldl2cellml(source, { sourceUri: options.sourceUri, rdfSource: options.rdfSource, metadata: true })
  return { name, ...result, ms: performance.now() - start }
}

async function start(): Promise<Loaded> {
  const loaded = await loadConverter()
  const { times, frameworkIssues } = loaded
  status.textContent =
    `Loaded oxigraph in ${ms(times.oxigraph)} and libcellml.js in ${ms(times.libcellml)} (in parallel), ` +
    `then the BG-RDF framework in ${ms(times.framework)}` +
    (frameworkIssues.length > 0 ? `, with ${frameworkIssues.length} issues: ${frameworkIssues.join('; ')}` : '.')
  status.className = frameworkIssues.length > 0 ? 'bad' : ''
  convertAllButton.disabled = false
  fileInput.disabled = false
  return loaded
}

const loading = start()
loading.catch((error: unknown) => {
  status.textContent = `Failed to load: ${error instanceof Error ? error.message : String(error)}`
  status.className = 'bad'
})

async function convertAll(): Promise<CaseResult[]> {
  const loaded = await loading
  convertAllButton.disabled = true
  rows.replaceChildren()
  const results: CaseResult[] = []
  const startAll = performance.now()
  for (const c of CASES) {
    const result = await convert(loaded, c.name, loaded.bundled(c.source), c)
    results.push(result)
    addRow(c.kind, result)
  }
  const failed = results.filter((r) => r.exception !== undefined).length
  $<HTMLParagraphElement>('summary').textContent =
    `${results.length} cases in ${ms(performance.now() - startAll)}: ` +
    `${results.filter((r) => r.cellml !== undefined).length} gave CellML, ` +
    `${results.filter((r) => r.issues !== undefined).length} gave issues (example_A3 and example_A3_reduced should, for their units), ` +
    `${failed} threw.`
  convertAllButton.disabled = false
  return results
}

convertAllButton.addEventListener('click', () => void convertAll())

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (file === undefined) return
  const loaded = await loading
  const rdfSource = /\.ttl$/i.test(file.name)
  // A local file has no IRI of its own; give it one, percent-encoded as the converter requires
  const sourceUri = `file:///${encodeURIComponent(file.name)}`
  const result = await convert(loaded, file.name, await file.text(), { sourceUri, rdfSource })
  addRow(rdfSource ? 'your Turtle' : 'your CellDL', result)
  show(result)
  fileInput.value = ''
})

window.browserCheck = {
  ready: loading.then(({ times, frameworkIssues }) => ({ times, frameworkIssues, userAgent: navigator.userAgent })),
  convertAll,
}
