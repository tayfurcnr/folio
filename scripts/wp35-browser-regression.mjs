import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const port = await freePort()
const viteCli = new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname
const server = spawn(process.execPath, [viteCli, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: `${root}/apps/editor`, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
const baseUrl = `http://127.0.0.1:${port}/?perf=1&test=1`
const errors = []
const measurements = []
let browser
let activeTestStep = 'startup'

try {
  await waitForServer(baseUrl, server, () => serverOutput)
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  if (process.env.WP35_SKIP_INTERACTIONS !== '1') await verifyInteractionAndLibrary()
  if (process.env.WP35_SKIP_PERF !== '1') await verifyPerformanceMatrix()
  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({ status: 'PASS', scenarios: measurements.length, measurements, browserErrors: errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step: activeTestStep, message: error instanceof Error ? error.message : String(error), serverOutput, measurements, browserErrors: errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function verifyInteractionAndLibrary() {
  activeTestStep = 'browser UI interaction'
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  watchErrors(page, 'ui')
  await page.goto(baseUrl)
  await ready(page)
  await page.evaluate(() => window.__folioTest.prepareBlankSlide())
  await createRect(page)
  await selectLastShape(page)

  activeTestStep = 'resize undo redo'
  const beforeResize = await getProjection(page)
  const resizeHandle = page.locator('.engine-selection__handle--se').last()
  const resizeHandleBox = await resizeHandle.boundingBox()
  const resizeDebug = await page.evaluate(() => { const canvas = document.querySelector('.slide-canvas').getBoundingClientRect(); const handle = document.querySelectorAll('.engine-selection__handle--se'); const box = handle[handle.length - 1].getBoundingClientRect(); const selection = handle[handle.length - 1].parentElement.getBoundingClientRect(); return {canvas: {left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height}, handle: {left: box.left, top: box.top, width: box.width, height: box.height}, selection: {left: selection.left, top: selection.top, width: selection.width, height: selection.height}, logical: [(box.left + box.width / 2 - canvas.left) / canvas.width * 960, (box.top + box.height / 2 - canvas.top) / canvas.height * 540] } })
  await page.evaluate(() => { window.__pointerDownLog = []; window.addEventListener('pointerdown', (event) => window.__pointerDownLog.push({target: event.target?.className, current: event.currentTarget?.constructor?.name, buttons: event.buttons}), true) })
  await dragHandle(page, resizeHandle, 34, 24)
  const resized = await getProjection(page)
  assert(resized.rect[2] > beforeResize.rect[2] && resized.rect[3] > beforeResize.rect[3], `Rust Session resize projection did not grow: ${JSON.stringify({ before: beforeResize.rect, after: resized.rect, handle: resizeHandleBox, resizeDebug, pointerDownLog: await page.evaluate(() => window.__pointerDownLog), zoom: await page.locator('.statusbar__zoom > span').textContent(), lastPointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), rustSelection: await page.evaluate(() => window.__folioTest.snapshot().selection), pointerMetrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}.`)
  activeTestStep = 'resize undo'
  await clickEnabled(page, 'Geri al')
  const resizeUndo = await getProjection(page)
  assert(JSON.stringify(resizeUndo.rect) === JSON.stringify(beforeResize.rect), 'One Undo did not restore the resize geometry.')
  activeTestStep = 'resize redo'
  await clickEnabled(page, 'İleri al')
  const resizeRedo = await getProjection(page)
  assert(JSON.stringify(resizeRedo.rect) === JSON.stringify(resized.rect), 'Redo did not restore the resized geometry.')
  measurements.push({ name: 'resize-undo-redo', before: beforeResize.rect, resized: resized.rect, afterOneUndo: resizeUndo.rect, afterRedo: resizeRedo.rect })
  const beforeRotate = await getProjection(page)
  await page.evaluate((id) => window.__folioTest.selectShape(id), beforeRotate.id)
  await page.locator('.engine-selection__rotate').waitFor({ state: 'visible' })
  const rotateHandle = page.locator('.engine-selection__rotate').last()
  activeTestStep = 'rotation drag'
  await dragHandle(page, rotateHandle, 60, 0)
  const rotated = await getProjection(page)
  assert(Math.abs(rotated.rotation ?? 0) > 2, 'Rust Session rotation was not applied by the rotate handle.')
  activeTestStep = 'rotation undo'
  await clickEnabled(page, 'Geri al')
  const rotationUndo = await getProjection(page)
  assert(Math.abs((rotationUndo.rotation ?? 0) - (beforeRotate.rotation ?? 0)) < 0.01, 'One Undo did not restore rotation.')
  activeTestStep = 'rotation redo'
  await clickEnabled(page, 'İleri al')
  const rotationRedo = await getProjection(page)
  assert(Math.abs((rotationRedo.rotation ?? 0) - (rotated.rotation ?? 0)) < 0.01, 'Redo did not restore the rotated geometry.')
  measurements.push({ name: 'rotate-undo-redo', before: beforeRotate.rotation ?? 0, rotated: rotated.rotation, afterOneUndo: rotationUndo.rotation ?? 0, afterRedo: rotationRedo.rotation ?? 0 })
  await clickEnabled(page, 'Geri al')
  await selectLastShape(page)

  activeTestStep = 'grid and snap'
  await page.getByRole('button', { name: 'Görünüm' }).click()
  await page.getByRole('switch', { name: 'Izgara', exact: true }).click()
  assert(await page.locator('.canvas-grid').count() === 1, 'Grid overlay did not turn on.')
  await page.getByRole('switch', { name: 'Izgaraya yasla' }).click()
  const gridSnapChecked = await page.getByRole('switch', { name: 'Izgaraya yasla' }).getAttribute('aria-checked')
  assert(gridSnapChecked === 'true', 'Grid snap switch did not become active.')
  await page.keyboard.press('Escape')
  const shapeBeforeSnap = await getProjection(page)
  const canvas = page.locator('.slide-canvas')
  const canvasBox = await canvas.boundingBox()
  assert(canvasBox, 'Canvas has no bounds.')
  const moveControl = page.locator('.engine-selection__move').last()
  const moveControlBox = await moveControl.boundingBox()
  assert(moveControlBox, 'Selected shape move control is missing.')
  const start = { x: moveControlBox.x + moveControlBox.width / 2, y: moveControlBox.y + moveControlBox.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.waitForTimeout(40)
  await page.mouse.move(start.x + 37, start.y + 23, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('.engine-selection'))
  const snapped = await getProjection(page)
  assert(Math.abs(snapped.rect[0] / 20 - Math.round(snapped.rect[0] / 20)) * 20 <= 6 && Math.abs(snapped.rect[1] / 20 - Math.round(snapped.rect[1] / 20)) * 20 <= 6, `Session move did not snap to the 20-unit grid: ${JSON.stringify({before: shapeBeforeSnap.rect, rect: snapped.rect, selection: await page.evaluate(() => window.__folioTest.snapshot().selection), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), snap: await page.evaluate(() => window.__folioLastSnap)})}`)
  measurements.push({ name: 'grid-snap', before: shapeBeforeSnap.rect, after: snapped.rect, gridVisible: await page.locator('.canvas-grid').count() === 1, snapSwitch: gridSnapChecked })

  const hand = page.getByRole('button', { name: 'El aracı' })
  activeTestStep = 'hand tool state'
  await hand.click()
  assert(await hand.getAttribute('aria-pressed') === 'true', 'Hand tool did not enter active state.')
  assert(await canvas.evaluate((node) => getComputedStyle(node).cursor) === 'grab', 'Hand tool cursor is not grab.')
  activeTestStep = 'hand tool pan'
  const planeBefore = await page.locator('.slide-plane').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41)
  const panPoint = { x: canvasBox.x + 40, y: canvasBox.y + 40 }
  await page.mouse.move(panPoint.x, panPoint.y)
  await page.mouse.down()
  assert(await canvas.evaluate((node) => getComputedStyle(node).cursor) === 'grabbing', 'Pan cursor did not change to grabbing.')
  await page.mouse.move(panPoint.x + 45, panPoint.y + 28, { steps: 6 })
  await page.mouse.up()
  try { await page.waitForFunction((before) => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('.slide-plane')).transform).m41 - before) > 20, planeBefore, { timeout: 3000 }) }
  catch { throw new Error(`Hand tool did not pan the workspace: ${JSON.stringify({before: planeBefore, after: await page.locator('.slide-plane').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult())})}`) }
  measurements.push({ name: 'hand-pan', active: await hand.getAttribute('aria-pressed'), cursorWhileDragging: 'grabbing', before: planeBefore, after: await page.locator('.slide-plane').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m41) })
  await hand.click()
  assert(await hand.getAttribute('aria-pressed') === 'false', 'Hand tool did not return to selection mode.')

  activeTestStep = 'fit toast'
  await page.getByRole('button', { name: 'Ekrana sığdır' }).click()
  assert(await page.locator('.statusbar__feedback').isVisible(), 'Fit toast was not shown.')
  await page.waitForTimeout(3000)
  assert(await page.locator('.statusbar__feedback').count() === 0, 'Fit toast did not dismiss automatically.')
  measurements.push({ name: 'fit-toast', visibleOnFit: true, autoDismissMs: 2800 })

  activeTestStep = 'text caret and keyboard editing'
  await page.evaluate(() => window.__folioTest.insertTextBox())
  const textInput = page.getByRole('textbox', { name: 'Slayt metnini düzenle' })
  await textInput.waitFor({ state: 'visible' })
  await page.keyboard.type('Folio')
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => shape.text === 'Folio'))
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('!')
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => shape.text === 'Foli!o'))
  measurements.push({ name: 'text-caret-keyboard', afterTyping: 'Folio', afterCaretLeftInsert: 'Foli!o', source: 'Rust Session projection' })

  activeTestStep = 'media library persistence and reuse'
  await page.getByRole('button', { name: 'Kütüphane' }).click()
  const png = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 4; const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas 2D is unavailable.'); context.fillStyle = '#ff6f3c'; context.fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png').split(',')[1] }), 'base64')
  activeTestStep = 'add library image'
  await addFile(page, 'sample.png', 'image/png', png)
  activeTestStep = 'library image deduplication'
  await addFile(page, 'sample.png', 'image/png', png)
  assert(await page.locator('.library-assets__item').count() === 1, 'Identical media produced duplicate library entries.')
  activeTestStep = 'add library audio'
  await addFile(page, 'quiet.wav', 'audio/wav', makeWav())
  activeTestStep = 'add library video'
  await addFile(page, 'clip.mp4', 'video/mp4', makeMp4Header())
  activeTestStep = 'verify image/audio/video library entries'
  assert(await page.locator('.library-assets__item').count() === 3, 'Audio/video assets were not persisted in the Library.')
  activeTestStep = 'reload persisted library'
  await page.reload()
  await ready(page)
  await page.getByRole('button', { name: 'Kütüphane' }).click()
  assert(await page.locator('.library-assets__item').count() === 3, 'IndexedDB Library contents did not survive reload.')
  activeTestStep = 'reuse stored library image'
  const shapeCount = Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
  await page.locator('.library-assets__item').filter({ hasText: 'sample.png' }).getByRole('button', { name: 'Ekle' }).click()
  try { await page.waitForFunction((count) => Number(document.querySelector('.editor-shell').dataset.engineShapes) === count + 1, shapeCount, { timeout: 5000 }) }
  catch { throw new Error(`Stored image could not be inserted into the Rust Session: ${JSON.stringify({before: shapeCount, after: await page.locator('.editor-shell').getAttribute('data-engine-shapes'), error: await page.locator('.library-panel__error').allTextContents(), revision: await page.locator('.editor-shell').getAttribute('data-engine-revision')})}`) }
  const countWithImage = Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
  await page.getByRole('button', { name: 'sample.png dosyasını kütüphaneden kaldır' }).click()
  await page.waitForFunction(() => document.querySelectorAll('.library-assets__item').length === 2)
  assert(Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes')) === countWithImage, 'Removing a Library entry damaged its embedded Session media shape.')
  measurements.push({ name: 'media-library', storedItems: 3, reloadedItems: 3, shapeCountAfterImageInsert: countWithImage, shapeCountAfterLibraryDelete: Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes')), deduplicated: true })
  await context.close()
}

async function verifyPerformanceMatrix() {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
    for (const dpr of [1, 2]) {
      const context = await browser.newContext({ locale: 'tr-TR', viewport, deviceScaleFactor: dpr })
      const page = await context.newPage()
      watchErrors(page, `${viewport.width}x${viewport.height}-dpr${dpr}`)
      await page.goto(baseUrl)
      await ready(page)
      await page.evaluate(() => window.__folioTest.prepareBlankSlide())
      await createRect(page)
      await selectLastShape(page, true)
      for (const zoom of [50, 100, 200]) {
        activeTestStep = `normal drag ${viewport.width}x${viewport.height} dpr${dpr} zoom${zoom}`
        await setZoom(page, zoom)
        const result = await measureDrag(page, `normal-${viewport.width}x${viewport.height}-dpr${dpr}-z${zoom}`, 14)
        assert(result.renderActiveCalls === 1, `${result.name}: expected one final Rust slide raster, got ${result.renderActiveCalls}: ${JSON.stringify(result)}`)
        assert(result.renderOverflowCalls === 0, `${result.name}: in-bounds shape should skip overflow raster.`)
        assert(result.overflowWidth === null && result.overflowHeight === null, `${result.name}: stale overflow bitmap remained for in-bounds geometry.`)
        measurements.push(result)
      }
      await context.close()
    }
  }

  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: dpr })
    const page = await context.newPage()
    watchErrors(page, `large-dpr${dpr}`)
    await page.goto(baseUrl)
    await ready(page)
    await page.evaluate(() => window.__folioTest.prepareBlankSlide())
    for (const count of [100, 500, 1000]) {
      activeTestStep = `large drag ${count} objects dpr${dpr}`
      await page.evaluate((shapes) => window.__folioTest.seedShapes(shapes), count - 1)
      await createRect(page)
      await selectLastShape(page, true)
      await setZoom(page, 100)
      const result = await measureDrag(page, `objects-${count}-dpr${dpr}-z100`, 22)
      const geometry = await getProjection(page)
      await clickEnabled(page, 'Geri al')
      const undone = await getProjection(page)
      await clickEnabled(page, 'İleri al')
      const redone = await getProjection(page)
      assert(JSON.stringify(undone.rect) !== JSON.stringify(geometry.rect) && JSON.stringify(redone.rect) === JSON.stringify(geometry.rect), `Large scene ${count} Undo/Redo failed.`)
      result.undoRedo = 'PASS'
      result.objects = Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
      result.wasmMemoryBytes = await page.evaluate(() => window.__folioTest.memoryBytes())
      measurements.push(result)
      await page.evaluate(() => window.__folioTest.reset())
      await page.waitForFunction(() => Number(document.querySelector('.editor-shell').dataset.engineShapes) === 0)
    }
    await context.close()
  }
}

