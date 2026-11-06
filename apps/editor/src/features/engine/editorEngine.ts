import {
  createEngineAdapter,
  type DocumentSummary,
  type EngineCommand,
  type EngineUpdate,
  type HitTestResult,
  type MovePreviewFrames,
  type MediaPlaybackRequest,
  type PointerInput,
  type RenderFrame,
  type SelectedShapeGeometry,
  type SelectionProjection,
  type SessionId,
  type SlideId,
  type SlideProjection,
  type SmartGuide,
} from '@folio/engine-adapter'
import { finishPerf, perfNow, recordPerf } from './perfDiagnostics'
import { getInitialEditorLocale, type EditorLocale } from '../localization/locale'
import type { DocumentOperation, DocumentOperationAction, DocumentOperationListener } from './documentOperations'

export type EngineSlideView = DocumentSummary['slides'][number] & { readonly thumbnail: RenderFrame | null }

export interface EditorEngineState {
  readonly ready: boolean
  readonly loading: boolean
  readonly error: string | null
  readonly commandError: string | null
  readonly summary: DocumentSummary | null
  readonly slides: readonly EngineSlideView[]
  readonly activeSlide: SlideProjection | null
  readonly activeFrame: RenderFrame | null
  readonly activeOverflowFrame: RenderFrame | null
  readonly selection: SelectionProjection | null
}
export interface LiveEngineFrames { readonly active: RenderFrame | null; readonly overflow: RenderFrame | null }
export interface LiveMovePreview { readonly frame: RenderFrame; readonly overflowFrame: RenderFrame; readonly shapes: readonly SelectedShapeGeometry[]; readonly inputSequence?: number; readonly renderedCurrentGeometry?: boolean }

const emptyState: EditorEngineState = {
  ready: false,
  loading: true,
  error: null,
  commandError: null,
  summary: null,
  slides: [],
  activeSlide: null,
  activeFrame: null,
  activeOverflowFrame: null,
  selection: null,
}

/** React receives immutable projections; the Rust Session remains the document authority. */
class EditorEngine {
  private readonly adapter = createEngineAdapter()
  private sessionId: SessionId | null = null
  private initPromise: Promise<void> | null = null
  private operationQueue: Promise<unknown> = Promise.resolve()
  private liveFrames: LiveEngineFrames = { active: null, overflow: null }
  private frameListeners = new Set<() => void>()
  private pendingDragInput: PointerInput | null = null
  private pendingDragInputAt = 0
  private pendingDragSequence: number | undefined
  private dragInputFrame = 0
  private previewOnlyDrag = false
  private liveTextResizePreview = false
  private scaleTextOnCornerResize = false
  private textResizeInitialRects = new Map<string, [number, number, number, number]>()
  private movePreviewIds: readonly string[] | null = null
  private movePreviewFrame: RenderFrame | null = null
  private movePreviewOverflowFrame: RenderFrame | null = null
  private movePreviewCache: { key: string; frames: MovePreviewFrames } | null = null
  private movePreviewSnapshot: LiveMovePreview | null = null
  private movePreviewListeners = new Set<(preview: LiveMovePreview | null) => void>()
  private overflowMargin = 120
  private viewportZoom = 100
  private lastPointerResult: unknown = null
  private listeners = new Set<() => void>()
  private documentId: string = crypto.randomUUID()
  private readOnly = false
  private operationSequence = 0
  private operationListeners = new Set<DocumentOperationListener>()
  private appliedRemoteOperations = new Set<string>()
  private pointerTransaction: PointerInput[] = []
  private pointerTransactionBaseRevision = 0
  private mediaRequestListeners = new Set<(request: MediaPlaybackRequest) => void>()
  private mediaRequestListenersByShape = new Map<string, Set<(request: MediaPlaybackRequest) => void>>()
  private pendingMediaRequests: MediaPlaybackRequest[] = []
  private toolGuides: readonly SmartGuide[] = []
  private toolGuideListeners = new Set<(guides: readonly SmartGuide[]) => void>()
  private state: EditorEngineState = emptyState
  private shapePresetCatalog: Array<{ name: string; label: string; category: string }> | null = null
  private readonly emptyShapePresetCatalog: readonly { name: string; label: string; category: string }[] = []
  private shapePresetCatalogPromise: Promise<Array<{ name: string; label: string; category: string }> | null> | null = null
  private shapePresetCatalogListeners = new Set<(items: readonly { name: string; label: string; category: string }[]) => void>()
  readonly getShapePresetCatalogSnapshot = (): readonly { name: string; label: string; category: string }[] => this.shapePresetCatalog ?? this.emptyShapePresetCatalog
  readonly subscribeShapePresetCatalog = (listener: () => void): (() => void) => { this.shapePresetCatalogListeners.add(listener); return () => this.shapePresetCatalogListeners.delete(listener) }

