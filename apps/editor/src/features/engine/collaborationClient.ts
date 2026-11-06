import type { DocumentOperation } from './documentOperations'
import type { RenderFrame } from '@folio/engine-adapter'

export type CollaborationRole = 'owner' | 'edit' | 'comment' | 'view'
export type CollaborationStatus = 'connecting' | 'connected' | 'disconnected' | 'conflict' | 'error'
export interface SharedDocument {
  readonly documentId: string
  readonly title: string
  readonly revision: number
  readonly sequence: number
  readonly snapshotSequence: number
  readonly snapshotRevision: number
  readonly snapshot: Uint8Array
  readonly operations: readonly { readonly sequence: number; readonly operation: DocumentOperation }[]
  readonly comments: readonly unknown[]
  readonly role: CollaborationRole
}
export interface SharedLink { readonly shareId: string; readonly token: string; readonly role: Exclude<CollaborationRole, 'owner'> }
export interface ManagedSharedLink { readonly shareId: string; readonly role: SharedLink['role']; readonly createdAt: number }
export interface CollaborationCallbacks {
  readonly onStatus?: (status: CollaborationStatus, detail?: string) => void
  readonly onRole?: (role: CollaborationRole) => void
  readonly onComment?: (comment: SharedComment) => void
  readonly onComments?: (comments: readonly unknown[]) => void
  readonly onSnapshotRequired?: () => void
}
export interface SharedComment { readonly id: string; readonly text: string; readonly slideIndex: number; readonly createdAt: number; readonly author: string }
export interface PresenterState { readonly title: string; readonly index: number; readonly total: number; readonly notes: string; readonly frame: RenderFrame | null }
export interface PresenterSession { readonly sessionId: string; readonly token: string }
interface CollaborationEngine {
  subscribeDocumentOperations(listener: (operation: DocumentOperation) => void): () => void
  applyRemoteOperation(operation: DocumentOperation): Promise<'applied' | 'duplicate' | 'revision-mismatch'>
}

const configuredEndpoint = (import.meta as ImportMeta & { env?: { VITE_COLLABORATION_URL?: string } }).env?.VITE_COLLABORATION_URL
const sameOriginEndpoint = typeof window === 'undefined' ? 'http://127.0.0.1:4175' : window.location.origin
export const collaborationEndpoint = (configuredEndpoint || sameOriginEndpoint).replace(/\/$/, '')

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
function operationToWire(operation: DocumentOperation): Record<string, unknown> {
  const action = operation.action.kind === 'replace-document'
    ? { ...operation.action, snapshotBase64: operation.action.snapshot ? bytesToBase64(operation.action.snapshot) : null, snapshot: undefined }
    : operation.action
  return { ...operation, action }
}
function operationFromWire(value: unknown): DocumentOperation {
  if (!value || typeof value !== 'object') throw new Error('Invalid collaboration operation.')
  const operation = value as DocumentOperation & { action: Record<string, unknown> }
  if (operation.action.kind === 'replace-document') {
    const snapshotBase64 = operation.action.snapshotBase64
    return { ...operation, action: { kind: 'replace-document', snapshot: typeof snapshotBase64 === 'string' ? base64ToBytes(snapshotBase64) : null } }
  }
  return value as DocumentOperation
}
async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${collaborationEndpoint}${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
}
async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || `Collaboration request failed (${response.status}).`)
  return body
}

export async function createSharedDocument(document: { id: string; title: string; revision: number; bytes: Uint8Array }): Promise<{ documentId: string; ownerToken: string }> {
  const response = await api('/api/documents', { method: 'POST', body: JSON.stringify({
    documentId: document.id, title: document.title, revision: document.revision, snapshotBase64: bytesToBase64(document.bytes),
  }) })
  return parseResponse(response)
}

