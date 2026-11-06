# WP2 Regression Results

Date: 2026-11-05T08:33:10.431Z

Browser: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36

All tests used Folio's own release-built WASM artifact loaded in headless Chrome; no mocks or stubs. WASM API: createSession, FolioSession.execute, createBlankSlide, insertShapesBatch, pointer, getDocumentSummary, getSlideProjection, getSelectionProjection, renderSlide, undo, redo, importPptx, exportPptx, regressionDiagnostics (test-only).

| Feature | Status | Actual browser output |
|---|---|---|
| pointer | PASS | {"status":"PASS","slideId":"257","shapeId":260,"selected":true,"before":[100,100,240,120],"moved":[132,122,240,120],"resized":[132,122,270,148],"selectionAfter":["260"]} |
| render | PASS | {"status":"PASS","width":960,"height":540,"byteLength":2073600,"format":"RGBA8","nonWhitePixels":41889,"colorSpace":"8-bit RGBA, byte channel order R,G,B,A","firstPixel":[255,255,255,255]} |
| undoRedo | PASS | {"status":"PASS","inserted":[20,30,80,60],"moved":[45,45,80,60],"afterUndoMove":[20,30,80,60],"afterUndoInsert":"shape absent","afterRedoInsert":[20,30,80,60],"afterRedoMove":[45,45,80,60]} |
| batchInsertion | PASS | {"status":"PASS","cases":[{"count":100,"insertMs":2.4,"shapeCountAfterInsert":102,"undoEntriesBefore":0,"undoEntriesAfterInsert":1,"baselineShapeCount":2,"oneUndoShapeCount":2,"oneRedoShapeCount":102,"clipboardBefore":{"pastes":0,"plain":"folio-regression-clipboard","shapes":0},"clipboardAfter":{"pastes":0,"plain":"folio-regression-clipboard","shapes":0},"duplicateOffsetBefore":37,"duplicateOffsetAfter":37,"journalTail":["edit.paste",null]},{"count":1000,"insertMs":6.6,"shapeCountAfterInsert":1002,"undoEntriesBefore":0,"undoEntriesAfterInsert":1,"baselineShapeCount":2,"oneUndoShapeCount":2,"oneRedoShapeCount":1002,"clipboardBefore":{"pastes":0,"plain":"folio-regression-clipboard","shapes":0},"clipboardAfter":{"pastes":0,"plain":"folio-regression-clipboard","shapes":0},"duplicateOffsetBefore":37,"duplicateOffsetAfter":37,"journalTail":["edit.paste",null]}]} |
| pptx | PASS | {"status":"PASS","kind":"synthetic DeckCraft export/import round-trip; not opened by Microsoft PowerPoint","byteLength":22023,"zipSignature":[80,75,3,4],"slideCountBefore":1,"slideCountAfter":1,"shapeCountsBefore":[4],"shapeCountsAfter":[4],"sourceShapeIds":["258","259","260","261"],"importedShapeIds":["258","259","260","261"],"textContentBefore":["\n\nSynthetic regression — İstanbul, ığüşöç\n"],"textContentAfter":["\n\nSynthetic regression — İstanbul, ığüşöç\n"],"renderedImport":{"width":960,"height":540,"byteLength":2073600,"format":"RGBA8","nonWhitePixels":20651},"importedSlideCount":1} |

## Commands

- `npm run build:wasm`
- `npm run regression:wp2` (build test-only WASM and run Chromium headless regression) (Chromium headless, served the generated test WASM)

## PoC comparison

The prior PoC browser smoke uses direct WASM calls for pointer selection/move/resize and PPTX round-trip. Its batch browser smoke exercises 100, 500 and 1,000 shapes, one undo/redo and clipboard/duplicate-offset preservation. The Folio run below covers the requested 100 and 1,000 counts through the new Folio WASM API. Unlike the earlier PoC, this report does not claim external-writer or Microsoft PowerPoint compatibility.

## Browser diagnostics

No JavaScript console errors or uncaught exceptions.

## Interpretation

All five requested motor capabilities passed this regression. WP3 can begin. This does not close production release gates for authentic PowerPoint files, OS IME, production font manifests, representative memory tests, or batch recovery journaling.
