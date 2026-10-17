// libcellml.js ships no type declarations. The parts of its API these
// packages use are typed in @physiomelinks/cellml-units (`LibCellML`); this
// only types the module's default export, the WebAssembly loader.
declare module 'libcellml.js' {
  const createLibCellML: (options?: Record<string, unknown>) => Promise<unknown>
  export default createLibCellML
}