export async function getSharedDocument(documentId: string, token: string): Promise<SharedDocument> {
  const response = await api(`/api/documents/${encodeURIComponent(documentId)}?token=${encodeURIComponent(token)}`)
  const result = await parseResponse<Omit<SharedDocument, 'snapshot' | 'operations'> & { snapshotBase64: string; operations: Array<{ sequence: number; operation: unknown }> }>(response)
  return { ...result, snapshot: base64ToBytes(result.snapshotBase64), operations: result.operations.map((entry) => ({ sequence: entry.sequence, operation: operationFromWire(entry.operation) })) }
}

export async function createSharedLink(documentId: string, ownerToken: string, role: SharedLink['role']): Promise<SharedLink> {
  const response = await api(`/api/documents/${encodeURIComponent(documentId)}/shares`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ role }),
  })
  return parseResponse(response)
}

export async function listSharedLinks(documentId: string, ownerToken: string): Promise<ManagedSharedLink[]> {
  const response = await api(`/api/documents/${encodeURIComponent(documentId)}/shares`, { headers: { Authorization: `Bearer ${ownerToken}` } })
  const result = await parseResponse<{ shares: ManagedSharedLink[] }>(response)
  return result.shares
}

export async function revokeSharedLink(documentId: string, ownerToken: string, shareId: string): Promise<void> {
  const response = await api(`/api/documents/${encodeURIComponent(documentId)}/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${ownerToken}` },
  })
  await parseResponse(response)
}

export async function createPresenterSession(documentId: string, ownerToken: string): Promise<PresenterSession> {
  const response = await api(`/api/documents/${encodeURIComponent(documentId)}/presenter-sessions`, {
    method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
  })
  return parseResponse(response)
}

export class PresenterRealtimeClient {
  private socket: WebSocket | null = null
  private latestState: PresenterState | null = null
  private stateTimer = 0
  private stateVersion = 0
  private receivedStateVersion = 0
  constructor(
    private readonly endpoint: string,
    private readonly session: PresenterSession,
    private readonly role: 'host' | 'remote',
    private readonly authToken: string,
    private readonly callbacks: { readonly onReady?: () => void; readonly onState?: (state: PresenterState) => void; readonly onNavigate?: (direction: -1 | 1) => void; readonly onEnded?: () => void },
  ) {}

  connect(): Promise<void> {
    if (this.socket) return Promise.resolve()
    const url = new URL('/api/presenter', this.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('sessionId', this.session.sessionId)
    url.searchParams.set('token', this.authToken)
    url.searchParams.set('role', this.role)
    const socket = new WebSocket(url)
    this.socket = socket
    return new Promise((resolve, reject) => {
      let settled = false
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return
        const message = JSON.parse(event.data) as Record<string, unknown>
        if (message.type === 'ready') { settled = true; this.callbacks.onReady?.(); resolve(); return }
        if (message.type === 'state' && message.state && typeof message.state === 'object') {
          const version = ++this.receivedStateVersion
          void presenterStateFromWire(message.state).then((state) => { if (version === this.receivedStateVersion) this.callbacks.onState?.(state) }).catch(() => undefined)
        }
        else if (message.type === 'navigate' && (message.direction === 1 || message.direction === -1)) this.callbacks.onNavigate?.(message.direction)
        else if (message.type === 'ended') this.callbacks.onEnded?.()
        else if (message.type === 'error' && !settled) { settled = true; reject(new Error(String(message.code ?? 'PRESENTER_ERROR'))) }
      }
      socket.onerror = () => { if (!settled) { settled = true; reject(new Error('PRESENTER_CONNECTION_FAILED')) } }
      socket.onclose = () => { if (this.socket === socket) this.socket = null; if (!settled) { settled = true; reject(new Error('PRESENTER_CONNECTION_CLOSED')) } }
    })
  }

  sendState(state: PresenterState): void {
    if (this.role !== 'host' || this.socket?.readyState !== WebSocket.OPEN) return
    this.latestState = state
    if (this.stateTimer) return
    this.stateTimer = window.setTimeout(() => {
      this.stateTimer = 0
      const next = this.latestState
      if (!next) return
      const version = ++this.stateVersion
      void encodePresenterFrame(next.frame).then((frame) => {
        if (version !== this.stateVersion || this.socket?.readyState !== WebSocket.OPEN) return
        this.socket.send(JSON.stringify({ type: 'state', state: { ...next, frame } }))
      }).catch(() => undefined)
    }, 120)
  }

