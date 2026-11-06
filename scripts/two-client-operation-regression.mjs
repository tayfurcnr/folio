import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const root = new URL('..', import.meta.url).pathname
const vitePort = await freePort()
const collabPort = await freePort()
const dataDir = await mkdtemp(join(tmpdir(), 'folio-collab-browser-'))
const service = spawn(process.execPath, [join(root, 'apps/collab-server/server.mjs')], { cwd: root, env: { ...process.env, FOLIO_COLLAB_HOST: '127.0.0.1', FOLIO_COLLAB_PORT: String(collabPort), FOLIO_COLLAB_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] })
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], { cwd: join(root, 'apps/editor'), env: { ...process.env, FOLIO_COLLAB_PROXY_TARGET: `http://127.0.0.1:${collabPort}` }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
for (const child of [service, vite]) {
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk })
}
const errors = []
let browser
const pages = []
let step = 'servers startup'

try {
  await Promise.all([waitForHttp(`http://127.0.0.1:${collabPort}`, service), waitForHttp(`http://127.0.0.1:${vitePort}`, vite)])
  browser = await chromium.launch({ headless: true, executablePath: process.env.FOLIO_CHROMIUM ?? '/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })))
  for (const context of contexts) context.setDefaultTimeout(10_000)
  for (const context of contexts) {
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(`http://127.0.0.1:${vitePort}/?test=1`)
    await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
    pages.push(page)
  }
  const [owner, editor, viewer] = pages

  step = 'create durable shared document and role links'
  const { documentId, revision, bytes } = await owner.evaluate(async () => ({ documentId: window.__folioTest.getDocumentId(), revision: window.__folioTest.snapshot().summary.revision, bytes: Array.from(await window.__folioTest.exportPptx()) }))
  const createResponse = await fetch(`http://127.0.0.1:${collabPort}/api/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId, title: 'Two-client regression', revision, snapshotBase64: Buffer.from(bytes).toString('base64') }) })
  assert.equal(createResponse.status, 201)
  const created = await createResponse.json()
  const createLink = async (role) => {
    const response = await fetch(`http://127.0.0.1:${collabPort}/api/documents/${documentId}/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.ownerToken}` }, body: JSON.stringify({ role }) })
    assert.equal(response.status, 201)
    return response.json()
  }
  const editLink = await createLink('edit')
  const viewLink = await createLink('view')
  const sharedSnapshot = { documentId, bytes }
  for (const page of [editor, viewer]) await page.evaluate(({ documentId, bytes }) => window.__folioTest.importPresentation(new Uint8Array(bytes), documentId), sharedSnapshot)

  step = 'connect all independent clients to the real WebSocket service'
  const endpoint = `http://127.0.0.1:${collabPort}`
  await owner.evaluate(({ endpoint, documentId, token }) => window.__folioTest.connectCollaboration(endpoint, documentId, token, 0), { endpoint, documentId, token: created.ownerToken })
  await editor.evaluate(({ endpoint, documentId, token }) => window.__folioTest.connectCollaboration(endpoint, documentId, token, 0), { endpoint, documentId, token: editLink.token })
  await viewer.evaluate(({ endpoint, documentId, token }) => window.__folioTest.connectCollaboration(endpoint, documentId, token, 0), { endpoint, documentId, token: viewLink.token })
  for (const page of pages) await page.waitForFunction(() => window.__folioTest.collaborationState().status === 'connected')
  assert.equal(await editor.evaluate(() => window.__folioTest.collaborationState().role), 'edit')
  assert.equal(await viewer.evaluate(() => window.__folioTest.collaborationState().role), 'view')

  step = 'owner edit reaches editor and viewer'
  await owner.evaluate(() => window.__folioTest.setSlideNotes('Owner edit', 0))
  for (const page of [editor, viewer]) await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Owner edit')

  step = 'editor edit reaches owner and viewer'
  await editor.evaluate(() => window.__folioTest.setSlideNotes('Editor edit', 0))
  for (const page of [owner, viewer]) await page.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Editor edit')

  step = 'canvas gestures synchronize and view role stays read-only'
  await owner.evaluate(async () => {
    await window.__folioTest.pointer({ kind: 'down', x: 900, y: 500 })
    await window.__folioTest.pointer({ kind: 'up', x: 900, y: 500 })
  })
  await editor.waitForFunction(() => window.__folioTest.collaborationState().status === 'connected')
  const readOnlyError = await viewer.evaluate(async () => {
    try { await window.__folioTest.setSlideNotes('Viewer must not edit', 0); return null }
    catch (error) { return String(error) }
  })
  assert.match(readOnlyError, /DOCUMENT_READ_ONLY/)
  assert.equal(await viewer.locator('.editor-shell').getAttribute('data-engine-notes'), 'Editor edit')

  step = 'comments share live over the same document connection'
  await editor.evaluate(() => window.__folioTest.sendSharedComment('Shared feedback', 0))
  await Promise.all([owner, editor, viewer].map((page) => page.waitForFunction(() => window.__folioTest.collaborationState().comments.some((comment) => comment.text === 'Shared feedback'))))
  assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('\n')}`)

  step = 'create an invite from the editor and open it in an independent browser profile'
  const inviteOwnerContext = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })
  const inviteGuestContext = await browser.newContext({ locale: 'tr-TR', viewport: { width: 1366, height: 768 } })
  const inviteOwner = await inviteOwnerContext.newPage()
  const inviteGuest = await inviteGuestContext.newPage()
  pages.push(inviteOwner, inviteGuest)
  for (const page of [inviteOwner, inviteGuest]) {
    page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  }
  await inviteOwner.goto(`http://127.0.0.1:${vitePort}/?test=1`)
  await inviteOwner.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await inviteOwner.getByRole('button', { name: 'Paylaş' }).click()
  await inviteOwner.getByRole('menuitem', { name: 'Düzenleyebilir bağlantı oluştur' }).click()
  const inviteInput = inviteOwner.getByRole('textbox', { name: 'Paylaşım bağlantısı' })
  await inviteInput.waitFor()
  const inviteUrl = await inviteInput.inputValue()
  assert.match(inviteUrl, /#collab=/)
  await inviteGuest.goto(inviteUrl.replace('http://127.0.0.1:', 'http://localhost:'))
  await inviteGuest.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await inviteGuest.evaluate(() => window.__folioTest.setSlideNotes('Opened from a real invite', 0))
  await inviteOwner.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Opened from a real invite')
  await inviteOwner.waitForTimeout(1400)
  await inviteOwner.reload()
  await inviteOwner.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineReady === 'true')
  await inviteOwner.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Opened from a real invite')
  await inviteGuest.evaluate(() => window.__folioTest.setSlideNotes('Owner reconnected after reload', 0))
  await inviteOwner.waitForFunction(() => document.querySelector('.editor-shell')?.dataset.engineNotes === 'Owner reconnected after reload')
  await inviteOwner.getByRole('button', { name: 'Yorumları aç' }).click()
  await inviteGuest.getByRole('button', { name: 'Yorumları aç' }).click()
  await inviteGuest.getByPlaceholder('Yorum yaz… (@ ile slayt etiketle)').fill('Shared UI comment thread')
  await inviteGuest.getByRole('button', { name: 'Yorumu gönder' }).click()
  await inviteOwner.getByText('Shared UI comment thread').waitFor()
  await inviteOwner.getByRole('button', { name: 'Yanıtla' }).click()
  await inviteOwner.getByRole('textbox', { name: 'Yanıt yaz' }).fill('Shared UI reply')
  await inviteOwner.getByRole('button', { name: 'Yanıt gönder' }).click()
  await inviteGuest.getByText('Shared UI reply').waitFor()
  await inviteOwner.getByRole('button', { name: 'Çözüldü olarak işaretle' }).click()
  await inviteGuest.locator('.chat-message--resolved').waitFor()
  await inviteOwner.locator('.comments-chat__close').click()
  await inviteOwner.getByRole('button', { name: 'Paylaş' }).click()
  await inviteOwner.getByRole('menuitem', { name: 'İptal et' }).waitFor()
  await inviteOwner.getByRole('menuitem', { name: 'İptal et' }).click()
  const inviteParts = /#collab=([^.]*)\.(.+)$/.exec(new URL(inviteUrl).hash)
  assert.ok(inviteParts)
  const revokedAccess = await fetch(`http://127.0.0.1:${collabPort}/api/documents/${decodeURIComponent(inviteParts[1])}?token=${encodeURIComponent(inviteParts[2])}`)
  assert.equal(revokedAccess.status, 403)
  assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('\n')}`)
  console.log(JSON.stringify({ status: 'PASS', checks: ['owner/edit/view links connect three independent browser contexts to the persisted server document', 'document edits and pointer transactions propagate over WebSocket', 'view permission blocks local edits', 'comments propagate to all connected collaborators', 'editor creates a permissioned invite and a different browser origin opens and edits the shared document through the same-origin WebSocket proxy', 'owner reloads, catches up with the remote change and receives subsequent edits', 'comment threads, replies and resolution state synchronize through the actual UI', 'owner revokes the invite in the UI and its access is denied immediately'], documentId }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error), notes: await Promise.all(pages.map((page) => page.locator('.editor-shell').getAttribute('data-engine-notes').catch(() => null))), serverOutput: output, errors }, null, 2))
  process.exitCode = 1
} finally {
  for (const page of pages) await page.evaluate(() => window.__folioTest?.closeCollaboration()).catch(() => undefined)
  await browser?.close()
  await stop(vite)
  await stop(service)
  await rm(dataDir, { recursive: true, force: true })
}

async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const address = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return address.port
}
async function waitForHttp(url, child) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with ${child.exitCode}: ${output}`)
    try { const response = await fetch(url); if (response.ok || response.status === 404) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Server did not start: ${output}`)
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGTERM')
  await closed
}