  readonly getSnapshot = (): EditorEngineState => this.state
  readonly subscribeMediaRequests = (shapeId: string, listener: (request: MediaPlaybackRequest) => void): (() => void) => {
    this.mediaRequestListeners.add(listener)
    const listeners = this.mediaRequestListenersByShape.get(shapeId) ?? new Set<(request: MediaPlaybackRequest) => void>()
    listeners.add(listener)
    this.mediaRequestListenersByShape.set(shapeId, listeners)
    const pending: MediaPlaybackRequest[] = []
    for (const request of this.pendingMediaRequests) {
      if (String(request.shape) === shapeId) listener(request)
      else pending.push(request)
    }
    this.pendingMediaRequests = pending
    return () => {
      this.mediaRequestListeners.delete(listener)
      listeners.delete(listener)
      if (!listeners.size) this.mediaRequestListenersByShape.delete(shapeId)
    }
  }
  readonly getLiveFrames = (): LiveEngineFrames => this.liveFrames
  readonly getMovePreviewFrame = (): RenderFrame | null => this.movePreviewFrame
  readonly getMovePreviewOverflowFrame = (): RenderFrame | null => this.movePreviewOverflowFrame
  readonly getCachedMovePreviewFrames = (): MovePreviewFrames | null => this.movePreviewCache?.frames ?? null
  readonly getMovePreviewSnapshot = (): LiveMovePreview | null => this.movePreviewSnapshot
  readonly getLastPointerResult = (): unknown => this.lastPointerResult
  readonly getToolGuides = (): readonly SmartGuide[] => this.toolGuides
  readonly subscribeToolGuides = (listener: (guides: readonly SmartGuide[]) => void): (() => void) => {
    this.toolGuideListeners.add(listener)
    return () => this.toolGuideListeners.delete(listener)
  }
  async hitTest(x: number, y: number): Promise<HitTestResult | null> {
    await this.initialize()
    return this.adapter.hitTest(this.requireSession(), x, y, 4)
  }
  readonly subscribeFrames = (listener: () => void): (() => void) => {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }
  readonly subscribeMovePreview = (listener: (preview: LiveMovePreview | null) => void): (() => void) => {
    this.movePreviewListeners.add(listener)
    return () => this.movePreviewListeners.delete(listener)
  }
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly getDocumentId = (): string => this.documentId
  readonly isReadOnly = (): boolean => this.readOnly
  readonly setReadOnly = (readOnly: boolean): void => { this.readOnly = readOnly }
  private assertWritable(action: string): void {
    if (this.readOnly && !['selection.select', 'slide.go', 'shape.presets'].includes(action)) throw new Error('DOCUMENT_READ_ONLY')
  }
  readonly setDocumentId = (documentId: string): void => {
    if (!documentId || documentId === this.documentId) return
    this.documentId = documentId
    this.operationSequence = 0
    this.pointerTransaction = []
  }
  private beginDocument(documentId: string): void {
    this.documentId = documentId
    this.operationSequence = 0
    this.pointerTransaction = []
  }
  readonly subscribeDocumentOperations = (listener: DocumentOperationListener): (() => void) => {
    this.operationListeners.add(listener)
    return () => this.operationListeners.delete(listener)
  }

  async applyRemoteOperation(operation: DocumentOperation): Promise<'applied' | 'duplicate' | 'revision-mismatch'> {
    await this.initialize()
    let duplicate = false
    const revisionMatches = await this.track(() => this.enqueue(async () => {
      if (operation.documentId !== this.documentId) throw new Error('DOCUMENT_ID_MISMATCH')
      if (this.appliedRemoteOperations.has(operation.id)) { duplicate = true; return true }
      const replace = operation.action.kind === 'replace-document'
      const currentRevision = this.state.summary?.revision ?? 0
      if (!replace && operation.baseRevision !== currentRevision) throw new Error(`STALE_OPERATION:${currentRevision}`)
      const id = this.requireSession()
      const action = operation.action
      if (action.kind === 'commands') {
        for (const command of action.commands) await this.adapter.execute(id, command)
      } else if (action.kind === 'pointer') {
        for (const input of action.inputs) await this.applyPointer(input)
        this.pointerTransaction = []
      } else if (action.kind === 'key') {
        await this.adapter.key(id, action.input)
      } else if (action.kind === 'text') {
        if (action.mode === 'commit') await this.adapter.commitText(id, action.text)
        else {
          await this.adapter.typeText(id, action.text)
          for (const _character of Array.from(action.text)) await this.adapter.execute(id, { type: 'custom', name: 'text.move', params: { to: 'right' } })
        }
      } else if (action.kind === 'undo') {
        await this.adapter.undo(id)
      } else if (action.kind === 'redo') {
        await this.adapter.redo(id)
      } else if (action.kind === 'insert-shapes') {
        await this.adapter.insertShapesBatch(id, [...action.shapes], [...(action.media ?? [])])
      } else if (action.kind === 'replace-document') {
        const next = await this.createLocalizedSession()
        if (action.snapshot) {
          try { await this.adapter.importPptx(next, action.snapshot) }
          catch (error) { this.adapter.closeSession(next); throw error }
        }
        this.sessionId = next
        this.adapter.closeSession(id)
        this.beginDocument(operation.documentId)
      }
      await this.refresh()
      const actualRevision = this.state.summary?.revision ?? 0
      return actualRevision === operation.revision
    }))
    if (duplicate) return 'duplicate'
    this.appliedRemoteOperations.add(operation.id)
    if (this.appliedRemoteOperations.size > 2048) {
      const oldest = this.appliedRemoteOperations.values().next()
      if (!oldest.done) this.appliedRemoteOperations.delete(oldest.value)
    }
    return revisionMatches ? 'applied' : 'revision-mismatch'
  }

