export type SessionId = string & { readonly __sessionId: unique symbol }
export type SlideId = string & { readonly __slideId: unique symbol }

export interface EngineError {
  code: string
  message: string
  retryable: boolean
  operationId?: string
}

export class EngineAdapterError extends Error implements EngineError {
  readonly code: string
  readonly retryable: boolean
  readonly operationId: string

  constructor(error: Partial<EngineError>, operationId: string) {
    super(error.message || 'The presentation engine operation failed.')
    this.name = 'EngineAdapterError'
    this.code = error.code || 'UNKNOWN_ERROR'
    this.retryable = error.retryable ?? false
    this.operationId = operationId
  }
}

export type EngineCommand =
  | { type: 'slide.new'; params: { layout?: string } }
  | { type: 'slide.delete'; params: { id: number | string } }
  | { type: 'slide.duplicate'; params?: Record<string, never> }
  | { type: 'shape.insert'; params: { preset: string; rect: [number, number, number, number] } }
  | { type: 'insert.textBox'; params: { rect: [number, number, number, number]; text?: string } }
  | { type: 'text.insert'; params: { text: string } }
  | { type: 'text.edit'; params: { id: number | string; at?: [number, number] } }
  | { type: 'format.font'; params: { family: string } }
  | { type: 'edit.copy' | 'edit.paste' | 'edit.undo' | 'edit.redo'; params?: Record<string, never> }
  | { type: 'shape.delete'; params?: Record<string, never> }
  | { type: 'custom'; name: string; params: Record<string, unknown> }

export interface EngineUpdate {
  result: unknown
  revision: number
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
}
export interface EngineInfo { engine: 'deckcraft'; revision: string; protocolVersion: 1 }
export interface DocumentSummary {
  revision: number; title: string; activeSlideIndex: number; dirty: boolean; canUndo: boolean; canRedo: boolean
  slides: Array<{ id: SlideId; title: string }>
}
export interface SlideProjection {
  id: SlideId; title: string
  shapes: Array<{ id: string; name: string; rect: [number, number, number, number] | null; text: string | null; fontFamilies: string[] | null }>
}
export interface SelectionProjection { slideId: SlideId | null; shapeIds: string[]; textSelection: unknown; isComposing: boolean }
export interface RenderFrame { width: number; height: number; pixels: Uint8Array }
export interface PointerInput { kind: 'down' | 'drag' | 'up' | 'move' | 'doubleClick' | 'tripleClick' | 'contextClick'; x: number; y: number; modifiers?: ModifierState }
export interface ModifierState { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; cmd?: boolean }
export interface KeyInput { key: string; modifiers?: ModifierState }
export interface ImportResult extends DocumentSummary { importedSlideCount: number }

interface WasmSession {
  free(): void
  execute(command: string, paramsJson: string): unknown
  createBlankSlide(): unknown
  insertShapesBatch(shapesJson: string): unknown
  pointer(kind: string, x: number, y: number, modsJson: string): unknown
  key(key: string, modsJson: string): unknown
  composeText(text: string, activeJson: string): unknown
  commitText(text: string): unknown
  getDocumentSummary(): DocumentSummary
  getSlideProjection(slideId: string): SlideProjection
  getSelectionProjection(): SelectionProjection
  renderSlide(slideId: string, scale: number): RenderFrame
  undo(): unknown
  redo(): unknown
  importPptx(bytes: Uint8Array): ImportResult
  exportPptx(): Uint8Array
}
interface WasmModule { default(): Promise<unknown>; createSession(): WasmSession }
type WasmLoader = () => Promise<WasmModule>

export interface EngineAdapter {
  initialize(): Promise<EngineInfo>
  createSession(): Promise<SessionId>
  createBlankSlide(id: SessionId): Promise<EngineUpdate>
  createBlankSlide(id: SessionId): Promise<EngineUpdate>
  closeSession(id: SessionId): void
  execute(id: SessionId, command: EngineCommand): Promise<EngineUpdate>
  insertShapesBatch(id: SessionId, shapes: unknown[]): Promise<EngineUpdate>
  pointer(id: SessionId, input: PointerInput): Promise<EngineUpdate>
  key(id: SessionId, input: KeyInput): Promise<EngineUpdate>
  composeText(id: SessionId, text: string, active?: [number, number]): Promise<EngineUpdate>
  commitText(id: SessionId, text: string): Promise<EngineUpdate>
  getDocumentSummary(id: SessionId): Promise<DocumentSummary>
  getSlideProjection(id: SessionId, slideId: SlideId): Promise<SlideProjection>
  getSelectionProjection(id: SessionId): Promise<SelectionProjection>
  renderSlide(id: SessionId, slideId: SlideId, scale: number): Promise<RenderFrame>
  undo(id: SessionId): Promise<EngineUpdate>
  redo(id: SessionId): Promise<EngineUpdate>
  importPptx(id: SessionId, bytes: Uint8Array): Promise<ImportResult>
  exportPptx(id: SessionId): Promise<Uint8Array>
}

