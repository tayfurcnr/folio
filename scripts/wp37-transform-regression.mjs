import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const port = await freePort()
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: `${root}/apps/editor`, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
const url = `http://127.0.0.1:${port}/?perf=1&test=1`
const errors = []
const results = []
let currentCase = 'setup'
const artifacts = `${root}/docs/artifacts/editor-ux`
await mkdir(artifacts, { recursive: true })
let browser

try {
  await waitForServer(url, server, () => serverOutput)
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const matrix = [[50, 1], [100, 1], [200, 1], [50, 2], [100, 2], [200, 2], [50, 4], [100, 4], [200, 4]]
  const only = process.env.WP37_ONLY
  const repeatCount = Math.max(1, Number.parseInt(process.env.WP37_REPEAT ?? '1', 10) || 1)
  const matrixPerf = only === 'matrix-perf'
  const coldMatrix = only === 'cold-matrix'
  const exactRotateTarget = /^rotate-z\d+-dpr\d+$/.test(only ?? '')
  const zoomDprTarget = only?.startsWith('z') ?? false
  if (!only || only === 'cold') {
    results.push(await resizeCase(100, 1, 'se', 'cold'))
    results.push(await rotateCase(100, 1, 'cold'))
  }
  for (const [zoom, dpr] of matrix.filter(([z, d]) => !only || matrixPerf || coldMatrix || only.includes(`z${z}-dpr${d}`))) {
    if (coldMatrix) {
      results.push(await moveCase(zoom, dpr, 'cold'))
      results.push(await resizeCase(zoom, dpr, 'se', 'cold'))
      results.push(await rotateCase(zoom, dpr, 'cold'))
    }
    if (matrixPerf) {
      results.push(await moveCase(zoom, dpr, 'cold'))
      results.push(await resizeCase(zoom, dpr, 'se', 'cold'))
      results.push(await rotateCase(zoom, dpr, 'cold'))
    }
    if (!exactRotateTarget && (!only || matrixPerf || zoomDprTarget)) results.push(await moveCase(zoom, dpr, 'warm'))
    for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].filter((h) => !exactRotateTarget && (matrixPerf ? h === 'se' : (!only || zoomDprTarget || (only.startsWith('resize-') && only.split('-')[1] === h))))) {
      results.push(await resizeCase(zoom, dpr, handle))
    }
    if (!only || matrixPerf || zoomDprTarget || only.startsWith('rotate')) {
      if (!exactRotateTarget || only === `rotate-z${zoom}-dpr${dpr}`) {
        for (let iteration = 0; iteration < repeatCount; iteration++) results.push(await rotateCase(zoom, dpr))
      }
    }
  }
  if (!only || only === 'multi') results.push(await multiSelectionCase())
  if (only === 'selection-controls') {
    results.push(await moveControlCase())
    results.push(await rotateCase(100, 1))
  }
  if (!only || only === 'multi-rotate') results.push(await multiRotateCase())
  if (!only || only === 'corner-rotate') results.push(await cornerRotateCase())
  if (!only || only === 'cursor') results.push(await cursorInteractionCase())
  if (!only || only === 'rotated-resize') results.push(await rotatedResizeCase())
  if (only === 'shape-corner') results.push(await shapeCornerAspectCase())
  if (!only || only === 'text') results.push(...await textTransformCase())
  if (only === 'edit-rotate') results.push(await editModeFirstRotateCase())
  if (only === 'text-resize-live') results.push(await textResizeLivePreviewCase())
  if (!only || only === 'text-mode') results.push(await textEditModeCase())
  if (only === 'single-click-text') results.push(await singleClickTextEditCase())
  if (only === 'cancel-rotate') results.push(await canceledRotationCase())
  if (!only || only === 'text-matrix') results.push(await textClickMatrixCase())
  if (only === 'atlas-visual') results.push(await selectionVisualCase())
  if (!only || only === 'placeholders') results.push(await placeholderClickCase())
  if (!only || only === 'shift') results.push(await shiftResizeCase())
  if (!only || only === 'alt-resize') results.push(await altCenterResizeCase())
  if (!only || only === 'rotation-snap') results.push(await rotationSnapCase())
  if (!only || only === 'flip') results.push(await flipResizeCase())
  if (!only || only === 'overflow') results.push(await overflowResizeCase())
  if (only === 'overflow-hit') results.push(await overflowHitTestCase())
  if (!only || only === 'successive') results.push(await successiveTransformsCase())
  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({ status: 'PASS', visibleChromium: false, summary: summarize(results), ...(only ? { cases: results } : {}), errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', currentCase, message: error instanceof Error ? error.message : String(error), serverOutput, completedCases: results.map((result) => result.name), errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function resizeCase(zoom, dpr, handle, cacheMode = 'warm') {
  currentCase = `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}`
  currentCase += ': setup'
  const { context, page } = await setup(zoom, dpr, `resize-${handle}`)
  currentCase = `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}: prepare shape`
  const shape = await prepareRect(page)
  currentCase = `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}: locate handle`
  const box = await page.locator(`.engine-selection__handle--${handle}`).boundingBox()
  assert(box, `Resize handle ${handle} is missing.`)
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const engineHit = await page.evaluate(({ x, y }) => { const bounds = document.querySelector('.slide-canvas').getBoundingClientRect(); return window.__folioTest.hitTest((x - bounds.left) / bounds.width * 960, (y - bounds.top) / bounds.height * 540) }, start)
  assert(engineHit?.kind === 'resize', `Resize handle ${handle} missed the engine hit test: ${JSON.stringify(engineHit)}`)
  const dx = handle.includes('w') ? -36 : handle.includes('e') ? 36 : 0
  const dy = handle.includes('n') ? -28 : handle.includes('s') ? 28 : 0
  currentCase = `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}: transform gesture`
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y)
    await page.evaluate(() => { window.__folioGestureInputStart = performance.now() })
    await page.mouse.down()
    if (cacheMode !== 'cold') await waitPreview(page)
    await moveInSteps(page, start, dx, dy)
    const sizeLabel = await page.locator('.engine-transform-tooltip--dimension').evaluate((node) => ({ text: node.textContent, visibility: getComputedStyle(node).visibility }))
    assert(sizeLabel.visibility === 'visible' && /\d+\s×\s\d+/.test(sizeLabel.text ?? ''), `Resize dimensions tooltip did not follow the handle: ${JSON.stringify(sizeLabel)}`)
    await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up()
    const final = await waitFinal(page, shape.id)
    assert(JSON.stringify(final.rect) === JSON.stringify(during.rect), `Resize ${handle} preview projection and final Rust shape differ.`)
    return { geometry: final.rect, rotation: final.rotation, shape: final }
  }, cacheMode)
  currentCase = `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}: undo/redo`
  assert(!sameGeometry(shape, output.geometry.shape), `Resize ${handle} did not change the selected rectangle: before=${JSON.stringify(shape)} after=${JSON.stringify(output.geometry.shape)}`)
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: `resize-${handle}-z${zoom}-dpr${dpr}-${cacheMode}`, ...output }
}

async function moveCase(zoom, dpr, cacheMode = 'warm') {
  currentCase = `move-z${zoom}-dpr${dpr}-${cacheMode}`
  const { context, page } = await setup(zoom, dpr, 'move')
  const shape = await prepareRect(page)
  const box = await page.locator('.engine-selection').boundingBox()
  assert(box, 'Move selection frame is missing.')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.evaluate(() => { window.__folioGestureInputStart = performance.now() }); await page.mouse.down(); if (cacheMode !== 'cold') await waitPreview(page)
    await moveInSteps(page, start, 44, 24)
    await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up()
    const final = await waitFinal(page, shape.id)
    assert(sameGeometry(final, during), `Move preview projection and final Rust shape differ: ${JSON.stringify({ final, during })}`)
    return { geometry: final.rect, rotation: final.rotation, shape: final }
  }, cacheMode)
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: `move-z${zoom}-dpr${dpr}-${cacheMode}`, ...output }
}

async function rotateCase(zoom, dpr, cacheMode = 'warm') {
  currentCase = `rotate-z${zoom}-dpr${dpr}-${cacheMode}`
  const { context, page } = await setup(zoom, dpr, 'rotate')
  const shape = await prepareRect(page)
  const box = await page.locator('.engine-selection__rotate').boundingBox()
  assert(box, 'Rotation handle is missing.')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.evaluate((point) => {
    const rect = (selector) => { const element = document.querySelector(selector); const bounds = element?.getBoundingClientRect(); return bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null }
    const target = document.elementFromPoint(point.x, point.y)
    window.__folioRotatePointerProbe = { point, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], rotate: rect('.engine-selection__rotate'), toolbar: rect('.selection-toolbar'), target: target ? { tag: target.tagName, className: typeof target.className === 'string' ? target.className : null } : null }
  }, start)
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.evaluate(() => { window.__folioGestureInputStart = performance.now() }); await page.mouse.down(); if (cacheMode !== 'cold') await waitPreview(page)
    await moveInSteps(page, start, 45, 22)
    const angleLabel = await page.locator('.engine-transform-tooltip--rotation').evaluate((node) => ({ text: node.textContent, visibility: getComputedStyle(node).visibility }))
    assert(angleLabel.visibility === 'visible' && /^\d{1,3}°$/.test(angleLabel.text ?? ''), `Rotation angle tooltip did not follow the pointer: ${JSON.stringify(angleLabel)}`)
    assert(await page.locator('.engine-selection__rotate-hit').count() >= 4, 'Expected rotation hit zones outside all four selection corners.')
    await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up()
    const final = await waitFinal(page, shape.id)
    assert(sameGeometry(final, during), `Rotate preview projection and final Rust shape differ: ${JSON.stringify({ final, during })}`)
    assert(Math.abs(final.rotation ?? 0) > 1, `Rust rotation did not update: ${JSON.stringify(final)}`)
    return { geometry: final.rect, rotation: final.rotation, shape: final }
  }, cacheMode)
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: `rotate-z${zoom}-dpr${dpr}-${cacheMode}`, ...output }
}

async function multiSelectionCase() {
  const { context, page } = await setup(100, 1, 'multi')
  let first = await prepareRect(page)
  await page.evaluate((id) => window.__folioTest.selectShape(id), first.id)
  await page.evaluate(() => window.__folioTest.duplicateSelection())
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).length === 2, null, { timeout: 5000 })
  const shapes = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
  await page.evaluate((ids) => window.__folioTest.selectShapes(ids), shapes.map((shape) => shape.id))
  await page.waitForFunction(() => document.querySelectorAll('.engine-selection').length === 2)
  const handle = await page.locator('.engine-selection__handle--se').first().boundingBox()
  assert(handle, 'Multi-selection resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 30, 22)
    const during = await page.evaluate(() => window.__folioTest.movePreview().shapes)
    await page.mouse.up(); await waitPreviewHidden(page)
    const after = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
    assert(during.length === 2 && after.every((shape) => Array.isArray(shape.rect)), 'Multi-selection resize did not preserve both projected shapes.')
    assert(after.some((shape, index) => JSON.stringify(shape.rect) !== JSON.stringify(shapes[index].rect)), 'Multi-selection resize changed no Rust geometry.')
    return { selected: during.length, geometries: after.map((shape) => shape.rect), before: shapes, after }
  })
  await undoRedoMany(page, output.geometry.before, output.geometry.after)
  await context.close()
  return { name: 'multi-selection-resize', ...output }
}

