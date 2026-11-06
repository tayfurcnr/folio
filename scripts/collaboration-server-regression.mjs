import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const root = new URL('..', import.meta.url).pathname
const dataDir = await mkdtemp(join(tmpdir(), 'folio-collab-'))
const port = await freePort()
let server
const clients = []
const messageQueues = new WeakMap()
const messageWaiters = new WeakMap()
let step = 'server startup'

try {
  server = startServer()
  await waitForServer()
  const base = `http://127.0.0.1:${port}`
  step = 'create and secure a document'
  const createdResponse = await fetch(`${base}/api/documents`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Collab regression', revision: 1, snapshotBase64: 'dGVzdA==' }) })
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json()
  assert.equal((await fetch(`${base}/api/documents/${created.documentId}`)).status, 403)

  const makeShare = async (role) => {
    const response = await fetch(`${base}/api/documents/${created.documentId}/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.ownerToken}` }, body: JSON.stringify({ role }) })
    assert.equal(response.status, 201)
    return response.json()
  }
  const edit = await makeShare('edit')
  const comment = await makeShare('comment')
  const view = await makeShare('view')
  const listedShares = await fetch(`${base}/api/documents/${created.documentId}/shares`, { headers: { Authorization: `Bearer ${created.ownerToken}` } }).then((response) => response.json())
  assert.deepEqual(listedShares.shares.map(({ role }) => role).sort(), ['comment', 'edit', 'view'])
  assert.ok(listedShares.shares.every((share) => !Object.hasOwn(share, 'token') && !Object.hasOwn(share, 'tokenHash')))
  assert.equal((await fetch(`${base}/api/documents/${created.documentId}/shares`, { headers: { Authorization: `Bearer ${view.token}` } })).status, 403)

  step = 'create an isolated cross-device presenter control capability'
  const presenterResponse = await fetch(`${base}/api/documents/${created.documentId}/presenter-sessions`, { method: 'POST', headers: { Authorization: `Bearer ${created.ownerToken}` } })
  assert.equal(presenterResponse.status, 201)
  const presenter = await presenterResponse.json()
  assert.equal((await fetch(`${base}/api/documents/${created.documentId}/presenter-sessions`, { method: 'POST', headers: { Authorization: `Bearer ${view.token}` } })).status, 403)
  const editPresenterResponse = await fetch(`${base}/api/documents/${created.documentId}/presenter-sessions`, { method: 'POST', headers: { Authorization: `Bearer ${edit.token}` } })
  assert.equal(editPresenterResponse.status, 201)
  const editPresenter = await editPresenterResponse.json()
  const presenterHost = await connect(`${base.replace('http', 'ws')}/api/presenter?sessionId=${presenter.sessionId}&role=host&token=${encodeURIComponent(created.ownerToken)}`)
  const presenterRemote = await connect(`${base.replace('http', 'ws')}/api/presenter?sessionId=${presenter.sessionId}&role=remote&token=${encodeURIComponent(presenter.token)}`)
  clients.push(presenterHost, presenterRemote)
  assert.equal((await nextMessage(presenterHost)).role, 'host')
  assert.equal((await nextMessage(presenterRemote)).role, 'remote')
  presenterHost.send(JSON.stringify({ type: 'state', state: { title: 'Presenter', index: 1, total: 2, notes: 'Speaker notes', frame: { width: 1, height: 1, mimeType: 'image/png', dataBase64: 'AQIDBA==' } } }))
  const stateMessage = await nextMessage(presenterRemote)
  assert.equal(stateMessage.type, 'state'); assert.equal(stateMessage.state.notes, 'Speaker notes'); assert.equal(stateMessage.state.frame.dataBase64, 'AQIDBA==')
  presenterRemote.send(JSON.stringify({ type: 'navigate', direction: -1 }))
  assert.deepEqual(await nextMessage(presenterHost), { type: 'navigate', direction: -1 })
  presenterRemote.send(JSON.stringify({ type: 'operation', operation: {} }))
  assert.equal((await nextMessage(presenterRemote)).code, 'INVALID_COMMAND')
  await assert.rejects(connect(`${base.replace('http', 'ws')}/api/collaboration?documentId=${created.documentId}&token=${presenter.token}`))
  const editHost = await connect(`${base.replace('http', 'ws')}/api/presenter?sessionId=${editPresenter.sessionId}&role=host&token=${encodeURIComponent(edit.token)}`)
  const editRemote = await connect(`${base.replace('http', 'ws')}/api/presenter?sessionId=${editPresenter.sessionId}&role=remote&token=${encodeURIComponent(editPresenter.token)}`)
  clients.push(editHost, editRemote)
  assert.equal((await nextMessage(editHost)).role, 'host')
  assert.equal((await nextMessage(editRemote)).role, 'remote')

  step = 'connect independent roles over WebSocket'
  const ownerSocket = await connect(`${base.replace('http', 'ws')}/api/collaboration?documentId=${created.documentId}&token=${created.ownerToken}`)
  const editorSocket = await connect(`${base.replace('http', 'ws')}/api/collaboration?documentId=${created.documentId}&token=${edit.token}`)
  const commenterSocket = await connect(`${base.replace('http', 'ws')}/api/collaboration?documentId=${created.documentId}&token=${comment.token}`)
  const viewerSocket = await connect(`${base.replace('http', 'ws')}/api/collaboration?documentId=${created.documentId}&token=${view.token}`)
  clients.push(ownerSocket, editorSocket, commenterSocket, viewerSocket)
  assert.equal((await nextMessage(viewerSocket)).role, 'view')
  await nextMessage(ownerSocket); await nextMessage(editorSocket); await nextMessage(commenterSocket)

  step = 'persist and broadcast ordered operations'
  const operation = { id: 'owner-op-1', documentId: created.documentId, sequence: 1, baseRevision: 1, revision: 2, action: { kind: 'commands', commands: [{ type: 'custom', name: 'slide.notes', params: { text: 'saved' } }] } }
  ownerSocket.send(JSON.stringify({ type: 'operation', operation }))
  const [ack, broadcast, commenterBroadcast, viewerBroadcast] = await Promise.all([nextMessage(ownerSocket), nextMessage(editorSocket), nextMessage(commenterSocket), nextMessage(viewerSocket)])
  assert.equal(ack.type, 'ack'); assert.equal(ack.sequence, 1)
  assert.equal(broadcast.type, 'operation'); assert.equal(broadcast.operation.id, operation.id)
  assert.equal(commenterBroadcast.type, 'operation'); assert.equal(viewerBroadcast.type, 'operation')

  step = 'enforce comment and view permissions'
  commenterSocket.send(JSON.stringify({ type: 'comment', text: 'Looks good', slideIndex: 0 }))
  const [commentAck, sharedComment, editorComment, viewerComment] = await Promise.all([nextMessage(commenterSocket), nextMessage(ownerSocket), nextMessage(editorSocket), nextMessage(viewerSocket)])
  assert.equal(commentAck.type, 'comment'); assert.equal(sharedComment.comment.text, 'Looks good')
  assert.equal(editorComment.comment.text, 'Looks good'); assert.equal(viewerComment.comment.text, 'Looks good')
  viewerSocket.send(JSON.stringify({ type: 'comment', text: 'Not allowed' }))
  assert.equal((await nextMessage(viewerSocket)).code, 'COMMENT_ACCESS_REQUIRED')
  const sharedThread = { id: 'shared-thread-1', author: 'Mina', initials: 'M', time: '10:15', text: 'Please adjust this title', slideId: 'slide-1', slideIndex: 0, replies: [], resolved: false }
  ownerSocket.send(JSON.stringify({ type: 'comments:update', comments: [sharedThread] }))
  const threadStates = await Promise.all([ownerSocket, editorSocket, commenterSocket, viewerSocket].map((socket) => nextMessage(socket)))
  assert.ok(threadStates.every((state) => state.type === 'comments' && state.comments.some((comment) => comment.id === sharedThread.id)))
  viewerSocket.send(JSON.stringify({ type: 'comments:update', comments: [{ ...sharedThread, resolved: true }] }))
  assert.equal((await nextMessage(viewerSocket)).code, 'COMMENT_ACCESS_REQUIRED')
  editorSocket.send(JSON.stringify({ type: 'comments:update', comments: [{ ...sharedThread, resolved: true }] }))
  const resolvedStates = await Promise.all([ownerSocket, editorSocket, commenterSocket, viewerSocket].map((socket) => nextMessage(socket)))
  assert.ok(resolvedStates.every((state) => state.type === 'comments' && state.comments.find((comment) => comment.id === sharedThread.id)?.resolved === true))
  viewerSocket.send(JSON.stringify({ type: 'operation', operation: { ...operation, id: 'viewer-op', baseRevision: 2, revision: 3 } }))
  assert.equal((await nextMessage(viewerSocket)).code, 'EDIT_ACCESS_REQUIRED')
  editorSocket.send(JSON.stringify({ type: 'operation', operation: { ...operation, id: 'stale-op', baseRevision: 1, revision: 3 } }))
  assert.equal((await nextMessage(editorSocket)).code, 'STALE_REVISION')

  step = 'checkpoint, revoke access and restore durable state'
  ownerSocket.send(JSON.stringify({ type: 'checkpoint', revision: 2, sequence: 1, snapshotBase64: 'dGVzdDI=' }))
  assert.equal((await nextMessage(ownerSocket)).type, 'checkpoint-ack')
  const snapshot = await fetch(`${base}/api/documents/${created.documentId}?token=${created.ownerToken}`).then((response) => response.json())
  assert.equal(snapshot.snapshotBase64, 'dGVzdDI='); assert.equal(snapshot.operations.length, 0)
  const editorClosed = nextClose(editorSocket)
  const presenterClosed = nextClose(editRemote)
  const revoked = await fetch(`${base}/api/documents/${created.documentId}/shares/${edit.shareId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${created.ownerToken}` } })
  assert.equal(revoked.status, 200)
  assert.equal((await nextMessage(editRemote)).type, 'ended')
  assert.equal(await presenterClosed, 4003)
  const closeCode = await editorClosed
  assert.equal(closeCode, 4003)
  assert.equal((await fetch(`${base}/api/documents/${created.documentId}?token=${edit.token}`)).status, 403)
  await stopServer()
  server = startServer()
  await waitForServer()
  const restored = await fetch(`${base}/api/documents/${created.documentId}?token=${created.ownerToken}`).then((response) => response.json())
  assert.equal(restored.snapshotBase64, 'dGVzdDI=')
  assert.equal(restored.comments[0].text, 'Looks good')
  assert.equal(restored.comments.find((item) => item.id === sharedThread.id).resolved, true)
  console.log(JSON.stringify({ status: 'PASS', checks: ['capability tokens protect private documents', 'presenter controllers receive only expiring navigation capability, live slide frame, and speaker notes', 'non-owner cannot create presenter sessions and controller token cannot access document collaboration', 'owners can list share roles without exposing bearer tokens', 'non-owners cannot inspect access links', 'edit operations persist and broadcast over WebSockets', 'comment threads and resolution state synchronize with role enforcement', 'stale revisions are rejected', 'checkpoints compact the operation log', 'revoked editor sockets are closed immediately', 'documents and comments survive a service restart'] }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: 'FAIL', step, message: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 1
} finally {
  for (const client of clients) client.close()
  await stopServer().catch(() => undefined)
  await rm(dataDir, { recursive: true, force: true })
}

function startServer() {
  return spawn(process.execPath, [join(root, 'apps/collab-server/server.mjs')], { cwd: root, env: { ...process.env, FOLIO_COLLAB_HOST: '127.0.0.1', FOLIO_COLLAB_PORT: String(port), FOLIO_COLLAB_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] })
}
async function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return
  const closed = new Promise((resolve) => server.once('close', resolve))
  server.kill('SIGTERM')
  await closed
}
async function freePort() {
  const listener = createServer()
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
  const address = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return address.port
}
async function waitForServer() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Collaboration service exited with ${server.exitCode}.`)
    try { const response = await fetch(`http://127.0.0.1:${port}/`); if (response.status === 404) return } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  throw new Error('Collaboration service did not start.')
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    messageQueues.set(socket, [])
    messageWaiters.set(socket, [])
    socket.on('message', (data) => {
      const value = JSON.parse(data.toString())
      const waiters = messageWaiters.get(socket)
      const waiter = waiters.shift()
      if (waiter) waiter(value)
      else messageQueues.get(socket).push(value)
    })
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}
function nextMessage(socket) {
  const queued = messageQueues.get(socket)
  if (queued?.length) return Promise.resolve(queued.shift())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const waiters = messageWaiters.get(socket)
      const index = waiters.indexOf(handle)
      if (index >= 0) waiters.splice(index, 1)
      reject(new Error('Timed out waiting for WebSocket message.'))
    }, 3000)
    const handle = (message) => { clearTimeout(timer); resolve(message) }
    messageWaiters.get(socket).push(handle)
  })
}
function nextClose(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('close', handle); reject(new Error('Timed out waiting for revoked connection to close.')) }, 3000)
    const handle = (code) => { clearTimeout(timer); resolve(code) }
    socket.once('close', handle)
  })
}
