import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const port = await freePort()
const collabPort = await freePort()
const dataDir = await mkdtemp(join(tmpdir(), 'folio-presenter-'))
const collabServer = spawn(process.execPath, [join(root, 'apps/collab-server/server.mjs')], { cwd: root, env: { ...process.env, FOLIO_COLLAB_HOST: '127.0.0.1', FOLIO_COLLAB_PORT: String(collabPort), FOLIO_COLLAB_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] })
let collabOutput = ''
collabServer.stdout.setEncoding('utf8').on('data', (chunk) => { collabOutput += chunk })
collabServer.stderr.setEncoding('utf8').on('data', (chunk) => { collabOutput += chunk })
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: `${root}/apps/editor`, env: { ...process.env, FOLIO_COLLAB_PROXY_TARGET: `http://127.0.0.1:${collabPort}` }, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
const url = `http://127.0.0.1:${port}/?test=1`
const errors = []
let browser
let presenter
let remotePage
let page
let step = 'server startup'

try {
  await waitForServer()
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })
  context.setDefaultTimeout(6000)
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(url)
  step = 'Folio engine ready'
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.evaluate(() => window.__folioTest.reset())
  await page.evaluate(() => window.__folioTest.setSlideNotes('Presenter notes for the first slide', 0))
  await page.evaluate(() => window.__folioTest.addSlideAt(1))
  await page.waitForFunction(() => document.querySelectorAll('.filmstrip__entry').length === 2)
  await page.evaluate(() => window.__folioTest.setSlideNotes('Presenter notes for the second slide', 1))
  await page.evaluate(() => window.__folioTest.addSlideAt(2))
  await page.waitForFunction(() => document.querySelectorAll('.filmstrip__entry').length === 3)
  await page.evaluate(() => window.__folioTest.setSlideNotes('Presenter notes for the third slide', 2))
  await page.evaluate(() => window.__folioTest.setSlideHidden(1, true))
  const noteState = await page.locator('.editor-shell').getAttribute('data-engine-notes')
  assert(noteState === 'Presenter notes for the third slide', `Notes did not reach the engine projection: ${JSON.stringify(noteState)}`)

  step = 'open presentation and separate presenter window'
  await page.locator('.topbar__present').click()
  await page.getByRole('dialog', { name: 'Sunum görünümü' }).waitFor()
  const presenterPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Sunucu görünümü' }).click()
  presenter = await presenterPromise
  presenter.setDefaultTimeout(6000)
  await presenter.waitForFunction(() => !!document.querySelector('.presenter-remote'))

  step = 'show current slide and private presenter notes'
  await presenter.getByText('Presenter notes for the third slide', { exact: true }).waitFor()
  const firstSlideFrame = await presenter.locator('.presenter-remote__frame').evaluate((canvas) => ({ width: canvas.width, height: canvas.height }))
  assert(firstSlideFrame.width > 0 && firstSlideFrame.height > 0, `Presenter slide frame is blank: ${JSON.stringify(firstSlideFrame)}`)
  await presenter.getByText('2 / 2', { exact: true }).waitFor()

  step = 'go to page from the presentation controls'
  await page.getByRole('button', { name: 'Sayfaya git' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Sunum görünümü' }).waitFor()
  assert(await page.getByRole('spinbutton', { name: 'Sayfa numarası' }).count() === 0, 'Escape did not dismiss the page picker.')
  await page.getByRole('button', { name: 'Sayfaya git' }).click()
  await page.getByRole('spinbutton', { name: 'Sayfa numarası' }).fill('1')
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '0')
  await page.waitForFunction(() => document.querySelector('.presentation-mode__header')?.textContent?.includes('1 / 2'))

  step = 'go to page with the Canva presentation shortcut'
  await page.keyboard.press('Control+Alt+g')
  await page.getByRole('spinbutton', { name: 'Sayfa numarası' }).fill('2')
  await page.getByRole('button', { name: 'Git', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '2')
  await page.waitForFunction(() => document.querySelector('.presentation-mode__header')?.textContent?.includes('2 / 2'))

  step = 'remote previous moves the presentation and updates notes'
  await presenter.getByRole('button', { name: 'Önceki slayt' }).click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '0')
  await presenter.getByText('Presenter notes for the first slide', { exact: true }).waitFor()
  await presenter.getByText('1 / 2', { exact: true }).waitFor()

  step = 'remote keyboard next returns to the second slide'
  await presenter.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '2')
  await presenter.getByText('Presenter notes for the third slide', { exact: true }).waitFor()

  step = 'open scoped presenter link in an independent browser context'
  await page.getByRole('button', { name: 'Uzaktan kumandayı paylaş' }).click()
  const remoteUrl = await page.locator('.presenter-share__url').inputValue()
  assert(remoteUrl.includes('presenterRemote=') && remoteUrl.includes('token='), `Presenter link is missing its scoped token: ${remoteUrl}`)
  const remoteContext = await browser.newContext({ locale: 'tr-TR', viewport: { width: 390, height: 844 } })
  remotePage = await remoteContext.newPage()
  remotePage.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  remotePage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await remotePage.goto(remoteUrl)
  await remotePage.waitForFunction(() => !!document.querySelector('.presenter-remote__frame') && document.querySelector('.presenter-remote__frame')?.width > 0)
  await remotePage.getByText('Presenter notes for the third slide', { exact: true }).waitFor()
  await remotePage.getByRole('button', { name: 'Önceki slayt' }).click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '0')
  await remotePage.getByText('Presenter notes for the first slide', { exact: true }).waitFor()
  await remotePage.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineActiveSlide === '2')
  await remotePage.getByText('Presenter notes for the third slide', { exact: true }).waitFor()
  assert(errors.length === 0, `Browser reported errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ status: 'PASS', visibleChromium: false, checks: ['presenter opens in a separate browser window', 'active slide raster follows the editor presentation', 'speaker notes remain in presenter view and update per slide', 'go-to-page button and Ctrl+Alt+G shortcut navigate visible pages while skipping hidden slides', 'same-browser presenter controls navigate the presentation', 'independent browser context opens the remote link and controls navigation by button and keyboard while skipping hidden slides; current preview and notes update'], firstSlideFrame }, null, 2))
} catch (error) {
  const diagnostics = {
    editorNotes: await page?.locator('.editor-shell').getAttribute('data-engine-notes').catch(() => null),
    presenterText: await presenter?.locator('.presenter-remote').innerText().catch(() => null),
  }
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error), diagnostics, serverOutput, collabOutput, errors }, null, 2))
  process.exitCode = 1
} finally {
  await remotePage?.close().catch(() => undefined)
  await presenter?.close().catch(() => undefined)
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
  if (collabServer.exitCode === null && collabServer.signalCode === null) {
    const stopped = new Promise((resolve) => collabServer.once('close', resolve))
    collabServer.kill('SIGTERM')
    await stopped
  }
  await rm(dataDir, { recursive: true, force: true })
}

async function waitForServer() {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (collabServer.exitCode !== null) throw new Error(`Collaboration server exited early: ${collabOutput}`)
    if (server.exitCode !== null) throw new Error(`Vite exited early: ${serverOutput}`)
    try { const [editor, collaboration] = await Promise.all([fetch(url), fetch(`http://127.0.0.1:${collabPort}/healthz`)]); if (editor.ok && collaboration.ok) return } catch {}
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