async function moveControlCase() {
  const { context, page } = await setup(100, 1, 'selection-controls')
  const shape = await prepareRect(page)
  const before = await readShape(page, shape.id)
  const move = page.locator('.engine-selection__move')
  const rotate = page.locator('.engine-selection__rotate')
  assert(await move.count() === 1 && await rotate.count() === 1, 'Selected object must expose one Move and one Rotate control.')
  assert(await move.getAttribute('aria-label') === 'Taşı' && await rotate.getAttribute('aria-label') === 'Döndür', 'Transform controls need distinct accessible labels.')
  const box = await move.boundingBox()
  assert(box, 'Move control is missing its hit area.')
  await page.screenshot({ path: `${artifacts}/selection-move-rotate-controls.png`, animations: 'disabled' })
  const canvasBox = await page.locator('.slide-canvas').boundingBox()
  assert(canvasBox, 'Canvas geometry is missing for the Move control.')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const expectedDelta = 42 * 960 / canvasBox.width
  const expectedDeltaY = 18 * 540 / canvasBox.height
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await waitPreview(page)
    await moveInSteps(page, start, 42, 18)
    await waitProjection(page)
    await page.mouse.up()
    const final = await waitFinal(page, shape.id)
    const tolerance = Math.max(8, expectedDelta * .08)
    assert(Math.abs(final.rect[0] - before.rect[0] - expectedDelta) < tolerance && Math.abs(final.rect[1] - before.rect[1] - expectedDeltaY) < tolerance, `Move control did not follow the pointer: ${JSON.stringify({ before: before.rect, after: final.rect, expectedDelta, expectedDeltaY, tolerance })}`)
    return { shape: final }
  })
  await undoRedoShape(page, shape.id, before, output.geometry.shape)
  await page.evaluate(() => window.__folioTest.insertTextBoxAt([300, 150, 320, 80], 'Move me'))
  await page.locator('.engine-text-input').waitFor({ state: 'visible' })
  const textMove = page.locator('.engine-selection__move')
  await textMove.waitFor({ state: 'visible' })
  const textBefore = await page.evaluate(() => window.__folioTest.snapshot().activeSlide.shapes.find((item) => item.text === 'Move me'))
  const textControlBox = await textMove.boundingBox()
  assert(textBefore?.rect && textControlBox, 'Editing text should expose the shared Move control.')
  const textControlStart = { x: textControlBox.x + textControlBox.width / 2, y: textControlBox.y + textControlBox.height / 2 }
  await page.mouse.move(textControlStart.x, textControlStart.y)
  await page.mouse.down()
  await waitPreview(page)
  await moveInSteps(page, textControlStart, 32, 16)
  await page.mouse.up()
  await waitPreviewHidden(page)
  const textAfter = await page.evaluate((id) => window.__folioTest.snapshot().activeSlide.shapes.find((item) => item.id === id), textBefore.id)
  assert(textAfter.rect[0] !== textBefore.rect[0] || textAfter.rect[1] !== textBefore.rect[1], `Move control did not move a text box while its editor overlay was active: ${JSON.stringify({ before: textBefore, after: textAfter, pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), snap: await page.evaluate(() => window.__folioLastSnap) })}`)
  await context.close()
  return { name: 'explicit-move-control', ...output, textMove: { before: textBefore.rect, after: textAfter.rect } }
}

async function multiRotateCase() {
  const { context, page } = await setup(100, 1, 'multi-rotate')
  const first = await prepareRect(page)
  await page.evaluate((id) => window.__folioTest.selectShape(id), first.id)
  await page.evaluate(() => window.__folioTest.duplicateSelection())
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).length === 2, null, { timeout: 5000 })
  const before = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
  await page.evaluate((ids) => window.__folioTest.selectShapes(ids), before.map((shape) => shape.id))
  await page.waitForFunction(() => document.querySelectorAll('.engine-selection').length === 2, null, { timeout: 5000 })
  const rotate = await page.locator('.engine-selection__rotate').first().boundingBox()
  assert(rotate, 'Multi-selection rotation handle is missing.')
  const start = { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 42, 22); await waitProjection(page)
    const during = await page.evaluate(() => window.__folioTest.movePreview().shapes)
    await page.mouse.up(); await waitPreviewHidden(page)
    const after = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
    assert(after.length === 2 && after.every((shape) => Math.abs(shape.rotation ?? 0) > 1), `Rust did not rotate all selected shapes: ${JSON.stringify(after)}`)
    assert(during.length === 2 && during.every((shape) => Number.isFinite(shape.rotation)), 'Rust multi-selection rotation projection is incomplete.')
    return { rotations: after.map((shape) => shape.rotation), rects: after.map((shape) => shape.rect), before, after }
  })
  await undoRedoMany(page, output.geometry.before, output.geometry.after)
  await context.close()
  return { name: 'multi-selection-rotate', ...output }
}

async function cornerRotateCase() {
  const { context, page } = await setup(100, 1, 'corner-rotate')
  const shape = await prepareRect(page)
  const before = await readShape(page, shape.id)
  const corner = await page.locator('.engine-selection__rotate-hit--ne').first().boundingBox()
  assert(corner, 'Top-right rotation hit zone is missing.')
  const start = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 42, 22); await waitProjection(page); await page.mouse.up()
  await waitPreviewHidden(page)
  const after = await readShape(page, shape.id)
  assert(Math.abs(after.rotation ?? 0) > 1, `Corner rotation hit zone did not start a Rust rotate gesture: ${JSON.stringify({ before, after, pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()) })}`)
  await undoRedoShape(page, shape.id, before, after)
  await context.close()
  return { name: 'corner-rotation-hit-zone', rotation: after.rotation, undoRedo: 'PASS' }
}

async function canceledRotationCase() {
  const { context, page } = await setup(100, 1, 'cancel-rotate')
  const shape = await prepareRect(page)
  const rotate = await page.locator('.engine-selection__rotate').boundingBox()
  assert(rotate, 'Rotation handle is missing for pointer-cancel recovery.')
  const start = { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }
  await page.evaluate(() => {
    window.__rotatePointerId = null
    window.addEventListener('pointerdown', (event) => { window.__rotatePointerId = event.pointerId }, { capture: true, once: true })
  })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await waitPreview(page)
  await moveInSteps(page, start, 35, 18)
  const pointerId = await page.evaluate(() => window.__rotatePointerId)
  assert(typeof pointerId === 'number', 'Could not capture rotation pointer id.')
  await page.evaluate(({ pointerId, x, y }) => {
    document.body.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0 }))
    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId, pointerType: 'mouse', clientX: x, clientY: y, buttons: 0 }))
  }, { pointerId, x: start.x + 35, y: start.y + 18 })
  await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'hidden' && !document.querySelector('.engine-transform-preview-frames'), null, { timeout: 1500 })
  const final = await readShape(page, shape.id)
  assert(Math.abs(final.rotation ?? 0) > 1, `Canceled rotation did not settle its final angle: ${JSON.stringify(final)}`)
  await page.mouse.up()
  const rotateAgain = await page.locator('.engine-selection__rotate').boundingBox()
  assert(rotateAgain, 'Rotation handle did not recover after pointer cancellation.')
  const secondStart = { x: rotateAgain.x + rotateAgain.width / 2, y: rotateAgain.y + rotateAgain.height / 2 }
  await page.mouse.move(secondStart.x, secondStart.y)
  await page.mouse.down()
  await waitPreview(page)
  await moveInSteps(page, secondStart, 28, 24)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'hidden' && !document.querySelector('.engine-transform-preview-frames'), null, { timeout: 1500 })
  const afterBlur = await readShape(page, shape.id)
  assert(Math.abs((afterBlur.rotation ?? 0) - (final.rotation ?? 0)) > 1, `Window blur did not settle the in-progress rotation: ${JSON.stringify({ before: final.rotation, after: afterBlur.rotation })}`)
  await page.mouse.up()
  await context.close()
  return { name: 'rotation-pointer-cancel-and-window-blur-recovery', canceledRotation: final.rotation, blurredRotation: afterBlur.rotation, previewCleared: true }
}

async function cursorInteractionCase() {
  const sizes = []
  const cursors = []
  const cases = [[50, 1, 1366], [100, 1, 1366], [200, 1, 1366], [50, 2, 1366], [100, 2, 1366], [200, 2, 1366], [50, 4, 1366], [100, 4, 1366], [200, 4, 1366], [100, 1, 1920]]
  for (const [zoom, dpr, viewportWidth] of cases) {
    const { context, page } = await setup(zoom, dpr, `cursor-z${zoom}-dpr${dpr}-w${viewportWidth}`, { width: viewportWidth, height: viewportWidth === 1920 ? 1080 : 768 })
    const shape = await prepareRect(page)
    const canvas = await page.locator('.slide-canvas').boundingBox()
    assert(canvas, 'Slide canvas is missing.')
    const selectedBox = await page.locator('.engine-selection').boundingBox()
    assert(selectedBox, 'Selected shape frame is missing.')
    await page.mouse.move(selectedBox.x + selectedBox.width / 2, selectedBox.y + selectedBox.height / 2)
    await waitForCursor(page, 'move', `selected shape at zoom ${zoom}`, { x: selectedBox.x + selectedBox.width / 2, y: selectedBox.y + selectedBox.height / 2 })
    const selectedCursor = await page.locator('.slide-plane').evaluate((node) => getComputedStyle(node).cursor)
    assert(selectedCursor === 'move', `Selected shape hover should use move cursor: ${selectedCursor}`)
    const rotationCursor = await page.locator('.engine-selection__rotate').evaluate((node) => getComputedStyle(node).cursor)
    assert(rotationCursor.startsWith('url(') && rotationCursor.includes('crosshair'), `Rotation affordance should use the crisp directional rotate cursor, distinct from move: ${rotationCursor}`)

    const control = page.locator('.engine-selection__handle--se').first()
    const originalBox = await control.boundingBox()
    assert(originalBox, 'Resize handle is missing.')
    const start = { x: originalBox.x + originalBox.width / 2, y: originalBox.y + originalBox.height / 2 }
    const cornerTarget = await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.className, start)
    assert(String(cornerTarget).includes('engine-selection__handle--se') && !String(cornerTarget).includes('rotate-hit'),
      `Resize handle is covered by another interaction target at zoom ${zoom}, DPR ${dpr}: ${cornerTarget}`)
    const beforeResize = await readShape(page, shape.id)
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 64, 48); await waitProjection(page)
    const previewHandle = page.locator('.engine-transform-preview-frames .engine-selection__handle--se').first()
    const previewBox = await previewHandle.boundingBox()
    assert(previewBox, 'Transform preview lost its resize handle.')
    assert(Math.abs(previewBox.width - originalBox.width) < 1.5 && Math.abs(previewBox.height - originalBox.height) < 1.5,
      `Resize handle changed screen size while the object scaled at zoom ${zoom}: ${JSON.stringify({ original: originalBox, preview: previewBox })}`)
    await page.mouse.up(); const afterResize = await waitFinal(page, shape.id)
    assert(JSON.stringify(afterResize.rect) !== JSON.stringify(beforeResize.rect), `Resize handle did not change Rust geometry at zoom ${zoom}, DPR ${dpr}: ${JSON.stringify({ before: beforeResize.rect, after: afterResize.rect })}`)
    await undoRedoShape(page, shape.id, beforeResize, afterResize)
    const finalBox = await page.locator('.engine-selection__handle--se').first().boundingBox()
    assert(finalBox && Math.abs(finalBox.width - originalBox.width) < 1.5 && Math.abs(finalBox.height - originalBox.height) < 1.5,
      `Resize handle changed screen size after transform at zoom ${zoom}: ${JSON.stringify({ original: originalBox, final: finalBox })}`)
    sizes.push({ zoom, dpr, viewportWidth, originalCss: [originalBox.width, originalBox.height], duringCss: [previewBox.width, previewBox.height], finalCss: [finalBox.width, finalBox.height], originalDevicePixels: [originalBox.width * dpr, originalBox.height * dpr], duringDevicePixels: [previewBox.width * dpr, previewBox.height * dpr] })
    if (dpr === 1 && viewportWidth === 1366) {
      const screenshot = zoom === 100
        ? `${artifacts}/selection-transform-preview-${viewportWidth}.png`
        : `${artifacts}/selection-transform-preview-${viewportWidth}-z${zoom}.png`
      await page.screenshot({ path: screenshot, animations: 'disabled' })
    }
    if (zoom === 100 && dpr === 1 && viewportWidth === 1920) {
      await page.screenshot({ path: `${artifacts}/selection-transform-preview-${viewportWidth}.png`, animations: 'disabled' })
    }

    const emptyPoint = await findEmptyCanvasPoint(page)
    assert(emptyPoint, `No visible empty canvas point was found at zoom ${zoom}.`)
    await page.mouse.move(emptyPoint.x, emptyPoint.y)
    await waitForCursor(page, 'default', `empty canvas at zoom ${zoom}`, emptyPoint)
    const canvasCursor = await page.locator('.slide-plane').evaluate((node) => getComputedStyle(node).cursor)
    assert(canvasCursor === 'default', `Empty canvas should use default cursor: ${canvasCursor}`)
    await page.evaluate(() => window.__folioTest.restoreDefaultPresentation())
    if (zoom === 100 && dpr === 1 && viewportWidth === 1366) await page.screenshot({ path: `${artifacts}/placeholder-prompts-tr.png`, animations: 'disabled' })
    const text = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((shape) => shape.name === 'Title 1'))
    const textPoint = { x: canvas.x + (text.rect[0] + text.rect[2] / 2) * canvas.width / 960, y: canvas.y + (text.rect[1] + text.rect[3] / 2) * canvas.height / 540 }
    await page.mouse.move(textPoint.x, textPoint.y)
    await waitForCursor(page, 'move', `title placeholder at zoom ${zoom}`, textPoint)
    const textCursor = await page.locator('.slide-plane').evaluate((node) => getComputedStyle(node).cursor)
    assert(textCursor === 'move', `A title placeholder should advertise move outside text editing mode: ${JSON.stringify({ zoom, cursor: textCursor, text, canvas, textPoint, elementAtPoint: await page.evaluate((point) => document.elementFromPoint(point.x, point.y)?.className, textPoint) })}`)
    await page.mouse.dblclick(textPoint.x, textPoint.y)
    await page.waitForFunction(() => document.querySelector('.engine-text-input'))
    const editingCursor = await page.locator('.engine-text-input').evaluate((node) => getComputedStyle(node).cursor)
    assert(editingCursor === 'text', `Text editing should use text cursor: ${editingCursor}`)
    await page.locator('.engine-text-input').press('Escape')
    await page.waitForFunction(() => !document.querySelector('.engine-text-input'))
    if (zoom === 100 && dpr === 1 && viewportWidth === 1366) {
      await page.locator('.topbar__menus .menu-trigger').nth(2).click()
      await page.getByRole('button', { name: 'EN', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.lang === 'en')
      await page.evaluate(() => window.__folioTest.restoreDefaultPresentation())
      await page.screenshot({ path: `${artifacts}/placeholder-prompts-en.png`, animations: 'disabled' })
      await page.getByRole('button', { name: 'TR', exact: true }).click()
      await page.waitForFunction(() => document.documentElement.lang === 'tr')
      await page.evaluate(() => window.__folioTest.reset())
      await page.evaluate(() => window.__folioTest.insertShape('ellipse', [330, 180, 300, 180]))
      const hollowPoint = { x: canvas.x + 350 * canvas.width / 960, y: canvas.y + 200 * canvas.height / 540 }
      const hollowHit = await page.evaluate((point) => window.__folioTest.hitTest(point.x, point.y), { x: 350, y: 200 })
      assert(hollowHit === null, `Rust hit-test should reject a transparent ellipse corner: ${JSON.stringify(hollowHit)}`)
      await page.mouse.move(hollowPoint.x, hollowPoint.y)
      await waitForCursor(page, 'default', 'transparent ellipse corner', hollowPoint)
    }
    cursors.push({ zoom, dpr, selected: selectedCursor, canvas: canvasCursor, textObject: textCursor, textEditing: editingCursor, rotate: rotationCursor, cornerTarget, resize: 'Rust geometry + one-step Undo/Redo PASS' })
    await context.close()
  }
  return { name: 'cursor-hover-and-fixed-controls', cursors, handleSizes: sizes }
}