async function measureDrag(page, name, delta) {
  const main = page.locator('.editor-shell')
  const projectionBefore = await getProjection(page)
  const box = await page.locator('.slide-canvas').boundingBox()
  assert(box, 'Canvas has no bounds during performance run.')
  const moveControl = await page.locator('.engine-selection__move').last().boundingBox()
  assert(moveControl, `${name}: selected shape move control is missing.`)
  const start = { x: moveControl.x + moveControl.width / 2, y: moveControl.y + moveControl.height / 2 }
  await page.evaluate(() => window.__folioPerf.reset())
  await page.evaluate(() => { window.__folioFrames = []; window.__folioFrameActive = true; let last = performance.now(); const tick = (now) => { if (!window.__folioFrameActive) return; window.__folioFrames.push(now - last); last = now; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + delta, start.y + delta / 2, { steps: 22 })
  await page.mouse.up()
  await page.waitForTimeout(180)
  const result = await page.evaluate(async (label) => {
    window.__folioFrameActive = false
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const samples = window.__folioFrames.filter((sample) => sample > 0).sort((a, b) => a - b)
    const elapsed = samples.reduce((sum, sample) => sum + sample, 0)
    const profiler = window.__folioPerf.snapshot()
    return {
      name: label,
      fps: +(samples.length * 1000 / elapsed).toFixed(1),
      avgFrameMs: +(elapsed / Math.max(1, samples.length)).toFixed(2),
      p95FrameMs: +(samples[Math.max(0, Math.ceil(samples.length * 0.95) - 1)] ?? 0).toFixed(2),
      lateFrames: samples.filter((sample) => sample > 25).length,
      overflowWidth: window.__folioTest.snapshot().activeOverflowFrame?.width ?? null,
      overflowHeight: window.__folioTest.snapshot().activeOverflowFrame?.height ?? null,
      pointerToPaintMs: profiler['drag.inputToFrame']?.avgMs ?? null,
      renderActiveCalls: profiler['render.active']?.count ?? 0,
      renderOverflowCalls: profiler['render.overflow']?.count ?? 0,
      thumbnailCalls: profiler['render.thumbnail']?.count ?? 0,
      activeProjectionCalls: profiler['projection.activeSlide']?.count ?? 0,
      reactCommits: profiler['react.commit.render']?.count ?? 0,
      wasmMemoryBytes: await window.__folioTest.memoryBytes(),
      objectCount: Number(document.querySelector('.editor-shell').dataset.engineShapes),
    }
  }, name)
  const projectionAfter = await getProjection(page)
  assert(projectionAfter.rect[0] !== projectionBefore.rect[0] || projectionAfter.rect[1] !== projectionBefore.rect[1], `${name}: shape did not move in Rust projection.`)
  // Compositor previews avoid full Rust rasters during the drag; finalization rasterizes the slide.
  assert(result.renderActiveCalls > 0, `${name}: final Rust slide raster was not measured.`)
  return result
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true' && window.__folioTest && window.__folioPerf, null, { timeout: 30000 })
}

async function createRect(page) {
  const count = Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
  if (await page.getByRole('button', { name: 'Araçlar' }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: 'Araçlar' }).click()
  await page.getByRole('button', { name: 'Dikdörtgen', exact: true }).click()
  await page.waitForFunction((before) => Number(document.querySelector('.editor-shell').dataset.engineShapes) === before + 1, count)
}

async function selectLastShape(page, direct = false) {
  const shape = await getProjection(page)
  if (direct) {
    await page.evaluate((id) => window.__folioTest.selectShape(id), shape.id)
    await page.waitForFunction(() => !!document.querySelector('.engine-selection') && !window.__folioTest.snapshot().selection?.textSelection)
    return
  }
  const box = await page.locator('.slide-canvas').boundingBox()
  assert(box, 'Canvas has no bounds during selection.')
  await page.mouse.click(box.x + (shape.rect[0] + shape.rect[2] / 2) * box.width / 960, box.y + (shape.rect[1] + shape.rect[3] / 2) * box.height / 540)
  try { await page.waitForFunction(() => !!document.querySelector('.engine-selection'), null, {timeout: 3000}) } catch { throw new Error(`Selection UI did not appear after click: ${JSON.stringify({projection: await page.locator('.editor-shell').getAttribute('data-engine-projection'), selection: await page.locator('.editor-shell').getAttribute('data-engine-selection'), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), snap: await page.evaluate(() => window.__folioLastSnap), canvas: await page.locator('.slide-canvas').boundingBox()})}`) }
}

async function dragHandle(page, handle, dx, dy) {
  const box = await handle.boundingBox()
  assert(box, 'Expected selection handle is not visible.')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 12 })
  await page.mouse.up()
  try { await page.waitForFunction(() => !!document.querySelector('.engine-selection'), null, { timeout: 3000 }) } catch { throw new Error(`Selection UI disappeared after handle drag: ${JSON.stringify({ handle: await handle.getAttribute('class'), selection: await page.locator('.editor-shell').getAttribute('data-engine-selection'), projection: await page.locator('.editor-shell').getAttribute('data-engine-projection'), pointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), snap: await page.evaluate(() => window.__folioLastSnap), metrics: await page.evaluate(() => window.__folioPerf.snapshot()) })}`) }
}

