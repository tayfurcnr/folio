# Folio WASM engine wrapper

This crate is a thin downstream wrapper around DeckCraft at `19dceffd0bf3cbc79f9aaaf23fe3e05932fb434d`. It follows the verified `deckcraft/poc/folio-wasm` implementation pattern and does not copy the DeckCraft engine source. The WASM-facing API exposes command/input operations, small document/selection projections, render, undo/redo, PPTX import/export and batch insertion. PoC-only font and memory diagnostics are intentionally omitted.

Batch insertion uses DeckCraft's `edit.paste` command in one history transaction and restores clipboard/preferences. DeckCraft's current journal entry for this action omits the clipboard payload, so crash recovery cannot replay the inserted shapes yet. Keep recovery claims disabled until DeckCraft provides a journal-safe batch API or upstream fix.

Production readiness remains gated on authentic PowerPoint round trips, OS IME behavior, the production font manifest and representative memory testing. These risks do not block continued Folio adapter development.
