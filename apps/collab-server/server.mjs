import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { WebSocketServer, WebSocket } from 'ws'

const host = process.env.FOLIO_COLLAB_HOST ?? '127.0.0.1'
const port = Number(process.env.FOLIO_COLLAB_PORT ?? 4175)
const dataDir = resolve(process.env.FOLIO_COLLAB_DATA_DIR ?? '.folio-data/collaboration')
const configuredOrigins = (process.env.FOLIO_COLLAB_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
const MAX_BODY_BYTES = 64 * 1024 * 1024
const MAX_OPERATIONS = 10_000
const documents = new Map()
const connections = new Map()
const documentQueues = new Map()
const presenterSessions = new Map()

function hashToken(token) { return createHash('sha256').update(token).digest('hex') }
function equalHash(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function validId(id) { return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) }
function originAllowed(origin) {
  if (!origin) return true
  if (configuredOrigins.includes(origin)) return true
  if (configuredOrigins.length) return false
  try {
    const parsed = new URL(origin)
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  } catch { return false }
}
function jsonResponse(response, status, payload, origin) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
  })
  response.end(JSON.stringify(payload))
}
function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Request body too large.'), { status: 413 })); request.destroy(); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(Object.assign(new Error('Invalid JSON body.'), { status: 400 })) }
    })
    request.on('error', reject)
  })
}
function requireSnapshot(value) {
  if (typeof value !== 'string' || value.length < 4 || value.length > MAX_BODY_BYTES * 1.4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw Object.assign(new Error('Invalid presentation snapshot.'), { status: 400 })
  }
  return value
}
function persist(document) {
  const file = resolve(dataDir, `${document.id}.json`)
  const temporary = `${file}.${randomUUID()}.tmp`
  return mkdir(dirname(file), { recursive: true, mode: 0o700 })
    .then(() => writeFile(temporary, JSON.stringify(document), { mode: 0o600 }))
    .then(() => rename(temporary, file))
}
function serializeDocument(id, action) {
  const previous = documentQueues.get(id) ?? Promise.resolve()
  const result = previous.catch(() => undefined).then(action)
  const settled = result.then(() => undefined, () => undefined)
  documentQueues.set(id, settled)
  void settled.finally(() => { if (documentQueues.get(id) === settled) documentQueues.delete(id) })
  return result
}
function auth(document, token) {
  if (!document || typeof token !== 'string' || token.length < 32 || token.length > 256) return null
  const tokenHash = hashToken(token)
  if (equalHash(document.ownerHash, tokenHash)) return { role: 'owner', tokenHash }
  const share = document.shares.find((item) => equalHash(item.tokenHash, tokenHash))
  return share ? { role: share.role, tokenHash, shareId: share.id } : null
}
function bearer(request) {
  const value = request.headers.authorization
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : ''
}
function getDocument(id) { return validId(id) ? documents.get(id) : undefined }
function operationIsValid(operation, id) {
  if (!operation || typeof operation !== 'object' || operation.documentId !== id || typeof operation.id !== 'string' || operation.id.length > 128) return false
  if (!Number.isInteger(operation.baseRevision) || operation.baseRevision < 0 || !Number.isInteger(operation.revision) || operation.revision < 0) return false
  const action = operation.action
  if (!action || typeof action !== 'object') return false
  if (action.kind === 'commands') return Array.isArray(action.commands) && action.commands.length > 0 && action.commands.length <= 64
  if (action.kind === 'pointer') return Array.isArray(action.inputs) && action.inputs.length > 0 && action.inputs.length <= 4096
  if (action.kind === 'key') return !!action.input && typeof action.input.key === 'string'
  if (action.kind === 'text') return typeof action.text === 'string' && action.text.length <= 1_000_000 && ['insert', 'commit'].includes(action.mode)
  if (action.kind === 'undo' || action.kind === 'redo') return true
  if (action.kind === 'insert-shapes') return Array.isArray(action.shapes) && action.shapes.length <= 1000
  if (action.kind === 'replace-document') return action.snapshotBase64 === null || typeof action.snapshotBase64 === 'string'
  return false
}