async function waitForCursor(page, cursor, context, point) {
  await page.evaluate((position) => { window.__lastTestPointer = position }, point)
  try { await page.waitForFunction((expected) => getComputedStyle(document.querySelector('.slide-plane')).cursor === expected, cursor, { timeout: 5000 }) }
  catch { throw new Error(`Cursor did not become ${cursor} for ${context}: ${JSON.stringify(await page.evaluate(async () => { const p=window.__lastTestPointer; const c=document.querySelector('.slide-canvas'); const box=c.getBoundingClientRect(); const point={x:(p.x-box.left)/box.width*960,y:(p.y-box.top)/box.height*540}; return { cursor:getComputedStyle(document.querySelector('.slide-plane')).cursor, pointerTarget:document.elementFromPoint(p.x,p.y)?.className,logical:point,rustHit:await window.__folioTest.hitTest(point.x,point.y) } }))}`) }
}

async function findEmptyCanvasPoint(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('.slide-canvas')
    if (!canvas || !window.__folioTest) return null
    const box = canvas.getBoundingClientRect()
    const left = Math.max(1, box.left + 2)
    const right = Math.min(innerWidth - 2, box.right - 2)
    const top = Math.max(1, box.top + 2)
    const bottom = Math.min(innerHeight - 2, box.bottom - 2)
    for (let row = 0; row < 9; row++) for (let column = 0; column < 13; column++) {
      const point = { x: left + (right - left) * (column + .5) / 13, y: top + (bottom - top) * (row + .5) / 9 }
      if (document.elementFromPoint(point.x, point.y) !== canvas) continue
      const logical = { x: (point.x - box.left) / box.width * 960, y: (point.y - box.top) / box.height * 540 }
      if (!await window.__folioTest.hitTest(logical.x, logical.y)) return point
    }
    return null
  })
}

async function rotatedResizeCase() {
  const { context, page } = await setup(100, 1, 'rotated-resize')
  const shape = await prepareRect(page)
  await rotateShape(page, shape.id)
  const before = await readShape(page, shape.id)
  const handle = await page.locator('.engine-selection__handle--se').boundingBox()
  assert(handle, 'Rotated resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 28, 18)
    await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); const after = await waitFinal(page, shape.id)
    assert(sameGeometry(after, during), 'Rotated resize preview and final Rust projection differ.')
    assert(after.rotation === before.rotation && JSON.stringify(after.rect) !== JSON.stringify(before.rect), 'Resize of rotated shape lost rotation or failed to resize.')
    return { geometry: after.rect, rotation: after.rotation }
  })
  await context.close()
  return { name: 'rotated-shape-resize', ...output }
}

async function shapeCornerAspectCase() {
  const { context, page } = await setup(100, 1, 'shape-corner-aspect')
  const shape = await prepareRect(page)
  const handle = await page.locator('.engine-selection__handle--se').boundingBox()
  assert(handle, 'Shape corner resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 45, 16); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up()
    const final = await waitFinal(page, shape.id)
    const beforeRatio = shape.rect[2] / shape.rect[3]
    const afterRatio = final.rect[2] / final.rect[3]
    assert(Math.abs(beforeRatio - afterRatio) < 0.05, `Canva style corner resize should preserve a basic shape's ratio: ${JSON.stringify({ before: shape.rect, after: final.rect })}`)
    assert(sameGeometry(final, during), 'Proportional shape resize preview and final projection differ.')
    return { before: shape.rect, after: final.rect, ratio: afterRatio }
  })
  await context.close()
  return { name: 'basic-shape-corner-preserves-ratio', ...output }
}

async function textTransformCase() {
  const { context, page } = await setup(100, 1, 'text')
  await page.evaluate(() => window.__folioTest.insertTextBox())
  await page.waitForFunction(() => document.querySelectorAll('.engine-text-input').length === 1)
  await page.locator('.engine-text-input').evaluate((node) => node.blur())
  const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0])
  await page.evaluate((id) => window.__folioTest.selectShape(id), shape.id)
  await page.waitForFunction(() => document.querySelector('.engine-selection'))
  const handle = await page.locator('.engine-selection__handle--e').boundingBox()
  assert(handle, 'Text resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 24, 0)
    await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); const after = await waitFinal(page, shape.id)
    assert(sameRect(after.rect, during.rect), 'Text resize projection and final Rust geometry differ.')
    return { geometry: after.rect, shape: after, rasterCallsDuringDrag: await getDragRasterMetrics(page) }
  })
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  const resized = await readShape(page, shape.id)
  const rotate = await page.locator('.engine-selection__rotate').boundingBox()
  assert(rotate, 'Text rotation handle is missing.')
  const rotateStart = { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }
  const rotationOutput = await runTransform(page, async () => {
    await page.mouse.move(rotateStart.x, rotateStart.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, rotateStart, 42, 20); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); const final = await waitFinal(page, shape.id)
    assert(sameGeometry(final, during), 'Text rotation projection and final Rust geometry differ.')
    assert(Math.abs(final.rotation ?? 0) > 1, 'Text box did not rotate in Rust Session.')
    return { geometry: final, shape: final }
  })
  await undoRedoShape(page, shape.id, resized, rotationOutput.geometry.geometry)
  await context.close()
  return [{ name: 'text-box-resize', ...output }, { name: 'text-box-rotate', ...rotationOutput }]
}

async function textEditModeCase() {
  const { context, page } = await setup(100, 1, 'text-mode')
  await page.evaluate(() => window.__folioTest.insertTextBox())
  await page.waitForFunction(() => document.querySelector('.engine-text-input'))
  await page.locator('.engine-text-input').press('Escape')
  try { await page.waitForFunction(() => !document.querySelector('.engine-text-input'), null, { timeout: 5000 }) }
  catch { throw new Error(`Escape did not leave text editing: ${JSON.stringify(await page.evaluate(() => ({ selection: window.__folioTest.snapshot().selection, active: document.activeElement?.className })))}`) }
  await page.keyboard.press('Enter')
  try { await page.waitForFunction(() => document.querySelector('.engine-text-input'), null, { timeout: 5000 }) }
  catch { throw new Error(`Enter did not start text editing: ${JSON.stringify(await page.evaluate(() => ({ selection: window.__folioTest.snapshot().selection, active: document.activeElement?.tagName, shapes: window.__folioTest.snapshot().activeSlide?.shapes })))}`) }
  assert(await page.locator('.engine-text-input').evaluate((node) => document.activeElement === node), 'Enter did not focus the Rust text editing overlay.')
  await page.locator('.engine-text-input').press('Escape')
  await page.waitForFunction(() => !document.querySelector('.engine-text-input'))
  const textShape = await page.evaluate(() => {
    const id = JSON.parse(document.querySelector('.editor-shell').dataset.engineSelection)[0]
    return JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((shape) => shape.id === id)
  })
  const canvas = await page.locator('.slide-canvas').boundingBox()
  const textPoint = { x: canvas.x + (textShape.rect[0] + textShape.rect[2] / 2) * canvas.width / 960, y: canvas.y + (textShape.rect[1] + textShape.rect[3] / 2) * canvas.height / 540 }
  await page.mouse.dblclick(textPoint.x, textPoint.y)
  await page.waitForFunction(() => document.querySelector('.engine-text-input'))
  await context.close()
  return { name: 'text-selection-editing-mode', enterEscapeAndDoubleClick: 'PASS' }
}

async function editModeFirstRotateCase() {
  const { context, page } = await setup(100, 1, 'edit-mode-first-rotate')
  await page.evaluate(() => window.__folioTest.insertTextBox())
  const input = page.locator('.engine-text-input')
  await input.waitFor({ state: 'visible' })
  const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0])
  const handle = await page.locator('.engine-selection__rotate').boundingBox()
  assert(handle, 'Rotation handle is missing while the new text box is being edited.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await moveInSteps(page, start, 42, 20)
  await page.mouse.up()
  const final = await waitFinal(page, shape.id)
  assert(Math.abs(final.rotation ?? 0) > 1, `First rotation from active text-edit mode was lost: ${JSON.stringify({ final, inputVisible: await input.isVisible().catch(() => false), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()) })}`)
  await context.close()
  return { name: 'edit-mode-first-rotate', rotation: final.rotation }
}