async function setZoom(page, zoom) {
  await page.evaluate((value) => window.__folioTest.setZoom(value), zoom)
  await page.waitForTimeout(120)
  const current = Number((await page.locator('.statusbar__zoom > span').textContent()).replace('%', ''))
  assert(current === zoom, `Test zoom setter did not reach ${zoom}%; current zoom is ${current}%.`)
}

async function clickEnabled(page, label) {
  const button = page.getByRole('button', { name: label })
  await button.waitFor({ state: 'visible' })
  await page.waitForFunction((name) => !document.querySelector(`button[aria-label="${name}"]`)?.disabled, label)
  await button.click()
  await page.waitForTimeout(100)
}

function getProjection(page) {
  return page.locator('.editor-shell').getAttribute('data-engine-projection').then((json) => {
    const shapes = JSON.parse(json)
    const shape = shapes.at(-1)
    assert(shape?.rect, 'Rust shape projection is missing geometry.')
    return shape
  })
}

async function addFile(page, name, mimeType, buffer) {
  activeTestStep = `choose library file ${name}`
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Dosya ekle' }).click()
  await (await chooser).setFiles({ name, mimeType, buffer })
  activeTestStep = `persist library file ${name}`
  try { await page.waitForFunction((filename) => [...document.querySelectorAll('.library-assets__item strong')].some((item) => item.textContent === filename), name, { timeout: 5000 }) }
  catch { throw new Error(`Library file did not render: ${JSON.stringify({name, items: await page.locator('.library-assets__item strong').allTextContents(), error: await page.locator('.library-panel__error').count() ? await page.locator('.library-panel__error').allTextContents() : [], files: await page.evaluate(async () => (await indexedDB.databases()).map(({name}) => name))})}`) }
}

