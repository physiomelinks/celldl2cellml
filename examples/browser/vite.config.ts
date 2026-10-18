import { fileURLToPath } from 'node:url'

import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  // Relative URLs, so the build works from any path (a file server, GitHub Pages)
  base: './',
  // Both modules find their .wasm with new URL(..., import.meta.url), which pre-bundling breaks
  optimizeDeps: { exclude: ['libcellml.js', 'oxigraph'] },
  build: {
    // No inlined assets: the .wasm files stay separate, so their sizes can be measured
    assetsInlineLimit: 0,
    reportCompressedSize: true,
  },
  plugins: [
    // dist/stats.html: what the page's JavaScript is made of, module by module (the .wasm files aren't modules).
    // Sizes are each module's code before minifying, with gzip and brotli estimates; the visualizer's
    // sourcemap mode would give sizes after minifying, but without gzip or brotli, and loses the ?raw files.
    visualizer({
      filename: 'dist/stats.html',
      title: 'bg2cellml browser check: bundle',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      projectRoot: REPO_ROOT,
    }) as PluginOption,
  ],
})
