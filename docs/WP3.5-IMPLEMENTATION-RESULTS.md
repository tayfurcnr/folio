# WP3.5 implementation results

Date: 2026-11-04

## Summary

WP3.5 adds small interaction fixes and supporting architecture without changing the Folio visual system or replacing the Rust/WASM engine. The Rust Session remains the only persistent presentation and selection authority. WP4 was not started; `atlas/` and `deckcraft/` were treated as read-only.

| Area | Result | Evidence |
|---|---|---|
| Architecture review | PASS | [ARCHITECTURE-REVIEW.md](ARCHITECTURE-REVIEW.md) was written before implementation. It recommends small feature ownership changes and no broad component migration. |
| Hand tool state and pan | PASS | `WP35_SKIP_PERF=1 npm run test:wp35`: Chromium observed `aria-pressed=true`, cursor `grab`/`grabbing`, and slide-plane translation `0→45` CSS px; returning to selection mode cleared the active state. |
| Rust selection, resize, rotate, Undo/Redo | PASS | Same Chromium run: resize `[360,210,240,120]→[360,210,282,150]`; one Undo restored the original rectangle and Redo restored the resized rectangle. Rotate `0→39.657°`; one Undo restored `0°` and Redo restored `39.657°`. |
| Grid overlay and snap | PASS | Same browser test turned on the 20-unit overlay and snap switch. Rust Session rectangle moved `[360,210,282,150]→[402,240,282,150]`; the two-unit X residual is DeckCraft's existing smart-guide alignment, within the 6-unit combined snap tolerance. |
| Overflow preview | PASS (bounded) | `renderSlideOverflow` receives a workspace-derived margin; WASM caps output at 4096×4096 RGBA pixels. Existing render regression exercises the real renderer. No unbounded buffer is allocated. |
| Fit toast | PASS | Browser test observed the toast after Fit; it disappeared automatically after 2.8 seconds. |
| Library media persistence/reuse | PASS | Browser added a generated valid PNG plus WAV and MP4 fixtures; identical PNG upload deduped, all three survived reload, inserting the PNG changed Session shape count `2→3`, and deleting its Library entry kept the shape count at `3`. IndexedDB is scoped to the local browser profile, not a user/project service. |
| Text caret and keyboard | PASS | Browser typed `Folio`, moved the caret left, inserted `!`, and confirmed `Foli!o` in the Rust projection. |
| TypeScript and production build | PASS | `npm run typecheck`; `npm run build`. |
| WP2 regression | PASS | `npm run regression:wp2`; all five Folio release-WASM browser cases passed. PPTX is a synthetic DeckCraft round trip, not Microsoft PowerPoint compatibility proof. See [WP2-REGRESSION-RESULTS.md](WP2-REGRESSION-RESULTS.md). |
| Drag performance comparison | PASS (measured, qualified) | [WP3.5-DRAG-LATENCY-RESULTS.md](WP3.5-DRAG-LATENCY-RESULTS.md): real Chromium pointer drags against read-only ATLAS at DPR 1/zoom 100. Zero-copy WASM pixel view reduced Folio's pixel copy from 2.94–3.26 ms/frame to 0.01–0.03 ms/frame. For 100 objects input-to-frame average improved 13.06→10.24 ms; 1,000 objects 15.00→12.55 ms. FPS did not consistently improve; scanout latency is outside browser measurement. |
| Full viewport/DPR/zoom and large-scene matrix | PASS | `WP35_SKIP_INTERACTIONS=1 npm run test:wp35`: 18 real Chromium cases, 1366×768 and 1920×1080 × DPR 1/2 × zoom 50/100/200, plus 100/500/1,000 Rust Session objects × DPR 1/2. All had zero browser errors; large-scene drag Undo/Redo passed. FPS ranged 45.3–60; measured frame p95 ranged 16.7–50 ms (the highest was 1366×768, DPR2, zoom50 with the 4096×3256 overflow surface). Each drag had 24 active and overflow render calls, one thumbnail refresh, two full projection calls, and 5–6 React commits. |

## Causes and changes

- **Resize controls missed pointer input after text selection.** The transparent text input was stacked above the selection frame. The selection frame now stacks above it while the text input remains available for caret editing.
- **Text box edges did not initiate a Rust drag.** The textarea intercepted pointer events and the canvas did not receive them. Edge-band pointer events now enter the existing pointer pipeline; clicks in the text area remain native caret interactions. Drag still updates the real Rust Session and keeps its one-interaction history semantics.
- **Overflow clipping used a fixed margin.** The workspace now computes the needed margin from its visible area and current zoom. WASM bounds the enlarged frame to a maximum 4096-pixel side.
- **Kütüphane items were transient.** Files now live in IndexedDB under a content hash and can be re-used. Embedded document media remains owned by the Rust Session; deleting a Library entry only removes that local asset entry.
- **Fit status did not dismiss.** The feedback is now a timed, reduced-motion-aware toast with timer cleanup.
- **Feature placement needed a boundary before WP4.** The review keeps existing UI files in place, puts new asset storage in `features/media-library`, and avoids empty feature folders or a broad refactor.

## Performance notes

The existing drag implementation still coalesces pointer moves at animation-frame boundaries, renders temporary drag frames directly to canvas, skips document/selection projection and thumbnails during the drag, and restores full-resolution rendering on pointer-up. `paintFrame` now wraps the Rust-owned `ArrayBuffer` in an `ImageData` view instead of copying every RGBA pixel into a second buffer; it retains a safe copy fallback when the WASM memory buffer is shared. Controlled measurements are in [WP3.5-DRAG-LATENCY-RESULTS.md](WP3.5-DRAG-LATENCY-RESULTS.md). This removes a measured copy cost, but the browser has not established physical display scanout latency. ATLAS 1,000-object comparison was unavailable, so parity at that size is not claimed.

## Remaining risks

- OS-level IME, production font bundles, external Microsoft PowerPoint compatibility, operating-system clipboard, batch-recovery persistence, and long-duration memory soak remain open production risks.
- Browser-profile IndexedDB is local-only until a project/account asset service is added. A future `.folio` archive must package referenced bytes.
- High-DPR, low-zoom overflow rendering can still miss 60 FPS: the largest observed p95 was 50 ms at DPR2/50%, with a capped 4096×3256 overflow frame. Treat this as a measured limitation for future optimization; no CSS/GPU drag overlay was added.
- The browser measured pointer-to-next-paint and frame timing, not physical monitor scanout. ATLAS was compared at 1 and 100 objects; there is no ATLAS 1,000-object parity claim.
