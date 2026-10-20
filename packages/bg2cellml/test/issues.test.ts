/** `IssueLog`: issues' default severity and stage, and their `elementId`. */

import { describe, expect, it } from 'vitest'

import { IssueLog } from '../src/index.js'

const DOCUMENT = 'https://example.org/model.ttl'

describe('IssueLog', () => {
  it("reports an error at the log's stage", () => {
    const log = new IssueLog('framework')
    log.report('a problem')
    log.reportIssue({ message: 'a note', severity: 'info', stage: 'units' })
    expect(log.issues).toEqual([
      { message: 'a problem', severity: 'error', stage: 'framework' },
      { message: 'a note', severity: 'info', stage: 'units' },
    ])
  })

  it("gives only subjects in the model's document an elementId", () => {
    const log = new IssueLog('model', `${DOCUMENT}#model`)
    log.report('in the document', `${DOCUMENT}#R_1`)
    log.report('the document itself', DOCUMENT)
    log.report('elsewhere', 'https://example.org/other.ttl#R_1')
    expect(log.issues.map((issue) => issue.elementId)).toEqual(['R_1', undefined, undefined])
  })

  it('gives no elementId without a document', () => {
    const log = new IssueLog()
    log.report('a problem', `${DOCUMENT}#R_1`)
    expect(log.issues[0]).toEqual({ message: 'a problem', severity: 'error', stage: 'build', subject: `${DOCUMENT}#R_1` })
  })
})