  private publishDocumentOperation(baseRevision: number, action: DocumentOperationAction): void {
    const revision = this.state.summary?.revision ?? baseRevision
    const operation: DocumentOperation = {
      id: crypto.randomUUID(), documentId: this.documentId, sequence: ++this.operationSequence,
      baseRevision, revision, action,
    }
    for (const listener of this.operationListeners) {
      try { listener(operation) } catch { /* Observers cannot interrupt document edits. */ }
    }
  }

  async initialize(): Promise<void> {
    if (this.state.ready) return
    this.initPromise ??= (async () => {
      try {
        await this.adapter.initialize()
        this.sessionId = await this.createLocalizedSession()
        await this.refresh()
        this.publish({ ...this.state, ready: true, loading: false, error: null })
      } catch (error) {
        this.publish({ ...this.state, loading: false, error: errorMessage(error) })
        this.initPromise = null
        throw error
      }
    })()
    return this.initPromise
  }

  async execute(command: EngineCommand): Promise<EngineUpdate> {
    this.assertWritable(command.type === 'custom' ? command.name : command.type)
    return this.track(async () => this.enqueue(async () => {
      const baseRevision = this.state.summary?.revision ?? 0
      const update = await this.adapter.execute(this.requireSession(), command)
      for (const request of update.mediaRequests ?? []) {
        const listeners = this.mediaRequestListenersByShape.get(String(request.shape))
        if (!listeners?.size) this.pendingMediaRequests.push(request)
        else for (const listener of listeners) listener(request)
      }
      await this.refresh()
      if (!(command.type === 'custom' && command.name === 'shape.presets')) {
        this.publishDocumentOperation(baseRevision, { kind: 'commands', commands: [command] })
      }
      return update
    }))
  }

  async getShapePresets(): Promise<Array<{ name: string; label: string; category: string }>> {
    if (this.shapePresetCatalog) return this.shapePresetCatalog
    this.shapePresetCatalogPromise ??= this.execute({ type: 'custom', name: 'shape.presets', params: {} })
      .then((update) => {
        const result = Array.isArray(update.result) ? update.result : []
        this.shapePresetCatalog = result.filter((item): item is { name: string; label: string; category: string } => !!item && typeof item === 'object'
          && typeof (item as { name?: unknown }).name === 'string' && typeof (item as { label?: unknown }).label === 'string' && typeof (item as { category?: unknown }).category === 'string')
        for (const listener of this.shapePresetCatalogListeners) listener(this.shapePresetCatalog)
        return this.shapePresetCatalog
      })
      .catch(() => { this.shapePresetCatalogPromise = null; return null })
    return (await this.shapePresetCatalogPromise) ?? []
  }

  async setInkTool(mode: 'pen' | 'highlighter' | 'eraser'): Promise<void> {
    await this.initialize()
    await this.enqueue(() => this.adapter.setInkTool(this.requireSession(), mode))
  }

  async setSelectTool(): Promise<void> {
    await this.initialize()
    await this.enqueue(() => this.adapter.setSelectTool(this.requireSession()))
  }

  async getFormatState(): Promise<Record<string, unknown>> {
    return this.enqueue(async () => {
      const update = await this.adapter.execute(this.requireSession(), { type: 'custom', name: 'format.state', params: {} })
      return update.result && typeof update.result === 'object' ? update.result as Record<string, unknown> : {}
    })
  }

  async getFontFamilies(): Promise<string[]> {
    await this.initialize()
    return this.enqueue(() => this.adapter.getFontFamilies(this.requireSession()))
  }

  async getMediaBytes(shapeId: string): Promise<Uint8Array> {
    await this.initialize()
    return this.enqueue(() => this.adapter.getMediaBytes(this.requireSession(), shapeId))
  }

  async getAnimations(): Promise<unknown[]> {
    await this.initialize()
    return this.enqueue(async () => {
      const update = await this.adapter.execute(this.requireSession(), { type: 'custom', name: 'animation.get', params: {} })
      return Array.isArray(update.result) ? update.result : []
    })
  }

  async insertShapesBatch(shapes: unknown[], media: unknown[] = []): Promise<void> {
    this.assertWritable('insert-shapes')
    await this.track(() => this.enqueue(async () => {
      const baseRevision = this.state.summary?.revision ?? 0
      await this.adapter.insertShapesBatch(this.requireSession(), shapes, media)
      await this.refresh()
      this.publishDocumentOperation(baseRevision, { kind: 'insert-shapes', shapes: structuredClone(shapes), media: structuredClone(media) })
    }))
  }

  async renderSelectionForClipboard(): Promise<{ readonly frame: RenderFrame; readonly scale: number; readonly margin: number } | null> {
    const slideId = this.state.activeSlide?.id
    const ids = this.state.selection?.shapeIds ?? []
    if (!slideId || !ids.length) return null
    const scale = 1
    const margin = 120
    return this.enqueue(async () => {
      const frames = await this.adapter.renderSelectedPreview(this.requireSession(), slideId, scale, margin, 1, ids)
      return { frame: frames.selectedShapes, scale, margin }
    })
  }

