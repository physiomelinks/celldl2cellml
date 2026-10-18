/**
 * The browser check (work plan chunk 8.1): the page must load the converter
 * and give, for every bundled case, exactly what the converter gives in Node,
 * where the parity tests check it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Converter } from '@physiomelinks/bg2cellml'
import type { LibCellML } from '@physiomelinks/cellml-units'
import { DOMParser } from '@xmldom/xmldom'
import createLibCellML from 'libcellml.js'
import * as oxigraph from 'oxigraph'

import { CASES, ONTOLOGY, TEMPLATES, templateName, type CaseResult } from '../src/cases.js'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8')

type Output = Omit<CaseResult, 'name' | 'ms'>

/** What the converter gives in Node, by case name. */
async function nodeOutputs(): Promise<Map<string, Output>> {
  const libcellml = (await createLibCellML()) as unknown as LibCellML
  const converter = new Converter({ libcellml, oxigraph, domParser: new DOMParser() as never })
  const issues = converter.loadFramework({
    ontology: read(ONTOLOGY),
    templates: Object.fromEntries(TEMPLATES.map((path) => [templateName(path), read(path)])),
  })
  expect(issues).toEqual([])
  const outputs = new Map<string, Output>()
  for (const c of CASES) {
    outputs.set(c.name, await converter.celldl2cellml(read(c.source), { sourceUri: c.sourceUri, rdfSource: c.rdfSource, metadata: true }))
  }
  return outputs
}

const outputOf = ({ name: _name, ms: _ms, ...output }: CaseResult): Output => output

test('converts every bundled case as Node does', async ({ page, browserName }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  const expected = await nodeOutputs()

  await page.goto('/')
  const ready = await page.evaluate(() => window.browserCheck.ready)
  expect(ready.frameworkIssues).toEqual([])

  const results = await page.evaluate(() => window.browserCheck.convertAll())
  expect(results.map((r) => r.name)).toEqual(CASES.map((c) => c.name))
  for (const result of results) {
    expect(outputOf(result), result.name).toEqual(expected.get(result.name))
  }

  // What the cases should give, as the Node tests check: CellML, apart from
  // example_A3 and example_A3_reduced, whose voltage source's numbers have no units
  const withIssues = results.filter((r) => r.issues !== undefined).map((r) => r.name)
  expect(withIssues).toEqual(['example_A3', 'example_A3_reduced'])
  expect(results.filter((r) => r.exception !== undefined)).toEqual([])

  // The page shows what it converted
  await expect(page.locator('#rows tr')).toHaveCount(CASES.length)
  await page.locator('#rows tr', { hasText: 'example_RC_reduced' }).click()
  await expect(page.locator('#output')).toContainText('<model')

  expect(errors).toEqual([])

  // Keep the load and conversion times, to record in the README
  const record = {
    browser: browserName,
    userAgent: ready.userAgent,
    loadMs: ready.times,
    convertMs: Object.fromEntries(results.map((r) => [r.name, Math.round(r.ms)])),
    totalConvertMs: Math.round(results.reduce((sum, r) => sum + r.ms, 0)),
  }
  mkdirSync(testInfo.outputDir, { recursive: true })
  writeFileSync(testInfo.outputPath('timings.json'), `${JSON.stringify(record, null, 2)}\n`)
  await testInfo.attach('timings', { body: JSON.stringify(record, null, 2), contentType: 'application/json' })
  console.log(`${browserName}: ${JSON.stringify({ load: record.loadMs, totalConvertMs: record.totalConvertMs })}`)
})

test('converts a file chosen with the file picker', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => window.browserCheck.ready)
  await page.locator('#file').setInputFiles(`${REPO_ROOT}packages/bg2cellml/test/models/rdf_error.celldl`)
  const row = page.locator('#rows tr', { hasText: 'rdf_error.celldl' })
  await expect(row).toContainText('your CellDL')
  await expect(row).toContainText('CellML')
  await expect(page.locator('#output')).toContainText('<model')
})
