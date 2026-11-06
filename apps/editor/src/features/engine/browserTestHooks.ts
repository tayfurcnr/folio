import { editorEngine } from './editorEngine'

declare global {
  interface Window {
    __folioTest?: {
      seedShapes(count: number): Promise<void>
      prepareBlankSlide(): Promise<void>
      addSlideAt(index: number): Promise<void>
      selectShape(id: string): Promise<void>
      beginTextEdit(id: string): Promise<void>
      selectTextRange(id: string, anchor: [number, number], caret: [number, number]): Promise<void>
      selectShapes(ids: readonly string[]): Promise<void>
      setElementOpacity(ids: readonly string[], opacity: number): Promise<void>
      exportPptx(): Promise<Uint8Array>
      duplicateSelection(): Promise<void>
      insertTextBox(): Promise<void>
      insertTextBoxAt(rect: [number, number, number, number], text?: string): Promise<void>
      setSlideNotes(text: string, index?: number): Promise<void>
      setSlideHidden(index: number, hidden: boolean): Promise<void>
      insertShape(preset: string, rect: [number, number, number, number]): Promise<void>
      insertAudio(name: string, dataBase64: string): Promise<void>
      insertVideo(name: string, dataBase64: string): Promise<unknown>
      mediaCommand(id: string, action: 'play' | 'pause' | 'toggle' | 'stop' | 'seek', ms?: number): Promise<unknown>
      changeShape(id: string, preset: string): Promise<void>
      setInkTool(mode: 'pen' | 'highlighter' | 'eraser'): Promise<void>
      setSelectTool(): Promise<void>
      setZoom(zoom: number): void
      memoryBytes(): Promise<number>
      lastPointerResult(): unknown
      hitTest(x: number, y: number): ReturnType<typeof editorEngine.hitTest>
      snapshot(): ReturnType<typeof editorEngine.getSnapshot>
      subscribeDocumentOperations(listener: (operation: unknown) => void): () => void
      pointer(input: import('@folio/engine-adapter').PointerInput): Promise<void>
      applyRemoteOperation(operation: import('./documentOperations').DocumentOperation): Promise<'applied' | 'duplicate' | 'revision-mismatch'>
      importPresentation(bytes: Uint8Array, documentId: string): Promise<void>
      getDocumentId(): string
      connectCollaboration(endpoint: string, documentId: string, token: string, sequence: number): Promise<void>
      closeCollaboration(): void
      sendSharedComment(text: string, slideIndex: number): void
      collaborationState(): { status: string; role: string | null; comments: unknown[] }
      formatState(): Promise<unknown>
      getTextRuler(): Promise<unknown>
      getAnimations(): Promise<unknown>
      movePreview(): ReturnType<typeof editorEngine.getMovePreviewSnapshot>
      clearPreviewCache(): void
      reset(): Promise<void>
      restoreDefaultPresentation(): Promise<void>
    }
  }
}

