import { Profiler, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { EngineCommand, KeyInput, PointerInput, SlideId } from '@folio/engine-adapter'
import type { WorkspaceSection } from './app/sections'
import { editorEngine } from './features/engine/editorEngine'
import { EditorHeader } from './ui/header/EditorHeader'
import { NavigationRail } from './ui/navigation/NavigationRail'
import { WorkspacePanel } from './ui/panels/WorkspacePanel'
import { FormatDialog } from './ui/panels/FormatDialog'
import { EditorWorkspace } from './ui/workspace/EditorWorkspace'
import { addFolioClipboardMarker, type FolioClipboardPayload } from './ui/workspace/richTextClipboard'
import { CommentsChatPanel } from './ui/panels/CommentsChatPanel'
import { Button } from './ui/components/Button'
import { Icon } from './ui/components/Icon'
import { EngineFrame } from './ui/workspace/EngineFrame'
import { recordPerf } from './features/engine/perfDiagnostics'
import { addMediaAssets, loadMediaAssets, removeMediaAsset, type MediaAsset } from './features/media-library/mediaAssets'
import { installBrowserTestHooks } from './features/engine/browserTestHooks'
import { listRecentPresentations, loadAutosavedPresentation, loadRecentPresentation, loadSharedOwnerToken, listSharedLinks as listLocallySavedLinks, removeSharedLink as removeLocallySavedLink, saveSharedOwnerToken, saveSharedLink, saveAutosavedPresentation, type RecentPresentation } from './features/engine/documentAutosave'
import { commentDocumentKey, loadDocumentComments, type DocumentComment } from './features/engine/documentComments'
import { CollaborationClient, collaborationEndpoint, createPresenterSession, createSharedDocument, createSharedLink, getSharedDocument, listSharedLinks as fetchSharedLinks, PresenterRealtimeClient, revokeSharedLink, type PresenterSession } from './features/engine/collaborationClient'
import { useLocale } from './features/localization/locale'
import type { TemplateCard } from './features/templates/templateCards'

export function App() {
  const { locale, t } = useLocale()
  const localeApplied = useRef(locale)
  const openPresentationInput = useRef<HTMLInputElement>(null)
  const engine = useSyncExternalStore(editorEngine.subscribe, editorEngine.getSnapshot, editorEngine.getSnapshot)
  const [activeSection, setActiveSection] = useState<WorkspaceSection | null>('templates')
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light')
  const [rulersVisible, setRulersVisible] = useState(true)
  const [gridVisible, setGridVisible] = useState(false)
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false)
  const [formatPainterActive, setFormatPainterActive] = useState(false)
  const [formatDialog, setFormatDialog] = useState<{ kind: 'paragraph' | 'tabs' | 'font' | 'columns'; params: Record<string, unknown> } | null>(null)
  const [textPlacementPending, setTextPlacementPending] = useState(false)
  const [rectanglePlacementPending, setRectanglePlacementPending] = useState(false)
  const [rectanglePreset, setRectanglePreset] = useState('rect')
  const [chartPlacementPending, setChartPlacementPending] = useState(false)
  const [linePlacementPending, setLinePlacementPending] = useState(false)
  const [linePreset, setLinePreset] = useState('line')
  const [drawTool, setDrawToolState] = useState<'select' | 'pen' | 'highlighter' | 'eraser'>('select')
  const [filmstripVisible, setFilmstripVisible] = useState(true)
  const [zoom, setZoom] = useState(60)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentDocumentId, setCommentDocumentId] = useState<string | null>(null)
  const [sharedComments, setSharedComments] = useState<readonly DocumentComment[] | null>(null)
  const [collaborationRole, setCollaborationRole] = useState<'owner' | 'edit' | 'comment' | 'view' | null>(null)
  const [presentationOpen, setPresentationOpen] = useState(false)
  const [goToPageOpen, setGoToPageOpen] = useState(false)
  const [libraryFiles, setLibraryFiles] = useState<MediaAsset[]>([])
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading')
  const [autosaveEpoch, setAutosaveEpoch] = useState(0)
  const [recentPresentations, setRecentPresentations] = useState<RecentPresentation[]>([])
  const [presentationOpenError, setPresentationOpenError] = useState<string | null>(null)
  const collaborationClient = useRef<CollaborationClient | null>(null)
  const collaborationToken = useRef<string | null>(null)
  const autosaveReady = useRef(false)
  const activeDocumentId = useRef<string | null>(null)
  const pendingAutosave = useRef<Promise<void> | null>(null)
  const setDocumentId = useCallback((documentId: string) => { activeDocumentId.current = documentId; collaborationToken.current = null; setCommentDocumentId(documentId); setSharedComments(null); setCollaborationRole(null); collaborationClient.current?.dispose(); collaborationClient.current = null }, [])
  const receiveSharedComments = useCallback((comments: readonly unknown[]) => setSharedComments(normalizeSharedComments(comments, editorEngine.getSnapshot().slides)), [])
  const publishSharedComments = useCallback((comments: readonly DocumentComment[]) => { setSharedComments(comments); collaborationClient.current?.sendComments(comments) }, [])
  const refreshRecentPresentations = useCallback(() => {
    void listRecentPresentations().then(setRecentPresentations).catch(() => undefined)
  }, [])
  const formatPainterActiveRef = useRef(false)
  const clipboardWriteGeneration = useRef(0)
  const selectSection = (section: WorkspaceSection) => setActiveSection((active) => active === section ? null : section)
  const changeZoom = useCallback((nextZoom: number) => { setZoom(nextZoom); editorEngine.setViewportZoom(nextZoom) }, [])

  useEffect(() => { document.documentElement.dataset.colorMode = colorMode }, [colorMode])
  useEffect(() => {
    if (!formatPainterActive) return
    let current = true
    void editorEngine.execute({ type: 'custom', name: 'format.state', params: {} }).then((update) => {
      if (!current) return
      const stillArmed = !!(update.result && typeof update.result === 'object' && (update.result as { painter?: unknown }).painter === true)
      formatPainterActiveRef.current = stillArmed
      if (!stillArmed) setFormatPainterActive(false)
    }).catch(() => undefined)
    return () => { current = false }
  }, [formatPainterActive, engine.summary?.revision])
  useEffect(() => { editorEngine.setViewportZoom(zoom) }, [zoom])
  useEffect(() => {
    let active = true
    void (async () => {
      let invite = parseCollaborationInvite(window.location.hash)
      let saved: Awaited<ReturnType<typeof loadAutosavedPresentation>> = null
      let storageFailed = false
      try { if (!invite) saved = await loadAutosavedPresentation() }
      catch { storageFailed = true }
      let restored = false
      try {
      if (invite) {
        collaborationToken.current = invite.token
        const shared = await getSharedDocument(invite.documentId, invite.token)
        await editorEngine.importPresentation(shared.snapshot, shared.documentId)
        editorEngine.setDocumentId(shared.documentId)
        editorEngine.setReadOnly(shared.role === 'view' || shared.role === 'comment')
        for (const entry of shared.operations) {
          if (entry.sequence <= shared.snapshotSequence) continue
          const result = await editorEngine.applyRemoteOperation(entry.operation)
          if (result === 'revision-mismatch') throw new Error('PAYLASIM_SURUM_CAKISMASI')
        }
        setSharedComments(normalizeSharedComments(shared.comments, editorEngine.getSnapshot().slides))
        setCollaborationRole(shared.role)
        restored = true
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        collaborationClient.current?.dispose()
        collaborationClient.current = new CollaborationClient(
          collaborationEndpoint, shared.documentId, invite.token, editorEngine, shared.sequence,
          { onStatus(status, detail) { if (status === 'error' || status === 'conflict') setPresentationOpenError(detail ?? status) }, onRole(role) { setCollaborationRole(role); editorEngine.setReadOnly(role === 'view') }, onComments: receiveSharedComments },
        )
        collaborationClient.current.connect()
      } else if (saved) { await editorEngine.importPresentation(saved.bytes, saved.documentId); restored = true }
        else await editorEngine.initialize()
      } catch {
        storageFailed = true
        saved = null
        if (invite) { invite = null; setPresentationOpenError(t('Paylaşım bağlantısı açılamadı')) }
        await editorEngine.initialize().catch(() => undefined)
      }
      let snapshot = editorEngine.getSnapshot()
      const documentId = invite
        ? invite.documentId
        : restored && saved?.documentId
        ? saved.documentId
        : restored
          ? commentDocumentKey(snapshot.summary?.title ?? '', snapshot.slides)
          : crypto.randomUUID()
      setCommentDocumentId(documentId)
      editorEngine.setDocumentId(documentId)
      activeDocumentId.current = documentId
      if (!invite) {
        try {
          const ownerToken = await loadSharedOwnerToken(documentId)
          if (ownerToken) {
            collaborationToken.current = ownerToken
            const shared = await getSharedDocument(documentId, ownerToken)
            setSharedComments(normalizeSharedComments(shared.comments, editorEngine.getSnapshot().slides))
            setCollaborationRole('owner')
            const localRevision = editorEngine.getSnapshot().summary?.revision ?? 0
            if (shared.revision > localRevision) {
              await editorEngine.importPresentation(shared.snapshot, documentId)
              editorEngine.setDocumentId(documentId)
              for (const entry of shared.operations) {
                if (entry.sequence <= shared.snapshotSequence) continue
                const result = await editorEngine.applyRemoteOperation(entry.operation)
                if (result === 'revision-mismatch') throw new Error('Belge geçmişi eşitlenemedi.')
              }
              snapshot = editorEngine.getSnapshot()
            } else if (shared.revision < localRevision) {
              setPresentationOpenError(t('Bu cihazda sunucuya gönderilmemiş değişiklikler var.'))
            }
            if (shared.revision >= localRevision) {
              collaborationClient.current = new CollaborationClient(collaborationEndpoint, documentId, ownerToken, editorEngine, shared.sequence, {
                onStatus(status, detail) { if (status === 'error' || status === 'conflict') setPresentationOpenError(detail ?? status) },
                onRole(role) { setCollaborationRole(role); editorEngine.setReadOnly(role === 'view') },
                onComments: receiveSharedComments,
              })
              collaborationClient.current.connect()
            }
          }
        } catch (error) {
          setPresentationOpenError(error instanceof Error ? error.message : String(error))
        }
      }
      if (restored && saved) {
        const bytes = await editorEngine.exportPresentation().catch(() => saved!.bytes)
        await saveAutosavedPresentation(bytes, documentId, editorEngine.getSnapshot().summary?.title ?? saved.title ?? snapshot.summary?.title ?? 'Sunum').catch(() => { storageFailed = true })
      }
      autosaveReady.current = true
      try { setRecentPresentations(await listRecentPresentations()) } catch { storageFailed = true }
      setAutosaveEpoch((epoch) => epoch + 1)
      if (active) setAutosaveStatus(storageFailed ? 'error' : 'saved')
    })()
    return () => { active = false }
  }, [])
  useEffect(() => () => collaborationClient.current?.dispose(), [])
  useEffect(() => {
    if (!autosaveReady.current || !engine.ready || !engine.summary) return
    let active = true
    setAutosaveStatus('saving')
    const documentId = commentDocumentId
    const timer = window.setTimeout(() => {
      const saving = editorEngine.exportPresentation()
        .then((bytes) => {
          if (activeDocumentId.current !== documentId) return
          return saveAutosavedPresentation(bytes, documentId ?? undefined, engine.summary?.title ?? 'Sunum')
        })
        .then(() => { if (active && activeDocumentId.current === documentId) { setAutosaveStatus('saved'); refreshRecentPresentations() } })
        .catch(() => { if (active && activeDocumentId.current === documentId) setAutosaveStatus('error') })
        .finally(() => { if (pendingAutosave.current === saving) pendingAutosave.current = null })
      pendingAutosave.current = saving
    }, 1200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [engine.ready, engine.summary?.revision, engine.summary?.title, autosaveEpoch, commentDocumentId, refreshRecentPresentations])
  useEffect(() => { if (engine.ready && localeApplied.current !== locale) { localeApplied.current = locale; void editorEngine.setLocale(locale) } }, [engine.ready, locale])
  useEffect(() => { installBrowserTestHooks({ setZoom: changeZoom }) }, [changeZoom])
  useEffect(() => { void loadMediaAssets().then(setLibraryFiles).catch((error: unknown) => setLibraryError(error instanceof Error ? error.message : String(error))) }, [])
  useEffect(() => {
    let lastPixelRatio = window.devicePixelRatio
    let resolutionQuery: MediaQueryList
    const watchPixelRatio = () => {
      resolutionQuery?.removeEventListener('change', handlePixelRatioChange)
      lastPixelRatio = window.devicePixelRatio
      resolutionQuery = window.matchMedia(`(resolution: ${lastPixelRatio}dppx)`)
      resolutionQuery.addEventListener('change', handlePixelRatioChange, { once: true })
    }
    const updatePixelRatio = () => {
      if (window.devicePixelRatio === lastPixelRatio) return
      watchPixelRatio()
      void editorEngine.refreshViewport().catch(() => undefined)
    }
    const handlePixelRatioChange = () => updatePixelRatio()
    watchPixelRatio()
    window.addEventListener('resize', updatePixelRatio)
    // Some Chromium compositor/DPR changes do not emit resize or resolution media events.
    const pixelRatioPoll = window.setInterval(updatePixelRatio, 300)
    return () => { window.clearInterval(pixelRatioPoll); window.removeEventListener('resize', updatePixelRatio); resolutionQuery?.removeEventListener('change', handlePixelRatioChange) }
  }, [])

  const execute = useCallback((command: EngineCommand) => { void editorEngine.execute(command).catch(() => undefined) }, [])
  const copySelectionToSystemClipboard = useCallback((cut: boolean) => {
    const generation = ++clipboardWriteGeneration.current
    const selectionRender = editorEngine.renderSelectionForClipboard()
    const operation = editorEngine.execute({ type: cut ? 'edit.cut' : 'edit.copy' })
    const result = operation.then((update) => {
      if (generation !== clipboardWriteGeneration.current) throw new DOMException('Superseded clipboard write.', 'AbortError')
      const value = update.result && typeof update.result === 'object' ? update.result as { text?: unknown; html?: unknown; folioClipboard?: FolioClipboardPayload } : {}
      const text = typeof value.text === 'string' ? value.text : ''
      const folioClipboard = value.folioClipboard
      const html = typeof value.html === 'string' ? value.html : ''
      const markedHtml = folioClipboard ? addFolioClipboardMarker(html, folioClipboard) : html
      return { text: text || folioClipboard?.shapes.map((shape) => (shape as { name?: string }).name ?? 'Folio object').join('\n') || 'Folio object', html: markedHtml ?? html, hasFolioPayload: !!folioClipboard }
    })
    const itemData: Record<string, Blob | Promise<Blob>> = {
      'text/plain': result.then((value) => new Blob([value.text], { type: 'text/plain' })),
      'text/html': result.then((value) => new Blob([value.html], { type: 'text/html' })),
    }
    itemData['image/png'] = Promise.all([result, selectionRender]).then(async ([value, rendered]) => {
      if (!value.hasFolioPayload || !rendered) throw new Error('Selection has no image representation.')
      return selectionToPng(rendered.frame, engine.activeSlide?.shapes.filter((shape) => engine.selection?.shapeIds.includes(shape.id)) ?? [], rendered.scale, rendered.margin)
    })
    void (async () => {
      try {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Rich clipboard writing is not supported.')
        await navigator.clipboard.write([new ClipboardItem(itemData)])
      } catch {
        if (generation !== clipboardWriteGeneration.current) return
        try {
          const value = await result
          if (generation === clipboardWriteGeneration.current && navigator.clipboard?.writeText) await navigator.clipboard.writeText(value.text)
        } catch (error) {
          setPresentationOpenError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }, [engine.activeSlide?.shapes, engine.selection?.shapeIds])
  const onPointer = useCallback(async (input: PointerInput, previewSequence?: number) => {
    await editorEngine.pointer(input, previewSequence)
    if (input.kind !== 'up' || !formatPainterActiveRef.current) return
    try {
      const update = await editorEngine.execute({ type: 'custom', name: 'format.state', params: {} })
      const stillArmed = !!(update.result && typeof update.result === 'object' && (update.result as { painter?: unknown }).painter === true)
      formatPainterActiveRef.current = stillArmed
      if (!stillArmed) setFormatPainterActive(false)
    } catch { /* Leave the visible state armed until the engine can be queried again. */ }
  }, [])
  const onKey = useCallback((input: KeyInput) => {
    if (input.key === 'Escape' && formatPainterActiveRef.current) {
      formatPainterActiveRef.current = false
      setFormatPainterActive(false)
      void editorEngine.execute({ type: 'custom', name: 'folio.formatPainterCancel', params: {} }).catch(() => undefined)
      return
    }
    void editorEngine.key(input).catch(() => undefined)
  }, [])
  const onTypeText = useCallback((text: string) => { void editorEngine.typeText(text).catch(() => undefined) }, [])
  const onComposeText = useCallback((text: string, active?: [number, number]) => { void editorEngine.composeText(text, active).catch(() => undefined) }, [])
  const onCommitText = useCallback((text: string) => { void editorEngine.commitText(text).catch(() => undefined) }, [])
  const setDrawTool = useCallback((tool: 'select' | 'pen' | 'highlighter' | 'eraser') => {
    setDrawToolState(tool)
    void (async () => {
      if (tool === 'select') await editorEngine.setSelectTool()
      else {
        await editorEngine.key({ key: 'Escape' })
        await editorEngine.setInkTool(tool)
      }
    })().catch(() => setDrawToolState('select'))
  }, [])
  const selectSlide = useCallback((id: SlideId) => {
    const index = editorEngine.getSnapshot().slides.findIndex((slide) => slide.id === id)
    if (index >= 0) void editorEngine.execute({ type: 'slide.go', params: { index } }).catch(() => undefined)
  }, [])
  const navigatePresentation = useCallback((index: number) => {
    const slides = editorEngine.getSnapshot().slides
    const current = editorEngine.getSnapshot().summary?.activeSlideIndex ?? 0
    const direction = index > current ? 1 : index < current ? -1 : 0
    let candidate = Math.max(0, Math.min(slides.length - 1, index))
    while (slides[candidate]?.hidden) {
      if (!direction) return
      const next = candidate + direction
      if (next < 0 || next >= slides.length) return
      candidate = next
    }
    const slide = slides[candidate]
    if (slide && !slide.hidden) selectSlide(slide.id)
  }, [selectSlide])
  useEffect(() => {
    if (!presentationOpen) return
    const handle = (event: KeyboardEvent) => {
      if (goToPageOpen) {
        if (event.key === 'Escape') { event.preventDefault(); setGoToPageOpen(false) }
        return
      }
      if (event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); setGoToPageOpen(true); return }
      if (event.key === 'Escape') { setPresentationOpen(false); return }
      const index = editorEngine.getSnapshot().summary?.activeSlideIndex ?? 0
      if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); navigatePresentation(index + 1) }
      else if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); navigatePresentation(index - 1) }
      else if (event.key === 'Home') { event.preventDefault(); navigatePresentation(0) }
      else if (event.key === 'End') { event.preventDefault(); navigatePresentation(editorEngine.getSnapshot().slides.length - 1) }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [presentationOpen, goToPageOpen, navigatePresentation])
  useEffect(() => {
    if (presentationOpen || !document.fullscreenElement) return
    void document.exitFullscreen().catch(() => undefined)
  }, [presentationOpen])
  useEffect(() => {
    const handleFullscreenChange = () => { if (!document.fullscreenElement && presentationOpen) { setGoToPageOpen(false); setPresentationOpen(false) } }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [presentationOpen])
  const moveSlide = useCallback((from: number, to: number) => { void editorEngine.execute({ type: 'slide.move', params: { from, to } }).catch(() => undefined) }, [])
  const undo = useCallback(() => { void editorEngine.undo().catch(() => undefined) }, [])
  const redo = useCallback(() => { void editorEngine.redo().catch(() => undefined) }, [])
  const duplicateSlide = useCallback((id: SlideId) => { void editorEngine.duplicateSlide(id).catch(() => undefined) }, [])
  const renameSlide = useCallback((index: number, name: string) => { void editorEngine.execute({ type: 'custom', name: 'slide.rename', params: { index, name } }).catch(() => undefined) }, [])
  const toggleSlideHidden = useCallback((index: number, hidden: boolean) => { void editorEngine.execute({ type: 'custom', name: 'slide.hide', params: { index, hidden } }).catch(() => undefined) }, [])
  const preserveCurrentPresentation = useCallback(async () => {
    await pendingAutosave.current?.catch(() => undefined)
    const documentId = activeDocumentId.current
    if (!documentId || !editorEngine.getSnapshot().summary) return
    const snapshot = editorEngine.getSnapshot()
    const bytes = await editorEngine.exportPresentation()
    await saveAutosavedPresentation(bytes, documentId, snapshot.summary?.title ?? 'Sunum')
    setRecentPresentations(await listRecentPresentations())
  }, [])
  const newPresentation = useCallback(async () => {
    try {
      await preserveCurrentPresentation()
      const documentId = crypto.randomUUID()
      await editorEngine.newPresentation(documentId)
      setDocumentId(documentId)
      setAutosaveEpoch((epoch) => epoch + 1)
    } catch (error) { setPresentationOpenError(error instanceof Error ? error.message : String(error)) }
  }, [preserveCurrentPresentation, setDocumentId])
  const openPresentation = useCallback(() => openPresentationInput.current?.click(), [])
  const enterPresentationMode = useCallback(() => {
    const slides = editorEngine.getSnapshot().slides
    const current = editorEngine.getSnapshot().summary?.activeSlideIndex ?? 0
    if (slides[current]?.hidden) {
      const firstVisible = slides.find((slide) => !slide.hidden)
      if (firstVisible) selectSlide(firstVisible.id)
    }
    setPresentationOpen(true)
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined)
  }, [selectSlide])
  const createPresenterControl = useCallback(async (): Promise<{ session: PresenterSession; hostToken: string; url: string }> => {
    const documentId = activeDocumentId.current
    const current = editorEngine.getSnapshot()
    if (!documentId || !current.summary) throw new Error('Sunum henüz hazır değil.')
    let hostToken = collaborationToken.current ?? await loadSharedOwnerToken(documentId)
    if (!hostToken) {
      const bytes = await editorEngine.exportPresentation()
      const created = await createSharedDocument({ id: documentId, title: current.summary.title, revision: current.summary.revision, bytes })
      hostToken = created.ownerToken
      await saveSharedOwnerToken(documentId, hostToken)
      collaborationClient.current?.dispose()
      collaborationClient.current = new CollaborationClient(collaborationEndpoint, documentId, hostToken, editorEngine, 0, {
        onStatus(status, detail) { if (status === 'error' || status === 'conflict') setPresentationOpenError(detail ?? status) },
        onRole(role) { setCollaborationRole(role); editorEngine.setReadOnly(role === 'view') },
        onComments: receiveSharedComments,
      })
      collaborationClient.current.connect()
    } else {
      const shared = await getSharedDocument(documentId, hostToken)
      const localRevision = current.summary.revision
      if (shared.revision < localRevision) throw new Error('Sunucuya eşitlenmemiş değişiklikler var; bağlantı oluşturulmadı.')
      if (shared.revision > localRevision) {
        await editorEngine.importPresentation(shared.snapshot, documentId)
        editorEngine.setDocumentId(documentId)
        for (const entry of shared.operations) if (entry.sequence > shared.snapshotSequence) {
          const result = await editorEngine.applyRemoteOperation(entry.operation)
          if (result === 'revision-mismatch') throw new Error('Sunum geçmişi eşitlenemedi.')
        }
      }
    }
    collaborationToken.current = hostToken
    const session = await createPresenterSession(documentId, hostToken)
    const url = new URL(window.location.href)
    url.searchParams.delete('presenter')
    url.hash = new URLSearchParams({ presenterRemote: session.sessionId, token: session.token }).toString()
    return { session, hostToken, url: url.toString() }
  }, [receiveSharedComments])
  const importPresentation = useCallback((file: File) => {
    setPresentationOpenError(null)
    void preserveCurrentPresentation()
      .then(() => file.arrayBuffer())
      .then((buffer) => { const documentId = crypto.randomUUID(); return editorEngine.importPresentation(new Uint8Array(buffer), documentId).then(() => documentId) })
      .then((documentId) => { setDocumentId(documentId); setAutosaveEpoch((epoch) => epoch + 1); setPresentationOpenError(null) })
      .catch((error: unknown) => setPresentationOpenError(error instanceof Error ? error.message : String(error)))
  }, [preserveCurrentPresentation, setDocumentId])
  const importPresentationFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (file) importPresentation(file)
  }, [importPresentation])
  useEffect(() => {
    const preventBrowserFileOpen = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault()
    }
    const importDroppedPresentation = (event: DragEvent) => {
      const file = Array.from(event.dataTransfer?.files ?? []).find(isPowerPointFile)
      if (!file) return
      event.preventDefault()
      event.stopPropagation()
      importPresentation(file)
    }
    document.addEventListener('dragover', preventBrowserFileOpen, true)
    document.addEventListener('drop', importDroppedPresentation, true)
    return () => { document.removeEventListener('dragover', preventBrowserFileOpen, true); document.removeEventListener('drop', importDroppedPresentation, true) }
  }, [importPresentation])
  const openRecentPresentation = useCallback((documentId: string) => {
    setPresentationOpenError(null)
    void preserveCurrentPresentation()
      .then(() => loadRecentPresentation(documentId))
      .then((saved) => {
        if (!saved) throw new Error(t('Son sunum bulunamadı'))
        return editorEngine.importPresentation(saved.bytes, documentId).then(() => saved)
      })
      .then((saved) => { setDocumentId(documentId); setAutosaveEpoch((epoch) => epoch + 1); setPresentationOpenError(null); setRecentPresentations((items) => [{ documentId, title: saved.title ?? 'Sunum', updatedAt: Date.now() }, ...items.filter((item) => item.documentId !== documentId)].slice(0, 10)) })
      .catch((error: unknown) => setPresentationOpenError(error instanceof Error ? error.message : String(error)))
  }, [preserveCurrentPresentation, setDocumentId, t])
  const savePresentation = useCallback(async (copy: boolean) => {
    try {
      const bytes = await editorEngine.exportPresentation()
      const blob = new Blob([Uint8Array.from(bytes).buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const title = (editorEngine.getSnapshot().summary?.title || 'Sunum').replace(/[\\/:*?"<>|]/g, '-').trim()
      anchor.href = href
      anchor.download = `${title}${copy ? ' - kopya' : ''}.pptx`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 1000)
    } catch { /* The engine snapshot exposes the error in the status bar. */ }
  }, [])
  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's' || event.altKey) return
      event.preventDefault()
      void savePresentation(false)
    }
    window.addEventListener('keydown', saveShortcut)
    return () => window.removeEventListener('keydown', saveShortcut)
  }, [savePresentation])
  const sharePresentationFile = useCallback(async () => {
    const bytes = await editorEngine.exportPresentation()
    const title = (editorEngine.getSnapshot().summary?.title || 'Sunum').replace(/[\\/:*?"<>|]/g, '-').trim()
    const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    const file = new File([Uint8Array.from(bytes).buffer as ArrayBuffer], `${title}.pptx`, { type: mime })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title })
      return
    }
    const href = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = file.name
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  }, [])
  const createCollaborationInvite = useCallback(async (role: 'edit' | 'comment' | 'view'): Promise<string> => {
    const documentId = activeDocumentId.current
    const current = editorEngine.getSnapshot()
    if (!documentId || !current.summary) throw new Error('Sunum henüz hazır değil.')
    let ownerToken = collaborationToken.current ?? await loadSharedOwnerToken(documentId)
    let initialLocalComments: readonly DocumentComment[] = []
    if (!ownerToken) {
      const bytes = await editorEngine.exportPresentation()
      initialLocalComments = await loadDocumentComments(documentId).catch(() => [])
      const created = await createSharedDocument({ id: documentId, title: current.summary.title, revision: current.summary.revision, bytes })
      ownerToken = created.ownerToken
      await saveSharedOwnerToken(documentId, ownerToken)
    }
    collaborationToken.current = ownerToken
    const shared = await getSharedDocument(documentId, ownerToken)
    setSharedComments(normalizeSharedComments(shared.comments, editorEngine.getSnapshot().slides))
    setCollaborationRole('owner')
    const localRevision = editorEngine.getSnapshot().summary?.revision ?? 0
    if (shared.revision < localRevision) throw new Error('Bu cihazda sunucuya gönderilmemiş değişiklikler var. Eşitlenmeden bağlantı oluşturulamaz.')
    if (shared.revision > localRevision) {
      collaborationClient.current?.dispose()
      await editorEngine.importPresentation(shared.snapshot, documentId)
      editorEngine.setDocumentId(documentId)
      for (const entry of shared.operations) {
        if (entry.sequence <= shared.snapshotSequence) continue
        const result = await editorEngine.applyRemoteOperation(entry.operation)
        if (result === 'revision-mismatch') throw new Error('Belge eşitlenemedi; sayfayı yenileyip tekrar deneyin.')
      }
    }
    const link = await createSharedLink(documentId, ownerToken, role)
    await saveSharedLink({ documentId, shareId: link.shareId, role: link.role, token: link.token, createdAt: Date.now() })
    collaborationClient.current?.dispose()
    collaborationClient.current = new CollaborationClient(collaborationEndpoint, documentId, ownerToken, editorEngine, shared.sequence, {
      onStatus(status, detail) { if (status === 'error' || status === 'conflict') setPresentationOpenError(detail ?? status); else if (status === 'connected' && initialLocalComments.length) collaborationClient.current?.sendComments(initialLocalComments) },
      onRole(nextRole) { setCollaborationRole(nextRole); editorEngine.setReadOnly(nextRole === 'view') },
      onComments: receiveSharedComments,
    })
    collaborationClient.current.connect()
    const url = new URL(window.location.href)
    url.hash = `collab=${encodeURIComponent(documentId)}.${link.token}`
    return url.toString()
  }, [])
  const listCollaborationLinks = useCallback(async () => {
    const documentId = activeDocumentId.current
    if (!documentId) return []
    const ownerToken = await loadSharedOwnerToken(documentId)
    if (!ownerToken) return []
    const [remote, local] = await Promise.all([fetchSharedLinks(documentId, ownerToken), listLocallySavedLinks(documentId)])
    const localById = new Map(local.map((link) => [link.shareId, link.token]))
    return remote.map((link) => {
      const token = localById.get(link.shareId)
      if (!token) return link
      const url = new URL(window.location.href)
      url.hash = `collab=${encodeURIComponent(documentId)}.${token}`
      return { ...link, href: url.toString() }
    })
  }, [])
  const revokeCollaborationLink = useCallback(async (shareId: string) => {
    const documentId = activeDocumentId.current
    if (!documentId) throw new Error('Sunum bulunamadı.')
    const ownerToken = await loadSharedOwnerToken(documentId)
    if (!ownerToken) throw new Error('Bu bağlantıyı yönetme yetkiniz yok.')
    await revokeSharedLink(documentId, ownerToken, shareId)
    await removeLocallySavedLink(documentId, shareId)
  }, [])
  const insertText = useCallback(() => { setTextPlacementPending((pending) => !pending) }, [])
  const placeText = useCallback((rect: [number, number, number, number]) => {
    setTextPlacementPending(false)
    void editorEngine.insertTextBoxAndEdit(rect).catch(() => undefined)
  }, [])
  const insertRectangle = useCallback((preset = 'rect') => { setRectanglePreset(preset); setRectanglePlacementPending(true) }, [])
  const placeRectangle = useCallback((rect: [number, number, number, number], preset: string) => {
    setRectanglePlacementPending(false)
    void editorEngine.execute({ type: 'shape.insert', params: { preset, rect } }).catch(() => undefined)
  }, [])
  const insertNote = useCallback(async () => {
    const shapeCount = editorEngine.getSnapshot().activeSlide?.shapes.length ?? 0
    const offset = (shapeCount % 6) * 28
    try {
      await editorEngine.insertShapesBatch([{
        name: 'Not',
        xfrm: { x: 300 + offset, y: 180 + offset, w: 280, h: 200 },
        geom: { kind: 'preset', name: 'rect' },
        fill: { kind: 'solid', color: { base: { kind: 'rgb', rgb: { r: 255, g: 242, b: 168, a: 255 } }, mods: [] } },
        line: { fill: { kind: 'none' } },
        text: { paragraphs: [{ runs: [{ text: 'Notunuzu yazın' }] }] },
      }])
    } catch { /* The engine snapshot exposes command errors. */ }
  }, [])
  const insertTable = useCallback(() => { void editorEngine.execute({ type: 'custom', name: 'insert.table', params: { rows: 3, cols: 3, rect: [120, 140, 720, 240] } }).catch(() => undefined) }, [])
  const insertChart = useCallback(() => { setChartPlacementPending(true) }, [])
  const placeChart = useCallback((rect: [number, number, number, number]) => {
    setChartPlacementPending(false)
    void editorEngine.execute({ type: 'custom', name: 'insert.chart', params: { type: 'column', title: 'Grafik', rect, categories: ['A', 'B', 'C'], series: [{ name: 'Seri 1', values: [4, 7, 5] }] } }).catch(() => undefined)
  }, [])
  const insertIcon = useCallback((name: string) => { void editorEngine.execute({ type: 'custom', name: 'insert.icon', params: { name, rect: [400, 200, 120, 120] } }).catch(() => undefined) }, [])
  const insertDiagram = useCallback(() => { void editorEngine.execute({ type: 'custom', name: 'insert.smartArt', params: { kind: 'process', items: ['Başlangıç', 'Süreç', 'Sonuç'] } }).catch(() => undefined) }, [])
  const insertLine = useCallback((preset = 'line') => { setLinePreset(preset); setLinePlacementPending(true) }, [])
  const placeLine = useCallback((rect: [number, number, number, number], flipV: boolean, preset: string) => {
    setLinePlacementPending(false)
    void editorEngine.execute({ type: 'shape.insert', params: { preset, rect, ...(flipV && preset === 'line' ? { flip: 'v' } : {}) } }).catch(() => undefined)
  }, [])
  const insertWordArt = useCallback(() => { void editorEngine.execute({ type: 'custom', name: 'insert.wordArt', params: { text: 'Vurgu', style: 1 } }).catch(() => undefined) }, [])
  const applyTheme = useCallback((name: string) => { void editorEngine.execute({ type: 'custom', name: 'design.theme', params: { name } }).catch(() => undefined) }, [])
  const applyColorScheme = useCallback((name: string) => { void editorEngine.execute({ type: 'custom', name: 'design.colors', params: { name } }).catch(() => undefined) }, [])
  const applyFontScheme = useCallback((name: string) => { void editorEngine.execute({ type: 'custom', name: 'design.fonts', params: { name } }).catch(() => undefined) }, [])
  const applyEffectScheme = useCallback((name: string) => { void editorEngine.execute({ type: 'custom', name: 'design.effects', params: { name } }).catch(() => undefined) }, [])
  const renamePresentation = useCallback((title: string) => { void editorEngine.execute({ type: 'custom', name: 'file.properties', params: { title } }).catch(() => undefined) }, [])
  const exportPresentationFile = useCallback(async (format: 'pdf' | 'pptx') => {
    const exported = await editorEngine.execute({ type: 'custom', name: 'file.saveBytes', params: { format } })
    const data = (exported.result as { data?: unknown } | null)?.data
    if (typeof data !== 'string') throw new Error('Dosya dışa aktarılamadı.')
    const binary = atob(data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const anchor = document.createElement('a')
    const title = (editorEngine.getSnapshot().summary?.title || 'Sunum').replace(/[\\/:*?"<>|]/g, '-').trim()
    anchor.href = blobUrl
    anchor.download = `${title}.${format}`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }, [])
  const applyTemplate = useCallback((template: TemplateCard) => {
    void editorEngine.execute({ type: 'custom', name: 'presentation.applyTemplate', params: { ...template, slides: template.slides.map((slide, index) => ({ ...slide, layout: template.layouts[index] })) } }).catch(() => undefined)
  }, [])
  const selectShape = useCallback((id: string) => { void editorEngine.execute({ type: 'custom', name: 'selection.select', params: { id: Number(id) } }).catch(() => undefined) }, [])
  const setShapeVisibility = useCallback((id: string, visible: boolean) => { void editorEngine.execute({ type: 'custom', name: 'shape.visible', params: { ids: [Number(id)], visible } }).catch(() => undefined) }, [])
  const setShapeLocked = useCallback((id: string, locked: boolean) => { void editorEngine.execute({ type: 'custom', name: 'shape.lock', params: { ids: [Number(id)], locked } }).catch(() => undefined) }, [])
  const showAllShapes = useCallback((visible: boolean) => { void editorEngine.execute({ type: 'custom', name: visible ? 'selection.showAll' : 'selection.hideAll', params: {} }).catch(() => undefined) }, [])
  const setTransition = useCallback((index: number, kind = 'fade') => { void editorEngine.execute({ type: 'custom', name: 'transition.set', params: { kind, index } }).catch(() => undefined) }, [])
  const transitionCommand = useCallback((name: 'transition.set' | 'transition.options' | 'transition.timing' | 'transition.applyAll', params: Record<string, unknown>) => { void editorEngine.execute({ type: 'custom', name, params }).catch(() => undefined) }, [])
  const queryTransitionCatalog = useCallback(async () => { try { const update = await editorEngine.execute({ type: 'custom', name: 'transition.list', params: {} }); return Array.isArray(update.result) ? update.result as Array<{ id: string; label: string; category: string; duration: number; options: string[] }> : [] } catch { return [] } }, [])
  const queryShapePresets = useCallback(() => editorEngine.getShapePresets(), [])
  const addAnimation = useCallback((effect: string, animationClass: string, start: string, duration: number) => { const ids = editorEngine.getSnapshot().selection?.shapeIds.map(Number) ?? []; if (ids.length) void editorEngine.execute({ type: 'custom', name: 'animation.add', params: { effect, class: animationClass, start, duration, ids } }).catch(() => undefined) }, [])
  const manageAnimation = useCallback((name: 'animation.remove' | 'animation.move', params: { index: number; to?: number }) => { void editorEngine.execute({ type: 'custom', name, params }).catch(() => undefined) }, [])
  const arrangeSelection = useCallback((name: 'arrange.align' | 'arrange.distribute' | 'arrange.bringForward' | 'arrange.sendBackward' | 'arrange.bringToFront' | 'arrange.sendToBack', params: Record<string, string | number[]>) => { void editorEngine.execute({ type: 'custom', name, params }).catch(() => undefined) }, [])
  const reorderShape = useCallback((id: string, index: number) => { void editorEngine.execute({ type: 'custom', name: 'arrange.reorder', params: { id: Number(id), index } }).catch(() => undefined) }, [])
  const formatSelectedShape = useCallback((name: 'shape.altText' | 'shape.fill' | 'shape.line' | 'shape.setBounds' | 'shape.rotate' | 'shape.flip' | 'shape.change' | 'shape.action', params: Record<string, unknown>) => { const ids = editorEngine.getSnapshot().selection?.shapeIds.map(Number) ?? []; if (ids.length) void editorEngine.execute({ type: 'custom', name, params: { ...params, ids } }).catch(() => undefined) }, [])
  const formatSelectedText = useCallback((name: 'format.bold' | 'format.italic' | 'format.underline' | 'format.strikethrough' | 'format.subscript' | 'format.superscript' | 'format.grow' | 'format.shrink' | 'format.highlight' | 'format.clear' | 'format.autofit' | 'format.wrap' | 'format.margins' | 'format.case' | 'format.caps' | 'format.font' | 'format.size' | 'format.color' | 'format.align' | 'format.bullets' | 'format.numbering' | 'format.lineSpacing' | 'format.spacing' | 'format.indent' | 'format.outdent' | 'format.paragraphDialog' | 'format.tabs' | 'format.fontDialog' | 'format.columns' | 'format.direction' | 'format.anchor' | 'format.rtl' | 'format.textShadow' | 'folio.textGlow' | 'format.textOutline' | 'format.textWarp' | 'format.painter' | 'format.painterCancel', params: Record<string, unknown>) => {
    if (name === 'format.painterCancel') {
      formatPainterActiveRef.current = false
      setFormatPainterActive(false)
      void editorEngine.execute({ type: 'custom', name: 'folio.formatPainterCancel', params: {} }).catch(() => undefined)
      return
    }
    if (name === 'format.painter') {
      void editorEngine.execute({ type: 'custom', name, params }).then(() => {
        formatPainterActiveRef.current = true
        setFormatPainterActive(true)
      }).catch(() => undefined)
      return
    }
    void editorEngine.execute({ type: 'custom', name, params }).then((update) => {
      const request = update.uiRequests?.find((item) => item.kind === 'dialog' && (item.id === 'paragraph' || item.id === 'tabs' || item.id === 'font' || item.id === 'columns'))
      if (request && typeof request.id === 'string' && request.params && typeof request.params === 'object') setFormatDialog({ kind: request.id === 'paragraph' ? 'paragraph' : request.id === 'tabs' ? 'tabs' : request.id === 'font' ? 'font' : 'columns', params: request.params as Record<string, unknown> })
    }).catch(() => undefined)
  }, [])
  const applyFormatDialog = useCallback((name: string, params: Record<string, unknown>) => {
    void editorEngine.execute({ type: 'custom', name, params }).then(() => setFormatDialog(null)).catch(() => undefined)
  }, [])
  const insertSymbol = useCallback((text: string) => { void editorEngine.execute({ type: 'custom', name: 'insert.symbol', params: { text } }).catch(() => undefined) }, [])
  const applyPictureCrop = useCallback((id: string, crop: [number, number, number, number]) => { void editorEngine.execute({ type: 'custom', name: 'picture.crop', params: { ids: [Number(id)], left: crop[0], top: crop[1], right: crop[2], bottom: crop[3] } }).catch(() => undefined) }, [])
  const chartCommand = useCallback((name: 'chart.data' | 'chart.type' | 'chart.options', params: Record<string, unknown>) => { void editorEngine.execute({ type: 'custom', name, params }).catch(() => undefined) }, [])
  const tableCommand = useCallback((name: 'table.insertRowAbove' | 'table.insertRowBelow' | 'table.insertColumnLeft' | 'table.insertColumnRight' | 'table.deleteRow' | 'table.deleteColumn' | 'table.style' | 'table.options' | 'table.cellFill' | 'table.cellAlign' | 'table.cellMargins' | 'table.borders' | 'table.distributeRows' | 'table.distributeColumns' | 'table.merge' | 'table.split' | 'table.selectCells', params: Record<string, unknown>) => { const id = editorEngine.getSnapshot().selection?.shapeIds[0]; if (id) void editorEngine.execute({ type: 'custom', name, params: { ...params, id: Number(id) } }).catch(() => undefined) }, [])
  const addSection = useCallback((index: number, name: string) => { void editorEngine.execute({ type: 'custom', name: 'section.add', params: { name, at: index } }).catch((error: unknown) => console.error('Could not add slide section:', error)) }, [])
  const renameSection = useCallback((index: number, name: string) => { void editorEngine.execute({ type: 'custom', name: 'section.rename', params: { index, name } }).catch(() => undefined) }, [])
  const removeSection = useCallback((index: number, withSlides: boolean) => { void editorEngine.execute({ type: 'custom', name: 'section.remove', params: { index, slides: withSlides } }).catch(() => undefined) }, [])
  const moveSection = useCallback((index: number, to: number) => { void editorEngine.execute({ type: 'custom', name: 'section.move', params: { index, to } }).catch(() => undefined) }, [])
  const saveLibraryFiles = useCallback(async (files: File[]) => {
    try { setLibraryFiles(await addMediaAssets(files)); setLibraryError(null) }
    catch (error) { setLibraryError(error instanceof Error ? error.message : String(error)) }
  }, [])
  const deleteLibraryAsset = useCallback(async (id: string) => {
    try { setLibraryFiles(await removeMediaAsset(id)); setLibraryError(null) }
    catch (error) { setLibraryError(error instanceof Error ? error.message : String(error)) }
  }, [])
  const insertMedia = useCallback(async (file: File, point?: [number, number]) => {
    try {
      setLibraryFiles(await addMediaAssets([file]))
      setLibraryError(null)
      const mime = file.type.toLocaleLowerCase()
      const command = mime.startsWith('image/') ? 'insert.picture' : mime.startsWith('video/') ? 'insert.video' : mime.startsWith('audio/') ? 'insert.audio' : null
      if (!command) throw new Error('Bu dosya türü slayta eklenemiyor. Resim, ses veya video dosyası seçin.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      let rect: [number, number, number, number] | undefined
      if (point) {
        let width = 480, height = 270
        if (mime.startsWith('image/')) {
          try {
            const bitmap = await createImageBitmap(file)
            const scale = Math.min(1, 640 / bitmap.width, 420 / bitmap.height)
            width = bitmap.width * scale
            height = bitmap.height * scale
            bitmap.close()
          } catch { /* Unsupported image decoders use the standard media frame. */ }
        }
        const slideWidth = engine.summary?.slideSize[0] ?? 960
        const slideHeight = engine.summary?.slideSize[1] ?? 540
        rect = [Math.max(0, Math.min(slideWidth - width, point[0] - width / 2)), Math.max(0, Math.min(slideHeight - height, point[1] - height / 2)), width, height]
      }
      await editorEngine.execute({ type: 'custom', name: command, params: { name: file.name, data: btoa(binary), ...(rect ? { rect } : {}) } })
    } catch (error) { setLibraryError(error instanceof Error ? error.message : String(error)) }
  }, [engine.summary?.slideSize[0], engine.summary?.slideSize[1]])

  const activeSlideNumber = (engine.summary?.activeSlideIndex ?? 0) + 1
  return <Profiler id="folio-app" onRender={(_id, _phase, actualDuration) => { recordPerf('react.commit.render', actualDuration); const commits = (window as Window & { __folioReactCommitTimes?: number[] }).__folioReactCommitTimes; if (commits) commits.push(performance.now()) }}><main className={`editor-shell${activeSection ? '' : ' editor-shell--panel-closed'}`} data-color-mode={colorMode} data-engine-ready={engine.ready} data-engine-slides={engine.slides.length} data-engine-active-slide={engine.summary?.activeSlideIndex ?? 0} data-engine-slide-size={JSON.stringify(engine.summary?.slideSize ?? [960, 540])} data-engine-background={engine.activeSlide?.backgroundColor ?? ''} data-engine-background-type={engine.activeSlide?.backgroundType ?? ''} data-engine-sections={JSON.stringify(engine.summary?.sections ?? [])} data-engine-shapes={engine.activeSlide?.shapes.length ?? 0} data-engine-projection={JSON.stringify(engine.activeSlide?.shapes ?? [])} data-engine-selection={JSON.stringify(engine.selection?.shapeIds ?? [])} data-engine-notes={engine.activeSlide?.notes ?? ''} data-engine-revision={engine.summary?.revision ?? -1} data-engine-can-undo={engine.summary?.canUndo ?? false} data-engine-can-redo={engine.summary?.canRedo ?? false}>
    <input ref={openPresentationInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" hidden aria-label={t('Açılacak PowerPoint sunumunu seç')} onChange={importPresentationFile} />
    <EditorHeader documentTitle={engine.summary?.title ?? t('Sunum yükleniyor')} openError={presentationOpenError} onDismissOpenError={() => setPresentationOpenError(null)} colorMode={colorMode} rulersVisible={rulersVisible} gridVisible={gridVisible} gridSnapEnabled={gridSnapEnabled} commentsOpen={commentsOpen} canUndo={engine.summary?.canUndo ?? false} canRedo={engine.summary?.canRedo ?? false} hasSelection={!!engine.selection?.shapeIds.length || !!engine.selection?.textSelection} onUndo={undo} onRedo={redo} onCommand={execute} onRenamePresentation={renamePresentation} onExport={exportPresentationFile} onSharePresentation={sharePresentationFile} onCreateCollaborationLink={createCollaborationInvite} onListCollaborationLinks={listCollaborationLinks} onRevokeCollaborationLink={revokeCollaborationLink} onNewPresentation={newPresentation} onOpenPresentation={openPresentation} onSavePresentation={(copy) => { void savePresentation(copy) }} recentPresentations={recentPresentations} onOpenRecentPresentation={openRecentPresentation} onPresent={enterPresentationMode} onToggleComments={() => setCommentsOpen((open) => !open)} onColorModeChange={setColorMode} onToggleRulers={() => setRulersVisible((visible) => !visible)} onToggleGrid={() => setGridVisible((visible) => !visible)} onToggleGridSnap={() => setGridSnapEnabled((enabled) => !enabled)} />
    <NavigationRail active={activeSection} onSelect={selectSection} />
    {activeSection && <WorkspacePanel section={activeSection} onClose={() => setActiveSection(null)} engine={engine} libraryFiles={libraryFiles} libraryError={libraryError} onAddLibraryFiles={saveLibraryFiles} onRemoveLibraryAsset={deleteLibraryAsset} onSetSlideSize={(params) => execute({ type: 'custom', name: 'design.slideSize', params })} onInsertText={insertText} onInsertShape={insertRectangle} onInsertRect={insertRectangle} onInsertNote={insertNote} onSetDrawTool={setDrawTool} drawTool={drawTool} onInsertSymbol={insertSymbol} onInsertTable={insertTable} onInsertChart={insertChart} onInsertIcon={insertIcon} onInsertDiagram={insertDiagram} onInsertLine={insertLine} onInsertWordArt={insertWordArt} onApplyTheme={applyTheme} onApplyColorScheme={applyColorScheme} onApplyFontScheme={applyFontScheme} onApplyEffectScheme={applyEffectScheme} onSelectShape={selectShape} onSetShapeVisibility={setShapeVisibility} onSetShapeLocked={setShapeLocked} onShowAllShapes={showAllShapes} onSetTransition={setTransition} onTransitionCommand={transitionCommand} onQueryTransitionCatalog={queryTransitionCatalog} onQueryShapePresets={queryShapePresets} onAddAnimation={addAnimation} onManageAnimation={manageAnimation} onArrange={arrangeSelection} onReorderShape={reorderShape} onFormatShape={formatSelectedShape} onFormatText={formatSelectedText} formatPainterActive={formatPainterActive} onApplyPictureCrop={applyPictureCrop} onChartCommand={chartCommand} onTableCommand={tableCommand} onInsertMedia={insertMedia} onApplyTemplate={applyTemplate} />}
    <EditorWorkspace zoom={zoom} onZoomChange={changeZoom} rulersVisible={rulersVisible} gridVisible={gridVisible} gridSnapEnabled={gridSnapEnabled} autosaveStatus={autosaveStatus} drawingTool={drawTool !== 'select'} placingText={textPlacementPending} placingRectangle={rectanglePlacementPending} rectanglePreset={rectanglePreset} placingLine={linePlacementPending} linePreset={linePreset} placingChart={chartPlacementPending} onPlaceChart={placeChart} onPlaceText={placeText} onPlaceRectangle={placeRectangle} onPlaceLine={placeLine} onCancelTextPlacement={() => { setTextPlacementPending(false); setRectanglePlacementPending(false); setLinePlacementPending(false); setChartPlacementPending(false) }} onToggleGrid={() => setGridVisible((visible) => !visible)} filmstripVisible={filmstripVisible} engine={engine} onSelectSlide={selectSlide} onDuplicateSlide={duplicateSlide} onMoveSlide={moveSlide} onRenameSlide={renameSlide} onToggleSlideHidden={toggleSlideHidden} onSetTransition={setTransition} onAddSection={addSection} onRenameSection={renameSection} onRemoveSection={removeSection} onMoveSection={moveSection} onExecute={execute} onCopySelectionToSystemClipboard={copySelectionToSystemClipboard} onPasteFolioClipboard={(payload) => { void editorEngine.insertShapesBatch([...payload.shapes], [...payload.media]).catch((error) => setPresentationOpenError(error instanceof Error ? error.message : String(error))) }} onPresent={() => setPresentationOpen(true)} onPointer={onPointer} onKey={onKey} onTypeText={onTypeText} onComposeText={onComposeText} onCommitText={onCommitText} onDropMedia={(file, point) => { void insertMedia(file, point) }} onInsertShapesBatch={(shapes) => { void editorEngine.insertShapesBatch(shapes).catch((error) => setPresentationOpenError(error instanceof Error ? error.message : String(error))) }} onPasteRichText={(payload) => { void editorEngine.execute({ type: "custom", name: "folio.textPasteRich", params: { ...payload } }).catch((error) => setPresentationOpenError(error instanceof Error ? error.message : String(error))) }} onToggleFilmstrip={() => setFilmstripVisible((visible) => !visible)} />
    {commentsOpen && <CommentsChatPanel slides={engine.slides} activeSlide={activeSlideNumber} activeShape={engine.selection?.shapeIds.length === 1 ? (() => { const shape = engine.activeSlide?.shapes.find((item) => item.id === engine.selection?.shapeIds[0]); return shape ? { id: shape.id, name: shape.name } : null })() : null} documentKey={commentDocumentId ?? commentDocumentKey(engine.summary?.title ?? '', engine.slides)} sharedComments={sharedComments} canComment={collaborationRole !== 'view'} onSharedCommentsChange={publishSharedComments} onSelectSlide={(index) => { const slide = engine.slides[index - 1]; if (slide) selectSlide(slide.id) }} onSelectShape={async (index, shapeId) => { const slide = engine.slides[index - 1]; if (!slide) return; await editorEngine.execute({ type: 'slide.go', params: { index: index - 1 } }); await editorEngine.execute({ type: 'custom', name: 'selection.select', params: { id: Number(shapeId) } }) }} onClose={() => setCommentsOpen(false)} />}
    {presentationOpen && <PresentationMode engine={engine} goToPageOpen={goToPageOpen} onGoToPageOpenChange={setGoToPageOpen} onClose={() => { setGoToPageOpen(false); setPresentationOpen(false) }} onNavigate={navigatePresentation} onCreateRemoteControl={createPresenterControl} />}
    {formatDialog && <FormatDialog kind={formatDialog.kind} params={formatDialog.params} t={t} onClose={() => setFormatDialog(null)} onApply={applyFormatDialog} />}
  </main></Profiler>
}

function PresentationMode({ engine, goToPageOpen, onGoToPageOpenChange, onClose, onNavigate, onCreateRemoteControl }: { readonly engine: ReturnType<typeof editorEngine.getSnapshot>; readonly goToPageOpen: boolean; readonly onGoToPageOpenChange: (open: boolean) => void; readonly onNavigate: (index: number) => void; readonly onClose: () => void; readonly onCreateRemoteControl: () => Promise<{ session: PresenterSession; hostToken: string; url: string }> }) {
  const { t } = useLocale()
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  const presenterChannelName = useRef(`folio-presenter-${crypto.randomUUID()}`).current
  const presenterChannel = useRef<BroadcastChannel | null>(null)
  const remoteHost = useRef<PresenterRealtimeClient | null>(null)
  const engineRef = useRef(engine)
  const navigateRef = useRef(onNavigate)
  const closeRef = useRef(onClose)
  const [presenterError, setPresenterError] = useState(false)
  const [pageNumber, setPageNumber] = useState('')
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null)
  const [remotePending, setRemotePending] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const index = engine.summary?.activeSlideIndex ?? 0
  const visibleSlides = engine.slides.map((slide, slideIndex) => ({ slide, slideIndex })).filter(({ slide }) => !slide.hidden)
  const visiblePage = Math.max(0, visibleSlides.findIndex(({ slideIndex }) => slideIndex === index))
  engineRef.current = engine
  navigateRef.current = onNavigate
  closeRef.current = onClose
  const publishPresenterState = useCallback(() => {
    const current = engineRef.current
    const visibleSlides = current.slides.filter((slide) => !slide.hidden)
    const activeSlideId = current.slides[current.summary?.activeSlideIndex ?? 0]?.id
    const state = {
      title: current.summary?.title ?? 'Sunum', index: Math.max(0, visibleSlides.findIndex((slide) => slide.id === activeSlideId)),
      total: visibleSlides.length,
      notes: current.activeSlide?.notes ?? '', frame: current.activeFrame,
    }
    presenterChannel.current?.postMessage({ type: 'state', state })
    remoteHost.current?.sendState(state)
  }, [])
  useEffect(() => {
    const channel = new BroadcastChannel(presenterChannelName)
    presenterChannel.current = channel
    channel.onmessage = (event: MessageEvent<{ type?: string; direction?: number }>) => {
      if (event.data.type === 'ready') { publishPresenterState(); return }
      if (event.data.type === 'close') { closeRef.current(); return }
      if (event.data.type === 'navigate' && (event.data.direction === 1 || event.data.direction === -1)) {
        const current = engineRef.current
        const currentIndex = current.summary?.activeSlideIndex ?? 0
        let next = currentIndex + event.data.direction
        while (next >= 0 && next < current.slides.length && current.slides[next]?.hidden) next += event.data.direction
        if (next >= 0 && next < current.slides.length) navigateRef.current(next)
      }
    }
    return () => { channel.close(); if (presenterChannel.current === channel) presenterChannel.current = null }
  }, [presenterChannelName, publishPresenterState])
  useEffect(() => () => remoteHost.current?.close(), [])
  useEffect(() => { publishPresenterState() }, [engine.activeFrame, engine.activeSlide?.notes, engine.summary?.activeSlideIndex, engine.summary?.revision, engine.summary?.title, publishPresenterState])
  const openPresenter = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('presenter', presenterChannelName)
    const popup = window.open(url, 'folio-presenter', 'popup,width=1280,height=800')
    setPresenterError(!popup)
  }
  const openRemoteControl = async () => {
    if (remotePending) return
    setRemotePending(true)
    setRemoteError(null)
    try {
      const { session, hostToken, url } = await onCreateRemoteControl()
      const client = new PresenterRealtimeClient(collaborationEndpoint, session, 'host', hostToken, { onNavigate: (direction) => {
        const current = engineRef.current
        let next = (current.summary?.activeSlideIndex ?? 0) + direction
        while (next >= 0 && next < current.slides.length && current.slides[next]?.hidden) next += direction
        if (next >= 0 && next < current.slides.length) navigateRef.current(next)
      }, onEnded: () => { remoteHost.current = null; setRemoteUrl(null) } })
      await client.connect()
      remoteHost.current?.close()
      remoteHost.current = client
      setRemoteUrl(url)
      publishPresenterState()
    } catch (error) { setRemoteError(error instanceof Error ? error.message : String(error)) }
    finally { setRemotePending(false) }
  }
  const copyRemoteUrl = async () => {
    if (!remoteUrl) return
    try { await navigator.clipboard.writeText(remoteUrl) }
    catch { const input = document.querySelector<HTMLInputElement>('.presenter-share__url'); input?.focus(); input?.select(); document.execCommand('copy') }
  }
  const navigateVisible = (direction: -1 | 1) => {
    let candidate = index + direction
    while (candidate >= 0 && candidate < engine.slides.length && engine.slides[candidate]?.hidden) candidate += direction
    if (candidate >= 0 && candidate < engine.slides.length) onNavigate(candidate)
  }
  const openPageJump = () => { setPageNumber(String(visiblePage + 1)); onGoToPageOpenChange(true) }
  const submitPageJump = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const page = Number(pageNumber)
    const target = Number.isInteger(page) ? visibleSlides[page - 1] : undefined
    if (!target) return
    onNavigate(target.slideIndex)
    onGoToPageOpenChange(false)
  }
  const handleStageClick = async (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    const slideElement = event.currentTarget.querySelector<HTMLElement>('.presentation-mode__slide')
    const bounds = slideElement?.getBoundingClientRect()
    const [width, height] = engine.summary?.slideSize ?? [960, 540]
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const x = (event.clientX - bounds.left) / bounds.width * width
      const y = (event.clientY - bounds.top) / bounds.height * height
      const hit = await editorEngine.hitTest(x, y).catch(() => null)
      const shape = hit?.id == null ? null : engine.activeSlide?.shapes.find((item) => item.id === String(hit.id))
      const clickAction = shape?.clickAction as { action?: { kind?: string; url?: string; slide?: string | number } } | null | undefined
      const action = clickAction?.action
      if (action?.kind === 'url' && action.url && isSafePresentationUrl(action.url)) { window.open(action.url, '_blank', 'noopener,noreferrer'); return }
      if (action?.kind === 'slide') { const target = engine.slides.findIndex((slide) => slide.id === String(action.slide)); if (target >= 0) { onNavigate(target); return } }
      if (action?.kind === 'nextSlide') { navigateVisible(1); return }
      if (action?.kind === 'previousSlide') { navigateVisible(-1); return }
      if (action?.kind === 'firstSlide') { const target = engine.slides.findIndex((slide) => !slide.hidden); if (target >= 0) { onNavigate(target); return } }
      if (action?.kind === 'lastSlide') { let target = -1; for (let slideIndex = engine.slides.length - 1; slideIndex >= 0; slideIndex -= 1) if (!engine.slides[slideIndex]?.hidden) { target = slideIndex; break } if (target >= 0) { onNavigate(target); return } }
      if (action?.kind === 'endShow') { onClose(); return }
    }
    navigateVisible(1)
  }
  const [slideWidth, slideHeight] = engine.summary?.slideSize ?? [960, 540]
  return <section className="presentation-mode" role="dialog" aria-modal="true" aria-label={t('Sunum görünümü')}>
    <header className="presentation-mode__header"><span>{engine.summary?.title ?? t('Sunum')} · {visiblePage + 1} / {visibleSlides.length}</span><div className="presentation-mode__header-actions"><Button variant="secondary" size="sm" onClick={openPresenter}>{t('Sunucu görünümü')}</Button><Button variant="secondary" size="sm" disabled={remotePending} onClick={() => { void openRemoteControl() }}>{remotePending ? t('Bağlantı hazırlanıyor…') : t('Uzaktan kumandayı paylaş')}</Button><Button variant="secondary" size="sm" onClick={onClose}>{t('Sunumdan çık')}</Button></div></header>
    {presenterError && <span className="presentation-mode__presenter-error" role="status">{t('Sunucu görünümü açılamadı. Tarayıcı penceresine izin verin.')}</span>}
    {remoteError && <span className="presentation-mode__presenter-error" role="alert">{remoteError}</span>}
    {remoteUrl && <div className="presenter-share" role="dialog" aria-label={t('Uzaktan kumanda bağlantısı')}><div className="presenter-share__card"><h2>{t('Telefonla sunumu kontrol edin')}</h2><p>{t('Bu bağlantıyı sunumu kontrol edecek cihaza gönderin. Bağlantı yalnızca bu sunum sırasında çalışır.')}</p><label htmlFor="presenter-remote-url">{t('Uzaktan kumanda bağlantısı')}</label><input id="presenter-remote-url" className="presenter-share__url" readOnly value={remoteUrl} onFocus={(event) => event.currentTarget.select()} /><div><Button variant="accent" size="sm" onClick={() => { void copyRemoteUrl() }}>{t('Bağlantıyı kopyala')}</Button><Button variant="secondary" size="sm" onClick={() => setRemoteUrl(null)}>{t('Kapat')}</Button></div></div></div>}
    {goToPageOpen && <div className="presentation-mode__page-jump-overlay" onClick={() => onGoToPageOpenChange(false)}><form className="presentation-mode__page-jump" aria-label={t('Sayfaya git')} onClick={(event) => event.stopPropagation()} onSubmit={submitPageJump}><label htmlFor="presentation-page-number">{t('Sayfa numarası')}</label><div><input id="presentation-page-number" autoFocus type="number" min="1" max={visibleSlides.length} required value={pageNumber} onChange={(event) => setPageNumber(event.currentTarget.value)} /><Button type="submit" variant="accent" size="sm">{t('Git')}</Button><Button type="button" variant="secondary" size="sm" onClick={() => onGoToPageOpenChange(false)}>{t('İptal')}</Button></div><small>{t('Sayfaya git kısayolu')}</small></form></div>}
    <div className="presentation-mode__stage" onPointerDown={(event) => { pointerStartRef.current = { x: event.clientX, y: event.clientY } }} onPointerUp={(event) => { const start = pointerStartRef.current; pointerStartRef.current = null; if (!start) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy)) { suppressClickRef.current = true; window.setTimeout(() => { suppressClickRef.current = false }, 0); event.preventDefault(); navigateVisible(dx < 0 ? 1 : -1) } }} onClick={(event) => { void handleStageClick(event) }}>
      <div className="presentation-mode__surface" style={{ width: `min(94vw, calc((100vh - 118px) * ${slideWidth / slideHeight}), 1600px)`, aspectRatio: `${slideWidth} / ${slideHeight}` }}>
        <EngineFrame frame={engine.activeFrame} className="presentation-mode__slide" label={`${t('Slayt')} ${index + 1}`} style={{ width: '100%', height: '100%' }} />
        {engine.activeSlide?.shapes.filter((shape) => shape.media && shape.rect && !shape.hidden).map((shape) => <PresentationMedia key={shape.id} id={shape.id} rect={shape.rect!} slideSize={[slideWidth, slideHeight]} media={shape.media!} />)}
      </div>
    </div>
    <footer className="presentation-mode__controls"><Button variant="secondary" size="icon" aria-label={t('Önceki slayt')} disabled={!visibleSlides.slice(0, visiblePage).length} onClick={() => navigateVisible(-1)} icon={<Icon name="chevron-right" className="presentation-mode__previous" />} /><div><Button variant="secondary" size="sm" onClick={openPageJump}>{t('Sayfaya git')}</Button><span>{t('ile ilerleyin · Esc ile çıkın')}</span></div><Button variant="secondary" size="icon" aria-label={t('Sonraki slayt')} disabled={!visibleSlides.slice(visiblePage + 1).length} onClick={() => navigateVisible(1)} icon={<Icon name="chevron-right" />} /></footer>
  </section>
}

