import { elementIdOf } from './model/names.js'

/** How serious an issue is. Only errors stop a model being used; libCellML's messages are `info`. */
export type IssueSeverity = 'error' | 'warning' | 'info'

/**
 * Where an issue was found: reading the source (`input`), loading the
 * framework or the model, converting units, building the CellML, or checking
 * it with libCellML's Validator or Analyser.
 */
export type IssueStage = 'input' | 'framework' | 'model' | 'units' | 'build' | 'validator' | 'analyser'

/** A problem found while loading a framework or model, or generating CellML. */
export interface Issue {
  readonly message: string
  readonly severity: IssueSeverity
  readonly stage: IssueStage
  /** The IRI of the element, junction or bond involved, if there is one. */
  readonly subject?: string
  /** The subject's IRI fragment, such as a CellDL diagram id, when the subject is in the model's document. */
  readonly elementId?: string
  readonly cause?: unknown
}

/** What `reportIssue()` takes: an issue whose severity and stage default to `error` and the log's stage. */
export type IssueReport = Omit<Issue, 'severity' | 'stage' | 'elementId'> & Partial<Pick<Issue, 'severity' | 'stage'>>

/** Collects issues instead of throwing, so one run reports every problem. Matches the Python `report_issue()`. */
export class IssueLog {
  readonly #issues: Issue[] = []
  /** The stage of issues that don't give their own. */
  readonly stage: IssueStage
  /** The model's document IRI, without a fragment, whose subjects' fragments are issues' `elementId`s. */
  document?: string

  constructor(stage: IssueStage = 'build', document?: string) {
    this.stage = stage
    if (document !== undefined) this.document = documentOf(document)
  }

  /** Report an error at the log's stage. */
  report(message: string, subject?: string, cause?: unknown): void {
    this.reportIssue({ message, ...(subject === undefined ? {} : { subject }), ...(cause === undefined ? {} : { cause }) })
  }

  /** Report an issue, with `elementId` set when its subject is in the model's document. */
  reportIssue(report: IssueReport): void {
    const issue: { -readonly [K in keyof Issue]: Issue[K] } = {
      message: report.message,
      severity: report.severity ?? 'error',
      stage: report.stage ?? this.stage,
    }
    if (report.subject !== undefined) {
      issue.subject = report.subject
      const elementId = this.#elementId(report.subject)
      if (elementId !== undefined) issue.elementId = elementId
    }
    if (report.cause !== undefined) issue.cause = report.cause
    this.#issues.push(issue)
  }

  get issues(): readonly Issue[] {
    return this.#issues
  }

  get hasIssues(): boolean {
    return this.#issues.length > 0
  }

  #elementId(subject: string): string | undefined {
    return this.document === undefined ? undefined : elementIdOf(subject, this.document)
  }
}

/** An IRI without its fragment. */
export const documentOf = (iri: string): string => {
  const hash = iri.indexOf('#')
  return hash < 0 ? iri : iri.slice(0, hash)
}