  async getWasmMemoryBytes(): Promise<number> {
    return this.enqueue(() => this.adapter.getWasmMemoryBytes(this.requireSession()))
  }

  async setLocale(locale: EditorLocale): Promise<void> {
    await this.track(() => this.enqueue(async () => {
      await this.adapter.setLocale(this.requireSession(), locale)
      await this.refresh()
    }))
  }

  async undo(): Promise<void> {
    this.assertWritable('undo')
    await this.track(() => this.enqueue(async () => { const baseRevision = this.state.summary?.revision ?? 0; await this.adapter.undo(this.requireSession()); await this.refresh(); this.publishDocumentOperation(baseRevision, { kind: 'undo' }) }))
  }

  async redo(): Promise<void> {
    this.assertWritable('redo')
    await this.track(() => this.enqueue(async () => { const baseRevision = this.state.summary?.revision ?? 0; await this.adapter.redo(this.requireSession()); await this.refresh(); this.publishDocumentOperation(baseRevision, { kind: 'redo' }) }))
  }

  async duplicateSlide(id: SlideId): Promise<void> {
    this.assertWritable('slide.duplicate')
    await this.track(() => this.enqueue(async () => {
      const baseRevision = this.state.summary?.revision ?? 0
      const summary = await this.adapter.getDocumentSummary(this.requireSession())
      const index = summary.slides.findIndex((slide) => slide.id === id)
      if (index < 0) throw new Error(`Slide ${id} is not in the current Rust Session.`)
      await this.adapter.execute(this.requireSession(), { type: 'slide.go', params: { index } })
      await this.adapter.execute(this.requireSession(), { type: 'slide.duplicate', params: {} })
      await this.refresh()
      this.publishDocumentOperation(baseRevision, { kind: 'commands', commands: [
        { type: 'slide.go', params: { index } }, { type: 'slide.duplicate', params: {} },
      ] })
    }))
  }

  async insertTextBoxAndEdit(rect: [number, number, number, number], text = ''): Promise<void> {
    this.assertWritable('insert.textBox')
    await this.track(() => this.enqueue(async () => {
      const baseRevision = this.state.summary?.revision ?? 0
      const id = this.requireSession()
      const inserted = await this.adapter.execute(id, { type: 'insert.textBox', params: { rect, text } })
      const shapeId = (inserted.result as { id?: number | string } | null)?.id
      if (shapeId === undefined) throw new Error('Rust Session did not return the inserted text box id.')
      await this.adapter.execute(id, { type: 'text.edit', params: { id: shapeId } })
      await this.refresh()
      this.publishDocumentOperation(baseRevision, { kind: 'commands', commands: [
        { type: 'insert.textBox', params: { rect, text } }, { type: 'text.edit', params: { id: shapeId } },
      ] })
    }))
  }

  async newPresentation(documentId: string = crypto.randomUUID()): Promise<void> {
    await this.track(() => this.enqueue(async () => {
      const previous = this.sessionId
      const next = await this.createLocalizedSession()
      this.sessionId = next
      if (previous) this.adapter.closeSession(previous)
      await this.refresh()
      this.beginDocument(documentId)
      this.publishDocumentOperation(0, { kind: 'replace-document', snapshot: null })
    }))
  }

  async importPresentation(bytes: Uint8Array, documentId: string = crypto.randomUUID()): Promise<void> {
    await this.track(() => this.enqueue(async () => {
      const next = await this.createLocalizedSession()
      try { await this.adapter.importPptx(next, bytes) }
      catch (error) { this.adapter.closeSession(next); throw error }
      const previous = this.sessionId
      this.sessionId = next
      if (previous) this.adapter.closeSession(previous)
      await this.refresh()
      this.beginDocument(documentId)
      this.publishDocumentOperation(0, { kind: 'replace-document', snapshot: bytes.slice() })
    }))
  }

  async exportPresentation(): Promise<Uint8Array> {
    return this.track(() => this.enqueue(() => this.adapter.exportPptx(this.requireSession())))
  }