  navigate(direction: -1 | 1): void {
    if (this.role === 'remote' && this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'navigate', direction }))
  }

  close(): void { if (this.stateTimer) window.clearTimeout(this.stateTimer); this.stateTimer = 0; this.stateVersion += 1; this.socket?.close(1000, 'Presenter closed'); this.socket = null }

}

async function encodePresenterFrame(frame: RenderFrame | null): Promise<null | { width: number; height: number; mimeType: string; dataBase64: string }> {
  if (!frame) return null
  const scale = Math.min(1, Math.sqrt(6_000_000 / (frame.width * frame.height)))
  const width = Math.max(1, Math.round(frame.width * scale))
  const height = Math.max(1, Math.round(frame.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Presenter preview encoder is unavailable.')
  const source = document.createElement('canvas')
  source.width = frame.width
  source.height = frame.height
  const sourceContext = source.getContext('2d')
  if (!sourceContext) throw new Error('Presenter preview encoder is unavailable.')
  sourceContext.putImageData(new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height), 0, 0)
  context.drawImage(source, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82))
    ?? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Presenter preview could not be encoded.')
  return { width, height, mimeType: blob.type || 'image/png', dataBase64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) }
}

async function presenterStateFromWire(value: unknown): Promise<PresenterState> {
  const state = value as PresenterState & { frame: null | { width: number; height: number; mimeType: string; dataBase64: string } }
  if (!state.frame) return { ...state, frame: null }
  const encoded = base64ToBytes(state.frame.dataBase64)
  const blobBuffer = new ArrayBuffer(encoded.byteLength)
  new Uint8Array(blobBuffer).set(encoded)
  const bitmap = await createImageBitmap(new Blob([blobBuffer], { type: state.frame.mimeType }))
  const canvas = document.createElement('canvas')
  canvas.width = state.frame.width
  canvas.height = state.frame.height
  const context = canvas.getContext('2d')
  if (!context) { bitmap.close(); throw new Error('Presenter preview decoder is unavailable.') }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  return { ...state, frame: { width: canvas.width, height: canvas.height, pixels: new Uint8Array(pixels) } }
}

export class CollaborationClient {
  private socket: WebSocket | null = null
  private unsubscribe: (() => void) | null = null
  private disposed = false
  private conflicted = false
  private ready = false
  private retryTimer = 0
  private receiveQueue: Promise<void> = Promise.resolve()
  private outgoing: DocumentOperation[] = []
  private lastSequence: number

  constructor(
    private readonly endpoint: string,
    private readonly documentId: string,
    private readonly token: string,
    private readonly engine: CollaborationEngine,
    initialSequence: number,
    private readonly callbacks: CollaborationCallbacks = {},
  ) { this.lastSequence = initialSequence }

  connect(): void {
    if (this.disposed || this.socket) return
    this.callbacks.onStatus?.('connecting')
    this.unsubscribe = this.engine.subscribeDocumentOperations((operation) => {
      if (operation.documentId !== this.documentId) {
        this.stopWithConflict('DOCUMENT_CHANGED')
        return
      }
      if (this.conflicted) return
      this.outgoing.push(operation)
      this.flushOutgoing()
    })
    this.openSocket()
  }

