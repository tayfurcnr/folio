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
const url = `http://127.0.0.1:${port}/?perf=1&test=1`
const measurements = []
const errors = []
let browser

try {
  await waitForServer(url)
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  for (const dpr of [1, 2]) {
    for (const zoom of [50, 100, 200]) {
      measurements.push(await verifyDrag({ dpr, zoom }))
    }
  }

  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({ status: 'PASS', scenarios: measurements.length, measurements, browserErrors: errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', message: error instanceof Error ? error.message : String(error), serverOutput, measurements, browserErrors: errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function verifyDrag({ dpr, zoom }) {
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1470, height: 900 }, deviceScaleFactor: dpr })
  const page = await context.newPage()
  const label = `dpr${dpr}-zoom${zoom}-1000-shapes`
  page.on('pageerror', (error) => errors.push({ scenario: label, type: 'pageerror', message: error.message }))
  page.on('console', (message) => { if (message.type() === 'error') errors.push({ scenario: label, type: 'console', message: message.text() }) })

  try {
    await page.goto(url)
    await page.waitForFunction(() => window.__folioTest && document.querySelector('.editor-shell')?.dataset.engineReady === 'true', null, { timeout: 30000 })
    await page.evaluate(() => window.__folioTest.seedShapes(997))
    await page.getByRole('button', { name: 'Bileşenler' }).click()
    await page.locator('.component-categories .ui-button').filter({ hasText: 'Şekiller' }).click()
    await page.waitForFunction(() => Number(document.querySelector('.editor-shell').dataset.engineShapes) === 1000)
    await setZoom(page, zoom)

    const target = await page.evaluate(() => window.__folioTest.snapshot().activeSlide.shapes.filter((shape) => shape.rect).at(-1))
    assert(target?.rect, `${label}: inserted Rust shape has no rectangle projection.`)
    const initialRect = [...target.rect]
    const canvas = page.locator('.slide-canvas')
    const bounds = await canvas.boundingBox()
    assert(bounds, `${label}: active canvas is missing.`)
    const start = {
      x: bounds.x + (target.rect[0] + target.rect[2] / 2) * bounds.width / 960,
      y: bounds.y + (target.rect[1] + target.rect[3] / 2) * bounds.height / 540,
    }

    await page.mouse.move(start.x, start.y)
    await page.evaluate(() => {
      window.__folioDragTargets = []
      document.addEventListener('pointermove', (event) => {
        if (event.buttons & 1) window.__folioDragTargets.push(event.target instanceof Element ? event.target.tagName : 'UNKNOWN')
      }, true)
      window.__folioPerf.reset()
    })
    await page.mouse.down()
    await page.waitForTimeout(30)
    for (let step = 1; step <= 18; step += 1) {
      await page.mouse.move(start.x + step * 2, start.y + step, { steps: 1 })
      await page.waitForTimeout(16)
    }
    await page.mouse.up()

    await page.waitForFunction(({ id, rect }) => {
      const shape = window.__folioTest.snapshot().activeSlide.shapes.find((candidate) => candidate.id === id)
      return shape?.rect && (shape.rect[0] !== rect[0] || shape.rect[1] !== rect[1])
    }, { id: target.id, rect: initialRect }, { timeout: 10000 })
    const movedRect = await page.evaluate((id) => window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.id === id).rect, target.id)
    const targetTags = await page.evaluate(() => window.__folioDragTargets)
    const perf = await page.evaluate(() => window.__folioPerf.snapshot())

    assert(targetTags.length >= 12 && targetTags.every((tag) => tag === 'CANVAS'), `${label}: drag pointer left the captured canvas: ${JSON.stringify(targetTags)}`)
    assert((perf['pointer.event.drag']?.count ?? 0) >= 12, `${label}: too few real pointer drag events reached the editor.`)
    assert((perf['render.active']?.count ?? 0) >= 12 && (perf['render.overflow']?.count ?? 0) >= 12, `${label}: Rust active/overflow frame rendering was not measured.`)
    assert((perf['projection.activeSlide']?.count ?? 0) <= 2, `${label}: full document projection ran during drag.`)
    assert((perf['render.thumbnail']?.count ?? 0) <= 1, `${label}: thumbnails rendered repeatedly during drag.`)
    assert((perf['canvas.active.pixelView']?.avgMs ?? Infinity) < 0.1, `${label}: active frame pixel view copied or took too long.`)
    assert((perf['canvas.overflow.pixelView']?.avgMs ?? Infinity) < 0.1, `${label}: overflow frame pixel view copied or took too long.`)
    assert((perf['drag.inputToFrame']?.p95Ms ?? Infinity) < 40, `${label}: p95 pointer-to-canvas-paint exceeded 40 ms.`)

    await page.getByRole('button', { name: 'Geri al' }).click()
    await page.waitForFunction(({ id, rect }) => JSON.stringify(window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.id === id)?.rect) === JSON.stringify(rect), { id: target.id, rect: initialRect })
    await page.getByRole('button', { name: 'İleri al' }).click()
    await page.waitForFunction(({ id, rect }) => JSON.stringify(window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.id === id)?.rect) === JSON.stringify(rect), { id: target.id, rect: movedRect })

    return {
      name: label,
      actualObjectCount: Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes')),
      zoom: Number((await page.locator('.statusbar__zoom > span').textContent()).replace('%', '')),
      dpr,
      pointerEvents: perf['pointer.event.drag']?.count ?? 0,
      pointerHandlerAvgMs: perf['pointer.event.handler']?.avgMs ?? null,
      queueWaitAvgMs: perf['pointer.queue.wait']?.avgMs ?? null,
      rustPointerAvgMs: perf['pointer.rust.adapter']?.avgMs ?? null,
      activeRenderAvgMs: perf['render.active']?.avgMs ?? null,
      overflowRenderAvgMs: perf['render.overflow']?.avgMs ?? null,
      activePixelViewAvgMs: perf['canvas.active.pixelView']?.avgMs ?? null,
      overflowPixelViewAvgMs: perf['canvas.overflow.pixelView']?.avgMs ?? null,
      activePutImageDataAvgMs: perf['canvas.active.putImageData']?.avgMs ?? null,
      overflowPutImageDataAvgMs: perf['canvas.overflow.putImageData']?.avgMs ?? null,
      pointerToCanvasPaintP95Ms: perf['drag.inputToFrame']?.p95Ms ?? null,
      activeProjectionCalls: perf['projection.activeSlide']?.count ?? 0,
      thumbnailCalls: perf['render.thumbnail']?.count ?? 0,
      moveUndoRedo: 'PASS',
      pointerTarget: [...new Set(targetTags)],
    }
  } finally {
    await context.close()
  }
}

async function setZoom(page, targetZoom) {
  let zoom = Number((await page.locator('.statusbar__zoom > span').textContent()).replace('%', ''))
  for (let attempt = 0; zoom !== targetZoom && attempt < 16; attempt += 1) {
    const label = zoom > targetZoom ? 'Uzaklaştır' : 'Yakınlaştır'
    await page.getByRole('button', { name: label }).evaluate((button) => button.click())
    await page.waitForFunction((previous) => Number(document.querySelector('.statusbar__zoom > span').textContent.replace('%', '')) !== previous, zoom)
    zoom = Number((await page.locator('.statusbar__zoom > span').textContent()).replace('%', ''))
  }
  assert(zoom === targetZoom, `Could not set Folio zoom to ${targetZoom}%; current zoom is ${zoom}%.`)
}

async function waitForServer(targetUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Vite exited ${server.exitCode}: ${serverOutput}`)
    try { if ((await fetch(targetUrl)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not start: ${serverOutput}`)
}

async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const port = listener.address().port
  await new Promise((resolve) => listener.close(resolve))
  return port
}

function assert(condition, message) { if (!condition) throw new Error(message) }
