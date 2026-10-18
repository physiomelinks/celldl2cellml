import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  BG_RDF,
  REPO_ROOT,
  compareResults,
  loadManifest,
  loadPythonFramework,
  loadReference,
  requireBgRdf,
  sha256,
} from './reference.js'

const manifest = loadManifest()

describe('reference results', () => {
  it('were generated from the BG-RDF files in the bg-rdf submodule', () => {
    requireBgRdf()
    for (const [file, hash] of Object.entries(manifest.bgRdf.files)) {
      expect(sha256(`${BG_RDF}${file}`), `bg-rdf/${file} has changed: regenerate the references`).toBe(hash)
    }
  })

  it('include the framework as Python loads it, with no issues', () => {
    const framework = loadPythonFramework(manifest)
    expect(framework.issues).toEqual([])
    expect(Object.keys(framework.domains)).toHaveLength(4)
    expect(Object.keys(framework.elementTemplates)).toHaveLength(22)
    for (const composite of Object.values(framework.compositeTemplates)) {
      expect(framework.elementTemplates, composite.iri).toHaveProperty([composite.template])
    }
  })

  describe.each(manifest.cases)('$name', (c) => {
    it('has an unchanged source model', () => {
      const path = `${REPO_ROOT}${c.source}`
      expect(existsSync(path), `${c.source} is missing`).toBe(true)
      expect(sha256(path), `${c.source} has changed: regenerate the references`).toBe(c.sourceSha256)
    })

    it('has a consistent reference', () => {
      const reference = loadReference(c)
      const points = reference.voi.values.length
      for (const group of ['states', 'rates', 'algebraics'] as const) {
        for (const values of Object.values(reference[group])) expect(values).toHaveLength(points)
      }
      expect(Object.keys(reference.states).length).toBeGreaterThan(0)
      expect(compareResults(reference, reference, manifest.tolerance)).toEqual([])
    })

    if (c.pmrCheck) {
      it('agrees with the hand-built PMR model', () => {
        expect(c.pmrCheck!.problems).toEqual([])
      })
    }
  })
})
