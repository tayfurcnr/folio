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
let step = 'server startup'
const errors = []

try {
  await waitForServer(url)
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await browser.newPage({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })
  page.setDefaultTimeout(6000)
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(url)
  step = 'Folio Rust/WASM engine ready'
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.evaluate(() => window.__folioTest.reset())

  step = 'insert text and select only the word bold'
  const text = 'Plain bold range'
  await page.evaluate((value) => window.__folioTest.insertTextBoxAt([160, 170, 600, 150], value), text)
  let shape = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((item) => item.text?.includes(text))
  assert(shape, 'The text fixture was not inserted.')
  if (await page.locator('.actions-panel').count() === 0) await page.getByRole('button', { name: 'Eylemler' }).click()
  const formatPanel = page.getByRole('region', { name: 'Metni biçimlendir' })
  await formatPanel.waitFor()
  await page.evaluate((id) => window.__folioTest.selectTextRange(id, [0, 6], [0, 10]), shape.id)
  await page.waitForFunction(() => {
    const selection = window.__folioTest.snapshot().selection?.textSelection
    return selection?.anchor?.[1] === 6 && selection?.caret?.[1] === 10
  })

  step = 'apply bold from real formatting panel without losing selected range'
  await formatPanel.getByRole('button', { name: 'Kalın' }).click()
  await page.waitForFunction((id) => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((item) => item.id === id)?.textStyles?.some((run) => run.text === 'bold' && run.bold), shape.id)
  assertRange(await page.evaluate(() => window.__folioTest.snapshot()), 6, 10)
  shape = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((item) => item.id === shape.id)
  assertOnlyBoldRange(shape.textStyles, 'Applying bold')

  step = 'undo removes bold only from selected range'
  await page.getByRole('button', { name: 'Geri al' }).click()
  await page.waitForFunction((id) => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((item) => item.id === id)?.textStyles?.every((run) => !run.bold), shape.id)
  assertRange(await page.evaluate(() => window.__folioTest.snapshot()), 6, 10)

  step = 'redo restores bold only to selected range'
  await page.getByRole('button', { name: 'İleri al' }).click()
  await page.waitForFunction((id) => JSON.parse(document.querySelector('.editor-shell').dataset.engineProjection).find((item) => item.id === id)?.textStyles?.some((run) => run.text === 'bold' && run.bold), shape.id)
  shape = JSON.parse(await page.locator('.editor-shell').getAttribute('data-engine-projection')).find((item) => item.id === shape.id)
  assertOnlyBoldRange(shape.textStyles, 'Redo')
  assertRange(await page.evaluate(() => window.__folioTest.snapshot()), 6, 10)
  assert(errors.length === 0, `Browser reported errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ status: 'PASS', checks: ['character-range selection persists across formatting toolbar click', 'only highlighted word receives bold', 'Undo and Redo preserve range-level formatting'], textStyles: shape.textStyles, selection: (await page.evaluate(() => window.__folioTest.snapshot())).selection.textSelection }, null, 2))
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

async function waitForServer(url) {
  const deadline = Date.now() + 30000
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
function assertRange(snapshot, start, end) {
  const range = snapshot.selection?.textSelection
  assert(range?.anchor?.[1] === start && range?.caret?.[1] === end, `Formatting lost the selected range: ${JSON.stringify(snapshot.selection)}`)
}
function assertOnlyBoldRange(runs, context) {
  assert(runs?.some((run) => run.text === 'Plain ' && !run.bold), `${context} bolded text before the range: ${JSON.stringify(runs)}`)
  assert(runs?.some((run) => run.text === 'bold' && run.bold), `${context} did not bold the selected word: ${JSON.stringify(runs)}`)
  assert(runs?.some((run) => run.text === ' range' && !run.bold), `${context} bolded text after the range: ${JSON.stringify(runs)}`)
}