function PresentationMedia({ id, rect, slideSize, media }: { readonly id: string; readonly rect: [number, number, number, number]; readonly slideSize: [number, number]; readonly media: NonNullable<NonNullable<ReturnType<typeof editorEngine.getSnapshot>['activeSlide']>['shapes'][number]['media']> }) {
  const playerRef = useRef<HTMLMediaElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => editorEngine.subscribeMediaRequests(id, (request) => {
    const player = playerRef.current
    if (!player) return
    const seek = (ms: number | null | undefined) => { if (ms != null && Number.isFinite(ms)) player.currentTime = Math.max(0, ms / 1000) }
    if (request.action === 'play') { seek(request.ms ?? media.trimStart); void player.play().catch(() => undefined) }
    else if (request.action === 'pause') player.pause()
    else if (request.action === 'toggle') { if (player.paused) { seek(request.ms ?? media.trimStart); void player.play().catch(() => undefined) } else player.pause() }
    else if (request.action === 'stop') { player.pause(); player.currentTime = 0 }
    else if (request.action === 'seek') seek(request.ms)
  }), [id, media.trimStart])
  useEffect(() => {
    let current = true
    let objectUrl: string | null = null
    void editorEngine.getMediaBytes(id).then((bytes) => {
      if (!current) return
      objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: media.contentType }))
      setSource(objectUrl)
      setError(null)
    }).catch((reason: unknown) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [id, media.video])
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    player.volume = Math.max(0, Math.min(1, media.volume))
    player.loop = media.loop && media.trimEnd === 0 && media.trimStart === 0
    if (media.autoplay) void player.play().catch(() => undefined)
  }, [source, media.autoplay, media.loop, media.volume, media.trimStart, media.trimEnd])
  const handleTimeUpdate = () => {
    const player = playerRef.current
    if (!player) return
    const start = media.trimStart / 1000
    const end = media.trimEnd > 0 ? Math.min(player.duration || Infinity, media.trimEnd / 1000) : player.duration
    if (player.currentTime < start) { player.currentTime = start; return }
    if (Number.isFinite(end) && end > start && player.currentTime >= end) {
      player.pause()
      player.currentTime = media.rewind ? 0 : start
      if (media.loop) void player.play().catch(() => undefined)
      return
    }
    const elapsed = player.currentTime - start
    const remaining = Number.isFinite(end) ? end - player.currentTime : Infinity
    const inLevel = media.fadeIn > 0 ? Math.min(1, elapsed / (media.fadeIn / 1000)) : 1
    const outLevel = media.fadeOut > 0 && Number.isFinite(remaining) ? Math.min(1, remaining / (media.fadeOut / 1000)) : 1
    player.volume = Math.max(0, Math.min(1, media.volume * inLevel * outLevel))
  }
  return <div className={`presentation-media${playing ? ' presentation-media--playing' : ''}${media.hide && !playing ? ' presentation-media--hidden-idle' : ''}`} data-media-id={id} style={{ left: `${rect[0] / slideSize[0] * 100}%`, top: `${rect[1] / slideSize[1] * 100}%`, width: `${rect[2] / slideSize[0] * 100}%`, height: `${rect[3] / slideSize[1] * 100}%` }} onPointerDown={(event) => event.stopPropagation()} onPointerUp={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    {source && (media.video ? <video ref={(node) => { playerRef.current = node }} src={source} controls playsInline autoPlay={media.autoplay} onLoadedMetadata={handleTimeUpdate} onTimeUpdate={handleTimeUpdate} onPlay={() => { setPlaying(true); if (media.fullScreen) void playerRef.current?.requestFullscreen?.().catch(() => undefined) }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /> : <audio ref={(node) => { playerRef.current = node }} src={source} controls autoPlay={media.autoplay} onLoadedMetadata={handleTimeUpdate} onTimeUpdate={handleTimeUpdate} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />)}
    {error && <span role="alert">{error}</span>}
  </div>
}

function isSafePresentationUrl(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') ? !!url.hostname : url.protocol === 'mailto:' && !!url.pathname }
  catch { return false }
}

function isPowerPointFile(file: File): boolean {
  return file.name.toLocaleLowerCase('en').endsWith('.pptx') || file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function normalizeSharedComments(values: readonly unknown[], slides: readonly { readonly id: string }[]): DocumentComment[] {
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const item = value as Record<string, unknown>
    if (typeof item.id !== 'string' || typeof item.text !== 'string') return []
    const slideIndex = Number.isInteger(item.slideIndex) ? Number(item.slideIndex) : 0
    const slideId = typeof item.slideId === 'string' ? item.slideId : slides[Math.max(0, Math.min(slides.length - 1, slideIndex))]?.id
    if (!slideId) return []
    const created = typeof item.createdAt === 'number' ? new Date(item.createdAt) : null
    const time = typeof item.time === 'string' ? item.time : created ? new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(created) : ''
    const author = typeof item.author === 'string' ? item.author : 'Ortak çalışan'
    const replies = Array.isArray(item.replies) ? item.replies.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const reply = value as Record<string, unknown>
      if (typeof reply.id !== 'string' || typeof reply.text !== 'string') return []
      return [{ id: reply.id, text: reply.text, author: typeof reply.author === 'string' ? reply.author : author, initials: typeof reply.initials === 'string' ? reply.initials : author.slice(0, 1).toLocaleUpperCase('tr'), time: typeof reply.time === 'string' ? reply.time : time }]
    }) : undefined
    return [{ id: item.id, text: item.text, slideId, slideIndex, author, initials: typeof item.initials === 'string' ? item.initials : author.slice(0, 1).toLocaleUpperCase('tr'), time, ...(typeof item.shapeId === 'string' ? { shapeId: item.shapeId } : {}), ...(typeof item.shapeName === 'string' ? { shapeName: item.shapeName } : {}), ...(replies ? { replies } : {}), ...(typeof item.resolved === 'boolean' ? { resolved: item.resolved } : {}) }]
  })
}

