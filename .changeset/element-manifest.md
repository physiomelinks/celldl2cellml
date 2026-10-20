---
'@physiomelinks/bg2cellml': minor
---

`convert()` returns `elements`, the element manifest: each element's and junction's CellML variables by its diagram id, with each variable's role (`flow`, `potential`, `quantity`, `parameter`, `ratio` or `other`) and units, and its `primary` variable. A variable two elements share is listed for both. `generateCellML()` returns it too, and `toViewerAnnotations()` makes `@celldl/viewer` annotations of it. `celldl2cellml()` is unchanged.
