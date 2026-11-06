import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const port = await freePort()
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: `${root}/apps/editor`, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
const url = `http://127.0.0.1:${port}/?test=1`
let browser
let step = 'Vite startup'
const errors = []

try {
  await waitForServer()
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ locale: 'tr-TR', permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  page.setDefaultTimeout(6000)
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(url)
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.evaluate(() => window.__folioTest.reset())
  await page.evaluate(() => window.__folioTest.prepareBlankSlide())

  step = 'copy selected rich text to the system clipboard'
  await page.evaluate(() => window.__folioTest.insertTextBoxAt([160, 110, 580, 110], 'Before replace after'))
  let textShape = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((shape) => shape.text === 'Before replace after')
  await page.evaluate((id) => window.__folioTest.selectTextRange(id, [0, 7], [0, 14]), textShape.id)
  await page.locator('.engine-text-input').evaluate((input) => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/plain', 'Bold styled')
    clipboard.setData('text/html', '<strong>Bold</strong> <span style="font-family:Arial;font-size:24px;font-style:italic;text-decoration:underline;color:#dc0000">styled</span>')
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  })
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => shape.text === 'Before Bold styled after'))
  textShape = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((shape) => shape.text === 'Before Bold styled after')
  await page.evaluate((id) => window.__folioTest.selectTextRange(id, [0, 7], [0, 18]), textShape.id)
  await page.locator('.engine-text-input').focus()
  await page.keyboard.press('Control+C')
  const textClipboard = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { plain: item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : '', html: item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '' }
  })
  assert(textClipboard.plain === 'Bold styled', `Copied text mismatch: ${JSON.stringify(textClipboard)}`)
  assert(['font-weight:700', 'font-style:italic', 'text-decoration:underline', 'font-family:Arial', '#DC0000'].every((style) => textClipboard.html.includes(style)), `System clipboard lost rich text styles: ${textClipboard.html}`)
  await page.evaluate(() => window.__folioTest.insertTextBoxAt([160, 270, 580, 100], 'Target'))
  await page.keyboard.press('Control+V')
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => shape.text === 'TargetBold styled'))
  const pastedText = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((shape) => shape.text === 'TargetBold styled')
  assert(pastedText.textStyles?.some((run) => run.text === 'Bold' && run.bold) && pastedText.textStyles?.some((run) => run.text === 'styled' && run.italic && run.underline), `Pasted system clipboard text lost styles: ${JSON.stringify(pastedText.textStyles)}`)

  step = 'copy and restore an image object through the system clipboard'
  await page.evaluate(() => window.__folioTest.prepareBlankSlide())
  const pngBase64 = await page.locator('.slide-canvas').evaluate(() => {
    const source = document.createElement('canvas')
    source.width = 64
    source.height = 48
    const context = source.getContext('2d')
    if (!context) throw new Error('Could not create the image fixture.')
    context.fillStyle = '#f60'
    context.fillRect(0, 0, source.width, source.height)
    return source.toDataURL('image/png').split(',')[1]
  })
  await page.locator('.slide-plane').evaluate((plane, png) => {
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([Uint8Array.from(atob(png), (character) => character.charCodeAt(0))], 'clipboard-picture.png', { type: 'image/png' }))
    plane.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }))
  }, pngBase64)
  await page.waitForFunction(() => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).some((shape) => shape.pictureCrop))
  const picture = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((shape) => shape.pictureCrop)
  await page.evaluate((id) => window.__folioTest.selectShape(id), picture.id)
  await page.locator('.slide-canvas').focus()
  await page.keyboard.press('Control+C')
  const objectClipboard = await page.evaluate(async (expectedId) => {
    const deadline = Date.now() + 6000
    while (Date.now() < deadline) {
      try {
        const [item] = await navigator.clipboard.read()
        if (item?.types.includes('text/html') && item.types.includes('image/png')) {
          const html = await (await item.getType('text/html')).text()
          const marker = new DOMParser().parseFromString(html, 'text/html').querySelector('meta[name="folio-clipboard-v1"]')?.content
          if (marker) {
            const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(marker), (character) => character.charCodeAt(0))))
            if (payload.shapes?.length === 1 && String(payload.shapes[0].id) === String(expectedId) && payload.media?.length === 1) {
              let visiblePixels = 0
              const bitmap = await createImageBitmap(await item.getType('image/png'))
              const canvas = document.createElement('canvas')
              canvas.width = bitmap.width
              canvas.height = bitmap.height
              const context = canvas.getContext('2d')
              context.drawImage(bitmap, 0, 0)
              const alpha = context.getImageData(0, 0, canvas.width, canvas.height).data
              for (let index = 3; index < alpha.length; index += 4) if (alpha[index] > 0) visiblePixels += 1
              if (visiblePixels) return { types: item.types, payload, visiblePixels }
            }
          }
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return null
  }, picture.id)
  assert(Array.isArray(objectClipboard?.types) && objectClipboard.types.includes('image/png') && objectClipboard.visiblePixels > 0, `Image copy did not place a visible PNG preview on the system clipboard: ${JSON.stringify(objectClipboard)}`)
  assert(objectClipboard.payload?.shapes?.length === 1 && objectClipboard.payload.media?.length === 1 && objectClipboard.payload.media[0].bytes.length > 0, 'System clipboard did not preserve the editable shape and original image bytes.')
  const nextSlideIndex = await page.evaluate(() => window.__folioTest.snapshot().slides.length)
  await page.evaluate((index) => window.__folioTest.addSlideAt(index), nextSlideIndex)
  await page.waitForFunction((index) => window.__folioTest.snapshot().summary.activeSlideIndex === index && window.__folioTest.snapshot().activeSlide.shapes.length === 0, nextSlideIndex)
  await page.locator('.slide-canvas').focus()
  await page.keyboard.press('Control+V')
  await page.waitForFunction(() => window.__folioTest.snapshot().activeSlide.shapes.some((shape) => shape.pictureCrop))
  const pastedPicture = await page.evaluate(() => window.__folioTest.snapshot().activeSlide.shapes.find((shape) => shape.pictureCrop))
  assert(pastedPicture, 'The system clipboard picture did not return as an editable Folio image.')
  assert(errors.length === 0, `Browser reported errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ status: 'PASS', checks: ['selected rich text reaches the system clipboard and pastes with styling', 'selected picture adds a PNG fallback plus Folio object metadata and original media bytes', 'pasting into Folio restores the image as an editable object'], textClipboard: { plain: textClipboard.plain, htmlLength: textClipboard.html.length }, pictureClipboard: { types: objectClipboard.types, visiblePixels: objectClipboard.visiblePixels, mediaBytes: objectClipboard.payload.media[0].bytes.length }, browserErrors: errors }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error), serverOutput, errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early: ${serverOutput}`)
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not become ready: ${serverOutput}`)
}

async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => listener.listen(0, '127.0.0.1', resolve).once('error', reject))
  const { port } = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

function assert(condition, message) { if (!condition) throw new Error(message) }
