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
const errors = []
const results = []
let browser
let step = 'startup'

try {
  await waitForServer(url, server, () => serverOutput)
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const onlyMulti = process.env.WP36_ONLY_MULTI === '1'
  const onlyText = process.env.WP36_ONLY_TEXT === '1'
  const isolated = onlyMulti || onlyText || !!process.env.WP36_ONLY_CASE
  if (!onlyMulti && !onlyText) {
    const cases = process.env.WP36_MATRIX === '1' ? [[50, 1], [100, 1], [200, 1], [50, 2], [100, 2], [200, 2], [50, 4], [100, 4], [200, 4]] : [[50, 1], [100, 1], [200, 2], [100, 4]]
    const selectedCases = process.env.WP36_ONLY_CASE ? cases.filter(([zoom, dpr]) => `${zoom}-${dpr}` === process.env.WP36_ONLY_CASE) : cases
    for (const [zoom, dpr] of selectedCases) {
      step = `single selection zoom ${zoom} dpr ${dpr}`
      results.push(await testSingleMove(zoom, dpr))
    }
  }
  if (!isolated || onlyMulti) {
    step = 'multi-selection'
    results.push(await testMultiMove())
  }
  if (!isolated || onlyText) {
    step = 'text-frame move'
    results.push(await testTextFrameMove())
  }
  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({ status: 'PASS', visibleChromium: false, results, errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error), serverOutput, results, errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function testSingleMove(zoom, dpr) {
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr })
  const page = await context.newPage()
  watchErrors(page, `single-z${zoom}-dpr${dpr}`)
  await page.goto(url)
  await ready(page)
  await page.evaluate(() => window.__folioTest.prepareBlankSlide())
  await createRect(page)
  await page.evaluate((value) => window.__folioTest.setZoom(value), zoom)
  await page.waitForTimeout(100)
  await selectFirst(page)
  await page.waitForTimeout(100)
  const before = await readShape(page, 0)
  const canvas = page.locator('.slide-canvas')
  const box = await canvas.boundingBox()
  assert(box, 'Slide canvas has no bounds.')
  const factor = box.width / 960
  const start = { x: box.x + (before.rect[0] + before.rect[2] / 2) * factor, y: box.y + (before.rect[1] + before.rect[3] / 2) * factor }
  const oldPositionSamples = await canvas.evaluate((node, rect) => {
    const c = node
    const ctx = c.getContext('2d')
    const points = [.2, .5, .8].flatMap((x) => [.2, .5, .8].map((y) => [rect[0] + rect[2] * x, rect[1] + rect[3] * y]))
    const samples = points.map(([x, y]) => [...ctx.getImageData(Math.round(x / 960 * c.width), Math.round(y / 540 * c.height), 1, 1).data])
    return { width:c.width, height:c.height, points, samples }
  }, before.rect)

  const prewarmMetrics = await page.evaluate(() => window.__folioPerf.snapshot())
  await page.evaluate(() => {
    window.__folioDragTelemetry = { events: [], frames: [], active: true }
    window.__folioDragLongTasks = []
    window.__folioDragStartedAt = performance.now()
    try { new PerformanceObserver((list) => window.__folioDragLongTasks.push(...list.getEntries().map((entry) => ({ startTime:entry.startTime,duration:entry.duration,attribution:Array.from(entry.attribution??[]).map((item)=>({name:item.name,containerType:item.containerType,containerName:item.containerName,containerId:item.containerId,src:item.src,lineNumber:item.lineNumber,columnNumber:item.columnNumber})) })))).observe({ type:'longtask',buffered:true }) } catch { /* Long Task API is optional. */ }
    const canvas = document.querySelector('.slide-plane')
    canvas.addEventListener('pointerup', () => { window.__folioPointerUpAt = performance.now() }, { capture:true, once:true })
    canvas.addEventListener('pointermove', (event) => {
      if (event.buttons === 1) window.__folioDragTelemetry.events.push({ x: event.clientX, y: event.clientY, time: performance.now() })
    }, { capture: true })
    const tick = (time) => {
      if (!window.__folioDragTelemetry.active) return
      const preview = document.querySelector('.move-preview-active')
      const matrix = preview ? new DOMMatrix(getComputedStyle(preview).transform) : null
      const event = window.__folioDragTelemetry.events.at(-1) ?? null
      window.__folioDragTelemetry.frames.push({ time, x: matrix?.m41 ?? 0, y: matrix?.m42 ?? 0, pointer: event })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.evaluate(() => window.__folioPerf.reset())
  await page.mouse.move(start.x, start.y)
  const downStarted = Date.now()
  await page.mouse.down()
  const pointerDownActionMs = Date.now() - downStarted
  for (let index = 1; index <= 12; index++) {
    await page.mouse.move(start.x + 76 * index / 12, start.y + 44 * index / 12)
    await page.waitForTimeout(16)
  }
  try { await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'visible', null, { timeout: 5000 }) }
  catch { throw new Error(`Rust move preview did not activate: ${JSON.stringify({ selection: await page.locator('.editor-shell').getAttribute('data-engine-selection'), projection: await page.locator('.editor-shell').getAttribute('data-engine-projection'), lastPointer: await page.evaluate(() => window.__folioTest.lastPointerResult()), movePreview: await page.evaluate(() => {const preview=window.__folioTest.movePreview();return preview&&{frame:preview.frame&&{width:preview.frame.width,height:preview.frame.height},overflowFrame:preview.overflowFrame&&{width:preview.overflowFrame.width,height:preview.overflowFrame.height},shapes:preview.shapes}}), canvases:await page.locator('.move-preview-active').evaluate((node)=>({style:node.style.cssText,width:node.width,height:node.height})), errors })}`) }
  const oldPositionAfter = await page.locator('.move-preview-background').evaluate((node, points) => {
    const c = node
    const ctx = c.getContext('2d')
    return { width:c.width, height:c.height, samples:points.map(([x, y]) => [...ctx.getImageData(Math.round(x / 960 * c.width), Math.round(y / 540 * c.height), 1, 1).data]) }
  }, oldPositionSamples.points)
  const clearedSampleCount = oldPositionSamples.samples.filter((beforeColor, index) => beforeColor.some((channel, component) => component < 3 ? Math.abs(channel - oldPositionAfter.samples[index][component]) > 8 : channel - oldPositionAfter.samples[index][component] > 8)).length
  assert(clearedSampleCount >= 5, `Rust background raster did not remove the selected object's old pixels (${clearedSampleCount}/9 sample points; before=${JSON.stringify(oldPositionSamples)} after=${JSON.stringify(oldPositionAfter)}).`)
  const previewRaster = await page.locator('.move-preview-active').evaluate((node) => { const c=node; const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let alpha=0; for(let i=3;i<d.length;i+=4) if(d[i]) alpha++; return { alpha, width:c.width, height:c.height } })
  assert(previewRaster.alpha > 100, `Rust selected-object raster is blank (${previewRaster.alpha} opaque pixels).`)
  const expectedScale = Math.min(4, Math.max(1, dpr * zoom / 100))
  const expectedPreviewScale = Math.min(3, Math.min(2, Math.max(1, dpr)) * zoom / 100)
  assert(previewRaster.width === 960 * expectedPreviewScale && previewRaster.height === 540 * expectedPreviewScale, `Active selected-object raster did not use the bounded compositor preview scale: ${JSON.stringify({dpr,zoom,expectedScale,expectedPreviewScale,previewRaster})}`)

  try { await page.waitForFunction(() => window.__folioPerf.snapshot()['projection.movePreview']?.count >= 1, null, { timeout:5000 }) }
  catch { throw new Error(`No Rust selected-shape projection arrived during drag: ${JSON.stringify({metrics:await page.evaluate(()=>window.__folioPerf.snapshot()),lastPointer:await page.evaluate(()=>window.__folioTest.lastPointerResult()),telemetry:await page.evaluate(()=>({events:window.__folioDragTelemetry.events.length,frames:window.__folioDragTelemetry.frames.length,latest:window.__folioDragTelemetry.events.at(-1)}))})}`) }
  const duringProjection = await page.evaluate(() => window.__folioTest.movePreview().shapes[0])
  const visualTransform = await page.locator('.move-preview-active').evaluate((node) => { const m = new DOMMatrix(getComputedStyle(node).transform); return [m.m41, m.m42] })
  const expectedTransform = [(duringProjection.rect[0] - before.rect[0]), (duringProjection.rect[1] - before.rect[1])]
  const expectedPointerTransform = [76 / factor, 44 / factor]
  assert(Math.abs(visualTransform[0] - expectedPointerTransform[0]) < 1 && Math.abs(visualTransform[1] - expectedPointerTransform[1]) < 1, `Compositor preview is not tracking the current pointer position: ${JSON.stringify({visualTransform,expectedPointerTransform,rustProjectionTransform:expectedTransform})}`)
  const metrics = await page.evaluate(() => window.__folioPerf.snapshot())
  assert((metrics['render.movePreview.cacheHit']?.count ?? 0) === 1, `The selected-object frames were not prewarmed before pointer-down: ${JSON.stringify({prewarmMetrics,metrics})}`)
  assert((metrics['render.active']?.count ?? 0) === 0 && (metrics['render.overflow']?.count ?? 0) === 0, `Full slide raster ran during preview drag: ${JSON.stringify(metrics)}`)
  assert((metrics['projection.movePreview']?.count ?? 0) > 0, 'No current Rust geometry projections were used to position the compositor preview.')
  const pointerLag = Math.hypot((start.x + 76 - start.x) - expectedTransform[0] * factor, (start.y + 44 - start.y) - expectedTransform[1] * factor)
  const telemetry = await page.evaluate(() => {
    window.__folioDragTelemetry.active = false
    window.__folioMotionEndedAt = performance.now()
    return window.__folioDragTelemetry
  })
  const screenshot = await page.screenshot({ scale:'css', animations:'disabled' })
  const screenshotTiming = await page.evaluate(() => ({ now:performance.now(), lastPointerMove:window.__folioDragTelemetry.events.at(-1)?.time ?? null }))
  const compositeSamples = await page.evaluate(async ({base64, points}) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image,0,0)
    return points.map(({x,y}) => [...context.getImageData(Math.round(x),Math.round(y),1,1).data])
  }, { base64:screenshot.toString('base64'), points:[{x:start.x-before.rect[2]*factor*.4,y:start.y-before.rect[3]*factor*.4},{x:start.x+76,y:start.y+44}] })
  assert(compositeSamples[0][2] < compositeSamples[0][0] + 30 && compositeSamples[1][2] > compositeSamples[1][0] + 50, `Final visible Chromium composite did not show the object only at its Rust position: ${JSON.stringify(compositeSamples)}`)
  await page.mouse.up()
  await page.evaluate(() => { window.__folioDragEndedAt = performance.now() })
  const longTasks = await page.evaluate(() => window.__folioDragLongTasks.filter((task)=>task.startTime < window.__folioMotionEndedAt && task.startTime + task.duration >= window.__folioDragStartedAt))
  await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'hidden')
  const after = await readShape(page, 0)
  assert(JSON.stringify(after.rect) === JSON.stringify(duringProjection.rect), 'Final Rust geometry did not match the visible drag projection.')
  await page.getByRole('button', { name: 'Geri al' }).click()
  await page.waitForFunction((rect) => JSON.stringify(JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0].rect) === JSON.stringify(rect), before.rect)
  await page.getByRole('button', { name: 'İleri al' }).click()
  await page.waitForFunction((rect) => JSON.stringify(JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0].rect) === JSON.stringify(rect), after.rect)
  const measured = telemetry.frames.filter((frame) => frame.pointer)
  const lags = measured.map((frame) => Math.hypot(frame.pointer.x - start.x - frame.x * factor, frame.pointer.y - start.y - frame.y * factor))
  const firstMove = telemetry.events[0]?.time
  const firstVisual = telemetry.frames.find((frame) => frame.pointer && frame.time >= firstMove && Math.hypot(frame.x, frame.y) > 0.5)?.time
  const frameTimes = telemetry.frames.slice(1).map((frame, index) => frame.time - telemetry.frames[index].time)
  const result = { name:`single-z${zoom}-dpr${dpr}`, mode:'visible compositor preview; Rust Session projected every drag frame', prewarmRenderMs:prewarmMetrics['render.movePreview.prewarm']?.avgMs ?? null, pointerDownActionMs, pointerDownPrewarmMs:metrics['render.movePreview.prewarm']?.avgMs ?? 0, previewCacheHit:metrics['render.movePreview.cacheHit']?.count === 1, rasterCallsDuringDrag:{active:metrics['render.active']?.count ?? 0,overflow:metrics['render.overflow']?.count ?? 0}, projectionCalls:metrics['projection.movePreview']?.count ?? 0, previewRaster, oldPositionCleared:{sampledPoints:9,clearedPoints:clearedSampleCount}, midDragCompositePixels:compositeSamples, pointerEventToScreenshotCaptureUpperBoundMs:screenshotTiming.lastPointerMove!==null?+Math.max(0,screenshotTiming.now-screenshotTiming.lastPointerMove).toFixed(2):null, pointerToCssTransformResidualPx:{avg:+avg(lags).toFixed(2),p95:+percentile(lags,0.95).toFixed(2),max:+Math.max(0,...lags).toFixed(2)}, firstPointerMoveToVisibleTransformMs:firstMove!==undefined&&firstVisual!==undefined?+Math.max(0,firstVisual-firstMove).toFixed(2):null, observedFrameTimeMs:{avg:+avg(frameTimes).toFixed(2),p95:+percentile(frameTimes,0.95).toFixed(2),over20ms:frameTimes.filter((time)=>time>20).length}, mainThreadLongTasksDuringDrag:longTasks, physicalDisplayScanoutMeasured:false, endpointPointerLagPx:+pointerLag.toFixed(2), undoRedo:'PASS', after:after.rect }
  await context.close()
  return result
}