async function textResizeLivePreviewCase() {
  const { context, page } = await setup(100, 1, 'text-resize-live-preview')
  await page.evaluate(() => window.__folioTest.insertTextBoxAt([300, 200, 300, 90], 'TAYFUR ÇINAR'))
  const input = page.locator('.engine-text-input')
  await input.waitFor({ state: 'visible' })
  await input.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.engine-text-input'))
  const shape = await page.evaluate(() => window.__folioTest.snapshot().activeSlide.shapes.find((item) => item.textBox))
  await page.evaluate((id) => window.__folioTest.selectShape(id), shape.id)
  const handle = await page.locator('.engine-selection__handle--e').boundingBox()
  assert(handle, 'Text box resize handle is missing.')
  assert(await page.locator('.engine-selection__handle').count() === 2
      && await page.locator('.engine-selection__handle--e,.engine-selection__handle--w').count() === 2,
    'Canva-style text boxes should expose only the left/right pill handles.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await waitPreview(page)
  const toolbarDuring = await page.locator('.selection-toolbar').evaluate((node) => getComputedStyle(node).visibility)
  assert(toolbarDuring === 'hidden', `The floating text toolbar must leave the active resize area: ${toolbarDuring}`)
  const alphaBounds = () => page.evaluate(() => {
    const frame = window.__folioTest.movePreview().frame
    let left = frame.width, top = frame.height, right = -1, bottom = -1
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      if (frame.pixels[(y * frame.width + x) * 4 + 3] < 16) continue
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
    return { left, top, width: right - left + 1, height: bottom - top + 1 }
  })
  const before = await alphaBounds()
  await moveInSteps(page, start, 220, 0)
  await waitProjection(page)
  const during = await alphaBounds()
  const current = await page.evaluate(() => window.__folioTest.movePreview())
  assert(current.renderedCurrentGeometry, 'Text resize preview still uses the stretched starting bitmap instead of a current Rust render.')
  assert(Math.abs(during.width - before.width) <= 2 && Math.abs(during.height - before.height) <= 2, `Text glyphs were distorted while resizing: ${JSON.stringify({ before, during })}`)
  await page.mouse.up()
  const final = await waitFinal(page, shape.id)
  await page.waitForFunction(() => { const toolbar = document.querySelector('.selection-toolbar'); return toolbar && getComputedStyle(toolbar).visibility === 'visible' })
  assert(final.rect[2] > shape.rect[2], `Text box width did not increase after resize: ${JSON.stringify({ before: shape.rect, after: final.rect })}`)
  assert(Math.abs(during.width - before.width) <= 2 && Math.abs(during.height - before.height) <= 2,
    `Resizing a text box changed the font instead of only changing its width: ${JSON.stringify({ before, during })}`)
  const renderMetric = await page.evaluate(() => window.__folioPerf.snapshot()['render.selectedTextPreview'])
  assert((renderMetric?.count ?? 0) > 0, 'Text resize did not render a current-geometry preview frame.')
  const eastAgain = await page.locator('.engine-selection__handle--e').boundingBox()
  const canvas = await page.locator('.slide-canvas').boundingBox()
  assert(eastAgain && canvas, 'Text resize controls disappeared before the wrap check.')
  const narrowStart = { x: eastAgain.x + eastAgain.width / 2, y: eastAgain.y + eastAgain.height / 2 }
  const narrowBy = (final.rect[2] - 96) * canvas.width / 960
  await page.mouse.move(narrowStart.x, narrowStart.y)
  await page.mouse.down()
  await moveInSteps(page, narrowStart, -narrowBy, 0)
  await waitProjection(page)
  const wrappedDuring = await alphaBounds()
  const wrappedPreview = await page.evaluate(() => window.__folioTest.movePreview())
  assert(wrappedPreview.renderedCurrentGeometry, 'Narrow text-box preview did not render the current Rust text layout.')
  assert(wrappedDuring.height > before.height + 4, `Narrowing a text box did not wrap its text: ${JSON.stringify({ before, wrappedDuring })}`)
  await page.mouse.up()
  const narrowed = await waitFinal(page, shape.id)
  assert(narrowed.rect[2] < final.rect[2] && narrowed.text === shape.text && narrowed.textBoxOptions?.wrap === true,
    `Text box did not keep its content and wrap setting after narrowing: ${JSON.stringify(narrowed)}`)
  await context.close()
  return { name: 'text-box-resize-keeps-font-size-hides-toolbar-and-wraps-text', before, during, finalRect: final.rect, toolbarDuring, wrappedDuring, narrowedRect: narrowed.rect, dynamicTextPreviewCalls: renderMetric.count, dynamicTextPreviewAvgMs: renderMetric.avgMs }
}

async function singleClickTextEditCase() {
  const { context, page } = await setup(100, 1, 'single-click-text')
  await page.getByRole('button', { name: 'Araçlar' }).click()
  await page.getByRole('button', { name: 'Metin', exact: true }).click()
  await page.locator('.slide-plane--placing-text').waitFor({ state: 'attached' })
  await page.keyboard.press('Escape')
  await page.locator('.slide-plane--placing-text').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Metin', exact: true }).click()
  await page.locator('.slide-plane--placing-text').waitFor({ state: 'attached' })
  const placementCanvas = await page.locator('.slide-canvas').boundingBox()
  assert(placementCanvas, 'Slide canvas is missing while text placement is active.')
  const target = { x: 315, y: 195 }
  await page.mouse.click(placementCanvas.x + target.x * placementCanvas.width / 960, placementCanvas.y + target.y * placementCanvas.height / 540)
  await page.locator('.engine-text-input').waitFor({ state: 'visible' })
  const placed = await page.evaluate(() => window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.textBox))
  assert(placed?.rect && Math.abs(placed.rect[0] - target.x) < 1 && Math.abs(placed.rect[1] - target.y) < 1, `Text box was not placed at the clicked slide coordinates: ${JSON.stringify({ target, rect: placed?.rect })}`)
  await page.keyboard.type('Existing text')
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0]?.text?.includes('Existing text'))
  await assertProjectedCaret(page, 'new text box')
  await page.locator('.engine-text-caret').evaluate((node) => { node.style.animation = 'none' })
  await page.screenshot({ path: `${artifacts}/atlas-text-caret-after.png`, animations: 'disabled' })
  const formatBefore = await page.evaluate(() => window.__folioTest.formatState())
  await page.keyboard.press('Control+a')
  await page.waitForFunction(() => { const i = document.querySelector('.engine-text-input'); return i && i.selectionStart === 0 && i.selectionEnd === i.value.length })
  const formatAfter = await page.evaluate(() => window.__folioTest.formatState())
  assert(JSON.stringify([formatAfter.font, formatAfter.size, formatAfter.bold, formatAfter.italic]) === JSON.stringify([formatBefore.font, formatBefore.size, formatBefore.bold, formatBefore.italic]), `Ctrl+A changed active formatting: ${JSON.stringify({ formatBefore, formatAfter })}`)
  await page.keyboard.type('Replaced all')
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0]?.text === 'Replaced all')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.engine-text-input'))
  const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((item) => item.text === 'Replaced all'))
  const canvas = await page.locator('.slide-canvas').boundingBox()
  assert(canvas && shape.rect, 'New text shape/canvas is missing.')
  const point = { x: canvas.x + (shape.rect[0] + shape.rect[2] / 2) * canvas.width / 960, y: canvas.y + (shape.rect[1] + shape.rect[3] / 2) * canvas.height / 540 }
  await page.mouse.click(point.x, point.y)
  await page.locator('.engine-text-input').waitFor({ state: 'visible' })
  assert(await page.locator('.engine-text-input').evaluate((node) => document.activeElement === node), 'Single click did not focus text editing.')
  await page.keyboard.press('ArrowLeft')
  await assertProjectedCaret(page, 'existing text after moving caret')
  await page.keyboard.press('Escape')
  await context.close()
  return { name: 'text-tool-caret-ctrl-a-formatting', status: 'PASS' }
}

async function selectionVisualCase() {
  const { context, page } = await setup(100, 1, 'atlas-visual')
  await prepareRect(page)
  await page.evaluate(() => {
    const plane = document.querySelector('.slide-plane')
    plane.style.setProperty('--handle-inset', '6px')
    plane.style.setProperty('--rotate-control-inset', '26px')
    const style = document.createElement('style')
    style.id = 'atlas-reference-handle-appearance'
    style.textContent = `.engine-selection__handle,.engine-selection__rotate{width:12px;height:12px;border:2px solid #fff;border-radius:3px;background:var(--accent);box-shadow:0 0 0 1px var(--accent)}.engine-selection__handle:hover,.engine-selection__rotate:hover{background:var(--accent-strong)}.engine-selection__handle::before,.engine-selection__rotate::before{display:none}.engine-selection__rotate::before{display:grid;width:100%;height:100%;place-items:center;color:#fff;font-size:9px;line-height:1;content:'↻'}`
    document.head.append(style)
  })
  const beforeScreenshot = `${artifacts}/atlas-transform-before.png`
  await page.screenshot({ path: beforeScreenshot, animations: 'disabled' })
  await page.evaluate(() => {
    document.querySelector('#atlas-reference-handle-appearance')?.remove()
    const plane = document.querySelector('.slide-plane')
    plane.style.setProperty('--handle-inset', '9px')
    plane.style.setProperty('--rotate-control-inset', '29px')
  })
  const afterScreenshot = `${artifacts}/atlas-transform-after.png`
  await page.screenshot({ path: afterScreenshot, animations: 'disabled' })
  await page.getByRole('button', { name: 'Görünüm' }).click()
  await page.getByRole('switch', { name: 'Koyu görünüm' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.colorMode === 'dark')
  await page.keyboard.press('Escape')
  const darkScreenshot = `${artifacts}/atlas-transform-after-dark.png`
  await page.screenshot({ path: darkScreenshot, animations: 'disabled' })
  const darkHandle = await page.locator('.engine-selection__handle').first().evaluate((node) => getComputedStyle(node, '::before').borderColor)
  assert(darkHandle !== 'rgba(0, 0, 0, 0)', `Selection handle disappeared in dark theme: ${darkHandle}`)
  const handles = await page.locator('.engine-selection__handle').evaluateAll((nodes) => nodes.map((node) => ({ box: node.getBoundingClientRect().toJSON(), background: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderColor })))
  const rotate = await page.locator('.engine-selection__rotate').evaluate((node) => ({ box: node.getBoundingClientRect().toJSON(), background: getComputedStyle(node).backgroundColor, glyph: getComputedStyle(node, '::before').content }))
  await context.close()
  return { name: 'atlas-transform-handle-visuals', screenshots: { before: beforeScreenshot, after: afterScreenshot, dark: darkScreenshot }, handles, rotate, darkHandle }
}

async function textClickMatrixCase() {
  const matrix = [[50, 1], [100, 1], [200, 1], [50, 2], [100, 2], [200, 2], [50, 4], [100, 4], [200, 4]]
  const cases = []
  for (const [zoom, dpr] of matrix) {
    currentCase = `single-click-text-z${zoom}-dpr${dpr}: setup`
    const { context, page } = await setup(zoom, dpr, `text-click-z${zoom}-dpr${dpr}`)
    currentCase = `single-click-text-z${zoom}-dpr${dpr}: create and exit edit mode`
    await page.evaluate(() => window.__folioTest.insertTextBoxAt([300, 220, 360, 90], 'Matrix text'))
    await page.locator('.engine-text-input').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('.engine-text-input'))
    const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0])
    const canvas = await page.locator('.slide-canvas').boundingBox()
    assert(canvas && shape.rect, `Text matrix canvas/shape missing at zoom ${zoom}, DPR ${dpr}.`)
    const center = { x: canvas.x + (shape.rect[0] + shape.rect[2] / 2) * canvas.width / 960, y: canvas.y + (shape.rect[1] + shape.rect[3] / 2) * canvas.height / 540 }
    currentCase = `single-click-text-z${zoom}-dpr${dpr}: enter text edit mode`
    await page.mouse.click(center.x, center.y)
    const input = page.locator('.engine-text-input')
    await input.waitFor({ state: 'visible', timeout: 2000 })
    const beforeCaret = await page.evaluate(() => window.__folioTest.snapshot().selection.textSelection?.caret)
    const inputBox = await input.boundingBox()
    assert(inputBox, `Text input missing at zoom ${zoom}, DPR ${dpr}.`)
    currentCase = `single-click-text-z${zoom}-dpr${dpr}: place caret`
    await page.evaluate(() => { window.__folioCaretClickStart = performance.now() })
    await page.mouse.click(inputBox.x + Math.min(20, inputBox.width / 3), inputBox.y + inputBox.height / 2)
    await page.waitForFunction((before) => JSON.stringify(window.__folioTest.snapshot().selection.textSelection?.caret) !== JSON.stringify(before), beforeCaret, { timeout: 2000 })
    const clickToCaretMs = await page.evaluate(() => +(performance.now() - window.__folioCaretClickStart).toFixed(2))
    const after = await readShape(page, shape.id)
    assert(JSON.stringify(after.rect) === JSON.stringify(shape.rect), `Text caret click moved the object at zoom ${zoom}, DPR ${dpr}.`)
    cases.push({ zoom, dpr, beforeCaret, afterCaret: await page.evaluate(() => window.__folioTest.snapshot().selection.textSelection?.caret), clickToCaretMs })
    await context.close()
  }
  return { name: 'single-click-text-caret-zoom-dpr-matrix', status: 'PASS', cases }
}