function makeWav() {
  const wav = Buffer.alloc(52)
  wav.write('RIFF', 0); wav.writeUInt32LE(44, 4); wav.write('WAVE', 8); wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(8, 40)
  return wav
}

function makeMp4Header() {
  const bytes = Buffer.alloc(24)
  bytes.writeUInt32BE(16, 0); bytes.write('ftyp', 4); bytes.write('isom', 8); bytes.writeUInt32BE(0, 12); bytes.write('isom', 16); bytes.write('mp42', 20)
  return bytes
}

function watchErrors(page, label) {
  page.on('pageerror', (error) => errors.push({ page: label, type: 'pageerror', message: error.message }))
  page.on('console', (message) => { if (message.type() === 'error') errors.push({ page: label, type: 'console', message: message.text() }) })
  page.on('requestfailed', (request) => errors.push({ page: label, type: 'requestfailed', url: request.url(), message: request.failure()?.errorText }))
}

async function waitForServer(url, process, output) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.exitCode !== null) throw new Error(`Vite exited ${process.exitCode}: ${output()}`)
    try { const response = await fetch(url); if (response.ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not start: ${output()}`)
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

function assert(condition, message) { if (!condition) throw new Error(message) }
  activeTestStep = 'rotate undo redo'
  activeTestStep = 'grid and snap'
  activeTestStep = 'pan interaction'
  activeTestStep = 'fit toast'
  activeTestStep = 'media library persistence and reuse'
