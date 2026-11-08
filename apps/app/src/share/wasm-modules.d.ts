// Wrangler bundles a .wasm import as a compiled WebAssembly.Module, the only form Workers will run.
declare module '*.wasm' {
  const compiledModule: WebAssembly.Module
  export default compiledModule
}