async function testMultiMove() {
  const context = await browser.newContext({ locale: 'tr-TR', viewport:{width:1366,height:768}, deviceScaleFactor:1 })
  const page = await context.newPage()
  watchErrors(page, 'multi')
  await page.goto(url); await ready(page)
  await page.evaluate(() => window.__folioTest.reset())
  await createRect(page)
  const initialShape=await readShape(page,0)
  await page.evaluate((id)=>window.__folioTest.selectShape(id),initialShape.id)
  await page.evaluate(()=>window.__folioTest.duplicateSelection())
  await page.waitForFunction(()=>JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).length===2,null,{timeout:5000})
  const boxes = await page.locator('.slide-canvas').boundingBox()
  const shapes = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
  const first=shapes[0], second=shapes[1]
  await page.evaluate((ids)=>window.__folioTest.selectShapes(ids),[first.id,second.id])
  try { await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineSelection).length === 2,null,{timeout:3000}) }
  catch { throw new Error(`Test setup could not select two Rust shapes: ${JSON.stringify({shapes,selection:await page.locator('.editor-shell').getAttribute('data-engine-selection'),error:await page.locator('.editor-shell').getAttribute('data-engine-error')})}`) }
  const before = await page.evaluate(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
  const start={x:boxes.x+(second.rect[0]+second.rect[2]/2)*boxes.width/960,y:boxes.y+(second.rect[1]+second.rect[3]/2)*boxes.height/540}
  await page.mouse.move(start.x,start.y); await page.mouse.down()
  try { await page.waitForFunction(() => document.querySelector('.move-preview-active')?.style.visibility === 'visible',null,{timeout:5000}) }
  catch { throw new Error(`Multi-selection compositor preview did not activate: ${JSON.stringify({selection:await page.locator('.editor-shell').getAttribute('data-engine-selection'),projection:await page.locator('.editor-shell').getAttribute('data-engine-projection'),lastPointer:await page.evaluate(()=>window.__folioTest.lastPointerResult()),preview:await page.evaluate(()=>window.__folioTest.movePreview()),errors})}`) }
  await page.mouse.move(start.x+38,start.y+24,{steps:8})
  await page.waitForFunction(() => window.__folioPerf.snapshot()['projection.movePreview']?.count >= 1)
  const mid=await page.evaluate(()=>window.__folioTest.movePreview().shapes)
  const transform=await page.locator('.move-preview-active').evaluate(node=>{const m=new DOMMatrix(getComputedStyle(node).transform);return[m.m41,m.m42]})
  const projectedDelta=[mid[0].rect[0]-before[0].rect[0],mid[0].rect[1]-before[0].rect[1]]
  assert(Math.abs(transform[0]-projectedDelta[0])<1&&Math.abs(transform[1]-projectedDelta[1])<1,`Multi-selection preview did not match the current Rust geometry: ${JSON.stringify({transform,projectedDelta,rustProjection:mid.map(shape=>shape.rect)})}`)
  await page.mouse.up(); await page.waitForFunction(()=>document.querySelector('.move-preview-active')?.style.visibility==='hidden')
  const after=await page.evaluate(()=>JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection))
  assert(after.length===2&&after.every((shape,i)=>shape.rect[0]>before[i].rect[0]&&shape.rect[1]>before[i].rect[1]),`Rust did not move all selected shapes: ${JSON.stringify({before:before.map(x=>x.rect),after:after.map(x=>x.rect),selection:await page.locator('.editor-shell').getAttribute('data-engine-selection'),lastPointer:await page.evaluate(()=>window.__folioTest.lastPointerResult()),start,canvas:boxes})}`)
  await page.getByRole('button',{name:'Geri al'}).click()
  await page.waitForFunction((rects)=>JSON.stringify(JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).map(x=>x.rect))===JSON.stringify(rects),before.map(x=>x.rect))
  return {name:'multi-selection',selected:2,projectionMatchesTransform:true,allShapesMoved:true,undo:'PASS'}
}