function parseCollaborationInvite(hash: string): { documentId: string; token: string } | null {
  const match = /^#collab=([^.:]+)\.([A-Za-z0-9_-]+)$/.exec(hash)
  if (!match) return null
  try { return { documentId: decodeURIComponent(match[1]), token: match[2] } }
  catch { return null }
}

async function selectionToPng(
  frame: { readonly width: number; readonly height: number; readonly pixels: Uint8Array },
  shapes: readonly { readonly rect: [number, number, number, number] | null; readonly rotation?: number | null }[],
  scale: number,
  margin: number,
): Promise<Blob> {
  const bounds = shapes.flatMap((shape) => {
    if (!shape.rect) return []
    const [x, y, width, height] = shape.rect
    const radians = (shape.rotation ?? 0) * Math.PI / 180
    const boundWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
    const boundHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
    return [[x + width / 2 - boundWidth / 2, y + height / 2 - boundHeight / 2, x + width / 2 + boundWidth / 2, y + height / 2 + boundHeight / 2] as const]
  })
  const pad = 8
  const left = bounds.length ? Math.min(...bounds.map((rect) => rect[0])) - pad : -margin
  const top = bounds.length ? Math.min(...bounds.map((rect) => rect[1])) - pad : -margin
  const right = bounds.length ? Math.max(...bounds.map((rect) => rect[2])) + pad : frame.width / scale - margin
  const bottom = bounds.length ? Math.max(...bounds.map((rect) => rect[3])) + pad : frame.height / scale - margin
  const x0 = Math.max(0, Math.floor((left + margin) * scale))
  const y0 = Math.max(0, Math.floor((top + margin) * scale))
  const x1 = Math.min(frame.width, Math.ceil((right + margin) * scale))
  const y1 = Math.min(frame.height, Math.ceil((bottom + margin) * scale))
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let row = 0; row < height; row += 1) {
    const source = ((y0 + row) * frame.width + x0) * 4
    pixels.set(frame.pixels.subarray(source, source + width * 4), row * width * 4)
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not encode the selected objects as an image.')
  context.putImageData(new ImageData(pixels, width, height), 0, 0)
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the selected objects as an image.')), 'image/png'))
}
