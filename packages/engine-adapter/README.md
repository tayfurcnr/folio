# @folio/engine-adapter

The only TypeScript boundary to the generated `folio_wasm` module. It loads WASM once, owns isolated session handles, returns typed projections, and normalizes structured Rust errors with an operation ID. React should depend on this package rather than importing wasm-bindgen output.

Build output is expected at `/wasm/folio_wasm.js` and `/wasm/folio_wasm_bg.wasm` (or under Vite's configured base path).