  async pointer(input: PointerInput, previewSequence?: number): Promise<void> {
    if (this.readOnly && input.kind === 'drag') return
    if (input.kind === 'drag') {
      this.pendingDragInput = input
      this.pendingDragInputAt = perfNow()
      this.pendingDragSequence = previewSequence
      if (!this.dragInputFrame) this.dragInputFrame = requestAnimationFrame(() => {
        this.dragInputFrame = 0
        void this.flushDragInput(true).catch((error: unknown) => {
          this.publish({ ...this.state, commandError: errorMessage(error) })
        })
      })
      return
    }
    const requestedAt = perfNow()
    await this.track(() => this.enqueue(async () => {
      if (requestedAt) recordPerf('pointer.queue.wait', performance.now() - requestedAt)
      if (input.kind === 'up' && this.pendingDragInput) {
        if (this.dragInputFrame) cancelAnimationFrame(this.dragInputFrame)
        this.dragInputFrame = 0
        const pending = this.pendingDragInput
        this.pendingDragInput = null
        const pendingAt = this.pendingDragInputAt
        this.pendingDragInputAt = 0
        this.pendingDragSequence = undefined
        await this.applyPointer(pending)
        const dragInputAt = pendingAt
        await this.applyPointer(input)
        const keepTransformPreviewUntilFinalFrame = this.previewOnlyDrag
        if (!keepTransformPreviewUntilFinalFrame) {
          this.movePreviewIds = null
          this.movePreviewFrame = null
          this.movePreviewOverflowFrame = null
          this.previewOnlyDrag = false
          this.publishMovePreview(null)
        }
        await this.refresh(true)
        this.publishPointerTransaction()
        if (keepTransformPreviewUntilFinalFrame) {
          this.movePreviewIds = null
          this.movePreviewFrame = null
          this.movePreviewOverflowFrame = null
          this.previewOnlyDrag = false
          this.publishMovePreview(null)
          this.frameListeners.forEach((listener) => listener())
        }
        finishPerf('drag.inputToFrame', dragInputAt)
        return
      }
      const pointerStarted = perfNow()
      await this.applyPointer(input)
      finishPerf('pointer.rust.adapter', pointerStarted)
      const keepTransformPreviewUntilFinalFrame = input.kind === 'up' && this.previewOnlyDrag
      if (input.kind === 'up' && !keepTransformPreviewUntilFinalFrame) {
        this.movePreviewIds = null
        this.movePreviewFrame = null
        this.movePreviewOverflowFrame = null
        this.previewOnlyDrag = false
        this.publishMovePreview(null)
      }
      if (input.kind === 'down') {
        const hitKind = (this.lastPointerResult as { hit?: { kind?: string } } | null)?.hit?.kind
        if (hitKind === 'resize' || hitKind === 'rotate') recordPerf('pointer.down.transformRefreshSkipped')
        else await this.refreshPointerDown()
      }
      else await this.refresh(input.kind === 'up')
      if (input.kind === 'up' || input.kind === 'doubleClick' || input.kind === 'tripleClick' || input.kind === 'contextClick') this.publishPointerTransaction()
      if (keepTransformPreviewUntilFinalFrame) {
        this.movePreviewIds = null
        this.movePreviewFrame = null
        this.movePreviewOverflowFrame = null
        this.previewOnlyDrag = false
        this.publishMovePreview(null)
        this.frameListeners.forEach((listener) => listener())
      }
    }))
  }

  private async applyPointer(input: PointerInput): Promise<void> {
    if (input.kind === 'down') { this.pointerTransaction = []; this.pointerTransactionBaseRevision = this.state.summary?.revision ?? 0 }
    if (input.kind === 'down' || input.kind === 'drag' || input.kind === 'up' || input.kind === 'doubleClick' || input.kind === 'tripleClick' || input.kind === 'contextClick') {
      this.pointerTransaction.push(structuredClone(input))
    }
    const started = perfNow()
    const update = await this.adapter.pointer(this.requireSession(), input)
    this.toolGuides = update.toolGuides ?? []
    this.toolGuideListeners.forEach((listener) => listener(this.toolGuides))
    if (input.kind === 'down') this.lastPointerResult = update.result
    finishPerf('pointer.rust.adapter', started)
  }

  private publishPointerTransaction(): void {
    if (!this.pointerTransaction.length) return
    const inputs = this.pointerTransaction
    this.pointerTransaction = []
    this.publishDocumentOperation(this.pointerTransactionBaseRevision, { kind: 'pointer', inputs })
  }

  private async flushDragInput(render: boolean): Promise<void> {
    const input = this.pendingDragInput
    const inputAt = this.pendingDragInputAt
    const inputSequence = this.pendingDragSequence
    this.pendingDragInput = null
    this.pendingDragInputAt = 0
    this.pendingDragSequence = undefined
    if (!input) return
    const requestedAt = perfNow()
    await this.track(() => this.enqueue(async () => {
      if (requestedAt) recordPerf('pointer.queue.wait', performance.now() - requestedAt)
      await this.applyPointer(input)
      if (render) {
        if (this.movePreviewIds) await this.updateMovePreviewProjection(inputSequence)
        else if (!this.previewOnlyDrag) await this.renderDragFrames()
        finishPerf('drag.inputToFrame', inputAt)
      }
    }))
  }

  async beginMovePreview(shapeIds: readonly string[]): Promise<void> {
    const ids = [...new Set(shapeIds)]
    if (!ids.length) return
    await this.enqueue(async () => {
      const slideId = this.state.activeSlide?.id
      if (!slideId) return
      const scale = this.previewRenderScale()
      const cacheKey = this.movePreviewKey(slideId, ids, scale)
      let frames = this.movePreviewCache?.key === cacheKey ? this.movePreviewCache.frames : null
      if (frames) recordPerf('render.movePreview.cacheHit')
      else {
        const started = perfNow()
        frames = await this.adapter.renderMovePreview(this.requireSession(), slideId, scale, this.overflowMargin, ids)
        finishPerf('render.movePreview', started)
        this.movePreviewCache = { key: cacheKey, frames }
      }
      this.movePreviewIds = ids
      this.movePreviewFrame = frames.selectedActiveShapes
      this.movePreviewOverflowFrame = frames.selectedShapes
      this.frameListeners.forEach((listener) => listener())
      this.publishMovePreview({ frame: frames.selectedActiveShapes, overflowFrame: frames.selectedShapes, shapes: (this.state.activeSlide?.shapes ?? []).filter((shape) => ids.includes(shape.id)).map((shape) => ({ id: shape.id, rect: shape.rect, rotation: shape.rotation ?? null })) })
    })
  }