  sendComment(text: string, slideIndex: number): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.ready && !this.conflicted) {
      this.socket.send(JSON.stringify({ type: 'comment', text, slideIndex }))
    } else this.callbacks.onStatus?.('disconnected', 'COLLABORATION_OFFLINE')
  }

  sendComments(comments: readonly unknown[]): void {
    if (this.socket?.readyState === WebSocket.OPEN && this.ready && !this.conflicted) {
      this.socket.send(JSON.stringify({ type: 'comments:update', comments }))
    } else this.callbacks.onStatus?.('disconnected', 'COLLABORATION_OFFLINE')
  }

  dispose(): void {
    this.disposed = true
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
    this.retryTimer = 0
    this.socket?.close(1000, 'Client closed')
    this.socket = null
  }

  private openSocket(): void {
    const url = new URL('/api/collaboration', this.endpoint)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.searchParams.set('documentId', this.documentId)
    url.searchParams.set('token', this.token)
    url.searchParams.set('sinceSequence', String(this.lastSequence))
    const socket = new WebSocket(url)
    this.socket = socket
    socket.onmessage = (event) => {
      this.receiveQueue = this.receiveQueue.then(() => this.receive(socket, event.data)).catch((error: unknown) => {
        this.callbacks.onStatus?.('conflict', error instanceof Error ? error.message : String(error))
      })
    }
    socket.onerror = () => this.callbacks.onStatus?.('disconnected')
    socket.onclose = (event) => {
      if (this.socket !== socket) return
      this.socket = null
      this.ready = false
      if (event.code === 4009) this.callbacks.onSnapshotRequired?.()
      if (!this.disposed && !this.conflicted) {
        this.callbacks.onStatus?.('disconnected')
        this.retryTimer = window.setTimeout(() => { this.retryTimer = 0; this.openSocket() }, 1200)
      }
    }
  }

  private async receive(socket: WebSocket, data: unknown): Promise<void> {
    if (typeof data !== 'string') return
    const message = JSON.parse(data) as Record<string, unknown>
    if (message.type === 'ready') {
      if (message.documentId !== this.documentId) { this.stopWithConflict('DOCUMENT_ID_MISMATCH'); return }
      this.ready = true
      this.lastSequence = Math.max(this.lastSequence, Number(message.sequence) || 0)
      this.callbacks.onRole?.(message.role as CollaborationRole)
      if (Array.isArray(message.comments)) this.callbacks.onComments?.(message.comments)
      this.callbacks.onStatus?.('connected')
      this.flushOutgoing()
    } else if (message.type === 'operation') {
      const sequence = Number(message.sequence)
      if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence) return
      if (sequence !== this.lastSequence + 1) { this.stopWithConflict('OPERATION_GAP'); return }
      const operation = operationFromWire(message.operation)
      const result = await this.engine.applyRemoteOperation(operation)
      if (result === 'revision-mismatch') { this.stopWithConflict('REVISION_MISMATCH'); return }
      this.lastSequence = sequence
    } else if (message.type === 'ack') {
      this.lastSequence = Math.max(this.lastSequence, Number(message.sequence) || 0)
      this.outgoing = this.outgoing.filter((operation) => operation.id !== message.id)
    } else if (message.type === 'comment') {
      this.callbacks.onComment?.(message.comment as SharedComment)
    } else if (message.type === 'comments') {
      if (Array.isArray(message.comments)) this.callbacks.onComments?.(message.comments)
    } else if (message.type === 'snapshot-required') {
      this.callbacks.onSnapshotRequired?.()
      socket.close(4009, 'Snapshot required')
    } else if (message.type === 'error') {
      const code = typeof message.code === 'string' ? message.code : 'COLLABORATION_ERROR'
      if (['STALE_REVISION', 'STALE_CHECKPOINT', 'CHECKPOINT_REQUIRED', 'REVISION_MISMATCH'].includes(code)) this.stopWithConflict(code)
      else this.callbacks.onStatus?.('error', code)
    }
  }

  private flushOutgoing(): void {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN || !this.ready || this.conflicted) return
    for (const operation of this.outgoing) socket.send(JSON.stringify({ type: 'operation', operation: operationToWire(operation) }))
    // Keep the queue until acknowledgements arrive. The server deduplicates retries by operation id.
  }

  private stopWithConflict(detail: string): void {
    this.conflicted = true
    this.ready = false
    this.callbacks.onStatus?.('conflict', detail)
    this.socket?.close(4002, detail)
  }
}
