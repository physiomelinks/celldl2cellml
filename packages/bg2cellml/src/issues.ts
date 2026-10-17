/** A problem found while loading a framework or model, or generating CellML. */
export interface Issue {
  readonly message: string
  /** The IRI of the element, junction or bond involved, if there is one. */
  readonly subject?: string
  readonly cause?: unknown
}

/** Collects issues instead of throwing, so one run reports every problem. Matches the Python `report_issue()`. */
export class IssueLog {
  readonly #issues: Issue[] = []

  report(message: string, subject?: string, cause?: unknown): void {
    const issue: { -readonly [K in keyof Issue]: Issue[K] } = { message }
    if (subject !== undefined) issue.subject = subject
    if (cause !== undefined) issue.cause = cause
    this.#issues.push(issue)
  }

  get issues(): readonly Issue[] {
    return this.#issues
  }

  get hasIssues(): boolean {
    return this.#issues.length > 0
  }
}