  async beginTransformPreview(shapeIds: readonly string[], liveTextResize = false, scaleTextOnCornerResize = false): Promise<void> {
    this.liveTextResizePreview = liveTextResize
    this.scaleTextOnCornerResize = scaleTextOnCornerResize
    this.textResizeInitialRects = new Map((this.state.activeSlide?.shapes ?? [])
      .filter((shape) => shapeIds.includes(shape.id) && shape.rect)
      .map((shape) => [shape.id, shape.rect!]))
    await this.beginMovePreview(shapeIds)
  }

  setPreviewOnlyDrag(enabled: boolean): void {
    this.previewOnlyDrag = enabled
    if (!enabled) {
      this.liveTextResizePreview = false
      this.scaleTextOnCornerResize = false
      this.textResizeInitialRects.clear()
    }
  }

  clearMovePreviewCacheForTests(): void {
    this.movePreviewCache = null
  }

  private async warmMovePreview(slideId: SlideId, shapeIds: readonly string[]): Promise<void> {
    const ids = [...new Set(shapeIds)]
    if (!ids.length || ids.length > 1000) return
    const scale = this.previewRenderScale()
    const key = this.movePreviewKey(slideId, ids, scale)
    if (this.movePreviewCache?.key === key) return
    const started = perfNow()
    const frames = await this.adapter.renderMovePreview(this.requireSession(), slideId, scale, this.overflowMargin, ids)
    this.movePreviewCache = { key, frames }
    finishPerf('render.movePreview.prewarm', started)
    this.frameListeners.forEach((listener) => listener())
  }

  private movePreviewKey(slideId: SlideId, shapeIds: readonly string[], scale: number): string {
    return `${this.sessionId}:${slideId}:${this.overflowMargin}:${scale}:${[...shapeIds].sort().join(',')}`
  }

  private renderScale(): number {
    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    return Math.min(4, Math.max(1, pixelRatio * this.viewportZoom / 100))
  }

  private previewRenderScale(): number {
    // Selected-object layers are compositor-scaled during interaction. Keep transient layers
    // below 3x so high-DPR, high-zoom transforms do not synchronously rasterize 4K RGBA layers.
    // Final document renders keep their independent full-quality scale.
    const pixelRatio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    return Math.min(3, Math.min(2, Math.max(1, pixelRatio)) * this.viewportZoom / 100)
  }

  private async updateMovePreviewProjection(inputSequence?: number): Promise<void> {
    const slideId = this.state.activeSlide?.id
    const ids = this.movePreviewIds
    if (!slideId || !ids || !this.movePreviewFrame || !this.movePreviewOverflowFrame) return
    if (this.liveTextResizePreview) {
      const projectionStarted = perfNow()
      const shapes = await this.adapter.getSelectedShapeGeometry(this.requireSession(), slideId, ids)
      finishPerf('projection.movePreview', projectionStarted)
      let textScale = 1
      if (this.scaleTextOnCornerResize) {
        const current = shapes.find((shape) => shape.rect && this.textResizeInitialRects.has(shape.id))
        const initial = current ? this.textResizeInitialRects.get(current.id) : null
        if (current?.rect && initial) {
          const sx = Math.abs(current.rect[2] / Math.max(0.001, initial[2]))
          const sy = Math.abs(current.rect[3] / Math.max(0.001, initial[3]))
          textScale = Math.sqrt(sx * sy)
        }
      }
      const renderStarted = perfNow()
      const frames = await this.adapter.renderSelectedPreview(this.requireSession(), slideId, this.previewRenderScale(), this.overflowMargin, textScale, ids)
      finishPerf('render.selectedTextPreview', renderStarted)
      this.movePreviewFrame = frames.selectedActiveShapes
      this.movePreviewOverflowFrame = frames.selectedShapes
      this.publishMovePreview({ frame: frames.selectedActiveShapes, overflowFrame: frames.selectedShapes, shapes, inputSequence, renderedCurrentGeometry: true })
      return
    }
    const projectionStarted = perfNow()
    const shapes = await this.adapter.getSelectedShapeGeometry(this.requireSession(), slideId, ids)
    finishPerf('projection.movePreview', projectionStarted)
    this.publishMovePreview({ frame: this.movePreviewFrame, overflowFrame: this.movePreviewOverflowFrame, shapes, inputSequence })
  }

  private publishMovePreview(preview: LiveMovePreview | null): void {
    this.movePreviewSnapshot = preview
    this.movePreviewListeners.forEach((listener) => listener(preview))
  }

  private async refreshPointerDown(): Promise<void> {
    const id = this.requireSession()
    const summary = await this.adapter.getDocumentSummary(id)
    const activeSlide = summary.slides[summary.activeSlideIndex] ?? summary.slides[0] ?? null
    const [projection, selection] = activeSlide
      ? await Promise.all([this.adapter.getSlideProjection(id, activeSlide.id), this.adapter.getSelectionProjection(id)])
      : [null, null] as const
    this.publish({ ...this.state, summary, activeSlide: projection, selection })
    if (activeSlide && selection?.shapeIds.length) await this.warmMovePreview(activeSlide.id, selection.shapeIds)
  }