async function placeholderClickCase() {
  currentCase = 'default-placeholders: setup and inherited geometry'
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push({ page: 'placeholder-click', message: error.message }))
  page.on('console', (message) => { if (message.type() === 'error') errors.push({ page: 'placeholder-click', message: message.text() }) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.evaluate(() => window.__folioTest.restoreDefaultPresentation())
  const projection = await page.evaluate(() => window.__folioTest.snapshot().activeSlide)
  const title = projection.shapes.find((shape) => shape.name === 'Title 1')
  const subtitle = projection.shapes.find((shape) => shape.name === 'Subtitle 2')
  assert(title?.rect && subtitle?.rect, `Inherited placeholder transforms are missing from the Rust projection: ${JSON.stringify({title,subtitle})}`)
  assert(title.placeholder && subtitle.placeholder, `Default title placeholders are not identified in the Rust projection: ${JSON.stringify({title,subtitle})}`)
  await page.evaluate((id) => window.__folioTest.selectShape(id), title.id)
  const selectionFrame = page.locator(`.engine-selection[data-engine-selection-id="${title.id}"]`)
  await selectionFrame.waitFor({ state: 'visible' })
  assert(await selectionFrame.locator('.engine-selection__handle').count() === 2
      && await selectionFrame.locator('.engine-selection__handle--e,.engine-selection__handle--w').count() === 2,
    'Canva-style title placeholders should expose only left/right text-box resize handles.')
  const canvasBounds = await page.locator('.slide-canvas').boundingBox()
  assert(canvasBounds && title.rect, 'Title placeholder canvas geometry is missing.')
  const start = { x: canvasBounds.x + (title.rect[0] + title.rect[2]) * canvasBounds.width / 960, y: canvasBounds.y + (title.rect[1] + title.rect[3]) * canvasBounds.width / 960 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await moveInSteps(page, start, 36, 24)
  await page.mouse.up()
  const afterHiddenCornerDrag = await page.evaluate((id) => window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.id === id)?.rect, title.id)
  assert(JSON.stringify(afterHiddenCornerDrag) === JSON.stringify(title.rect), `Hidden title-placeholder corner still resized the box: ${JSON.stringify({ before: title.rect, after: afterHiddenCornerDrag })}`)
  const selectionBorder = await selectionFrame.evaluate((node) => ({ className: node.className, width: getComputedStyle(node).borderTopWidth }))
  assert(selectionBorder.className.includes('engine-selection--placeholder') && selectionBorder.width === '0px', `Selected placeholder still has a duplicate React outline: ${JSON.stringify(selectionBorder)}`)
  const canvas = page.locator('.slide-canvas')
  const box = await canvas.boundingBox()
  assert(box, 'Slide canvas has no bounds for the default presentation.')
  const factor = box.width / 960
  for (const [shape, text] of [[title, 'Regression title'], [subtitle, 'Regression subtitle']]) {
    currentCase = `default-placeholders: enter ${shape.name} text`
    const [x, y, width, height] = shape.rect
    await page.mouse.click(box.x + (x + width * 0.5) * factor, box.y + (y + height * 0.5) * factor)
    const input = page.locator('.engine-text-input')
    try { await input.waitFor({ state: 'visible', timeout: 3000 }) }
    catch { throw new Error(`${shape.name} click did not open text editing: ${JSON.stringify({ point: { x: box.x + (x + width * 0.5) * factor, y: box.y + (y + height * 0.5) * factor }, activeElement: await page.evaluate(() => ({ tag: document.activeElement?.tagName, className: typeof document.activeElement?.className === 'string' ? document.activeElement.className : null })), selection: await page.evaluate(() => window.__folioTest.snapshot().selection), toolbar: await page.locator('.selection-toolbar').evaluate((node) => node.getBoundingClientRect().toJSON()), domTarget: await page.evaluate((point) => { const node = document.elementFromPoint(point.x, point.y); return node ? { tag: node.tagName, className: typeof node.className === 'string' ? node.className : null, html: node.outerHTML.slice(0, 240) } : null }, { x: box.x + (x + width * 0.5) * factor, y: box.y + (y + height * 0.5) * factor }) })}`) }
    assert(await input.evaluate((node) => document.activeElement === node), `${shape.name} click did not focus the text input.`)
    await page.keyboard.type(text)
    await page.waitForFunction(({ id, suffix }) => {
      const root = document.querySelector('.editor-shell')
      const shapes = JSON.parse(root?.getAttribute('data-engine-projection') ?? '[]')
      return shapes.some((item) => item.id === id && item.text?.includes(suffix))
    }, { id: shape.id, suffix: text })
    const current = await page.evaluate((id) => {
      const root = document.querySelector('.editor-shell')
      const shapes = JSON.parse(root?.getAttribute('data-engine-projection') ?? '[]')
      return shapes.find((item) => item.id === id)
    }, shape.id)
    assert(current.text?.includes(text), `${shape.name} text was not written into the Rust Session projection.`)
    await assertProjectedCaret(page, shape.name)
    const formatBeforeSelectAll = await page.evaluate(() => window.__folioTest.formatState())
    await page.keyboard.press('Control+a')
    await page.waitForFunction(() => {
      const input = document.querySelector('.engine-text-input')
      return input && input.selectionStart === 0 && input.selectionEnd === input.value.length
    }, null, { timeout: 1500 })
    const formatAfterSelectAll = await page.evaluate(() => window.__folioTest.formatState())
    assert(JSON.stringify([formatAfterSelectAll.font, formatAfterSelectAll.size, formatAfterSelectAll.bold, formatAfterSelectAll.italic]) === JSON.stringify([formatBeforeSelectAll.font, formatBeforeSelectAll.size, formatBeforeSelectAll.bold, formatBeforeSelectAll.italic]), `${shape.name} Ctrl+A changed its inherited text formatting: ${JSON.stringify({ before: formatBeforeSelectAll, after: formatAfterSelectAll })}`)
    await page.keyboard.press('Escape')
    if (shape.id === title.id) {
      await page.evaluate((id) => window.__folioTest.selectShape(id), title.id)
      const rightHandle = await page.locator(`.engine-selection[data-engine-selection-id="${title.id}"] .engine-selection__handle--e`).boundingBox()
      assert(rightHandle, 'Title placeholder right text-box handle is missing after text entry.')
      const handleStart = { x: rightHandle.x + rightHandle.width / 2, y: rightHandle.y + rightHandle.height / 2 }
      await page.mouse.move(handleStart.x, handleStart.y)
      await page.mouse.down()
      await waitPreview(page)
      const glyphBounds = () => page.evaluate(() => {
        const frame = window.__folioTest.movePreview().frame
        let left = frame.width, top = frame.height, right = -1, bottom = -1
        for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
          if (frame.pixels[(y * frame.width + x) * 4 + 3] < 16) continue
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        }
        return { width: right - left + 1, height: bottom - top + 1 }
      })
      const beforeGlyphBounds = await glyphBounds()
      await moveInSteps(page, handleStart, -60, 0)
      await waitProjection(page)
      const duringGlyphBounds = await glyphBounds()
      const placeholderPreview = await page.evaluate(() => window.__folioTest.movePreview())
      assert(placeholderPreview.renderedCurrentGeometry, 'Title placeholder resize did not re-render live text at its current width.')
      assert(Math.abs(duringGlyphBounds.width - beforeGlyphBounds.width) <= 2 && Math.abs(duringGlyphBounds.height - beforeGlyphBounds.height) <= 2,
        `Resizing the title placeholder changed its font metrics: ${JSON.stringify({ beforeGlyphBounds, duringGlyphBounds })}`)
      await page.mouse.up()
      await waitPreviewHidden(page)
      const resizedTitle = await page.evaluate((id) => window.__folioTest.snapshot().activeSlide.shapes.find((item) => item.id === id), title.id)
      assert(resizedTitle.rect[2] < title.rect[2], `Title placeholder right handle did not reduce width: ${JSON.stringify({ before: title.rect, after: resizedTitle.rect })}`)
    }
  }
  await context.close()
  return { name: 'inherited-placeholder-click-to-edit', titleId: title.id, subtitleId: subtitle.id, status: 'PASS' }
}

async function assertProjectedCaret(page, label) {
  try {
    await page.waitForFunction(() => window.__folioTest.snapshot().selection.caretLine && document.querySelector('.engine-text-caret'))
  } catch {
    throw new Error(`${label} has no engine-projected caret: ${JSON.stringify(await page.evaluate(() => window.__folioTest.snapshot().selection))}`)
  }
  const { line, visual, nativeCaret } = await page.evaluate(() => ({
    line: window.__folioTest.snapshot().selection.caretLine,
    visual: ((node) => ({ left: Number.parseFloat(node.style.left), top: Number.parseFloat(node.style.top), height: Number.parseFloat(node.style.height), transform: node.style.transform }))(document.querySelector('.engine-text-caret')),
    nativeCaret: getComputedStyle(document.querySelector('.engine-text-input')).caretColor,
  }))
  const expectedHeight = Math.hypot(line[2] - line[0], line[3] - line[1])
  const expectedAngle = Math.atan2(line[3] - line[1], line[2] - line[0]) - Math.PI / 2
  assert(Math.abs(visual.left - line[0]) < .01 && Math.abs(visual.top - line[1]) < .01 && Math.abs(visual.height - expectedHeight) < .01 && visual.transform === `rotate(${expectedAngle}rad)`, `${label} caret does not match the vertical Rust caret line: ${JSON.stringify({ line, visual, expectedHeight, expectedAngle })}`)
  assert(nativeCaret === 'rgba(0, 0, 0, 0)', `${label} still shows the browser's mismatched native caret: ${nativeCaret}`)
}

async function shiftResizeCase() {
  const { context, page } = await setup(100, 1, 'shift-resize')
  const shape = await prepareRect(page)
  const handle = await page.locator('.engine-selection__handle--se').boundingBox()
  assert(handle, 'Shift resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.keyboard.down('Shift'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 40, 12); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); await page.keyboard.up('Shift')
    const final = await waitFinal(page, shape.id)
    assert(Math.abs(final.rect[2] / final.rect[3] - shape.rect[2] / shape.rect[3]) < .05, `Shift aspect lock changed ratio beyond DeckCraft snap tolerance: ${JSON.stringify({ final: final.rect, during: during?.rect })}`)
    assert(sameGeometry(final, during), 'Shift resize Rust projection and final shape differ.')
    return { ratio: final.rect[2] / final.rect[3], rect: final.rect, shape: final }
  })
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: 'shift-aspect-resize', ...output }
}

async function altCenterResizeCase() {
  const { context, page } = await setup(100, 1, 'alt-center-resize')
  const shape = await prepareRect(page)
  const handle = await page.locator('.engine-selection__handle--se').boundingBox()
  assert(handle, 'Alt resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.keyboard.down('Alt'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 32, 20); await waitProjection(page)
    await page.mouse.up(); await page.keyboard.up('Alt')
    const after = await waitFinal(page, shape.id)
    const beforeCenter = [shape.rect[0] + shape.rect[2] / 2, shape.rect[1] + shape.rect[3] / 2]
    const afterCenter = [after.rect[0] + after.rect[2] / 2, after.rect[1] + after.rect[3] / 2]
    assert(afterCenter.every((value, index) => Math.abs(value - beforeCenter[index]) <= 1.1), `Alt resize shifted the center by more than one document unit: ${JSON.stringify({ before: shape.rect, after: after.rect })}`)
    return { before: shape.rect, after: after.rect, center: afterCenter }
  })
  await undoRedoShape(page, shape.id, shape, { ...shape, rect: output.geometry.after })
  await context.close()
  return { name: 'alt-center-resize', ...output }
}