function newOperationId(): string { return globalThis.crypto?.randomUUID?.() ?? `engine-${Date.now()}-${Math.random().toString(16).slice(2)}` }
function parseError(value: unknown): Partial<EngineError> {
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    return { code: typeof candidate.code === 'string' ? candidate.code : undefined,
      message: typeof candidate.message === 'string' ? candidate.message : undefined,
      retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : undefined }
  }
  return { message: value instanceof Error ? value.message : String(value) }
}
function asUpdate(value: unknown): EngineUpdate { return value as EngineUpdate }
const defaultLoader: WasmLoader = async () => {
  const base = `${(import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'}wasm/folio_wasm.js`
  const module = await import(/* @vite-ignore */ base) as WasmModule
  await module.default()
  return module
}

export function createEngineAdapter(loadWasm: WasmLoader = defaultLoader): EngineAdapter {
  let modulePromise: Promise<WasmModule> | undefined
  const sessions = new Map<SessionId, WasmSession>()
  const initialize = (): Promise<WasmModule> => {
    modulePromise ??= loadWasm().catch((error: unknown) => { modulePromise = undefined; throw error })
    return modulePromise
  }
  const get = (id: SessionId): WasmSession => {
    const session = sessions.get(id)
    if (!session) throw new EngineAdapterError({ code: 'SESSION_NOT_FOUND', message: `Session ${id} is not open.`, retryable: false }, newOperationId())
    return session
  }
  const run = async <T>(operation: (session: WasmSession) => T, id: SessionId): Promise<T> => {
    const operationId = newOperationId()
    try { return operation(get(id)) }
    catch (error) { throw new EngineAdapterError(parseError(error), operationId) }
  }
  return {
    async initialize() { try { await initialize(); return { engine: 'deckcraft', revision: '19dceffd0bf3cbc79f9aaaf23fe3e05932fb434d', protocolVersion: 1 } }
      catch (error) { throw new EngineAdapterError({ code: 'WASM_LOAD_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true }, newOperationId()) } },
    async createSession() {
      try { const wasm = await initialize(); const id = newOperationId() as SessionId; sessions.set(id, wasm.createSession()); return id }
      catch (error) { throw new EngineAdapterError({ code: 'WASM_LOAD_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true }, newOperationId()) }
    },
    closeSession(id) { const session = sessions.get(id); if (session) { sessions.delete(id); session.free() } },
    createBlankSlide(id) { return run((s) => asUpdate(s.createBlankSlide()), id) },
    execute(id, command) { return run((s) => asUpdate(s.execute(command.type === 'custom' ? command.name : command.type, JSON.stringify(command.params ?? {}))), id) },
    insertShapesBatch(id, shapes) { return run((s) => asUpdate(s.insertShapesBatch(JSON.stringify(shapes))), id) },
    pointer(id, input) { return run((s) => asUpdate(s.pointer(input.kind, input.x, input.y, JSON.stringify(input.modifiers ?? {}))), id) },
    key(id, input) { return run((s) => asUpdate(s.key(input.key, JSON.stringify(input.modifiers ?? {}))), id) },
    composeText(id, text, active) { return run((s) => asUpdate(s.composeText(text, active ? JSON.stringify(active) : '')), id) },
    commitText(id, text) { return run((s) => asUpdate(s.commitText(text)), id) },
    getDocumentSummary(id) { return run((s) => s.getDocumentSummary(), id) },
    getSlideProjection(id, slideId) { return run((s) => s.getSlideProjection(slideId), id) },
    getSelectionProjection(id) { return run((s) => s.getSelectionProjection(), id) },
    renderSlide(id, slideId, scale) { return run((s) => s.renderSlide(slideId, scale), id) },
    undo(id) { return run((s) => asUpdate(s.undo()), id) },
    redo(id) { return run((s) => asUpdate(s.redo()), id) },
    importPptx(id, bytes) { return run((s) => s.importPptx(bytes), id) },
    exportPptx(id) { return run((s) => s.exportPptx(), id) },
  }
}
