/** `GENERATOR` is the package's name and version; `yarn sync-version` keeps it so. */

import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import { GENERATOR } from '../src/index.js'

it("is package.json's name and version", () => {
  const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string }
  expect(GENERATOR).toEqual({ name, version })
})