async function testTextFrameMove() {
  const context = await browser.newContext({locale: 'tr-TR',viewport:{width:1366,height:768},deviceScaleFactor:1})
  const page=await context.newPage()
  watchErrors(page,'text-frame')
  await page.goto(url);await ready(page);await page.evaluate(()=>window.__folioTest.reset());await page.evaluate(()=>window.__folioTest.insertTextBox())
  await page.waitForFunction(()=>document.querySelector('.engine-text-input')&&JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).length===1,null,{timeout:5000})
  await page.waitForTimeout(50)
  const before=await readShape(page,0),canvas=page.locator('.slide-canvas'),box=await canvas.boundingBox()
  assert(box,'Canvas has no bounds for text frame drag.')
  const start={x:box.x+(before.rect[0]+20)*box.width/960,y:box.y+(before.rect[1]+4)*box.width/960}
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+36,start.y+24,{steps:8});await page.mouse.up()
  await page.waitForFunction(()=>document.querySelector('.move-preview-active')?.style.visibility==='hidden',null,{timeout:5000})
  const after=await readShape(page,0)
  assert(after.rect[0]>before.rect[0]&&after.rect[1]>before.rect[1],`Dragging the text-frame border did not move its Rust shape: ${JSON.stringify({before:before.rect,after:after.rect,lastPointer:await page.evaluate(()=>window.__folioTest.lastPointerResult())})}`)
  await page.getByRole('button',{name:'Geri al'}).click()
  await page.waitForFunction((rect)=>JSON.stringify(JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[0].rect)===JSON.stringify(rect),before.rect)
  const previewRaster=await page.locator('.move-preview-active').evaluate(node=>({width:node.width,height:node.height}))
  await context.close()
  return {name:'text-frame-border-move',moved:true,rustSession:'PASS',previewRaster,undo:'PASS'}
}

