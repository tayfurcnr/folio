import { chromium } from 'playwright'

const atlasUrl = process.env.ATLAS_URL
if (!atlasUrl) throw new Error('Set ATLAS_URL to a fresh local ATLAS dev-server URL. This test uses a temporary Chromium profile.')
const browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

try {
  await page.addInitScript(() => {
    window.__atlasScanBounds = (canvas, region = null) => {
      const context = canvas.getContext('2d')
      const x0 = region ? Math.max(0, Math.floor(region.x)) : 0
      const y0 = region ? Math.max(0, Math.floor(region.y)) : 0
      const width = region ? Math.min(canvas.width - x0, Math.ceil(region.width)) : canvas.width
      const height = region ? Math.min(canvas.height - y0, Math.ceil(region.height)) : canvas.height
      const { data } = context.getImageData(x0, y0, width, height)
      let left = width, top = height, right = -1, bottom = -1
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        if (data[offset + 3] > 0 && (data[offset] < 245 || data[offset + 1] < 245 || data[offset + 2] < 245)) {
          left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
        }
      }
      return right < 0 ? null : { left: x0 + left, top: y0 + top, width: right - left + 1, height: bottom - top + 1 }
    }
    window.__atlasLongTasks = []
    try { new PerformanceObserver((list) => window.__atlasLongTasks.push(...list.getEntries().map((entry) => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true }) } catch { /* Long Task API is optional. */ }
  })
  await page.goto(atlasUrl)
  await page.waitForSelector('[data-role="canvas"]', { timeout: 20000 })
  await page.locator('details.insert-tool-accordion > summary').filter({ hasText: 'Şekiller' }).last().click()
  const rectangle = page.locator('button[aria-label="Rectangle"]:visible').first()
  await rectangle.click()
  const canvas = page.locator('[data-role="canvas"]')
  const canvasBox = await canvas.boundingBox()
  if (!canvasBox) throw new Error('ATLAS canvas is not visible.')
  const drawStart = { x: canvasBox.x + 130, y: canvasBox.y + 110 }
  await page.mouse.move(drawStart.x, drawStart.y)
  await page.mouse.down()
  await page.mouse.move(drawStart.x + 230, drawStart.y + 130, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const objectRegion = { x: 100, y: 80, width: 440, height: 340 }
  const created = await canvas.evaluate((node, region) => window.__atlasScanBounds(node, region), objectRegion)
  if (!created || created.width < 20 || created.height < 20) throw new Error(`ATLAS Rectangle tool did not create visible content: ${JSON.stringify({ created, errors })}`)

  const selectPoint = { x: canvasBox.x + created.left + created.width / 2, y: canvasBox.y + created.top + created.height / 2 }
  await page.mouse.click(selectPoint.x, selectPoint.y)
  const initial = await canvas.evaluate((node, region) => window.__atlasScanBounds(node, region), objectRegion)
  if (!initial) throw new Error('Could not find the ATLAS rectangle after selection.')
  const dragStart = { x: canvasBox.x + initial.left + initial.width / 2, y: canvasBox.y + initial.top + initial.height / 2 }

  await page.evaluate(({ region }) => {
    const canvas = document.querySelector('[data-role="canvas"]')
    window.__atlasDragSamples = []
    window.__atlasPointerEvents = []
    window.__atlasDragActive = true
    window.__atlasDragStartedAt = performance.now()
    window.__atlasDragEndedAt = null
    canvas.addEventListener('pointermove', (event) => { if (event.buttons === 1) window.__atlasPointerEvents.push({ x: event.clientX, y: event.clientY, time: performance.now() }) }, { capture: true })
    const tick = (time) => {
      if (!window.__atlasDragActive) return
      const scanStarted = performance.now()
      const bounds = window.__atlasScanBounds(canvas, region)
      const scanMs = performance.now() - scanStarted
      const lastPointer = window.__atlasPointerEvents.at(-1) ?? null
      window.__atlasDragSamples.push({ time, bounds, scanMs, pointer: lastPointer })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, { region: objectRegion })
  await page.mouse.move(dragStart.x, dragStart.y)
  await page.mouse.down()
  const steps = 12
  const move = { x: 96, y: 60 }
  for (let index = 1; index <= steps; index++) {
    await page.mouse.move(dragStart.x + move.x * index / steps, dragStart.y + move.y * index / steps)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.evaluate(() => { window.__atlasDragEndedAt = performance.now() })
  await page.waitForTimeout(100)
  const capture = await page.evaluate(() => { window.__atlasDragActive = false; return { samples: window.__atlasDragSamples, events: window.__atlasPointerEvents } })
  const finalBounds = await canvas.evaluate((node, region) => window.__atlasScanBounds(node, region), objectRegion)
  const visual = capture.samples.filter((sample) => sample.bounds && sample.pointer)
  const lag = visual.map((sample) => Math.hypot(sample.pointer.x - dragStart.x - (sample.bounds.left - initial.left), sample.pointer.y - dragStart.y - (sample.bounds.top - initial.top)))
  const changedAt = capture.samples.find((sample) => sample.pointer && sample.bounds && (Math.abs(sample.bounds.left - initial.left) > 1 || Math.abs(sample.bounds.top - initial.top) > 1))?.time
  const firstMoveAt = capture.events[0]?.time
  const frameTimes = capture.samples.slice(1).map((sample, index) => sample.time - capture.samples[index].time)
  const dragTiming = await page.evaluate(() => ({ start: window.__atlasDragStartedAt, end: window.__atlasDragEndedAt }))
  const longTasks = (await page.evaluate(() => window.__atlasLongTasks ?? [])).filter((task) => task.startTime >= dragTiming.start && task.startTime <= dragTiming.end)
  const result = {
    status: 'PASS',
    visibleChromium: false,
    browser: await page.evaluate(() => navigator.userAgent),
    devicePixelRatio: await page.evaluate(() => devicePixelRatio),
    canvas: { width: 950, height: 530 },
    measuredPixels: { afterCreation: created, beforeDrag: initial, afterDrag: finalBounds, objectOnlyRegion: objectRegion },
    pointerMoves: capture.events.length,
    firstPointerToChangedCanvasMs: firstMoveAt !== undefined && changedAt !== undefined ? +(changedAt - firstMoveAt).toFixed(2) : null,
    pointerToVisualLagPx: { avg: round(avg(lag)), p95: round(percentile(lag, 0.95)), max: round(Math.max(0, ...lag)), instrumentation:'bounded object-region canvas readback; scan time is included in this visible-browser measurement' },
    frameTimeMs: { avg: round(avg(frameTimes)), p95: round(percentile(frameTimes, 0.95)), lateOver20ms: frameTimes.filter((time) => time > 20).length },
    canvasPixelScanMs: { avg: round(avg(visual.map((sample) => sample.scanMs))), p95: round(percentile(visual.map((sample) => sample.scanMs), 0.95)), regionPixels: objectRegion.width * objectRegion.height },
    mainThreadLongTasksDuringDrag: longTasks,
    sampleCount: capture.samples.length,
    errors,
  }
  console.log(JSON.stringify(result, null, 2))
  if (errors.length) process.exitCode = 1
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', message: error instanceof Error ? error.message : String(error), errors }, null, 2))
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

function round(value) { return Number.isFinite(value) ? +value.toFixed(2) : null }
function avg(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN }
function percentile(values, ratio) { if (!values.length) return NaN; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] }
