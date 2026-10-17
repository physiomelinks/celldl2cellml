# @physiomelinks/math-ast

A small expression tree for Content MathML. It reads equations from MathML, builds and compares expressions, renames variables, tidies sums and products, and writes MathML back out.

It replaces the parts of sympy that the Python [bg2cellml](https://github.com/CellDL/BG-Tools) uses. It has no runtime dependencies and knows nothing about bond graphs or CellML.

> [!WARNING]
> This is an early skeleton. `parseMathML`, `toMathML` and `canonicalise` aren't implemented yet.

## Usage

```js
import { ci, divide, eq, exp, minus, substitute, times, toMathML } from '@physiomelinks/math-ast'

// v = kappa*(exp(u_f/RT) - exp(u_r/RT))
const relation = eq(
  ci('v'),
  times(ci('kappa'), minus(exp(divide(ci('u_f'), ci('RT'))), exp(divide(ci('u_r'), ci('RT'))))),
)

const forElement = substitute(relation.rhs, { kappa: 'kappa_r', u_f: 'u_f_Re_r', u_r: 'u_r_Re_r' })
```

## What it covers

| Area | Functions | Status |
|---|---|---|
| Tree and builders | `ci`, `cn`, `constant`, `apply`, `plus`, `minus`, `times`, `divide`, `power`, `exp`, `ln`, `sin`, `cos`, `diff`, `eq` | Done |
| Comparing | `equals` (structural), `variables`, `sortKey` | Done |
| Renaming | `substitute`, `substituteEquation` | Done |
| Tidying | `canonicalise`: flatten, fold numbers, collect like terms, drop zeros | To do |
| Reading | `parseMathML`, `fromMathMLElement` (browser `DOMParser`, or `@xmldom/xmldom` in Node) | To do |
| Writing | `toMathML`, with a `cnUnits` hook for CellML's `cellml:units` | To do |

## Design notes

- **Plain data.** Nodes are plain, read-only objects, so they're easy to compare, serialise and test.
- **CellML stays outside.** CellML 2.0 needs `cellml:units` on every `<cn>`. The writer asks the caller for those units through `cnUnits`, so this package doesn't need to know about CellML.
- **Output text won't match sympy's.** Term order should be deterministic but doesn't need to match the Python output. Parity is checked by simulation.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