async function selectFirst(page) {
  const projection=await readShape(page,0)
  await page.evaluate((id)=>window.__folioTest.selectShape(id),projection.id)
  await page.waitForFunction(()=>document.querySelectorAll('.engine-selection').length>0,null,{timeout:3000})
}
async function clickShape(page, box, shape, shift) { await page.mouse.click(box.x+(shape.rect[0]+shape.rect[2]/2)*box.width/960,box.y+(shape.rect[1]+shape.rect[3]/2)*box.width/960,{modifiers:shift?['Shift']:[]}) }
async function createRect(page) {
  const count=Number(await page.locator('.editor-shell').getAttribute('data-engine-shapes'))
  await page.getByRole('button',{name:'Araçlar'}).click()
  await page.getByRole('button',{name:'Dikdörtgen',exact:true}).click()
  await page.waitForFunction(before=>Number(document.querySelector('.editor-shell').dataset.engineShapes)===before+1,count,{timeout:5000})
}
async function readShape(page,index) { return page.evaluate((i)=>JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection)[i],index) }
async function ready(page) {
  try { await page.waitForFunction(()=>document.querySelector('.editor-shell')?.dataset.engineReady==='true',null,{timeout:10000}) }
  catch { throw new Error(`Editor engine did not become ready: ${JSON.stringify({shell:await page.locator('.editor-shell').getAttribute('data-engine-ready').catch(()=>null),error:await page.locator('.engine-error').allTextContents(),body:(await page.locator('body').innerText()).slice(0,300)})}`) }
}
async function waitForServer(target, process, output) { for(let i=0;i<160;i++){if(process.exitCode!==null)throw new Error(`Vite exited ${process.exitCode}: ${output()}`);try{const response=await fetch(target);if(response.ok)return}catch{}await new Promise(r=>setTimeout(r,100))}throw new Error(`Vite did not start: ${output()}`) }
async function freePort() { const server= createServer(); await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve)); const {port}=server.address(); await new Promise(resolve=>server.close(resolve)); return port }
function watchErrors(page,label) {page.on('pageerror',error=>errors.push({page:label,message:error.message}));page.on('console',message=>{if(message.type()==='error')errors.push({page:label,message:message.text()})})}
function assert(condition,message){if(!condition)throw new Error(message)}
function avg(values){return values.length?values.reduce((sum,value)=>sum+value,0)/values.length:NaN}
function percentile(values,ratio){if(!values.length)return NaN;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*ratio)-1)]}