  private async renderDragFrames(): Promise<void> {
    const slideId = this.state.activeSlide?.id
    if (!slideId) return
    // Keep pointer feedback inexpensive on high-DPR displays; pointer-up restores full quality.
    const scale = Math.min(1, Math.max(0.5, window.devicePixelRatio || 1))
    const id = this.requireSession()
    const [active, overflow] = await Promise.all([
      this.measureActiveRender(id, slideId, scale),
      this.measureOverflowRender(id, slideId, scale),
    ])
    this.liveFrames = { active, overflow }
    recordPerf('engine.frame.publish')
    this.frameListeners.forEach((listener) => listener())
  }

  async key(input: Parameters<typeof this.adapter.key>[1]): Promise<void> {
    if (this.readOnly && input.key !== 'Escape') throw new Error('DOCUMENT_READ_ONLY')
    await this.track(() => this.enqueue(async () => { const baseRevision = this.state.summary?.revision ?? 0; await this.adapter.key(this.requireSession(), input); await this.refresh(); this.publishDocumentOperation(baseRevision, { kind: 'key', input: structuredClone(input) }) }))
  }

  async typeText(text: string): Promise<void> {
    this.assertWritable('text.insert')
    await this.track(() => this.enqueue(async () => {
      const baseRevision = this.state.summary?.revision ?? 0
      const id = this.requireSession()
      await this.adapter.typeText(id, text)
      for (const _character of Array.from(text)) await this.adapter.execute(id, { type: 'custom', name: 'text.move', params: { to: 'right' } })
      await this.refresh()
      this.publishDocumentOperation(baseRevision, { kind: 'text', text, mode: 'insert' })
    }))
  }

  async composeText(text: string, active?: [number, number]): Promise<void> {
    this.assertWritable('text.compose')
    await this.track(() => this.enqueue(async () => { await this.adapter.composeText(this.requireSession(), text, active); await this.refresh(false) }))
  }

  async commitText(text: string): Promise<void> {
    this.assertWritable('text.commit')
    await this.track(() => this.enqueue(async () => { const baseRevision = this.state.summary?.revision ?? 0; await this.adapter.commitText(this.requireSession(), text); await this.refresh(); this.publishDocumentOperation(baseRevision, { kind: 'text', text, mode: 'commit' }) }))
  }

  async refreshViewport(): Promise<void> {
    await this.enqueue(() => this.refresh(false))
  }

  setOverflowMargin(margin: number): void {
    if (Number.isFinite(margin)) this.overflowMargin = Math.max(120, Math.min(544, Math.ceil(margin)))
  }

  setViewportZoom(zoom: number): void {
    if (!Number.isFinite(zoom)) return
    const bounded = Math.max(10, Math.min(200, zoom))
    if (bounded === this.viewportZoom) return
    this.viewportZoom = bounded
    this.movePreviewCache = null
  }

