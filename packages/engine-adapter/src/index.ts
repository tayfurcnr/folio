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
  | { type: 'slide.new'; params: { layout?: string; at?: number } }
  | { type: 'slide.go'; params: { id?: string; index?: number } }
  | { type: 'slide.move'; params: { from?: number; ids?: string[]; to: number } }
  | { type: 'slide.delete'; params: { index?: number; ids?: number[] } }
  | { type: 'slide.duplicate'; params?: Record<string, never> }
  | { type: 'shape.insert'; params: { preset: string; rect: [number, number, number, number]; text?: string } }
  | { type: 'insert.textBox'; params: { rect: [number, number, number, number]; text?: string } }
  | { type: 'text.insert'; params: { text: string } }
  | { type: 'text.edit'; params: { id: number | string; at?: [number, number] } }
  | { type: 'format.font'; params: { family: string } }
  | { type: 'edit.cut' | 'edit.copy' | 'edit.paste' | 'edit.selectAll' | 'edit.undo' | 'edit.redo' | 'edit.delete'; params?: Record<string, never> }
  | { type: 'custom'; name: string; params: Record<string, unknown> }

export interface EngineUpdate {
  result: unknown
  revision: number
  dirty: boolean
  canUndo: boolean
  canRedo: boolean
  toolGuides?: SmartGuide[]
  mediaRequests?: MediaPlaybackRequest[]
  uiRequests?: Array<Record<string, unknown>>
}
export interface MediaPlaybackRequest { kind: 'media'; action: string; shape: string | number; ms?: number | null }
export interface SmartGuide { vertical: boolean; pos: number; from: number; to: number }
export interface EngineInfo { engine: 'deckcraft'; revision: string; protocolVersion: 1 }
export interface DocumentSummary {
  revision: number; title: string; activeSlideIndex: number; dirty: boolean; canUndo: boolean; canRedo: boolean; slideSize: [number, number]
  slides: Array<{ id: SlideId; title: string; hidden?: boolean }>
  sections: Array<{ name: string; slideIds: SlideId[] }>
}
export interface SlideProjection {
  id: SlideId; title: string; notes: string; backgroundColor?: string | null; backgroundType?: 'solid' | 'gradient' | 'image' | 'pattern' | 'none' | 'unknown'; transition?: { kind: string; option: string; durationMs: number; advanceOnClick: boolean; advanceAfterMs: number | null } | null
  shapes: Array<{ id: string; name: string; hidden: boolean; locked?: boolean; group?: boolean; textBox?: boolean; preset?: string | null; altText?: string; decorative?: boolean; clickAction?: { action: { kind: string; url?: string; slide?: number | string }; tooltip?: string } | null; textBoxOptions?: { wrap: boolean | null; autofit: 'none' | 'shrink' | 'resize' | null; margins: [number | null, number | null, number | null, number | null]; columns?: number | null; columnSpacing?: number | null; direction?: string | null; anchor?: string | null } | null; textWarp?: string | null; placeholder?: boolean; pictureCrop?: [number, number, number, number] | null; pictureEffect?: string | null; pictureAdjust?: { brightness: number; contrast: number; saturation: number; grayscale: boolean; transparency: number } | null; media?: { contentType: string; video: boolean; durationMs: number; width: number; height: number; autoplay: boolean; loop: boolean; rewind: boolean; acrossSlides: boolean; hide: boolean; fullScreen: boolean; volume: number; trimStart: number; trimEnd: number; fadeIn: number; fadeOut: number } | null; chart?: { type: string; title: string | null; categories: string[]; series: Array<{ name: string; values: Array<number | null> }> } | null; table?: { rows: number; columns: number; style: string; headerRow: boolean; totalRow: boolean; bandedRows: boolean; firstColumn: boolean; lastColumn: boolean; bandedColumns: boolean; cells: string[][]; merges: Array<[number, number, number, number]> } | null; rect: [number, number, number, number] | null; rotation?: number | null; flipH?: boolean | null; flipV?: boolean | null; lineWidth?: number | null; lineDash?: string | null; elementOpacity?: number | null; text: string | null; fontFamilies: string[] | null; fontSizes?: number[] | null; characterSpacings?: number[] | null; paragraphLineSpacings?: Array<{ kind: 'pct' | 'pt'; value: number }> | null; paragraphAlignments?: string[] | null; paragraphBullets?: string[] | null; paragraphTabs?: Array<Array<{ pos: number; align: string }>> | null; paragraphRtl?: boolean[] | null; textStyles?: Array<{ text: string; bold: boolean; italic: boolean; underline: boolean; outlineColor?: string | null; outlineWidth?: number | null; shadow?: boolean; shadowColor?: string | null; shadowBlur?: number | null; shadowDistance?: number | null; shadowAngle?: number | null; glow?: boolean; glowColor?: string | null; glowRadius?: number | null }> | null; textParagraphs?: Array<{ runs: Array<{ text: string; bold: boolean; italic: boolean; underline: boolean; font?: string | null; size?: number | null; color?: string | null }> }> | null }>
}
export interface SelectionProjection { slideId: SlideId | null; shapeIds: string[]; textSelection: unknown; cells?: [string, [number, number], [number, number]] | null; caretLine?: [number, number, number, number] | null; isComposing: boolean; marquee?: [number, number, number, number] | null }
export interface RenderFrame { width: number; height: number; pixels: Uint8Array }
export interface MovePreviewFrames { activeBackground: RenderFrame; overflowBackground: RenderFrame; selectedShapes: RenderFrame; selectedActiveShapes: RenderFrame }
export interface SelectedPreviewFrames { selectedShapes: RenderFrame; selectedActiveShapes: RenderFrame }
export interface SelectedShapeGeometry { id: string; rect: [number, number, number, number] | null; rotation: number | null; flipH?: boolean | null; flipV?: boolean | null }
export interface PointerInput { kind: 'down' | 'drag' | 'up' | 'move' | 'doubleClick' | 'tripleClick' | 'contextClick'; x: number; y: number; modifiers?: ModifierState }
export interface HitTestResult { kind: string; id?: string | number; handle?: number; text?: boolean; locked?: boolean }
export interface ModifierState { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; cmd?: boolean }
export interface KeyInput { key: string; modifiers?: ModifierState }
export interface ImportResult extends DocumentSummary { importedSlideCount: number }

