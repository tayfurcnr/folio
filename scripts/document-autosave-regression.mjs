import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const port = await freePort()
const server = spawn(process.execPath, [new URL('../node_modules/vite/bin/vite.js', import.meta.url).pathname, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: `${root}/apps/editor`, stdio: ['ignore', 'pipe', 'pipe'] })
let serverOutput = ''
server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk })
const errors = []
let browser
let page
let step = 'server startup'

try {
  await waitForServer()
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const context = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })
  context.setDefaultTimeout(8000)
  page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${port}/?test=1`)
  step = 'editor ready'
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')

  step = 'create a recoverable local presentation'
  await page.evaluate(() => {
    window.__folioOperations = []
    window.__folioTest.subscribeDocumentOperations((operation) => window.__folioOperations.push(operation))
  })
  await page.evaluate(() => window.__folioTest.setSlideNotes('Archived presentation note', 0))
  const initialOperations = await page.evaluate(() => window.__folioOperations.slice())
  assert(initialOperations.some((operation) => operation.action.kind === 'commands' && operation.action.commands.some((command) => command.type === 'custom' && command.name === 'slide.notes')), 'Document commands were not published as operations.')
  const originalDocumentId = initialOperations[0]?.documentId
  assert(originalDocumentId && initialOperations.every((operation, index) => operation.documentId === originalDocumentId && (index === 0 || operation.sequence > initialOperations[index - 1].sequence)), 'Operations for one document must have a stable identity and ordered sequence.')
  await page.evaluate(async () => {
    await window.__folioTest.pointer({ kind: 'down', x: 900, y: 500 })
    await window.__folioTest.pointer({ kind: 'up', x: 900, y: 500 })
  })
  const pointerOperation = await page.evaluate(() => window.__folioOperations.find((operation) => operation.action.kind === 'pointer'))
  assert(pointerOperation && pointerOperation.action.inputs.map((input) => input.kind).join(',') === 'down,up', 'Canvas pointer transactions must be grouped into one ordered operation.')
  await page.getByRole('button', { name: 'Dosya' }).click()
  await page.getByRole('menuitem', { name: 'Yeni sunum' }).click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes !== 'Archived presentation note')
  const switchedDocumentId = await page.evaluate(() => window.__folioOperations.filter((operation) => operation.action.kind === 'replace-document').at(-1)?.documentId)
  assert(switchedDocumentId && switchedDocumentId !== originalDocumentId, 'Creating a new document must use a fresh identity.')

  step = 'reopen the preserved presentation from recent files'
  await page.getByRole('button', { name: 'Dosya' }).click()
  const recent = page.locator('.menu-popover__recent [role="menuitem"]')
  await recent.first().waitFor()
  await recent.first().click()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Archived presentation note')
  const restoredOperation = await page.evaluate(() => window.__folioOperations.filter((operation) => operation.action.kind === 'replace-document').at(-1))
  assert.equal(restoredOperation.documentId, originalDocumentId, 'Restoring a recent document must restore its stable identity.')
  assert(await page.evaluate(() => window.__folioOperations.filter((operation) => operation.action.kind === 'replace-document').at(-1)?.action.snapshot instanceof Uint8Array), 'Restoring a document must publish its snapshot to transport observers.')
  await page.waitForSelector('.statusbar__save--saving')
  await page.waitForSelector('.statusbar__save--saved')

  step = 'verify archived presentation after a page reload'
  await page.reload()
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Archived presentation note')
  assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ status: 'PASS', checks: ['engine publishes ordered commands and grouped canvas transactions with stable document identity', 'switching to a new presentation archives the current document', 'recent presentations menu restores archived documents and exports a replacement snapshot event', 'restored document survives a page reload'], archivedNote: 'Archived presentation note' }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error), editorState: await page?.locator('.editor-shell').evaluate((element) => ({ title: element.getAttribute('data-engine-title'), notes: element.getAttribute('data-engine-notes'), revision: element.getAttribute('data-engine-revision') })).catch(() => null), serverOutput, errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser?.close()
  if (server.exitCode === null && server.signalCode === null) {
    const stopped = new Promise((resolve) => server.once('close', resolve))
    server.kill('SIGTERM')
    await stopped
  }
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitForServer() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited (${server.exitCode}): ${serverOutput}`)
    try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.ok) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Vite did not start: ${serverOutput}`)
}