  private async track<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (error) {
      this.publish({ ...this.state, commandError: errorMessage(error) })
      throw error
    }
  }

  private requireSession(): SessionId {
    if (!this.sessionId) throw new Error('Rust Session is not initialized.')
    return this.sessionId
  }

  private async createLocalizedSession(): Promise<SessionId> {
    const session = await this.adapter.createSession()
    await this.adapter.setLocale(session, getInitialEditorLocale())
    return session
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation)
    this.operationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private async refresh(refreshThumbnails = true): Promise<void> {
    const refreshStarted = perfNow()
    const id = this.requireSession()
    const summaryStarted = perfNow()
    const summary = await this.adapter.getDocumentSummary(id)
    finishPerf('projection.documentSummary', summaryStarted)
    const activeSlideMeta = summary.slides[summary.activeSlideIndex] ?? summary.slides[0] ?? null
    const renderScale = this.renderScale()
    const previousSlides = new Map(this.state.slides.map((slide) => [slide.id, slide.thumbnail]))
    const activeSlideId = activeSlideMeta?.id
    const revisionChanged = this.state.summary?.revision !== summary.revision
    if (revisionChanged) this.movePreviewCache = null
    const slidesPromise = Promise.all(summary.slides.map(async (slide) => ({ ...slide,
      // The active slide is rasterized at full quality below. Derive its filmstrip preview from
      // that frame rather than synchronously rasterizing the same document a second time.
      thumbnail: slide.id === activeSlideId
        ? previousSlides.get(slide.id) ?? null
        : !previousSlides.has(slide.id) || (refreshThumbnails && revisionChanged)
        ? await this.measureThumbnailRender(id, slide.id)
        : previousSlides.get(slide.id) ?? null,
    })))
    const [slides, activeSlide, selection] = activeSlideMeta
      ? await Promise.all([
        slidesPromise,
        this.measureActiveProjection(id, activeSlideMeta.id),
        this.measureSelectionProjection(id, 'projection.selection.refresh'),
      ])
      : [await slidesPromise, null, null] as const
    let activeFrame: RenderFrame | null = null
    let activeOverflowFrame: RenderFrame | null = null
    if (activeSlideMeta && activeSlide) {
      const overflowNeeded = hasPotentialSlideOverflow(activeSlide)
      if (!overflowNeeded) recordPerf('render.overflow.skipped')
      const [nextActiveFrame, nextOverflowFrame] = await Promise.all([
        this.measureActiveRender(id, activeSlideMeta.id, renderScale),
        overflowNeeded ? this.measureOverflowRender(id, activeSlideMeta.id, renderScale) : Promise.resolve(null),
      ])
      activeFrame = nextActiveFrame
      activeOverflowFrame = nextOverflowFrame
    }
    if (activeSlideId && activeFrame && (!previousSlides.has(activeSlideId) || (refreshThumbnails && revisionChanged))) {
      const thumbnail = downsampleFrame(activeFrame, renderScale, 0.25)
      const activeIndex = slides.findIndex((slide) => slide.id === activeSlideId)
      if (activeIndex >= 0) slides[activeIndex] = { ...slides[activeIndex]!, thumbnail }
    }
    this.liveFrames = { active: activeFrame, overflow: activeOverflowFrame }
    this.frameListeners.forEach((listener) => listener())
    this.publish({ ready: true, loading: false, error: null, commandError: null, summary, slides, activeSlide, activeFrame, activeOverflowFrame, selection })
    if (activeSlide && selection?.shapeIds.length) await this.warmMovePreview(activeSlide.id, selection.shapeIds)
    finishPerf('engine.refresh.total', refreshStarted)
  }

  private async measureActiveProjection(id: SessionId, slideId: SlideId): Promise<SlideProjection> {
    const started = perfNow()
    const projection = await this.adapter.getSlideProjection(id, slideId)
    finishPerf('projection.activeSlide', started)
    return projection
  }

  private async measureThumbnailRender(id: SessionId, slideId: SlideId): Promise<RenderFrame> {
    const started = perfNow()
    const frame = await this.adapter.renderSlide(id, slideId, 0.25)
    finishPerf('render.thumbnail', started)
    return frame
  }

  private async measureActiveRender(id: SessionId, slideId: SlideId, scale: number): Promise<RenderFrame> {
    const started = perfNow()
    const frame = await this.adapter.renderSlide(id, slideId, scale)
    finishPerf('render.active', started)
    return frame
  }

  private async measureOverflowRender(id: SessionId, slideId: SlideId, scale: number): Promise<RenderFrame> {
    const started = perfNow()
    const frame = await this.adapter.renderSlideOverflow(id, slideId, scale, this.overflowMargin)
    finishPerf('render.overflow', started)
    return frame
  }

  private async measureSelectionProjection(id: SessionId, metric: string): Promise<SelectionProjection> {
    const started = perfNow()
    const selection = await this.adapter.getSelectionProjection(id)
    finishPerf(metric, started)
    return selection
  }

  private publish(state: EditorEngineState): void {
    recordPerf('engine.publish')
    this.state = state
    this.listeners.forEach((listener) => listener())
  }

}

function downsampleFrame(frame: RenderFrame, sourceScale: number, targetScale: number): RenderFrame {
  const width = Math.max(1, Math.round(frame.width * targetScale / sourceScale))
  const height = Math.max(1, Math.round(frame.height * targetScale / sourceScale))
  const source = document.createElement('canvas')
  source.width = frame.width
  source.height = frame.height
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  if (!sourceContext) return frame
  const sourcePixels = new Uint8ClampedArray(frame.pixels.buffer as ArrayBuffer, frame.pixels.byteOffset, frame.pixels.byteLength)
  sourceContext.putImageData(new ImageData(sourcePixels, frame.width, frame.height), 0, 0)
  const thumbnail = document.createElement('canvas')
  thumbnail.width = width
  thumbnail.height = height
  const thumbnailContext = thumbnail.getContext('2d', { willReadFrequently: true })
  if (!thumbnailContext) return frame
  thumbnailContext.drawImage(source, 0, 0, width, height)
  const pixels = thumbnailContext.getImageData(0, 0, width, height).data
  return { width, height, pixels: new Uint8Array(pixels.buffer.slice(pixels.byteOffset, pixels.byteOffset + pixels.byteLength)) }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Keep a conservative inset for strokes, shadows, and rotated geometry before skipping the
 * transparent overflow raster. Shapes near the edge or with unknown bounds still use Rust. */
function hasPotentialSlideOverflow(slide: SlideProjection): boolean {
  const inset = 64
  const rightEdge = 960 - inset
  const bottomEdge = 540 - inset
  return slide.shapes.some((shape) => {
    if (shape.hidden) return false
    if (!shape.rect) return true
    const [x, y, rawWidth, rawHeight] = shape.rect
    if (![x, y, rawWidth, rawHeight].every(Number.isFinite)) return true
    const width = Math.abs(rawWidth)
    const height = Math.abs(rawHeight)
    const radians = ((shape.rotation ?? 0) * Math.PI) / 180
    const extentX = (Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height) / 2
    const extentY = (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height) / 2
    const centerX = x + rawWidth / 2
    const centerY = y + rawHeight / 2
    return centerX - extentX < inset || centerY - extentY < inset || centerX + extentX > rightEdge || centerY + extentY > bottomEdge
  })
}

export const editorEngine = new EditorEngine()

export function activeSlideId(state: EditorEngineState): SlideId | null {
  const index = state.summary?.activeSlideIndex ?? 0
  return state.slides[index]?.id ?? state.slides[0]?.id ?? null
}