const server = createServer(async (request, response) => {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : ''
  if (!originAllowed(origin)) { jsonResponse(response, 403, { error: 'ORIGIN_FORBIDDEN' }); return }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'Access-Control-Allow-Origin': origin || 'null', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' })
    response.end()
    return
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (request.method === 'GET' && url.pathname === '/healthz') { jsonResponse(response, 200, { status: 'ok' }, origin); return }
  const match = /^\/api\/documents\/([^/]+)(?:\/shares(?:\/([^/]+))?|\/checkpoint|\/presenter-sessions)?$/.exec(url.pathname)
  try {
    if (request.method === 'POST' && url.pathname === '/api/documents') {
      const body = await readJson(request)
      if (body.documentId !== undefined && !validId(body.documentId)) { jsonResponse(response, 400, { error: 'INVALID_DOCUMENT_ID' }, origin); return }
      const id = body.documentId ?? randomUUID()
      if (documents.has(id)) { jsonResponse(response, 409, { error: 'DOCUMENT_EXISTS' }, origin); return }
      const ownerToken = randomBytes(32).toString('base64url')
      const document = {
        id, title: typeof body.title === 'string' ? body.title.slice(0, 240) : 'Sunum',
        revision: Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : 0,
        sequence: 0, snapshotSequence: 0,
        snapshotRevision: Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : 0,
        snapshotBase64: requireSnapshot(body.snapshotBase64), ownerHash: hashToken(ownerToken),
        shares: [], operations: [], comments: [], createdAt: Date.now(), updatedAt: Date.now(),
      }
      await persist(document)
      documents.set(id, document)
      jsonResponse(response, 201, { documentId: id, ownerToken }, origin)
      return
    }
    if (!match) { jsonResponse(response, 404, { error: 'NOT_FOUND' }, origin); return }
    const [, id, shareId] = match
    const document = getDocument(id)
    if (!document) { jsonResponse(response, 404, { error: 'DOCUMENT_NOT_FOUND' }, origin); return }
    const credential = auth(document, url.searchParams.get('token') ?? bearer(request))
    if (!credential) { jsonResponse(response, 403, { error: 'ACCESS_DENIED' }, origin); return }

    if (request.method === 'POST' && url.pathname === `/api/documents/${id}/presenter-sessions`) {
      if (!['owner', 'edit'].includes(credential.role)) { jsonResponse(response, 403, { error: 'PRESENT_ACCESS_REQUIRED' }, origin); return }
      const now = Date.now()
      for (const [sessionId, session] of presenterSessions) if (session.expiresAt <= now) {
        for (const peer of session.sockets) { peer.send(JSON.stringify({ type: 'ended' })); peer.close(4003, 'Presenter session expired') }
        clearTimeout(session.expiryTimer)
        presenterSessions.delete(sessionId)
      }
      const sessionId = randomUUID()
      const token = randomBytes(32).toString('base64url')
      const session = { documentId: id, hostTokenHash: credential.tokenHash, hostShareId: credential.shareId ?? null, tokenHash: hashToken(token), expiresAt: now + 8 * 60 * 60 * 1000, sockets: new Set(), host: null, state: null, expiryTimer: null }
      session.expiryTimer = setTimeout(() => {
        for (const peer of session.sockets) { peer.send(JSON.stringify({ type: 'ended' })); peer.close(4003, 'Presenter session expired') }
        presenterSessions.delete(sessionId)
      }, session.expiresAt - now)
      session.expiryTimer.unref()
      presenterSessions.set(sessionId, session)
      jsonResponse(response, 201, { sessionId, token }, origin)
      return
    }

    if (request.method === 'GET' && url.pathname === `/api/documents/${id}`) {
      jsonResponse(response, 200, {
        documentId: id, title: document.title, revision: document.revision,
        sequence: document.sequence, snapshotSequence: document.snapshotSequence ?? 0,
        snapshotRevision: document.snapshotRevision ?? 0, snapshotBase64: document.snapshotBase64,
        operations: document.operations, comments: document.comments,
        role: credential.role,
      }, origin)
      return
    }
    if (request.method === 'GET' && url.pathname === `/api/documents/${id}/shares`) {
      if (credential.role !== 'owner') { jsonResponse(response, 403, { error: 'OWNER_REQUIRED' }, origin); return }
      jsonResponse(response, 200, { shares: document.shares.map(({ id: shareId, role, createdAt }) => ({ shareId, role, createdAt })) }, origin)
      return
    }
    if (request.method === 'POST' && url.pathname === `/api/documents/${id}/shares`) {
      if (credential.role !== 'owner') { jsonResponse(response, 403, { error: 'OWNER_REQUIRED' }, origin); return }
      const body = await readJson(request)
      if (!['edit', 'comment', 'view'].includes(body.role)) { jsonResponse(response, 400, { error: 'INVALID_ROLE' }, origin); return }
      await serializeDocument(id, async () => {
        const token = randomBytes(32).toString('base64url')
        const share = { id: randomUUID(), role: body.role, tokenHash: hashToken(token), createdAt: Date.now() }
        const previous = [...document.shares]
        document.shares.push(share)
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch { document.shares = previous; throw new Error('Persistence failed.') }
        jsonResponse(response, 201, { shareId: share.id, token, role: share.role }, origin)
      })
      return
    }
    if (request.method === 'DELETE' && url.pathname === `/api/documents/${id}/shares/${shareId}`) {
      if (credential.role !== 'owner') { jsonResponse(response, 403, { error: 'OWNER_REQUIRED' }, origin); return }
      await serializeDocument(id, async () => {
        const index = document.shares.findIndex((share) => share.id === shareId)
        if (index < 0) { jsonResponse(response, 404, { error: 'SHARE_NOT_FOUND' }, origin); return }
        const [revoked] = document.shares.splice(index, 1)
        const previous = [...document.shares, revoked]
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch { document.shares = previous; throw new Error('Persistence failed.') }
        for (const socket of connections.get(id) ?? []) if (socket.shareId === revoked.id && socket.readyState === WebSocket.OPEN) socket.close(4003, 'Access revoked')
        for (const [sessionId, session] of presenterSessions) if (session.documentId === id && session.hostShareId === revoked.id) {
          for (const socket of session.sockets) { socket.send(JSON.stringify({ type: 'ended' })); socket.close(4003, 'Access revoked') }
          clearTimeout(session.expiryTimer)
          presenterSessions.delete(sessionId)
        }
        jsonResponse(response, 200, { revoked: true }, origin)
      })
      return
    }
    if (request.method === 'POST' && url.pathname === `/api/documents/${id}/checkpoint`) {
      if (!['owner', 'edit'].includes(credential.role)) { jsonResponse(response, 403, { error: 'EDIT_ACCESS_REQUIRED' }, origin); return }
      const body = await readJson(request)
      await serializeDocument(id, async () => {
        if (body.revision !== document.revision || body.sequence !== document.sequence) { jsonResponse(response, 409, { error: 'STALE_CHECKPOINT', revision: document.revision, sequence: document.sequence }, origin); return }
        document.snapshotBase64 = requireSnapshot(body.snapshotBase64)
        document.operations = []
        document.snapshotSequence = document.sequence
        document.snapshotRevision = document.revision
        document.updatedAt = Date.now()
        await persist(document)
        jsonResponse(response, 200, { checkpointed: true, revision: document.revision, sequence: document.sequence }, origin)
      })
      return
    }
    jsonResponse(response, 404, { error: 'NOT_FOUND' }, origin)
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500
    if (status >= 500) process.stderr.write(`collaboration request failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    if (!response.headersSent) jsonResponse(response, status, { error: status === 500 ? 'INTERNAL_ERROR' : error.message }, origin)
    else response.destroy()
  }
})

const webSockets = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY_BYTES })
server.on('upgrade', (request, socket, head) => {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : ''
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (url.pathname === '/api/presenter' && originAllowed(origin)) {
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const session = presenterSessions.get(sessionId)
    const role = url.searchParams.get('role') ?? ''
    const document = session && documents.get(session.documentId)
    const token = url.searchParams.get('token') ?? ''
    const hostCredential = document && auth(document, token)
    const isHost = role === 'host' && hostCredential && equalHash(hostCredential.tokenHash, session?.hostTokenHash ?? '') && ['owner', 'edit'].includes(hostCredential.role) && (!session.host || session.host.readyState !== WebSocket.OPEN)
    const isRemote = role === 'remote' && session && token.length >= 32 && equalHash(session.tokenHash, hashToken(token)) && !!session.host
    if (!session || session.expiresAt <= Date.now() || (!isHost && !isRemote)) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.presenterSession = session
      webSocket.presenterRole = role
      webSockets.emit('connection', webSocket, request)
    })
    return
  }
  const id = url.searchParams.get('documentId') ?? ''
  const document = getDocument(id)
  const credential = document && originAllowed(origin) ? auth(document, url.searchParams.get('token') ?? '') : null
  if (url.pathname !== '/api/collaboration' || !credential) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
  const sinceSequence = Number(url.searchParams.get('sinceSequence') ?? 0)
  if (!Number.isSafeInteger(sinceSequence) || sinceSequence < 0) { socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.documentId = id
    webSocket.role = credential.role
    webSocket.shareId = credential.shareId
    webSocket.tokenHash = credential.tokenHash
    webSocket.sinceSequence = sinceSequence
    webSockets.emit('connection', webSocket, request)
  })
})
webSockets.on('connection', (socket) => {
  if (socket.presenterSession) {
    const session = socket.presenterSession
    const peers = session.sockets
    peers.add(socket)
    if (socket.presenterRole === 'host') session.host = socket
    socket.send(JSON.stringify({ type: 'ready', role: socket.presenterRole }))
    if (socket.presenterRole === 'remote' && session.state) socket.send(JSON.stringify({ type: 'state', state: session.state }))
    socket.on('close', () => {
      peers.delete(socket)
      if (session.host === socket) {
        session.host = null
        for (const peer of peers) { peer.send(JSON.stringify({ type: 'ended' })); peer.close(4003, 'Presenter ended') }
        for (const [sessionId, activeSession] of presenterSessions) if (activeSession === session) {
          clearTimeout(session.expiryTimer)
          presenterSessions.delete(sessionId)
          break
        }
      }
    })
    socket.on('message', (raw) => {
      let message
      try { message = JSON.parse(raw.toString()) } catch { socket.send(JSON.stringify({ type: 'error', code: 'INVALID_MESSAGE' })); return }
      if (socket.presenterRole === 'remote') {
        if (message.type !== 'navigate' || ![-1, 1].includes(message.direction)) { socket.send(JSON.stringify({ type: 'error', code: 'INVALID_COMMAND' })); return }
        if (session.host?.readyState === WebSocket.OPEN) session.host.send(JSON.stringify({ type: 'navigate', direction: message.direction }))
        return
      }
      if (message.type !== 'state' || !message.state || typeof message.state !== 'object') { socket.send(JSON.stringify({ type: 'error', code: 'INVALID_STATE' })); return }
      const state = message.state
      const frame = state.frame
      if (typeof state.title !== 'string' || state.title.length > 240 || typeof state.notes !== 'string' || state.notes.length > 20_000 || !Number.isSafeInteger(state.index) || !Number.isSafeInteger(state.total) || state.index < 0 || state.total < 1 || state.index >= state.total || (frame !== null && (!frame || !Number.isSafeInteger(frame.width) || !Number.isSafeInteger(frame.height) || frame.width < 1 || frame.height < 1 || frame.width * frame.height > 6_000_000 || !['image/webp', 'image/png'].includes(frame.mimeType) || typeof frame.dataBase64 !== 'string' || frame.dataBase64.length > 12_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.dataBase64)))) {
        socket.send(JSON.stringify({ type: 'error', code: 'INVALID_STATE' })); return
      }
      session.state = state
      const envelope = JSON.stringify({ type: 'state', state })
      for (const peer of peers) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(envelope)
    })
    return
  }
  const id = socket.documentId
  const document = documents.get(id)
  const group = connections.get(id) ?? new Set()
  group.add(socket)
  connections.set(id, group)
  if (socket.sinceSequence < (document.snapshotSequence ?? 0)) {
    socket.send(JSON.stringify({ type: 'snapshot-required', snapshotSequence: document.snapshotSequence ?? 0, sequence: document.sequence }))
    socket.close(4009, 'Snapshot required')
    return
  }
  socket.send(JSON.stringify({ type: 'ready', documentId: id, role: socket.role, revision: document.revision, sequence: socket.sinceSequence, headSequence: document.sequence, snapshotSequence: document.snapshotSequence ?? 0, comments: document.comments }))
  for (const entry of document.operations) if (entry.sequence > socket.sinceSequence) socket.send(JSON.stringify({ type: 'operation', sequence: entry.sequence, operation: entry.operation }))
  socket.on('close', () => { group.delete(socket); if (!group.size) connections.delete(id) })
  socket.on('message', (raw) => {
    void serializeDocument(id, async () => {
      const message = JSON.parse(raw.toString())
      if (message.type === 'operation') {
        if (!['owner', 'edit'].includes(socket.role)) { socket.send(JSON.stringify({ type: 'error', code: 'EDIT_ACCESS_REQUIRED' })); return }
        const operation = message.operation
        if (!operationIsValid(operation, id)) { socket.send(JSON.stringify({ type: 'error', code: 'INVALID_OPERATION' })); return }
        const duplicate = document.operations.find((entry) => entry.operation.id === operation.id)
        if (duplicate) { socket.send(JSON.stringify({ type: 'ack', id: operation.id, sequence: duplicate.sequence, revision: document.revision, duplicate: true })); return }
        if (operation.action.kind !== 'replace-document' && operation.baseRevision !== document.revision) {
          socket.send(JSON.stringify({ type: 'error', code: 'STALE_REVISION', revision: document.revision, sequence: document.sequence }))
          return
        }
        if (document.operations.length >= MAX_OPERATIONS) { socket.send(JSON.stringify({ type: 'error', code: 'CHECKPOINT_REQUIRED', revision: document.revision, sequence: document.sequence })); return }
        const previous = { revision: document.revision, sequence: document.sequence, snapshotBase64: document.snapshotBase64, snapshotRevision: document.snapshotRevision, snapshotSequence: document.snapshotSequence, operations: [...document.operations], updatedAt: document.updatedAt }
        if (operation.action.kind === 'replace-document' && operation.action.snapshotBase64 !== null) {
          document.snapshotBase64 = requireSnapshot(operation.action.snapshotBase64)
          document.operations = []
          document.snapshotRevision = operation.revision
          document.snapshotSequence = document.sequence + 1
        }
        document.sequence += 1
        document.revision = operation.revision
        document.operations.push({ sequence: document.sequence, operation })
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch {
          Object.assign(document, previous)
          socket.send(JSON.stringify({ type: 'error', code: 'PERSISTENCE_ERROR' }))
          return
        }
        const envelope = JSON.stringify({ type: 'operation', sequence: document.sequence, operation })
        for (const peer of connections.get(id) ?? []) if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(envelope)
        socket.send(JSON.stringify({ type: 'ack', id: operation.id, sequence: document.sequence, revision: document.revision }))
      } else if (message.type === 'comment') {
        if (socket.role === 'view') { socket.send(JSON.stringify({ type: 'error', code: 'COMMENT_ACCESS_REQUIRED' })); return }
        const text = typeof message.text === 'string' ? message.text.trim() : ''
        if (!text || text.length > 20_000) { socket.send(JSON.stringify({ type: 'error', code: 'INVALID_COMMENT' })); return }
        const comment = { id: randomUUID(), text, slideIndex: Number.isInteger(message.slideIndex) && message.slideIndex >= 0 ? message.slideIndex : 0, createdAt: Date.now(), author: 'Ortak çalışan' }
        const previous = { comments: [...document.comments], updatedAt: document.updatedAt }
        document.comments.push(comment)
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch { Object.assign(document, previous); socket.send(JSON.stringify({ type: 'error', code: 'PERSISTENCE_ERROR' })); return }
        const envelope = JSON.stringify({ type: 'comment', comment })
        for (const peer of connections.get(id) ?? []) if (peer.readyState === WebSocket.OPEN) peer.send(envelope)
      } else if (message.type === 'comments:update') {
        if (socket.role === 'view') { socket.send(JSON.stringify({ type: 'error', code: 'COMMENT_ACCESS_REQUIRED' })); return }
        if (!Array.isArray(message.comments) || message.comments.length > 2000 || Buffer.byteLength(JSON.stringify(message.comments)) > 2_000_000) {
          socket.send(JSON.stringify({ type: 'error', code: 'INVALID_COMMENTS' })); return
        }
        const incoming = message.comments
        if (incoming.some((comment) => !comment || typeof comment !== 'object' || typeof comment.id !== 'string' || comment.id.length > 128 || typeof comment.text !== 'string' || comment.text.length > 20_000 || typeof comment.author !== 'string' || comment.author.length > 120 || typeof comment.slideId !== 'string' || comment.slideId.length > 128 || (comment.replies !== undefined && (!Array.isArray(comment.replies) || comment.replies.length > 200)))) {
          socket.send(JSON.stringify({ type: 'error', code: 'INVALID_COMMENTS' })); return
        }
        const merged = new Map(document.comments.map((comment) => [comment.id, comment]))
        for (const comment of incoming) merged.set(comment.id, comment)
        const previous = { comments: [...document.comments], updatedAt: document.updatedAt }
        document.comments = [...merged.values()].slice(-2000)
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch { Object.assign(document, previous); socket.send(JSON.stringify({ type: 'error', code: 'PERSISTENCE_ERROR' })); return }
        const envelope = JSON.stringify({ type: 'comments', comments: document.comments })
        for (const peer of connections.get(id) ?? []) if (peer.readyState === WebSocket.OPEN) peer.send(envelope)
      } else if (message.type === 'checkpoint') {
        if (!['owner', 'edit'].includes(socket.role)) { socket.send(JSON.stringify({ type: 'error', code: 'EDIT_ACCESS_REQUIRED' })); return }
        if (message.revision !== document.revision || message.sequence !== document.sequence) { socket.send(JSON.stringify({ type: 'error', code: 'STALE_CHECKPOINT', revision: document.revision, sequence: document.sequence })); return }
        const previous = { snapshotBase64: document.snapshotBase64, snapshotRevision: document.snapshotRevision, snapshotSequence: document.snapshotSequence, operations: [...document.operations], updatedAt: document.updatedAt }
        document.snapshotBase64 = requireSnapshot(message.snapshotBase64)
        document.operations = []
        document.snapshotSequence = document.sequence
        document.snapshotRevision = document.revision
        document.updatedAt = Date.now()
        try { await persist(document) }
        catch { Object.assign(document, previous); socket.send(JSON.stringify({ type: 'error', code: 'PERSISTENCE_ERROR' })); return }
        socket.send(JSON.stringify({ type: 'checkpoint-ack', sequence: document.sequence, revision: document.revision }))
      } else socket.send(JSON.stringify({ type: 'error', code: 'UNKNOWN_MESSAGE' }))
    }).catch((error) => {
      socket.send(JSON.stringify({ type: 'error', code: error?.status === 400 ? 'INVALID_MESSAGE' : 'PERSISTENCE_ERROR' }))
    })
  })
})

await mkdir(dataDir, { recursive: true })
for (const entry of await import('node:fs/promises').then((fs) => fs.readdir(dataDir))) {
  if (!entry.endsWith('.json')) continue
  try {
    const document = JSON.parse(await readFile(resolve(dataDir, entry), 'utf8'))
    if (validId(document.id) && typeof document.ownerHash === 'string' && Array.isArray(document.shares) && Array.isArray(document.operations)) documents.set(document.id, document)
  } catch { process.stderr.write(`skipping invalid collaboration store entry: ${entry}\n`) }
}
server.listen(port, host, () => process.stdout.write(`Folio collaboration service listening on http://${host}:${port}\n`))

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  for (const socket of webSockets.clients) socket.close(1001, 'Server shutting down')
  webSockets.close()
  server.close(() => process.exit(0))
})
