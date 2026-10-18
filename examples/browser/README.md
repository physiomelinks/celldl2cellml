# Browser check

A small Vite page that runs `@physiomelinks/bg2cellml` in a browser, with oxigraph's web build (`oxigraph/web.js`) and libcellml.js, and converts CellDL and BG-RDF to CellML 2.0. It is chunk 8.1 of the work plan: the check that the packages work in Chrome, Firefox and Safari before they replace the Pyodide converter.

It isn't published. It converts:

- `rdf_error.celldl`, a CellDL document saved by the CellDL Editor (BG-Tools' `tests/models/rdf_error.celldl`, the only one we have);
- the 14 BG-RDF examples and the 5 variants in the reference manifest, as BG-RDF Turtle;
- any `.celldl`, `.svg` or `.ttl` file you choose.

Each case uses the base IRI the parity tests use, so its CellML is exactly what those tests check.

## Running it

Build the packages first, from the repository root:

```sh
yarn install
yarn build
```

Then, in this directory (or with `yarn workspace @physiomelinks/browser-check <script>`):

```sh
yarn dev             # the page at http://localhost:5173/, to open in any browser
yarn build           # the production build, in dist/
yarn preview         # serves dist/ at http://localhost:4173/
yarn size            # the build's download size, raw, gzip and brotli
yarn test:browsers   # the Playwright check, in Chromium, Firefox and WebKit
```

`test:browsers` needs Playwright's browsers once: `yarn playwright install chromium firefox webkit`. Where they can't be downloaded, `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can point at an installed Chromium, and `--project chromium` runs just that one.

## What the Playwright check checks

`test/browser.spec.ts` builds and serves the page, then in each browser:

- the converter and the BG-RDF framework load with no issues and no page errors;
- every case gives **exactly** what the converter gives in Node (CellML, metadata, issues), so anything the parity tests prove holds in the browser too;
- every case gives CellML, apart from example_A3 and example_A3_reduced, whose voltage source's numbers have no units (as in the Node tests);
- the page lists the cases, shows a case's CellML, and converts a file chosen with the file picker.

It writes each browser's load and conversion times to `test-results/<test>-<browser>/timings.json`.

WebKit is Playwright's build of Safari's engine, not Safari itself, so Safari is also checked by hand: open `yarn dev` or `yarn preview` in Safari, choose *Convert all bundled cases*, and check that 18 cases give CellML and example_A3 and example_A3_reduced give 1 and 2 issues.

## Results

### Browsers

| Browser | Version | How | Result | Date |
|---|---|---|---|---|
| Chromium | 156 (headless, Linux) | Playwright | All 20 cases as Node; file picker works | 18 October 2026 |
| Firefox | | Playwright | Passed | 18 October 2026 |
| WebKit | | Playwright | Passed | 18 October 2026 |
| Chrome | | By hand | Passed | 18 October 2026 |
| Safari | | By hand | Passed | 18 October 2026 |

In Chromium (2 CPU cores, Linux), oxigraph and libcellml.js loaded in 0.3 s each, in parallel, and the framework in 0.2 s. The 20 cases took 12 s, 0.3 s to 1 s each, the same as in Node on that machine: the converter, not the browser, sets the speed.

### Download size

From `yarn size` on the production build. Pyodide's 24 MB is unpacked (pyodide.asm.wasm 8.6 MB, sympy 6.3 MB, the Python standard library 2.4 MB, networkx 2.0 MB, lxml 1.8 MB and smaller wheels), so compare the raw column.

| Part | Raw (MB) | gzip (MB) | brotli (MB) |
|---|---:|---:|---:|
| oxigraph (.wasm) | 4.05 | 1.45 | 0.98 |
| libcellml.js (.wasm) | 2.30 | 0.65 | 0.48 |
| Converter, its packages and both modules' glue (.js) | 0.22 | 0.07 | 0.06 |
| **Converter** | **6.57** | **2.17** | **1.52** |
| Page data: BG-RDF framework and cases (.js) | 0.14 | 0.02 | 0.02 |

The converter is 6.6 MB raw against Pyodide's 24 MB: 27% of it. An application that already loads one of the modules downloads less: the CellDL Editor already has oxigraph, so for it the converter adds about 2.5 MB raw (0.5 MB as brotli); PhLynx already loads libcellml.js, so for it the converter adds about 4.3 MB raw.

## Notes

- Both modules find their `.wasm` with `new URL(..., import.meta.url)`, so `vite.config.ts` keeps them out of Vite's dependency pre-bundling. An application using Vite needs the same `optimizeDeps.exclude`.
- Vite warns that libcellml.js imports `node:module`. It only does so when it runs in Node, so the warning is harmless in a browser build.
- No DOMParser is passed in: the converter uses the browser's own.
