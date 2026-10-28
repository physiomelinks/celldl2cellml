import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  BG_RDF,
  FORK_ADDITIONS,
  REPO_ROOT,
  compareResults,
  loadManifest,
  loadPythonFramework,
  loadFixedPythonModel,
  loadPythonModel,
  loadReference,
  requireBgRdf,
  sha256,
} from './reference.js'

const manifest = loadManifest()

describe('reference results', () => {
  it('were generated from the BG-RDF files in the bg-rdf submodule', () => {
    requireBgRdf()
    for (const [file, hash] of Object.entries(manifest.bgRdf.files)) {
      // Or as the fork has it, adding to them (`FORK_ADDITIONS`)
      expect(sha256(`${BG_RDF}${file}`), `bg-rdf/${file} has changed: regenerate the references`).toBe(FORK_ADDITIONS.files[file] ?? hash)
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

  it('include the model as Python builds it, for every case Python can build', () => {
    const built = manifest.cases.filter((c) => c.intermediate !== undefined).map((c) => c.name)
    expect(built).toEqual([
      ...manifest.cases.filter((c) => c.kind === 'example').map((c) => c.name),
      'RC_prefixed_values',
      'A3_numbers_with_units',
      'A3_reduced_numbers_with_units',
    ])
  })

  it('include the model as Python builds it with bug 3 fixed, where that differs', () => {
    const fixed = manifest.cases.filter((c) => c.intermediateBug3Fixed !== undefined).map((c) => c.name)
    expect(fixed).toEqual(['example_B2', 'example_B2_reduced', 'RC_labelled_bonds'])
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

    if (c.intermediate !== undefined) {
      it('has an intermediate fixture from the same source, with no issues', () => {
        const model = loadPythonModel(c)
        expect(model.case).toBe(c.name)
        expect(model.sourceSha256, `${c.intermediate} is stale: regenerate the references`).toBe(c.sourceSha256)
        expect(model.issues).toEqual([])
        expect(model.elements.length).toBeGreaterThan(0)
        expect(model.equations.length).toBeGreaterThan(0)
      })
    }

    if (c.intermediateBug3Fixed !== undefined) {
      it('has a bug-3-fixed fixture from the same source, with no issues', () => {
        const model = loadFixedPythonModel(c)
        expect(model.case).toBe(c.name)
        expect(model.sourceSha256, `${c.intermediateBug3Fixed} is stale: regenerate the references`).toBe(c.sourceSha256)
        expect(model.issues).toEqual([])
      })
    }

    if (c.pmrCheck) {
      it('agrees with the hand-built PMR model', () => {
        expect(c.pmrCheck!.problems).toEqual([])
      })
    }
  })
})
