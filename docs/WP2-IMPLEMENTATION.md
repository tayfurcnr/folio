# WP2 implementation report

## Delivered

- `crates/folio-wasm`: Thin Rust wrapper using DeckCraft revision `19dceffd0bf3cbc79f9aaaf23fe3e05932fb434d` and the PoC's pinned `krilla` patch `c5a1cbfb5f9049f9270955caffb5bee5997aebf7`.
- Rust API: create/free session through wasm-bindgen, execute command, batch insertion, pointer/key and text composition, document and slide projections, selection projection, RGBA render, undo/redo and PPTX import/export.
- Rust errors cross the WASM boundary as structured `{ code, message, retryable }`; adapter adds an `operationId`.
- `packages/engine-adapter`: sole TypeScript WASM boundary, single-load retry behavior, isolated session registry and typed API.
- Root scripts for native Rust tests, adapter tests and typechecking. `scripts/build-wasm.mjs` emits ignored generated glue/artifacts under `apps/editor/public/wasm`.

## Verification run

- `cargo test --manifest-path crates/folio-wasm/Cargo.toml`: 3 passed (batch/undo/redo and session isolation; pointer/key/render and structured errors; PPTX round-trip and batch limits).
- `cargo check --manifest-path crates/folio-wasm/Cargo.toml --target wasm32-unknown-unknown`: passed.
- `npm test`: 3 Rust tests and 3 TypeScript adapter tests passed.
- `npm run typecheck`: editor and adapter passed.
- `npm run build`: passed.
- `npm run build:wasm`: passed; generated the wasm-bindgen glue and 25 MB WASM artifact locally (ignored by git).

## Explicit limits

- The adapter is not connected to React in WP2.
- PPTX round-trip coverage here is a native DeckCraft smoke round-trip, not validation against authentic Microsoft PowerPoint files.
- OS IME behavior, production font manifest and representative memory/performance tests remain open release gates.
- Batch uses DeckCraft `edit.paste` and one undo step; current journal record omits the shapes payload, so crash recovery cannot reconstruct the batch operation. Do not advertise recovery completeness.
- MPL-2.0 Symphonia notices/source delivery identified by the PoC remain a distribution requirement; see `deckcraft/poc/folio-wasm/MPL-2.0-DISTRIBUTION.md` (reference only; the file is outside Folio and was not changed).