async function rotationSnapCase() {
  const { context, page } = await setup(100, 1, 'rotation-snap')
  const shape = await prepareRect(page)
  const rotate = await page.locator('.engine-selection__rotate').boundingBox()
  assert(rotate, 'Shift rotation handle is missing.')
  const start = { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }
  const output = await runTransform(page, async () => {
    await page.keyboard.down('Shift'); await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 45, 22); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); await page.keyboard.up('Shift')
    const final = await waitFinal(page, shape.id)
    assert(Math.abs((final.rotation ?? 0) / 15 - Math.round((final.rotation ?? 0) / 15)) < .001, `Shift rotation did not snap to 15 degrees: ${final.rotation}`)
    assert(sameGeometry(final, during), 'Shift rotation preview and Rust result differ.')
    return { rotation: final.rotation, shape: final }
  })
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: 'shift-15-degree-rotation-snap', ...output }
}

async function flipResizeCase() {
  const { context, page } = await setup(100, 1, 'flip-resize')
  const shape = await prepareRect(page)
  const handle = await page.locator('.engine-selection__handle--e').boundingBox()
  assert(handle, 'Flip resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, -280, 0); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); const final = await waitFinal(page, shape.id)
    assert(final.flipH, `Crossing the opposite edge did not flip the shape: ${JSON.stringify(final)}`)
    assert(sameGeometry(final, during), 'Flip preview and final Rust shape differ.')
    return { geometry: final.rect, flipH: final.flipH, shape: final }
  })
  await undoRedoShape(page, shape.id, shape, output.geometry.shape)
  await context.close()
  return { name: 'flip-boundary-resize', ...output }
}

async function overflowResizeCase() {
  currentCase = 'out-of-canvas-resize'
  const { context, page } = await setup(100, 1, 'overflow-resize')
  const shape = await prepareRect(page)
  const handle = await page.locator('.engine-selection__handle--e').boundingBox()
  assert(handle, 'Overflow resize handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  const output = await runTransform(page, async () => {
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 560, 0); await waitProjection(page)
    const during = await page.evaluate((id) => window.__folioTest.movePreview().shapes.find((item) => item.id === id), shape.id)
    await page.mouse.up(); const final = await waitFinal(page, shape.id)
    assert(final.rect[0] + final.rect[2] > 960, `Resize did not extend beyond the slide: ${JSON.stringify(final.rect)}`)
    assert(sameGeometry(final, during), 'Overflow preview and final Rust shape differ.')
    return { rect: final.rect, shape: final }
  })
  await context.close()
  return { name: 'out-of-canvas-resize', ...output }
}

async function overflowHitTestCase() {
  const { context, page } = await setup(50, 1, 'overflow-hit-test')
  await page.evaluate(() => window.__folioTest.insertShape('rect', [-30, 200, 120, 80]))
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).length === 1)
  const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0])
  const canvas = await page.locator('.slide-canvas').boundingBox()
  const area = await page.locator('.slide-area').boundingBox()
  assert(canvas && area && canvas.x > area.x + 30, `Test shape's off-canvas section is not inside the editor viewport: ${JSON.stringify({ canvas, area })}`)
  const factor = canvas.width / 960
  await page.mouse.click(canvas.x + 600 * factor, canvas.y + 400 * factor)
  await page.waitForFunction(() => window.__folioTest.snapshot().selection?.shapeIds.length === 0)
  await page.mouse.click(canvas.x - 15 * factor, canvas.y + 240 * factor)
  try {
    await page.waitForFunction((id) => window.__folioTest.snapshot().selection?.shapeIds.includes(id), shape.id, { timeout: 3000 })
  } catch {
    throw new Error(`A visible off-canvas shape could not be selected by clicking its overflow raster: ${JSON.stringify({ shape, lastPointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), hit: await page.evaluate(() => window.__folioTest.hitTest(-15, 240)), area, canvas })}`)
  }
  const start = { x: canvas.x - 15 * factor, y: canvas.y + 240 * factor }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await waitPreview(page)
  await moveInSteps(page, start, 24, 0)
  await waitProjection(page)
  await page.mouse.up()
  const moved = await waitFinal(page, shape.id)
  assert(moved.rect[0] > shape.rect[0], `The selected off-canvas shape could not be dragged back toward the slide: ${JSON.stringify({ before: shape.rect, after: moved.rect })}`)
  await context.close()
  return { name: 'select-and-move-shape-from-outside-slide', shapeId: shape.id, point: [-15, 240], after: moved.rect }
}

async function successiveTransformsCase() {
  const { context, page } = await setup(100, 1, 'successive-transforms')
  const shape = await prepareRect(page)
  const resize = await page.locator('.engine-selection__handle--se').boundingBox()
  assert(resize, 'First successive transform resize handle is missing.')
  const resizeStart = { x: resize.x + resize.width / 2, y: resize.y + resize.height / 2 }
  const first = await runTransform(page, async () => {
    await page.mouse.move(resizeStart.x, resizeStart.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, resizeStart, 32, 22); await waitProjection(page); await page.mouse.up()
    return waitFinal(page, shape.id)
  })
  const rotate = await page.locator('.engine-selection__rotate').boundingBox()
  assert(rotate, 'Second successive transform rotation handle is missing.')
  const rotateStart = { x: rotate.x + rotate.width / 2, y: rotate.y + rotate.height / 2 }
  const second = await runTransform(page, async () => {
    await page.mouse.move(rotateStart.x, rotateStart.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, rotateStart, 42, 20); await waitProjection(page); await page.mouse.up()
    return waitFinal(page, shape.id)
  })
  await undoRedoShape(page, shape.id, first.geometry, second.geometry)
  await context.close()
  return { name: 'rapid-successive-resize-rotate', first: first.geometry.rect, second: second.geometry.rect, rotation: second.geometry.rotation }
}

async function rotateShape(page, id) {
  const handle = await page.locator('.engine-selection__rotate').boundingBox()
  assert(handle, 'Rotation handle is missing.')
  const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await waitPreview(page); await moveInSteps(page, start, 40, 24); await page.mouse.up(); await waitFinal(page, id)
}