interface WasmSession {
  free(): void
  setInkTool(mode: string): void
  setSelectTool(): void
  setLocale(locale: string): void
  getFontFamilies(): string[]
  getMediaBytes(shapeId: string): Uint8Array
  execute(command: string, paramsJson: string): unknown
  typeText(text: string): unknown
  createBlankSlide(): unknown
  insertShapesBatch(payloadJson: string): unknown
  pointer(kind: string, x: number, y: number, modsJson: string): unknown
  hitTest(x: number, y: number, tolerance: number): HitTestResult | null
  key(key: string, modsJson: string): unknown
  composeText(text: string, activeJson: string): unknown
  commitText(text: string): unknown
  wasmMemoryBytes(): number
  getDocumentSummary(): DocumentSummary
  getSlideProjection(slideId: string): SlideProjection
  getSelectedShapeGeometry(slideId: string, selectedIdsJson: string): SelectedShapeGeometry[]
  getSelectionProjection(): SelectionProjection
  renderSlide(slideId: string, scale: number): RenderFrame
  renderSlideOverflow(slideId: string, scale: number, margin: number): RenderFrame
  renderMovePreview(slideId: string, scale: number, margin: number, selectedIdsJson: string): MovePreviewFrames
  renderSelectedPreview(slideId: string, scale: number, margin: number, textScale: number, selectedIdsJson: string): SelectedPreviewFrames
  undo(): unknown
  redo(): unknown
  importPptx(bytes: Uint8Array): ImportResult
  exportPptx(): Uint8Array
}
interface WasmModule { default(options?: { module_or_path?: string | URL }): Promise<unknown>; engineRevision(): string; createSession(): WasmSession }
type WasmLoader = () => Promise<WasmModule>

