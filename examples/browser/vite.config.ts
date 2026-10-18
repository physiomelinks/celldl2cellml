import { defineConfig } from 'vite'

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
})
