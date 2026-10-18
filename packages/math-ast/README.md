# @physiomelinks/math-ast

An expression tree for CellML 2.0's subset of Content MathML, with a MathML reader and writer, structural comparison, variable renaming and tidying.

It replaces the parts of sympy that the Python [bg2cellml](https://github.com/CellDL/BG-Tools) uses, and is meant to be the shared core for other tools that handle CellML maths. The tree, the function, constant and operator tables, and the reader's handling of CellML's MathML come from [vue3-math-editor](https://github.com/vue3-repos/vue3-math-editor). It has no runtime dependencies and knows nothing about bond graphs or editors.

## Usage

```js
import { parseMathML, readMathML, substitute, toEquations, toMathML } from '@physiomelinks/math-ast'

// Strict: throws a MathMLError listing every problem
const equations = toEquations(parseMathML(relation))

// Lenient: reads what it can and lists the problems, as an editor pasting MathML wants
const { expressions, problems } = readMathML(pasted)

const forElement = substitute(equations[0].right, { kappa: 'kappa_r', u_f: 'u_f_Re_r' })

// CellML 2.0 needs units on every number
const math = toMathML(equations, { cnUnits: () => 'dimensionless' })
```

In Node, pass a DOM parser such as `@xmldom/xmldom`'s: `parseMathML(text, { domParser: new DOMParser() })`. Browsers use their own.

## What it covers

| Area | Functions | Status |
|---|---|---|
| Tree | `AstNode`: numbers (with units and e-notation), variables, constants, arithmetic, roots, abs, the 33 functions, comparisons, logic, piecewise, first derivatives | Done |
| Builders | `ci`, `cn`, `constant`, `plus`, `minus`, `times`, `divide`, `power`, `fn`, `exp`, `ln`, `sin`, `cos`, `diff`, `eq` | Done |
| Tables | `FUNCTIONS`, `CONSTANTS`, `CONDITION_OPERATORS`, each with its MathML, LaTeX and MathJSON | Done |
| Walking | `children`, `mapChildren`, `walk` | Done |
| Comparing | `equals` (structural), `variables`, `sortKey` | Done |
| Renaming | `substitute` | Done |
| Reading | `readMathML`, `readMathMLElement` (lenient); `parseMathML`, `fromMathMLElement` (strict); `toEquations` | Done |
| Writing | `toMathML`, `toMathMLFragment`, with a `cnUnits` hook for CellML's `cellml:units` | Done |
| Tidying | `canonicalise`: flatten, fold numbers, collect like terms, drop zeros, sort | Done |

## Reading

- **Input:** one or more `<math>` elements, or bare expressions such as an `<apply>`. The `cellml` prefix can be used without being declared.
- **Numbers:** `cellml:units` is read in any CellML version's namespace. E-notation (`<cn type="e-notation">1<sep/>-8</cn>`) keeps its mantissa and exponent. Only base 10 is accepted, and only real, integer and e-notation types.
- **Derivatives:** only first derivatives, as CellML 2.0 allows. `toEquations` moves a derivative on the right of an equation to the left, as the Python bg2cellml does.
- **Problems:** anything outside CellML's MathML is a problem naming the element, for example `<sum> isn't supported in CellML's MathML`. So is the wrong number of operands, a misplaced qualifier, an invalid name or number, or stray text. Every problem in every expression is reported, not just the first.

## Writing

- **Output:** one `<math>` element holding every expression, indented by two spaces (`indent: ''` for one line). It declares the MathML namespace, and the `cellml` prefix only when some number has units.
- **Units:** each number's `cellml:units` comes from `cnUnits(number)`, then from the number's own `units`. A number with neither has no attribute, which CellML 2.0 rejects, so a CellML writer should always pass `cnUnits`.
- **Numbers:** written as JavaScript prints them (`0.1`, not `0.10000000000000001`). A number that would print with an exponent is written in e-notation, since CellML rejects `1e-8` as text. Numbers read in e-notation keep their mantissa and exponent. NaN and the infinities are written as `<notanumber/>` and `<infinity/>`.
- **Checked by libCellML:** every BG-RDF relation, written out, passes libCellML's strict parser and validator, and reads back as the same expression.

## Tidying

`canonicalise` does what sympy does automatically when the Python bg2cellml builds sums and products, so expressions that are equal come out as equal trees:

- **Flattening:** nested sums and products become one.
- **Numbers:** plain numbers fold (`2 × 3 × x` is `6x`), and zeros and ones go (`x + 0`, `x × 1`, `x / 1`, `x ^ 1`).
- **Like terms:** collected, so `2x + 3x` is `5x` and `x - x` is `0`. An empty sum is `0` and an empty product `1`.
- **Spreading:** a number times a sum is spread over it, as sympy does (`2(a + b)` is `2a + 2b`). That's how a variable that is both an input and an output of a junction cancels. Products of other sums stay as they are.
- **Order:** terms and factors are sorted, so `b + a` and `a + b` give the same tree. Coefficients come first and the constant term last.
- **Signs:** negative terms are gathered into one subtraction, `a + c - (b + x)`, or a negation when every term is negative.

Two limits, both deliberate:

- **Units:** numbers with units are never folded or collected, since `2 s + 3` has no single value.
- **Finite arithmetic:** the result equals the input wherever the input is finite. Once a division by zero gives an infinity, JavaScript's signed zero can decide between `∞ - ∞` and `∞ + ∞`, and folding `-(0)` to `0` loses that sign.

It's checked against 2,000 random expressions for keeping the value, being stable under a second pass, and ignoring the order of terms and factors. A one-off run of 50,000 deeper expressions also passed.

## Design notes

- **Plain data.** Nodes are plain, read-only objects, so they're easy to compare, serialise and test. `traverse.ts` is the only place that needs a case for every node type.
- **Editor-only nodes stay out.** vue3-math-editor's `Group` (typed brackets) and `Placeholder` (empty slot) aren't part of the maths. An editor can extend `AstNode` with them.
- **CellML stays outside.** CellML 2.0 needs `cellml:units` on every `<cn>`. The writer asks the caller for those units through `cnUnits`, so this package doesn't need to know about CellML models.
- **Output text won't match sympy's.** Term order is deterministic but differs from sympy's. Parity is checked by simulation.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
