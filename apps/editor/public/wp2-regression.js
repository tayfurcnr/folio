const out = document.querySelector('#results')
const report = { status: 'PASS', features: {}, browser: navigator.userAgent }
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const approx = (actual, expected, tolerance = 0.01) => Math.abs(actual - expected) <= tolerance
const findShape = (session, slideId, id) => session.getSlideProjection(slideId).shapes.find((shape) => shape.id === String(id))
const snapshotSummary = (session) => session.getDocumentSummary()
const errorMessage = (error) => error?.message ?? String(error)
const pixelStats = (frame) => {
  const bytes = new Uint8Array(frame.pixels)
  let nonWhitePixels = 0
  for (let index = 0; index < bytes.length; index += 4) {
    if (bytes[index] !== 255 || bytes[index + 1] !== 255 || bytes[index + 2] !== 255 || bytes[index + 3] !== 255) nonWhitePixels += 1
  }
  return { byteLength: bytes.byteLength, format: 'RGBA8', nonWhitePixels }
}
const slideOne = (summary) => summary.slides.find((slide) => slide.title === 'Slide 1') ?? summary.slides[1] ?? summary.slides[0]
const markdownCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')

try {
  const wasm = await import('/wasm-test/folio_wasm.js')
  await wasm.default()
  report.api = ['createSession', 'FolioSession.execute', 'createBlankSlide', 'insertShapesBatch', 'pointer', 'getDocumentSummary', 'getSlideProjection', 'getSelectionProjection', 'renderSlide', 'undo', 'redo', 'importPptx', 'exportPptx', 'regressionDiagnostics (test-only)']

  // 1. Pointer selection, drag and southeast-handle resize, verified from real DeckCraft DocState projections.
  {
    const session = wasm.createSession()
    try {
      const created = session.execute('shape.insert', JSON.stringify({ preset: 'rect', rect: [100, 100, 240, 120] }))
      const shapeId = created.result.id
      const slideId = snapshotSummary(session).slides.at(-1).id
      session.pointer('down', 150, 150, '{}')
      const selected = session.getSelectionProjection().shapeIds.includes(String(shapeId))
      assert(selected, 'pointer down should select the inserted shape')
      const before = findShape(session, slideId, shapeId).rect
      session.pointer('down', 150, 150, '{}')
      session.pointer('drag', 180, 175, '{}')
      session.pointer('up', 180, 175, '{}')
      const moved = findShape(session, slideId, shapeId).rect
      assert(moved[0] > before[0] && moved[1] > before[1], `expected moved geometry, got ${before} => ${moved}`)
      session.pointer('down', moved[0] + moved[2], moved[1] + moved[3], '{}')
      session.pointer('drag', moved[0] + moved[2] + 30, moved[1] + moved[3] + 25, '{}')
      session.pointer('up', moved[0] + moved[2] + 30, moved[1] + moved[3] + 25, '{}')
      const resized = findShape(session, slideId, shapeId).rect
      assert(resized[2] > moved[2] && resized[3] > moved[3], `expected resize, got ${moved} => ${resized}`)
      report.features.pointer = { status: 'PASS', slideId, shapeId, selected, before, moved, resized, selectionAfter: session.getSelectionProjection().shapeIds }
    } catch (error) { error.message = `pointer: ${error.message}`; throw error } finally { session.free() }
  }

  // 2. DeckCraft CPU renderer; default Presentation dimensions must equal the requested 960x540 pt.
  {
    const session = wasm.createSession()
    try {
      const slideId = session.getDocumentSummary().slides[0].id
      session.execute('shape.insert', JSON.stringify({ preset: 'rect', rect: [100, 100, 240, 120] }))
      const frame = session.renderSlide(String(slideId), 1)
      const pixels = pixelStats(frame)
      assert(frame.width === 960 && frame.height === 540, `expected 960x540, got ${frame.width}x${frame.height}`)
      assert(pixels.byteLength === 960 * 540 * 4, `expected ${960 * 540 * 4} bytes, got ${pixels.byteLength}`)
      assert(pixels.nonWhitePixels > 0, 'render output is blank')
      report.features.render = { status: 'PASS', width: frame.width, height: frame.height, ...pixels, colorSpace: '8-bit RGBA, byte channel order R,G,B,A', firstPixel: Array.from(new Uint8Array(frame.pixels).slice(0, 4)) }
    } catch (error) { error.message = `render: ${error.message}`; throw error } finally { session.free() }
  }

  // 3. Insert/move, undo each operation, and redo while checking document projections each time.
  {
    const session = wasm.createSession()
    try {
      const slideId = snapshotSummary(session).slides[0].id
      const created = session.execute('shape.insert', JSON.stringify({ preset: 'rect', rect: [20, 30, 80, 60] }))
      const id = created.result.id
      const inserted = findShape(session, slideId, id).rect
      session.execute('shape.move', JSON.stringify({ ids: [id], dx: 25, dy: 15 }))
      const moved = findShape(session, slideId, id).rect
      assert(moved[0] !== inserted[0] || moved[1] !== inserted[1], 'move did not change geometry')
      session.undo()
      const afterUndoMove = findShape(session, slideId, id).rect
      assert(JSON.stringify(afterUndoMove) === JSON.stringify(inserted), `undo move expected ${inserted}, got ${afterUndoMove}`)
      session.undo()
      const afterUndoInsert = session.getSlideProjection(slideId).shapes.find((shape) => shape.id === String(id))
      assert(afterUndoInsert === undefined, 'undo insert did not remove shape')
      session.redo()
      const afterRedoInsert = findShape(session, slideId, id).rect
      assert(JSON.stringify(afterRedoInsert) === JSON.stringify(inserted), 'redo insert did not restore original shape')
      session.redo()
      const afterRedoMove = findShape(session, slideId, id).rect
      assert(JSON.stringify(afterRedoMove) === JSON.stringify(moved), 'redo move did not restore moved geometry')
      report.features.undoRedo = { status: 'PASS', inserted, moved, afterUndoMove, afterUndoInsert: 'shape absent', afterRedoInsert, afterRedoMove }
    } catch (error) { error.message = `undoRedo: ${error.message}`; throw error } finally { session.free() }
  }

  // 4. Real insertShapesBatch WASM API, 100 and 1,000 shapes; single-step history and session prefs/clipboard.
  {
    const cases = []
    for (const count of [100, 1000]) {
      const session = wasm.createSession()
      try {
        const slideId = snapshotSummary(session).slides[0].id
        session.seedRegressionClipboard()
        const before = session.regressionDiagnostics()
        const beforeShapeCount = session.getSlideProjection(slideId).shapes.length
        const payload = Array.from({ length: count }, (_, index) => ({
          name: `Regression ${count} ${index}`,
          xfrm: { x: 8 + (index % 40) * 23, y: 8 + Math.floor(index / 40) * 20, w: 18, h: 14 },
          geom: { kind: 'preset', name: ['rect', 'ellipse', 'star5'][index % 3] },
          text: index % 40 === 0 ? { paragraphs: [{ runs: [{ text: `İçerik ${index} ğüş` }] }] } : null,
        }))
        const start = performance.now()
        const inserted = session.insertShapesBatch(JSON.stringify(payload))
        const insertMs = performance.now() - start
        assert(inserted.result.ids.length === count, `expected ${count} inserted ids, got ${inserted.result.ids.length}`)
        const afterInsert = session.regressionDiagnostics()
        const insertedCount = session.getSlideProjection(slideId).shapes.length
        assert(inserted.result.ids.length === count && insertedCount === beforeShapeCount + count, `expected ${count} batch shapes, got ${insertedCount}`)
        assert(afterInsert.undoEntries === before.undoEntries + 1, `batch should add one undo step, got ${before.undoEntries} => ${afterInsert.undoEntries}`)
        assert(afterInsert.clipboard.shapes === before.clipboard.shapes && afterInsert.clipboard.plain === before.clipboard.plain && afterInsert.clipboard.pastes === before.clipboard.pastes && afterInsert.duplicateOffset === before.duplicateOffset, 'batch failed to preserve clipboard or duplicate offset')
        session.undo()
        const afterUndoCount = session.getSlideProjection(slideId).shapes.length
        assert(afterUndoCount === beforeShapeCount, `one undo should restore baseline ${beforeShapeCount} shapes, got ${afterUndoCount}`)
        session.redo()
        const afterRedoCount = session.getSlideProjection(slideId).shapes.length
        assert(afterRedoCount === beforeShapeCount + count, `one redo should restore ${count} batch shapes, got ${afterRedoCount}`)
        const afterRedo = session.regressionDiagnostics()
        assert(afterRedo.clipboard.shapes === before.clipboard.shapes && afterRedo.clipboard.plain === before.clipboard.plain && afterRedo.clipboard.pastes === before.clipboard.pastes && afterRedo.duplicateOffset === before.duplicateOffset, 'undo/redo changed clipboard or duplicate offset')
        cases.push({ count, insertMs: +insertMs.toFixed(2), shapeCountAfterInsert: insertedCount, undoEntriesBefore: before.undoEntries, undoEntriesAfterInsert: afterInsert.undoEntries, baselineShapeCount: beforeShapeCount, oneUndoShapeCount: afterUndoCount, oneRedoShapeCount: afterRedoCount, clipboardBefore: before.clipboard, clipboardAfter: afterInsert.clipboard, duplicateOffsetBefore: before.duplicateOffset, duplicateOffsetAfter: afterInsert.duplicateOffset, journalTail: afterInsert.journalTail })
      } finally { session.free() }
    }
    report.features.batchInsertion = { status: 'PASS', cases }
  }

  // 5. Synthetic engine-to-engine DeckCraft PPTX round-trip; explicitly not Microsoft PowerPoint compatibility.
  {
    const source = wasm.createSession()
    const target = wasm.createSession()
    try {
      const sourceSlideId = snapshotSummary(source).slides[0].id
      source.execute('insert.textBox', JSON.stringify({ rect: [40, 50, 400, 90], text: 'Synthetic regression — İstanbul, ığüşöç' }))
      source.execute('shape.insert', JSON.stringify({ preset: 'ellipse', rect: [500, 100, 80, 60] }))
      const beforeSummary = snapshotSummary(source)
      const beforeSlideCounts = beforeSummary.slides.map((slide) => source.getSlideProjection(slide.id).shapes.length)
      const beforeText = beforeSummary.slides.map((slide) => source.getSlideProjection(slide.id).shapes.map((shape) => shape.text ?? '').join('\n'))
      const beforeShapeIds = source.getSlideProjection(sourceSlideId).shapes.map((shape) => shape.id)
      const bytes = source.exportPptx()
      assert(bytes.length > 100 && bytes[0] === 0x50 && bytes[1] === 0x4b, 'export did not produce PPTX ZIP bytes')
      const imported = target.importPptx(bytes)
      const afterSummary = snapshotSummary(target)
      const afterSlideCounts = afterSummary.slides.map((slide) => target.getSlideProjection(slide.id).shapes.length)
      const afterText = afterSummary.slides.map((slide) => target.getSlideProjection(slide.id).shapes.map((shape) => shape.text ?? '').join('\n'))
      const afterShapeIds = target.getSlideProjection(afterSummary.slides.at(-1).id).shapes.map((shape) => shape.id)
      assert(afterSummary.slides.length === beforeSummary.slides.length, 'round-trip slide count differs')
      assert(JSON.stringify(afterSlideCounts) === JSON.stringify(beforeSlideCounts), `shape counts differ: ${beforeSlideCounts} => ${afterSlideCounts}`)
      assert(JSON.stringify(afterText) === JSON.stringify(beforeText), `text content differs: ${JSON.stringify(beforeText)} => ${JSON.stringify(afterText)}`)
      assert(afterText.at(-1).includes('Synthetic regression — İstanbul, ığüşöç'), 'Turkish synthetic text did not survive')
      const slideFrame = target.renderSlide(afterSummary.slides.at(-1).id, 1)
      assert(slideFrame.width === 960 && slideFrame.height === 540, `PPTX slide render expected 960x540, got ${slideFrame.width}x${slideFrame.height}`)
      report.features.pptx = { status: 'PASS', kind: 'synthetic DeckCraft export/import round-trip; not opened by Microsoft PowerPoint', byteLength: bytes.length, zipSignature: Array.from(bytes.slice(0, 4)), slideCountBefore: beforeSummary.slides.length, slideCountAfter: afterSummary.slides.length, shapeCountsBefore: beforeSlideCounts, shapeCountsAfter: afterSlideCounts, sourceShapeIds: beforeShapeIds, importedShapeIds: afterShapeIds, textContentBefore: beforeText, textContentAfter: afterText, renderedImport: { width: slideFrame.width, height: slideFrame.height, ...pixelStats(slideFrame) }, importedSlideCount: imported.importedSlideCount }
    } finally { source.free(); target.free() }
  }

  const rows = Object.entries(report.features).map(([name, result]) => `| ${name} | ${result.status} | ${markdownCell(JSON.stringify(result))} |`).join('\n')
  report.markdown = `# WP2 Regression Results\n\nDate: ${new Date().toISOString()}\n\nBrowser: ${report.browser}\n\nAll tests used Folio's own release-built WASM artifact loaded in headless Chrome; no mocks or stubs. WASM API: ${report.api.join(', ')}.\n\n| Feature | Status | Actual browser output |\n|---|---|---|\n${rows}\n\n## Commands\n\n- \`npm run build:wasm\`\n- \`npm run regression:wp2\` (build test-only WASM and run Chromium headless regression) (Chromium headless, served the generated test WASM)\n\n## PoC comparison\n\nThe prior PoC browser smoke uses direct WASM calls for pointer selection/move/resize and PPTX round-trip. Its batch browser smoke exercises 100, 500 and 1,000 shapes, one undo/redo and clipboard/duplicate-offset preservation. The Folio run below covers the requested 100 and 1,000 counts through the new Folio WASM API. Unlike the earlier PoC, this report does not claim external-writer or Microsoft PowerPoint compatibility.\n\n## Interpretation\n\n${Object.values(report.features).every((feature) => feature.status === 'PASS') ? 'All five requested motor capabilities passed this regression. WP3 can begin. This does not close production release gates for authentic PowerPoint files, OS IME, production font manifests, representative memory tests, or batch recovery journaling.' : 'At least one requested capability failed; WP3 should not begin until the failed capability is repaired and this report is rerun.'}\n`
  out.dataset.status = 'pass'
  out.textContent = JSON.stringify(report, null, 2)
} catch (error) {
  report.status = 'FAIL'
  report.error = errorMessage(error)
  report.markdown = `# WP2 Regression Results\n\nDate: ${new Date().toISOString()}\n\nStatus: FAIL\n\nFailed during browser run: ${report.error}\n\nWP3 readiness: not established. See console details in this page run.\n`
  out.dataset.status = 'fail'
  out.textContent = JSON.stringify(report, null, 2)
}