async function runTransform(page, action, cacheMode = 'warm') {
  if (cacheMode === 'cold') await page.evaluate(() => window.__folioTest.clearPreviewCache())
  const wasmMemoryBeforeBytes = await page.evaluate(() => window.__folioTest.memoryBytes())
  const prewarmMetrics = await page.evaluate(() => window.__folioPerf.snapshot())
  await page.evaluate(() => { window.__folioPerf.reset(); window.__folioReactCommitTimes = []; window.__folioTransformInputSequence = 0; window.__folioGestureInputStart = null; window.__folioTransformTelemetry = { events: [], frames: [], active: true, commits: 0, pointerUpTime: null } })
  await page.evaluate(() => {
    window.__folioNativePointerDownTarget = null
    document.addEventListener('pointerdown', (event) => {
      const target = event.target instanceof Element ? event.target : null
      window.__folioNativePointerDownTarget = { tag: target?.tagName ?? null, className: typeof target?.className === 'string' ? target.className : null, handle: target?.closest('[data-engine-handle]')?.getAttribute('data-engine-handle') ?? null }
    }, { capture: true, once: true })
    window.__folioTransformLongTasks = []
    window.__folioTransformPointerEvents = []
    const observer = new PerformanceObserver((entries) => { if (!window.__folioTransformTelemetry) return; window.__folioTransformLongTasks.push(...entries.getEntries().map((entry) => ({ time: entry.startTime, duration: entry.duration }))) })
    try { observer.observe({ type: 'longtask', buffered: false }); window.__folioTransformLongTaskObserver = observer } catch {}
    document.querySelector('.slide-plane').addEventListener('pointermove', (event) => { if (event.buttons === 1) window.__folioTransformTelemetry.events.push({ x: event.clientX, y: event.clientY, time: performance.now() }) }, { capture: true })
    document.addEventListener('pointercancel', () => { window.__folioTransformFallback = true }, { capture: true })
    window.addEventListener('mousemove', (event) => { if (window.__folioTransformFallback && (event.buttons & 1)) window.__folioTransformTelemetry.events.push({ x: event.clientX, y: event.clientY, time: performance.now(), fallback: true }) }, { capture: true })
    document.addEventListener('pointerup', (event) => { window.__folioTransformTelemetry.pointerUpTime = performance.now(); window.__folioTransformPointerEvents.push({type:'up',target:event.target?.className?.baseVal??event.target?.className??event.target?.tagName}) }, { capture: true, once: true })
    document.addEventListener('pointercancel', (event) => window.__folioTransformPointerEvents.push({type:'cancel',target:event.target?.className?.baseVal??event.target?.className??event.target?.tagName}), { capture: true })
    const tick = (time) => {
      if (!window.__folioTransformTelemetry?.active) return
      const instrumentationStart = performance.now()
      const node = document.querySelector('.move-preview-active')
      const matrix = node ? new DOMMatrix(getComputedStyle(node).transform) : null
      const pointer = window.__folioTransformTelemetry.events.at(-1) ?? null
      window.__folioTransformTelemetry.frames.push({ time, visible: node?.style.visibility === 'visible', matrix: matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : null, pointer, instrumentationMs: performance.now() - instrumentationStart })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const geometry = await action()
  const toolbarBounds = await page.locator('.selection-toolbar').boundingBox()
  const stageBounds = await page.locator('.stage').boundingBox()
  assert(toolbarBounds && stageBounds && toolbarBounds.x >= stageBounds.x + 2 && toolbarBounds.x + toolbarBounds.width <= stageBounds.x + stageBounds.width - 2,
    `Selection toolbar escaped the visible editor stage: ${JSON.stringify({ toolbarBounds, stageBounds })}`)
  const thumbnailMatch = await page.evaluate(async () => {
    const deadline = performance.now() + 2000
    while (performance.now() < deadline) {
      const active = document.querySelector('.slide-canvas')
      const thumbnail = document.querySelector('.slide-card--active .slide-card__preview')
      if (active instanceof HTMLCanvasElement && thumbnail instanceof HTMLCanvasElement && active.width && thumbnail.width) {
        const expected = document.createElement('canvas')
        expected.width = thumbnail.width
        expected.height = thumbnail.height
        const context = expected.getContext('2d')
        const actual = thumbnail.getContext('2d')
        if (context && actual) {
          context.drawImage(active, 0, 0, expected.width, expected.height)
          const expectedPixels = context.getImageData(0, 0, expected.width, expected.height).data
          const actualPixels = actual.getImageData(0, 0, thumbnail.width, thumbnail.height).data
          if (expectedPixels.length === actualPixels.length) {
            let maxChannelDelta = 0
            for (let index = 0; index < actualPixels.length; index += 1) maxChannelDelta = Math.max(maxChannelDelta, Math.abs(actualPixels[index] - expectedPixels[index]))
            if (maxChannelDelta <= 1) return { width: thumbnail.width, height: thumbnail.height, maxChannelDelta }
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    return null
  })
  assert(thumbnailMatch, 'The active filmstrip thumbnail did not update from the final canvas frame after the transform.')
  const rasterSize = await page.locator('.slide-canvas').evaluate((canvas) => {
    const zoom = new DOMMatrix(getComputedStyle(document.querySelector('.slide-plane')).transform).a
    return { width: canvas.width, height: canvas.height, scale: Math.min(4, Math.max(1, window.devicePixelRatio * zoom)) }
  })
  assert(Math.abs(rasterSize.width - Math.round(960 * rasterSize.scale)) <= 1 && Math.abs(rasterSize.height - Math.round(540 * rasterSize.scale)) <= 1, `Final raster scale did not match zoom × DPR: ${JSON.stringify(rasterSize)}`)
  const telemetry = await page.evaluate(() => { window.__folioTransformTelemetry.active = false; window.__folioTransformLongTaskObserver?.disconnect(); return { ...window.__folioTransformTelemetry, gestureInputStartTime: window.__folioGestureInputStart, longTasks: window.__folioTransformLongTasks, reactCommitTimes: window.__folioReactCommitTimes, pointerEventsObserved: window.__folioTransformPointerEvents } })
  const metrics = await page.evaluate(() => window.__folioPerf.snapshot())
  const previewRaster = await page.locator('.move-preview-active').evaluate((node) => ({ width: node.width, height: node.height }))
  const expectedPreviewScale = await page.evaluate(() => {
    const zoom = new DOMMatrix(getComputedStyle(document.querySelector('.slide-plane')).transform).a
    return Math.min(3, Math.min(2, Math.max(1, window.devicePixelRatio)) * zoom)
  })
  assert(Math.abs(previewRaster.width - Math.round(960 * expectedPreviewScale)) <= 1 && Math.abs(previewRaster.height - Math.round(540 * expectedPreviewScale)) <= 1,
    `Transient transform preview raster did not respect its 3x quality cap: ${JSON.stringify({ previewRaster, expectedPreviewScale })}`)
  if (cacheMode === 'cold') {
    const preparations = (metrics['render.movePreview']?.count ?? 0) + (metrics['render.movePreview.prewarm']?.count ?? 0)
    assert(preparations >= 1, `Cold transform did not prepare a Rust preview: ${JSON.stringify({ prepare: metrics['render.movePreview'], prewarm: metrics['render.movePreview.prewarm'] })}`)
  }
  if (cacheMode === 'warm') assert((metrics['render.movePreview.cacheHit']?.count ?? 0) === 1, `Warm transform did not use its prewarmed selected-object raster: ${JSON.stringify(metrics['render.movePreview.cacheHit'])}`)
  const wasmMemoryAfterBytes = await page.evaluate(() => window.__folioTest.memoryBytes())
  const dragRenders = (metrics['render.active']?.count ?? 0) + (metrics['render.overflow']?.count ?? 0)
  const rasterCounts = { active: metrics['render.active']?.count ?? 0, overflow: metrics['render.overflow']?.count ?? 0 }
  const overflowExpected = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => {
    if (shape.hidden) return false
    if (!shape.rect) return true
    const [x, y, rawWidth, rawHeight] = shape.rect
    if (![x, y, rawWidth, rawHeight].every(Number.isFinite)) return true
    const width = Math.abs(rawWidth), height = Math.abs(rawHeight), angle = (shape.rotation ?? 0) * Math.PI / 180
    const extentX = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2
    const extentY = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2
    const centerX = x + rawWidth / 2, centerY = y + rawHeight / 2, inset = 64
    return centerX - extentX < inset || centerY - extentY < inset || centerX + extentX > 960 - inset || centerY + extentY > 540 - inset
  }))
  const overflowVisibility = await page.locator('.slide-overflow').first().evaluate((node) => node.style.visibility)
  assert(overflowVisibility === (overflowExpected ? 'visible' : 'hidden'), `Overflow canvas visibility did not match final slide geometry: ${JSON.stringify({ overflowExpected,overflowVisibility })}`)
  const firstPointerAt = telemetry.events[0]?.time ?? Infinity
  const reactCommits = telemetry.reactCommitTimes.filter((time) => time >= firstPointerAt && (telemetry.pointerUpTime === null || time <= telemetry.pointerUpTime)).length
  assert(telemetry.events.length >= 3, `Expected several real pointermove events, received ${telemetry.events.length}.`)
  const firstPointer = telemetry.events[0]?.time
  const firstMotion = telemetry.events.find((event, index) => index > 0 && (Math.abs(event.x - telemetry.events[0].x) > .5 || Math.abs(event.y - telemetry.events[0].y) > .5))
  const firstMotionTime = firstMotion?.time ?? firstPointer
  const longTasksBeforeFirstMotion = telemetry.longTasks.filter((task) => firstMotionTime !== undefined && task.time + task.duration < firstMotionTime)
  const longTasksDuringDrag = telemetry.longTasks.filter((task) => firstMotionTime !== undefined && task.time >= firstMotionTime && (telemetry.pointerUpTime === null || task.time + task.duration <= telemetry.pointerUpTime))
  const longTasksAtPointerUp = telemetry.longTasks.filter((task) => telemetry.pointerUpTime !== null && task.time <= telemetry.pointerUpTime && task.time + task.duration > telemetry.pointerUpTime)
  const longTasksAfterPointerUp = telemetry.longTasks.filter((task) => telemetry.pointerUpTime !== null && task.time > telemetry.pointerUpTime)
  const motionFrames = telemetry.frames.filter((frame) => firstMotionTime !== undefined && frame.time >= firstMotionTime && (telemetry.pointerUpTime === null || frame.time <= telemetry.pointerUpTime))
  const frameTimes = motionFrames.slice(1).map((entry, index) => entry.time - motionFrames[index].time)
  const instrumentationTimes = motionFrames.map((frame) => frame.instrumentationMs).filter(Number.isFinite)
  const firstVisible = telemetry.frames.find((frame) => frame.pointer && frame.visible && frame.time >= firstMotionTime)?.time
  const pointerFrameLatency = telemetry.events.map((event) => telemetry.frames.find((frame) => frame.visible && frame.time >= event.time)?.time - event.time).filter(Number.isFinite)
  const identity = [1, 0, 0, 1, 0, 0]
  const firstChanged = telemetry.frames.find((frame) => frame.pointer && frame.visible && frame.time >= firstMotionTime && frame.matrix?.some((value, index) => Math.abs(value - identity[index]) > .002))?.time
  assert(firstChanged !== undefined, 'The compositor preview bitmap never transformed during the gesture.')
  assert(rasterCounts.active === 1 && rasterCounts.overflow === Number(overflowExpected), `Final Rust raster calls did not match actual slide overflow: ${JSON.stringify({ rasterCounts,overflowExpected })}`)
  assert(dragRenders === 1 + Number(overflowExpected), `Unexpected full Rust raster count at pointer-up: ${JSON.stringify({ dragRenders,overflowExpected })}`)
  const previewPreparationMs = (metrics['render.movePreview']?.totalMs ?? 0) + (metrics['render.movePreview.prewarm']?.totalMs ?? 0)
  return { geometry, cacheMode, previewRaster, pointerEvents: telemetry.events.length, pointerDownToFirstVisibleFrameMs: telemetry.gestureInputStartTime !== null && firstVisible !== undefined ? +(firstVisible - telemetry.gestureInputStartTime).toFixed(2) : null, firstMotionToVisibleFrameMs: firstMotionTime !== undefined && firstVisible !== undefined ? +(firstVisible - firstMotionTime).toFixed(2) : null, firstMotionToChangedTransformFrameMs: firstMotionTime !== undefined && firstChanged !== undefined ? +(firstChanged - firstMotionTime).toFixed(2) : null, pointerToPreviewFrameMs: { avg: +avg(pointerFrameLatency).toFixed(2), p95: +percentile(pointerFrameLatency, .95).toFixed(2) }, ...(process.env.WP37_TRACE === '1' ? { trace: { firstEvents: telemetry.events.slice(0, 4), firstFrames: telemetry.frames.filter((frame) => frame.pointer).slice(0, 8) } } : {}), avgFrameMs: +avg(frameTimes).toFixed(2), p95FrameMs: +percentile(frameTimes, .95).toFixed(2), telemetryInstrumentationMs: { avg: +avg(instrumentationTimes).toFixed(3), p95: +percentile(instrumentationTimes, .95).toFixed(3) }, dragFullRustRenderCalls: 0, pointerUpFullRustRenderCalls: dragRenders, overflowRasterSkipped: !overflowExpected, reactCommitsDuringDrag: reactCommits, reactRenderDurationMs: { avg: metrics['react.commit.render']?.avgMs ?? 0, p95: metrics['react.commit.render']?.p95Ms ?? 0 }, longTasksBeforeFirstMotion, longTasksDuringDrag, longTasksAtPointerUp, longTasksAfterPointerUp, previewCachePreparationMs: previewPreparationMs, selectionPrewarmMs: prewarmMetrics['render.movePreview.prewarm']?.avgMs ?? 0, warmPreviewCacheHit: (metrics['render.movePreview.cacheHit']?.count ?? 0) > 0, warmPreviewCacheHitCount: metrics['render.movePreview.cacheHit']?.count ?? 0, selectionPrewarmCallsDuringGesture: metrics['render.movePreview.prewarm']?.count ?? 0, pointerUpRasterTimeMs: +((metrics['render.active']?.totalMs ?? 0) + (metrics['render.overflow']?.totalMs ?? 0)).toFixed(2), projectionCalls: metrics['projection.movePreview']?.count ?? 0, projectionMs: { avg: metrics['projection.movePreview']?.avgMs ?? 0, p95: metrics['projection.movePreview']?.p95Ms ?? 0 }, pointerQueueWaitMs: { avg: metrics['pointer.queue.wait']?.avgMs ?? 0, p95: metrics['pointer.queue.wait']?.p95Ms ?? 0 }, pointerHandlerMs: { avg: metrics['pointer.event.handler']?.avgMs ?? 0, p95: metrics['pointer.event.handler']?.p95Ms ?? 0 }, rustPointerAdapterMs: { avg: metrics['pointer.rust.adapter']?.avgMs ?? 0, p95: metrics['pointer.rust.adapter']?.p95Ms ?? 0 }, rustRasterMs: { active: { avg: metrics['render.active']?.avgMs ?? 0, p95: metrics['render.active']?.p95Ms ?? 0 }, overflow: { avg: metrics['render.overflow']?.avgMs ?? 0, p95: metrics['render.overflow']?.p95Ms ?? 0 } }, thumbnailRefresh: { calls: metrics['render.thumbnail']?.count ?? 0, totalMs: metrics['render.thumbnail']?.totalMs ?? 0 }, canvasTransferMs: { activePixelCopy: metrics['canvas.active.pixelCopy']?.totalMs ?? 0, activePutImageData: metrics['canvas.active.putImageData']?.totalMs ?? 0, overflowPixelCopy: metrics['canvas.overflow.pixelCopy']?.totalMs ?? 0, overflowPutImageData: metrics['canvas.overflow.putImageData']?.totalMs ?? 0 }, wasmMemoryBytes: { before: wasmMemoryBeforeBytes, after: wasmMemoryAfterBytes, delta: wasmMemoryAfterBytes - wasmMemoryBeforeBytes } }
}

async function setup(zoom, dpr, label, viewport = { width: 1366, height: 768 }) {
  const context = await browser.newContext({ locale: 'tr-TR', viewport, deviceScaleFactor: dpr })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push({ page: label, message: error.message }))
  page.on('console', (message) => { if (message.type() === 'error') errors.push({ page: label, message: message.text() }) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.evaluate((value) => window.__folioTest.setZoom(value), zoom)
  await page.evaluate(() => window.__folioTest.prepareBlankSlide())
  return { context, page }
}

async function prepareRect(page) {
  const previous = Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
  await page.getByRole('button', { name: 'Araçlar' }).click()
  await page.getByRole('button', { name: 'Dikdörtgen ekle', exact: true }).click()
  await page.locator('.slide-plane--placing-rectangle').waitFor({ state: 'attached' })
  const canvas = await page.locator('.slide-canvas').boundingBox()
  assert(canvas, 'Slide canvas is missing while drawing a rectangle.')
  const zoom = canvas.width / 960
  const [left, top, right, bottom] = zoom > 1.25 ? [420, 230, 540, 310] : [200, 150, 440, 300]
  const start = { x: canvas.x + left * zoom, y: canvas.y + top * zoom }
  const end = { x: canvas.x + right * zoom, y: canvas.y + bottom * zoom }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await moveInSteps(page, start, end.x - start.x, end.y - start.y)
  await page.mouse.up()
  await page.waitForFunction((count) => Number(document.querySelector('.editor-shell').dataset.engineShapes) === count + 1, previous)
  const shape = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0])
  await page.evaluate((id) => window.__folioTest.selectShape(id), shape.id)
  await page.waitForFunction(() => document.querySelectorAll('.engine-selection').length === 1)
  return shape
}

async function waitPreview(page) {
  try { await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'visible', null, { timeout: 5000 }) }
  catch { throw new Error(`Transform preview did not become visible: ${JSON.stringify({ selection: await page.locator('.editor-shell').getAttribute('data-engine-selection'), rotatePointerProbe: await page.evaluate(() => window.__folioRotatePointerProbe), nativePointerDownTarget: await page.evaluate(() => window.__folioNativePointerDownTarget), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), preview: await page.evaluate(() => { const p = window.__folioTest.movePreview(); return p && { active: [p.frame.width, p.frame.height], overflow: [p.overflowFrame.width, p.overflowFrame.height], shapes: p.shapes } }), metrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}`) }
}
async function waitPreviewHidden(page) {
  try { await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'hidden', null, { timeout: 6000 }) }
  catch { throw new Error(`Final transform frame did not replace its preview: ${JSON.stringify({ visibility: await page.locator('.move-preview-active').evaluate((node) => node.style.visibility), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), shapes: await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)), metrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}`) }
}
async function waitProjection(page) {
  try { await page.waitForFunction(() => { const expectedSequence = window.__folioTransformInputSequence ?? 0; return expectedSequence > 0 ? window.__folioTest.movePreview()?.inputSequence === expectedSequence : window.__folioPerf.snapshot()['projection.movePreview']?.count >= 1 }, null, { timeout: 5000 }) }
  catch { throw new Error(`No Rust selected-shape projection arrived: ${JSON.stringify({ telemetry: await page.evaluate(() => ({events:window.__folioTransformTelemetry.events.length,tail:window.__folioTransformTelemetry.events.slice(-3),pointerUpTime:window.__folioTransformTelemetry.pointerUpTime})), events: await page.evaluate(() => window.__folioTransformPointerEvents), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), preview: await page.evaluate(() => { const p = window.__folioTest.movePreview(); return p && p.shapes }), metrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}`) }
}
async function waitFinal(page, id) {
  try { await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'hidden', null, { timeout: 6000 }) }
  catch { throw new Error(`Pointer-up did not reveal final Rust canvas: ${JSON.stringify({ id, preview: await page.locator('.move-preview-active').evaluate((node) => node.style.cssText), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), events: await page.evaluate(() => window.__folioTransformPointerEvents), telemetry: await page.evaluate(() => ({events:window.__folioTransformTelemetry?.events?.length,fallback:window.__folioTransformFallback,up:window.__folioTransformTelemetry?.pointerUpTime})), shape: await readShape(page, id), metrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}`) }
  return readShape(page, id)
}
async function readShape(page, id) { return page.evaluate((shapeId) => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((shape) => shape.id === shapeId), id) }
async function moveInSteps(page, start, dx, dy) { const steps = process.env.WP37_SOAK === '1' ? 60 : 8; for (let index = 1; index <= steps; index++) { await page.mouse.move(start.x + dx * index / steps, start.y + dy * index / steps); await page.waitForTimeout(16) } }
async function undoRedo(page, id, before, after) {
  await page.getByRole('button', { name: 'Geri al' }).click()
  try { await page.waitForFunction(({ shapeId, rect }) => { const value = JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((shape) => shape.id === shapeId)?.rect; return Array.isArray(value) && value.every((item, index) => Math.abs(item - rect[index]) < .1) }, { shapeId: id, rect: before }, { timeout: 5000 }) }
  catch { throw new Error(`Undo did not restore shape ${id}: expected ${JSON.stringify(before)}, got ${JSON.stringify(await readShape(page, id))}`) }
  await page.getByRole('button', { name: 'İleri al' }).click()
  try { await page.waitForFunction(({ shapeId, rect }) => { const value = JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((shape) => shape.id === shapeId)?.rect; return Array.isArray(value) && value.every((item, index) => Math.abs(item - rect[index]) < .1) }, { shapeId: id, rect: after }, { timeout: 5000 }) }
  catch { throw new Error(`Redo did not restore shape ${id}: expected ${JSON.stringify(after)}, got ${JSON.stringify(await readShape(page, id))}`) }
}
async function undoRedoShape(page, id, before, after) {
  const waitForShape = async (label, expected) => {
    try {
      await page.waitForFunction(({ shapeId, shape }) => { const value = JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((item) => item.id === shapeId); return value && value.rect.every((item,index)=>Math.abs(item-shape.rect[index])<.1) && Math.abs((value.rotation??0)-(shape.rotation??0))<.1 && !!value.flipH===!!shape.flipH && !!value.flipV===!!shape.flipV }, { shapeId: id, shape: expected }, { timeout: 5000 })
    } catch {
      throw new Error(`${label} did not restore shape ${id}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(await readShape(page, id))}`)
    }
  }
  await page.getByRole('button', { name: 'Geri al' }).click()
  await waitForShape('Undo', before)
  await page.getByRole('button', { name: 'İleri al' }).click()
  await waitForShape('Redo', after)
}
async function undoRedoMany(page, before, after) {
  const waitForShapes = async (expected) => page.waitForFunction((shapes) => {
    const current = JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)
    return shapes.every((shape) => { const value = current.find((item) => item.id === shape.id); return value && shape.rect.every((n,index) => Math.abs(value.rect[index]-n)<.1) && Math.abs((value.rotation??0)-(shape.rotation??0))<.1 })
  }, expected, { timeout: 5000 })
  await page.getByRole('button', { name: 'Geri al' }).click()
  await waitForShapes(before)
  await page.getByRole('button', { name: 'İleri al' }).click()
  await waitForShapes(after)
}
async function getDragRasterMetrics(page) { const m = await page.evaluate(() => window.__folioPerf.snapshot()); return { active: m['render.active']?.count ?? 0, overflow: m['render.overflow']?.count ?? 0 } }
async function waitForServer(target, process, output) { for (let i = 0; i < 160; i++) { if (process.exitCode !== null) throw new Error(`Vite exited ${process.exitCode}: ${output()}`); try { if ((await fetch(target)).ok) return } catch {} await new Promise((resolve) => setTimeout(resolve, 100)) } throw new Error(`Vite did not start: ${output()}`) }
async function freePort() { const server = createServer(); await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve)); const { port } = server.address(); await new Promise((resolve) => server.close(resolve)); return port }
function assert(condition, message) { if (!condition) throw new Error(message) }
function avg(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function percentile(values, ratio) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] }
function sameGeometry(a, b) { return !!a && !!b && Array.isArray(a.rect) && Array.isArray(b.rect) && a.rect.every((value, index) => Math.abs(value - b.rect[index]) < .1) && Math.abs((a.rotation ?? 0) - (b.rotation ?? 0)) < .1 && !!a.flipH === !!b.flipH && !!a.flipV === !!b.flipV }
function sameRect(a, b) { return !!a && !!b && a.every((value, index) => Math.abs(value - b[index]) < .1) }
function summarize(rows) {
  const measured = rows.filter((row) => typeof row.avgFrameMs === 'number')
  const groups = new Map()
  const transforms = new Map()
  for (const row of measured) {
    const operation = row.name.startsWith('move-') ? 'move' : row.name.startsWith('resize-') ? 'resize' : row.name.startsWith('rotate-') ? 'rotate' : null
    if (operation) {
      const key = `${operation} · ${row.cacheMode}`
      const values = transforms.get(key) ?? []
      values.push(row)
      transforms.set(key, values)
    }
    const match = row.name.match(/z(\d+)-dpr(\d+)-(cold|warm)/)
    if (!match) continue
    const key = `${match[1]}% · DPR ${match[2]} · ${match[3]}`
    const values = groups.get(key) ?? []
    values.push(row)
    groups.set(key, values)
  }
  const aggregate = (values) => ({
    gestures: values.length,
    firstMotionToVisualMs: +avg(values.map((value) => value.firstMotionToChangedTransformFrameMs ?? 0)).toFixed(2),
    pointerToPreviewMs: { avg: +avg(values.map((value) => value.pointerToPreviewFrameMs.avg)).toFixed(2), p95: +percentile(values.map((value) => value.pointerToPreviewFrameMs.p95), .95).toFixed(2) },
    pointerDownToFirstVisibleFrameMs: { avg: +avg(values.map((value) => value.pointerDownToFirstVisibleFrameMs ?? 0)).toFixed(2), p95: +percentile(values.map((value) => value.pointerDownToFirstVisibleFrameMs ?? 0), .95).toFixed(2), max: +Math.max(0, ...values.map((value) => value.pointerDownToFirstVisibleFrameMs ?? 0)).toFixed(2) },
    frameMs: { avg: +avg(values.map((value) => value.avgFrameMs)).toFixed(2), p95: +percentile(values.map((value) => value.p95FrameMs), .95).toFixed(2) },
    telemetryInstrumentationMs: { avg: +avg(values.map((value) => value.telemetryInstrumentationMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.telemetryInstrumentationMs.p95), .95).toFixed(3) },
    pointerHandlerMs: { avg: +avg(values.map((value) => value.pointerHandlerMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.pointerHandlerMs.p95), .95).toFixed(3) },
    rustPointerAdapterMs: { avg: +avg(values.map((value) => value.rustPointerAdapterMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.rustPointerAdapterMs.p95), .95).toFixed(3) },
    projectionMs: { avg: +avg(values.map((value) => value.projectionMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.projectionMs.p95), .95).toFixed(3) },
    pointerQueueWaitMs: { avg: +avg(values.map((value) => value.pointerQueueWaitMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.pointerQueueWaitMs.p95), .95).toFixed(3) },
    rustRasterMs: { active: { avg: +avg(values.map((value) => value.rustRasterMs.active.avg)).toFixed(3), p95: +percentile(values.map((value) => value.rustRasterMs.active.p95), .95).toFixed(3) }, overflow: { avg: +avg(values.map((value) => value.rustRasterMs.overflow.avg)).toFixed(3), p95: +percentile(values.map((value) => value.rustRasterMs.overflow.p95), .95).toFixed(3) } },
    thumbnailRefresh: { calls: values.reduce((sum, value) => sum + value.thumbnailRefresh.calls, 0), totalMs: +values.reduce((sum, value) => sum + value.thumbnailRefresh.totalMs, 0).toFixed(3) },
    wasmMemoryDeltaBytes: { total: values.reduce((sum, value) => sum + value.wasmMemoryBytes.delta, 0), max: Math.max(...values.map((value) => value.wasmMemoryBytes.delta)) },
    canvasTransferMs: Object.fromEntries(['activePixelCopy', 'activePutImageData', 'overflowPixelCopy', 'overflowPutImageData'].map((key) => [key, +values.reduce((sum, value) => sum + value.canvasTransferMs[key], 0).toFixed(3)])),
    react: { commitsAvg: +avg(values.map((value) => value.reactCommitsDuringDrag)).toFixed(2), commitsP95: percentile(values.map((value) => value.reactCommitsDuringDrag), .95), renderDurationMs: { avg: +avg(values.map((value) => value.reactRenderDurationMs.avg)).toFixed(3), p95: +percentile(values.map((value) => value.reactRenderDurationMs.p95), .95).toFixed(3) } },
    maxPointerUpRasterMs: +Math.max(...values.map((value) => value.pointerUpRasterTimeMs)).toFixed(2),
    maxPreviewPreparationMs: +Math.max(...values.map((value) => value.previewCachePreparationMs)).toFixed(2),
    fullRustRendersDuringDrag: values.reduce((sum, value) => sum + value.dragFullRustRenderCalls, 0),
    pointerUpFullRustRenders: values.reduce((sum, value) => sum + value.pointerUpFullRustRenderCalls, 0),
    overflowRastersSkipped: values.filter((value) => value.overflowRasterSkipped).length,
    longTaskCountDuringDrag: values.reduce((sum, value) => sum + value.longTasksDuringDrag.length, 0),
    longTaskCountAtPointerUp: values.reduce((sum, value) => sum + value.longTasksAtPointerUp.length, 0),
    maxLongTaskDuringDragMs: +Math.max(0, ...values.flatMap((value) => value.longTasksDuringDrag.map((task) => task.duration))).toFixed(2),
    maxLongTaskAtPointerUpMs: +Math.max(0, ...values.flatMap((value) => value.longTasksAtPointerUp.map((task) => task.duration))).toFixed(2),
    longTaskCountAfterPointerUp: values.reduce((sum, value) => sum + value.longTasksAfterPointerUp.length, 0),
    maxFinalizationLongTaskMs: +Math.max(0, ...values.flatMap((value) => value.longTasksAfterPointerUp.map((task) => task.duration))).toFixed(2),
  })
  return {
    cases: rows.length,
    performanceGestures: measured.length,
    zoomDprMatrix: Object.fromEntries([...groups].map(([key, values]) => [key, aggregate(values)])),
    transformTypes: Object.fromEntries([...transforms].map(([key, values]) => [key, aggregate(values)])),
    coldWarm: Object.fromEntries(['cold', 'warm'].map((mode) => [mode, aggregate(measured.filter((value) => value.cacheMode === mode))])),
    correctnessCases: rows.filter((value) => !value.avgFrameMs).map((value) => value.name),
  }
}