export interface EngineAdapter {
  initialize(): Promise<EngineInfo>
  createSession(): Promise<SessionId>
  setInkTool(id: SessionId, mode: string): Promise<void>
  setSelectTool(id: SessionId): Promise<void>
  setLocale(id: SessionId, locale: string): Promise<void>
  getFontFamilies(id: SessionId): Promise<string[]>
  getMediaBytes(id: SessionId, shapeId: string): Promise<Uint8Array>
  createBlankSlide(id: SessionId): Promise<EngineUpdate>
  closeSession(id: SessionId): void
  execute(id: SessionId, command: EngineCommand): Promise<EngineUpdate>
  typeText(id: SessionId, text: string): Promise<EngineUpdate>
  insertShapesBatch(id: SessionId, shapes: unknown[], media?: unknown[]): Promise<EngineUpdate>
  pointer(id: SessionId, input: PointerInput): Promise<EngineUpdate>
  hitTest(id: SessionId, x: number, y: number, tolerance: number): Promise<HitTestResult | null>
  key(id: SessionId, input: KeyInput): Promise<EngineUpdate>
  composeText(id: SessionId, text: string, active?: [number, number]): Promise<EngineUpdate>
  commitText(id: SessionId, text: string): Promise<EngineUpdate>
  getWasmMemoryBytes(id: SessionId): Promise<number>
  getDocumentSummary(id: SessionId): Promise<DocumentSummary>
  getSlideProjection(id: SessionId, slideId: SlideId): Promise<SlideProjection>
  getSelectedShapeGeometry(id: SessionId, slideId: SlideId, selectedIds: readonly string[]): Promise<SelectedShapeGeometry[]>
  getSelectionProjection(id: SessionId): Promise<SelectionProjection>
  renderSlide(id: SessionId, slideId: SlideId, scale: number): Promise<RenderFrame>
  renderSlideOverflow(id: SessionId, slideId: SlideId, scale: number, margin: number): Promise<RenderFrame>
  renderMovePreview(id: SessionId, slideId: SlideId, scale: number, margin: number, selectedIds: readonly string[]): Promise<MovePreviewFrames>
  renderSelectedPreview(id: SessionId, slideId: SlideId, scale: number, margin: number, textScale: number, selectedIds: readonly string[]): Promise<SelectedPreviewFrames>
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
  const response = await fetch(new URL(base, document.baseURI))
  if (!response.ok) throw new Error(`Could not load Folio WASM adapter (${response.status}).`)
  const moduleSource = await response.text()
  const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }))
  const module = await import(/* @vite-ignore */ moduleUrl) as WasmModule
  await module.default({ module_or_path: new URL('folio_wasm_bg.wasm', response.url) })
  URL.revokeObjectURL(moduleUrl)
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
    async initialize() { try { const wasm = await initialize(); return { engine: 'deckcraft', revision: wasm.engineRevision(), protocolVersion: 1 } }
      catch (error) { throw new EngineAdapterError({ code: 'WASM_LOAD_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true }, newOperationId()) } },
    async createSession() {
      try { const wasm = await initialize(); const id = newOperationId() as SessionId; sessions.set(id, wasm.createSession()); return id }
      catch (error) { throw new EngineAdapterError({ code: 'WASM_LOAD_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true }, newOperationId()) }
    },
    closeSession(id) { const session = sessions.get(id); if (session) { sessions.delete(id); session.free() } },
    setInkTool(id, mode) { return run((s) => s.setInkTool(mode), id) },
    setSelectTool(id) { return run((s) => s.setSelectTool(), id) },
    setLocale(id, locale) { return run((s) => s.setLocale(locale), id) },
    getFontFamilies(id) { return run((s) => s.getFontFamilies(), id) },
    getMediaBytes(id, shapeId) { return run((s) => s.getMediaBytes(shapeId), id) },
    createBlankSlide(id) { return run((s) => asUpdate(s.createBlankSlide()), id) },
    execute(id, command) { return run((s) => asUpdate(s.execute(command.type === 'custom' ? command.name : command.type, JSON.stringify(command.params ?? {}))), id) },
    typeText(id, text) { return run((s) => asUpdate(s.typeText(text)), id) },
    insertShapesBatch(id, shapes, media = []) { return run((s) => asUpdate(s.insertShapesBatch(JSON.stringify({ shapes, media }))), id) },
    pointer(id, input) {
      const { ctrl, meta, ...mods } = input.modifiers ?? {}
      return run((s) => asUpdate(s.pointer(input.kind, input.x, input.y, JSON.stringify({ ...mods, cmd: Boolean(mods.cmd || meta || ctrl) }))), id)
    },
    hitTest(id, x, y, tolerance) { return run((s) => s.hitTest(x, y, tolerance), id) },
    key(id, input) {
      const { ctrl, meta, ...mods } = input.modifiers ?? {}
      return run((s) => asUpdate(s.key(input.key, JSON.stringify({ ...mods, cmd: Boolean(mods.cmd || meta || ctrl) }))), id)
    },
    composeText(id, text, active) { return run((s) => asUpdate(s.composeText(text, active ? JSON.stringify(active) : '')), id) },
    commitText(id, text) { return run((s) => asUpdate(s.commitText(text)), id) },
    getWasmMemoryBytes(id) { return run((s) => s.wasmMemoryBytes(), id) },
    getDocumentSummary(id) { return run((s) => s.getDocumentSummary(), id) },
    getSlideProjection(id, slideId) { return run((s) => s.getSlideProjection(slideId), id) },
    getSelectedShapeGeometry(id, slideId, selectedIds) { return run((s) => s.getSelectedShapeGeometry(slideId, JSON.stringify(selectedIds.map((shapeId) => Number(shapeId)))), id) },
    getSelectionProjection(id) { return run((s) => s.getSelectionProjection(), id) },
    renderSlide(id, slideId, scale) { return run((s) => s.renderSlide(slideId, scale), id) },
    renderSlideOverflow(id, slideId, scale, margin) { return run((s) => s.renderSlideOverflow(slideId, scale, margin), id) },
    renderMovePreview(id, slideId, scale, margin, selectedIds) { return run((s) => s.renderMovePreview(slideId, scale, margin, JSON.stringify(selectedIds.map((shapeId) => Number(shapeId)))), id) },
    renderSelectedPreview(id, slideId, scale, margin, textScale, selectedIds) { return run((s) => s.renderSelectedPreview(slideId, scale, margin, textScale, JSON.stringify(selectedIds.map((shapeId) => Number(shapeId)))), id) },
    undo(id) { return run((s) => asUpdate(s.undo()), id) },
    redo(id) { return run((s) => asUpdate(s.redo()), id) },
    importPptx(id, bytes) { return run((s) => s.importPptx(bytes), id) },
    exportPptx(id) { return run((s) => s.exportPptx(), id) },
  }
}
