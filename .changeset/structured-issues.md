---
'@physiomelinks/bg2cellml': minor
---

Give each issue a `severity` (`error`, `warning` or `info`), the `stage` that found it (`input`, `framework`, `model`, `units`, `build`, `validator` or `analyser`; values in incompatible units and units CellML can't express are `units`), and, when its subject is in the model's document, the subject's IRI fragment as `elementId`. libCellML's levels become severities, with `message` as `info`. Validator warnings alone no longer stop a model being analysed, and a model type that can't run is reported as an error. `IssueLog.reportIssue()` reports an issue with these fields; `report()` is unchanged and reports an error.