/** Explicitly opt-in dev-only access for the checked-in Playwright regression harness. */
export function installBrowserTestHooks(options: { readonly setZoom?: (zoom: number) => void } = {}): void {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('test') !== '1') return
  let collaborationClient: import('./collaborationClient').CollaborationClient | null = null
  let collaborationStatus = 'disconnected'
  let collaborationRole: string | null = null
  const sharedComments: unknown[] = []
  window.__folioTest = {
    async prepareBlankSlide() {
      await editorEngine.execute({ type: 'custom', name: 'slide.layout', params: { layout: 'blank' } })
    },
    async addSlideAt(index) { await editorEngine.execute({ type: 'slide.new', params: { layout: 'blank', at: index } }) },
    async selectShape(id) {
      await editorEngine.execute({ type: 'custom', name: 'selection.select', params: { id: Number(id) } })
    },
    async beginTextEdit(id) { await editorEngine.execute({ type: 'text.edit', params: { id: Number(id), at: [0, 0] } }) },
    async selectTextRange(id, anchor, caret) {
      await editorEngine.execute({ type: 'text.edit', params: { id: Number(id), at: anchor } })
      await editorEngine.execute({ type: 'custom', name: 'text.select', params: { anchor, caret } })
    },
    async selectShapes(ids) {
      for (const [index, id] of ids.entries()) await editorEngine.execute({ type: 'custom', name: 'selection.select', params: { id: Number(id), toggle: index > 0 } })
    },
    async setElementOpacity(ids, opacity) {
      await editorEngine.execute({ type: 'custom', name: 'folio.elementOpacity', params: { ids: ids.map(Number), opacity } })
      await editorEngine.execute({ type: 'custom', name: 'folio.elementOpacityEnd', params: { ids: ids.map(Number), opacity } })
    },
    exportPptx: () => editorEngine.exportPresentation(),
    async duplicateSelection() { await editorEngine.execute({ type: 'custom', name: 'edit.duplicate', params: {} }) },
    insertTextBox: () => editorEngine.insertTextBoxAndEdit([300, 360, 360, 90]),
    insertTextBoxAt: (rect, text) => editorEngine.insertTextBoxAndEdit(rect, text),
    async setSlideNotes(text, index) { await editorEngine.execute({ type: 'custom', name: 'slide.notes', params: { text, ...(index == null ? {} : { index }) } }) },
    async setSlideHidden(index, hidden) { await editorEngine.execute({ type: 'custom', name: 'slide.hide', params: { index, hidden } }) },
    async insertShape(preset, rect) { await editorEngine.execute({ type: 'shape.insert', params: { preset, rect } }) },
    async insertAudio(name, data) { await editorEngine.execute({ type: 'custom', name: 'insert.audio', params: { name, data } }) },
    async insertVideo(name, data) { return editorEngine.execute({ type: 'custom', name: 'insert.video', params: { name, data } }) },
    async mediaCommand(id, action, ms) { return editorEngine.execute({ type: 'custom', name: `media.${action}`, params: { id: Number(id), ...(action === 'play' && ms != null ? { from: ms } : ms == null ? {} : { ms }) } }) },
    async changeShape(id, preset) { await editorEngine.execute({ type: 'custom', name: 'shape.change', params: { ids: [Number(id)], preset } }) },
    setInkTool: (mode) => editorEngine.setInkTool(mode),
    setSelectTool: () => editorEngine.setSelectTool(),
    setZoom(zoom) { if (Number.isFinite(zoom)) options.setZoom?.(Math.max(10, Math.min(200, zoom))) },
    async seedShapes(count) {
      await editorEngine.initialize()
      const shapes = Array.from({ length: count }, (_, index) => ({
        name: `Regression shape ${index + 1}`,
        xfrm: { x: 100 + (index % 24) * 38, y: 80 + (Math.floor(index / 24) % 12) * 38, w: count === 1 ? 240 : 24, h: count === 1 ? 120 : 24 },
        geom: { kind: 'preset', name: 'rect' },
      }))
      await editorEngine.insertShapesBatch(shapes)
    },
    memoryBytes: () => editorEngine.getWasmMemoryBytes(),
    lastPointerResult: editorEngine.getLastPointerResult,
    hitTest: editorEngine.hitTest.bind(editorEngine),
    snapshot: editorEngine.getSnapshot,
    subscribeDocumentOperations: (listener) => editorEngine.subscribeDocumentOperations(listener),
    pointer: (input) => editorEngine.pointer(input),
    applyRemoteOperation: (operation) => editorEngine.applyRemoteOperation(operation),
    importPresentation: (bytes, documentId) => editorEngine.importPresentation(bytes, documentId),
    getDocumentId: editorEngine.getDocumentId,
    async connectCollaboration(endpoint, documentId, token, sequence) {
      const { CollaborationClient } = await import('./collaborationClient')
      collaborationClient?.dispose()
      collaborationClient = new CollaborationClient(endpoint, documentId, token, editorEngine, sequence, {
        onStatus(status) { collaborationStatus = status },
        onRole(role) { collaborationRole = role; editorEngine.setReadOnly(role === 'view' || role === 'comment') },
        onComment(comment) { sharedComments.push(comment) },
      })
      collaborationClient.connect()
    },
    closeCollaboration() { collaborationClient?.dispose(); collaborationClient = null },
    sendSharedComment(text, slideIndex) { collaborationClient?.sendComment(text, slideIndex) },
    collaborationState() { return { status: collaborationStatus, role: collaborationRole, comments: [...sharedComments] } },
    async formatState() { return (await editorEngine.execute({ type: 'custom', name: 'format.state', params: {} })).result },
    async getTextRuler() { return (await editorEngine.execute({ type: 'custom', name: 'format.ruler', params: {} })).result },
    async getAnimations() { return (await editorEngine.execute({ type: 'custom', name: 'animation.get', params: {} })).result },
    movePreview: editorEngine.getMovePreviewSnapshot,
    clearPreviewCache: () => editorEngine.clearMovePreviewCacheForTests(),
    async reset() {
      await editorEngine.newPresentation()
      await editorEngine.execute({ type: 'custom', name: 'slide.layout', params: { layout: 'blank' } })
    },
    async restoreDefaultPresentation() {
      await editorEngine.newPresentation()
    },
  }
}
