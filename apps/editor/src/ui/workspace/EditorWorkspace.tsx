import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CompositionEvent, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, DragEvent as ReactDragEvent, ClipboardEvent as ReactClipboardEvent } from 'react'
import { Icon } from '../components/Icon'
import { Button } from '../components/Button'
import { SlideFilmstrip } from './SlideFilmstrip'
import { editorEngine } from '../../features/engine/editorEngine'
import type { EditorEngineState } from '../../features/engine/editorEngine'
import type { EngineCommand, KeyInput, MovePreviewFrames, PointerInput, SlideId, SmartGuide } from '@folio/engine-adapter'
import { finishPerf, perfNow, recordPerf } from '../../features/engine/perfDiagnostics'
import type { RenderFrame } from '@folio/engine-adapter'
import { EditorContextMenu, type ContextMenuTarget } from '../components/EditorContextMenu'
import { useLocale } from '../../features/localization/locale'
import { MoveableSelectionPoc } from './MoveableSelectionPoc'
import { findSmartGapGuides } from './smartGapGuides'
import { folioClipboardPayloadFromHtml, richTextHtmlForSelection, richTextPayloadFromClipboard, richTextShapeFromClipboard, type FolioClipboardPayload, type RichTextClipboardPayload } from './richTextClipboard'

type Props = {
  readonly zoom: number; readonly onZoomChange: (zoom: number) => void; readonly rulersVisible: boolean; readonly autosaveStatus: 'loading' | 'saving' | 'saved' | 'error'
  readonly gridVisible: boolean; readonly gridSnapEnabled: boolean; readonly onToggleGrid: () => void
  readonly placingText: boolean; readonly placingRectangle: boolean; readonly rectanglePreset: string; readonly placingLine: boolean; readonly linePreset: string; readonly placingChart: boolean; readonly drawingTool: boolean; readonly onPlaceText: (rect: [number, number, number, number]) => void; readonly onPlaceRectangle: (rect: [number, number, number, number], preset: string) => void; readonly onPlaceLine: (rect: [number, number, number, number], flipV: boolean, preset: string) => void; readonly onPlaceChart: (rect: [number, number, number, number]) => void; readonly onCancelTextPlacement: () => void
  readonly onToggleFilmstrip: () => void; readonly filmstripVisible: boolean
  readonly engine: EditorEngineState; readonly onSelectSlide: (slide: SlideId) => void; readonly onCopySelectionToSystemClipboard: (cut: boolean) => void; readonly onPasteFolioClipboard: (payload: FolioClipboardPayload) => void
  readonly onDuplicateSlide: (slide: SlideId) => void
  readonly onMoveSlide: (from: number, to: number) => void; readonly onRenameSlide: (index: number, name: string) => void; readonly onToggleSlideHidden: (index: number, hidden: boolean) => void; readonly onSetTransition: (index: number) => void; readonly onExecute: (command: EngineCommand) => void
  readonly onAddSection: (index: number, name: string) => void; readonly onRenameSection: (index: number, name: string) => void; readonly onRemoveSection: (index: number, withSlides: boolean) => void; readonly onMoveSection: (index: number, to: number) => void
  readonly onPresent: () => void
  readonly onPointer: (input: PointerInput, previewSequence?: number) => Promise<void>; readonly onKey: (input: KeyInput) => void
  readonly onTypeText: (text: string) => void
  readonly onComposeText: (text: string, active?: [number, number]) => void; readonly onCommitText: (text: string) => void
  readonly onDropMedia: (file: File, point: [number, number]) => void
  readonly onInsertShapesBatch: (shapes: unknown[]) => void
  readonly onPasteRichText: (payload: RichTextClipboardPayload) => void
}
type WorkspacePointerEvent = {
  readonly currentTarget: HTMLElement; readonly target: EventTarget | null; readonly pointerId: number; readonly clientX: number; readonly clientY: number
  readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly altKey: boolean; readonly metaKey: boolean; readonly buttons?: number; readonly button?: number; preventDefault?(): void; stopPropagation?(): void
}
type TextRulerState = { x: number; width: number; marginLeft: number; indent: number; rotated: boolean; tabs: Array<{ pos: number; align: 'l' | 'ctr' | 'r' | 'dec' }> }
type RulerTabDrag = { pointerId: number; marker: 'tab' | 'first' | 'hanging' | 'left' | null; from: number | null; startX: number; startY: number; currentX: number; currentY: number }

export function EditorWorkspace({ zoom, onZoomChange, rulersVisible, autosaveStatus, gridVisible, gridSnapEnabled, drawingTool, placingText, placingRectangle, rectanglePreset, placingLine, linePreset, placingChart, onPlaceChart, onPlaceText, onPlaceRectangle, onPlaceLine, onCancelTextPlacement, onToggleGrid, onToggleFilmstrip, filmstripVisible, engine, onSelectSlide, onCopySelectionToSystemClipboard, onPasteFolioClipboard, onDuplicateSlide, onMoveSlide, onRenameSlide, onToggleSlideHidden, onSetTransition, onAddSection, onRenameSection, onRemoveSection, onMoveSection, onExecute, onPresent, onPointer, onKey, onTypeText, onComposeText, onCommitText, onDropMedia, onInsertShapesBatch, onPasteRichText }: Props) {
  const { t } = useLocale()
  const shapePresets = useSyncExternalStore(editorEngine.subscribeShapePresetCatalog, editorEngine.getShapePresetCatalogSnapshot, editorEngine.getShapePresetCatalogSnapshot)
  useEffect(() => { void editorEngine.getShapePresets() }, [])
  const [fontFamilies, setFontFamilies] = useState<string[]>(['Arial', 'Arial Narrow', 'Georgia', 'Inter', 'Montserrat', 'Roboto', 'Times New Roman'])
  useEffect(() => { let active = true; void editorEngine.getFontFamilies().then((families) => { if (active && families.length) setFontFamilies(families) }).catch(() => undefined); return () => { active = false } }, [])
  const moveablePocEnabled = new URLSearchParams(location.search).get('moveablePoc') === '1'
  const [feedback, setFeedback] = useState<string | null>(null)
  const [smartGuides, setSmartGuides] = useState<readonly SmartGuide[]>(() => editorEngine.getToolGuides())
  const [smartGapGuides, setSmartGapGuides] = useState<ReturnType<typeof findSmartGapGuides>>([])
  const [textRuler, setTextRuler] = useState<TextRulerState | null>(null)
  const [rulerTabKind, setRulerTabKind] = useState<0 | 1 | 2 | 3>(0)
  const [rulerTabDrag, setRulerTabDrag] = useState<RulerTabDrag | null>(null)
  const [panMode, setPanMode] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const opacityGestureOpenRef = useRef(false)
  const [fileDropActive, setFileDropActive] = useState(false)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [overflowMargin, setOverflowMargin] = useState(120)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null)
  const [pictureCropMode, setPictureCropMode] = useState(false)
  const [pictureCropDraft, setPictureCropDraft] = useState<[number, number, number, number]>([0, 0, 0, 0])
  const pictureCropDragRef = useRef<{ edge: number; start: { x: number; y: number }; initial: [number, number, number, number]; rect: [number, number, number, number]; rotation: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const panPendingRef = useRef<{ x: number; y: number } | null>(null)
  const panFrameRef = useRef(0)
  const textFrameDragRef = useRef(false)
  const textPlacementStartRef = useRef<{ x: number; y: number } | null>(null)
  const [textPlacementPreview, setTextPlacementPreview] = useState<[number, number, number, number] | null>(null)
  const rectanglePlacementStartRef = useRef<{ x: number; y: number } | null>(null)
  const [rectanglePlacementPreview, setRectanglePlacementPreview] = useState<[number, number, number, number] | null>(null)
  const linePlacementStartRef = useRef<{ x: number; y: number } | null>(null)
  const [linePlacementPreview, setLinePlacementPreview] = useState<[number, number, number, number] | null>(null)
  const chartPlacementStartRef = useRef<{ x: number; y: number } | null>(null)
  const [chartPlacementPreview, setChartPlacementPreview] = useState<[number, number, number, number] | null>(null)
  const dragOriginRef = useRef<{ point: { x: number; y: number }; bounds: [number, number, number, number] | null; kind: 'move' | 'resize' | 'rotate' } | null>(null)
  const movePreviewDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const feedbackTimerRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const topRulerRef = useRef<HTMLDivElement>(null)
  const rulerTabDragRef = useRef<RulerTabDrag | null>(null)
  const autoFitRef = useRef(true)
  const fitZoomRef = useRef(zoom)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectionToolbarRef = useRef<HTMLDivElement>(null)
  const overflowCanvasRef = useRef<HTMLCanvasElement>(null)
  const movePreviewCanvasRef = useRef<HTMLCanvasElement>(null)
  const movePreviewOverflowCanvasRef = useRef<HTMLCanvasElement>(null)
  const movePreviewBackgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const movePreviewOverflowBackgroundCanvasRef = useRef<HTMLCanvasElement>(null)
  const preparedMovePreviewRef = useRef<MovePreviewFrames | null>(null)
  const previewGeometryRef = useRef<readonly { id: string; rect: [number, number, number, number] | null; rotation: number | null; flipH?: boolean | null; flipV?: boolean | null }[]>([])
  const previewInitialGeometryRef = useRef<readonly { id: string; rect: [number, number, number, number] | null; rotation: number | null; flipH?: boolean | null; flipV?: boolean | null }[]>([])
  const transformPreviewRef = useRef(false)
  const previewKindRef = useRef<'move' | 'resize' | 'rotate'>('move')
  const previewHandleRef = useRef('se')
  const textBoxResizeRef = useRef(false)
  const pointerDownClientRef = useRef({ x: 0, y: 0 })
  const clipboardPasteHandledRef = useRef(false)
  const clipboardPasteFallbackRef = useRef<number | null>(null)
  const lastTransformInputRef = useRef<PointerInput | null>(null)
  const moveControlRemapRef = useRef<{ start: { x: number; y: number }; anchor: { x: number; y: number } } | null>(null)
  const rotationPointerRemapRef = useRef<{ pivotX: number; pivotY: number; angleOffset: number } | null>(null)
  const transformInputSequenceRef = useRef(0)
  const globalTransformCleanupRef = useRef<(() => void) | null>(null)
  const handledTransformEventsRef = useRef(new WeakSet<Event>())
  const hoverHitTestSequenceRef = useRef(0)
  const transformMouseFallbackRef = useRef(false)
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const dimensionTooltipRef = useRef<HTMLDivElement>(null)
  const rotationTooltipRef = useRef<HTMLDivElement>(null)
  const composingText = useRef(false)
  const textCaretPointerRef = useRef<number | null>(null)
  const activeSlideIndex = engine.summary?.activeSlideIndex ?? 0
  const activeSlideNumber = activeSlideIndex + 1
  const slideWidth = engine.summary?.slideSize[0] ?? 960
  const slideHeight = engine.summary?.slideSize[1] ?? 540
  const autosaveLabels = { loading: 'Otomatik kaydetme hazırlanıyor', saving: 'Cihaza kaydediliyor', saved: 'Cihaza kaydedildi', error: 'Cihaza kaydedilemedi' } as const
  const viewTransformRef = useRef({ zoom, panOffset })
  viewTransformRef.current = { zoom, panOffset }
  useEffect(() => { setNotesDraft(engine.activeSlide?.notes ?? '') }, [engine.activeSlide?.id, engine.activeSlide?.notes])
  useEffect(() => {
    if (!placingText && !placingRectangle && !placingLine && !placingChart) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCancelTextPlacement()
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [placingText, placingRectangle, placingLine, placingChart, onCancelTextPlacement])
  useEffect(() => {
    if (!panMode) return
    const plane = stageRef.current?.querySelector<HTMLElement>('.slide-plane')
    if (plane) plane.style.cursor = ''
  }, [panMode])
  const textSelection = asTextSelection(engine.selection?.textSelection)
  useEffect(() => {
    if (!textSelection) { setTextRuler(null); return }
    let active = true
    void editorEngine.execute({ type: 'custom', name: 'format.ruler', params: {} }).then((update) => {
      if (!active || !update.result || typeof update.result !== 'object') return
      const result = update.result as Partial<TextRulerState>
      if (typeof result.x === 'number' && typeof result.width === 'number' && Array.isArray(result.tabs)) setTextRuler(result as TextRulerState)
    }).catch(() => { if (active) setTextRuler(null) })
    return () => { active = false }
  }, [textSelection?.shape, textSelection?.anchor[0], textSelection?.anchor[1], textSelection?.caret[0], textSelection?.caret[1], engine.summary?.revision])
  const editingShape = textSelection ? engine.activeSlide?.shapes.find((shape) => shape.id === textSelection.shape) ?? null : null
  const projectedTextCaret = engine.selection?.caretLine ?? null
  const showProjectedTextCaret = !!editingShape && !!textSelection && !!projectedTextCaret && !engine.selection?.isComposing
    && textSelection.anchor[0] === textSelection.caret[0] && textSelection.anchor[1] === textSelection.caret[1]
  const selectedShapes = engine.activeSlide?.shapes.filter((shape) => engine.selection?.shapeIds.includes(shape.id) && shape.rect) ?? []
  const selectedOpacityValues = selectedShapes.map((shape) => shape.elementOpacity ?? 1)
  const selectedOpacity = selectedOpacityValues.length && selectedOpacityValues.every((value) => Math.abs(value - selectedOpacityValues[0]!) < 0.001)
    ? Math.round((selectedOpacityValues[0] ?? 1) * 100) : 100
  const selectedTextShapes = selectedShapes.filter((shape) => shape.textBox || !!shape.text)
  const textOnlySelection = selectedShapes.length > 0 && selectedTextShapes.length === selectedShapes.length
  const selectedFontFamilies = selectedTextShapes.map((shape) => shape.fontFamilies?.at(-1) ?? '')
  const fontOptions = [...new Set([...fontFamilies, 'Arial', 'Arial Narrow', 'Georgia', 'Inter', 'Montserrat', 'Roboto', 'Times New Roman', ...selectedFontFamilies.filter(Boolean)])].sort((left, right) => left.localeCompare(right))
  const selectedFontSizes = selectedTextShapes.map((shape) => shape.fontSizes?.at(-1)?.toString() ?? '')
  const selectedParagraphAlignments = selectedTextShapes.map((shape) => {
    const alignment = shape.paragraphAlignments?.at(-1)?.toLowerCase() ?? ''
    if (alignment.includes('center') || alignment === 'ctr') return 'center'
    if (alignment.includes('right') || alignment === 'r') return 'right'
    if (alignment.includes('just')) return 'justify'
    if (alignment.includes('left') || alignment === 'l') return 'left'
    return ''
  })
  const selectedCharacterSpacings = selectedTextShapes.map((shape) => shape.characterSpacings?.at(-1) ?? 0)
  const commonCharacterSpacing = selectedCharacterSpacings.length && selectedCharacterSpacings.every((spacing) => Math.abs(spacing - selectedCharacterSpacings[0]!) < 0.001)
    ? String(selectedCharacterSpacings[0] ?? 0) : ''
  const selectedLineSpacingKeys = selectedTextShapes.map((shape) => {
    const spacing = shape.paragraphLineSpacings?.at(-1)
    return spacing ? `${spacing.kind}:${spacing.value}` : 'pct:1'
  })
  const commonLineSpacingKey = selectedLineSpacingKeys.length && selectedLineSpacingKeys.every((spacing) => spacing === selectedLineSpacingKeys[0])
    ? selectedLineSpacingKeys[0] ?? 'pct:1' : ''
  const lineSpacingPresets = [1, 1.15, 1.5, 2, 2.5, 3].map((lines) => `pct:${lines}`)
  const commonFontFamily = selectedFontFamilies.every((family) => family === selectedFontFamilies[0]) ? selectedFontFamilies[0] ?? '' : ''
  const commonFontSize = selectedFontSizes.every((size) => size === selectedFontSizes[0]) ? selectedFontSizes[0] ?? '' : ''
  const commonParagraphAlignment = selectedParagraphAlignments.every((alignment) => alignment === selectedParagraphAlignments[0]) ? selectedParagraphAlignments[0] ?? '' : ''
  const selectedPicture = selectedShapes.length === 1 && selectedShapes[0]?.pictureCrop ? selectedShapes[0] : null
  const selectionBounds = boundsOf(selectedShapes.flatMap((shape) => shape.rect ? [shape.rect] : []))
  const toolbarBelowSelection = !!selectionBounds && selectionBounds[1] + selectionBounds[3] + 58 < slideHeight
  useEffect(() => {
    setPictureCropMode(false)
    setPictureCropDraft(selectedPicture?.pictureCrop ?? [0, 0, 0, 0])
  }, [selectedPicture?.id, selectedPicture?.pictureCrop?.join(',')])
  const currentPreviewMatrix = () => {
    const currentBounds = boundsOf(previewGeometryRef.current.flatMap((shape) => shape.rect ? [shape.rect] : []))
    const initialBounds = boundsOf(previewInitialGeometryRef.current.flatMap((shape) => shape.rect ? [shape.rect] : []))
    if (!currentBounds || !initialBounds) return 'translate3d(0px, 0px, 0)'
    if (previewKindRef.current === 'rotate') {
      const before = previewInitialGeometryRef.current[0]
      const after = previewGeometryRef.current[0]
      const oldRotation = before?.rotation ?? 0
      const newRotation = after?.rotation ?? oldRotation
      const oldPivot = [initialBounds[0] + initialBounds[2] / 2, initialBounds[1] + initialBounds[3] / 2]
      const newPivot = [currentBounds[0] + currentBounds[2] / 2, currentBounds[1] + currentBounds[3] / 2]
      return `translate(${newPivot[0]}px, ${newPivot[1]}px) rotate(${newRotation - oldRotation}deg) translate(${-oldPivot[0]}px, ${-oldPivot[1]}px)`
    }
    if (previewInitialGeometryRef.current.length === 1) {
      const before = previewInitialGeometryRef.current[0]!
      const after = previewGeometryRef.current[0]
      if (before.rect && after?.rect) {
        const oldCenter = [before.rect[0] + before.rect[2] / 2, before.rect[1] + before.rect[3] / 2]
        const newCenter = [after.rect[0] + after.rect[2] / 2, after.rect[1] + after.rect[3] / 2]
        const sx = after.rect[2] / Math.max(.001, before.rect[2])
        const sy = after.rect[3] / Math.max(.001, before.rect[3])
        const beforeRotation = before.rotation ?? 0
        const afterRotation = after.rotation ?? beforeRotation
        const flipX = before.flipH !== after.flipH ? -1 : 1
        const flipY = before.flipV !== after.flipV ? -1 : 1
        return `translate(${newCenter[0]}px, ${newCenter[1]}px) rotate(${afterRotation}deg) scale(${sx * flipX}, ${sy * flipY}) rotate(${-beforeRotation}deg) translate(${-oldCenter[0]}px, ${-oldCenter[1]}px)`
      }
    }
    const scaleX = currentBounds[2] / Math.max(0.001, initialBounds[2])
    const scaleY = currentBounds[3] / Math.max(0.001, initialBounds[3])
    const anchorX = previewHandleRef.current.includes('w') ? initialBounds[0] + initialBounds[2] : initialBounds[0]
    const anchorY = previewHandleRef.current.includes('n') ? initialBounds[1] + initialBounds[3] : initialBounds[1]
    return `translate(${anchorX}px, ${anchorY}px) scale(${scaleX}, ${scaleY}) translate(${-anchorX}px, ${-anchorY}px)`
  }
  const pointerPreviewMatrix = (input: PointerInput, origin: NonNullable<typeof dragOriginRef.current>) => {
    const initial = previewInitialGeometryRef.current
    const rect = initial[0]?.rect
    if (!rect || input.kind !== 'drag') return currentPreviewMatrix()
    const dx = input.x - origin.point.x
    const dy = input.y - origin.point.y
    if (origin.kind === 'rotate') {
      const groupBounds = origin.bounds ?? boundsOf(initial.flatMap((shape) => shape.rect ? [shape.rect] : []))
      const pivotX = groupBounds ? groupBounds[0] + groupBounds[2] / 2 : rect[0] + rect[2] / 2
      const pivotY = groupBounds ? groupBounds[1] + groupBounds[3] / 2 : rect[1] + rect[3] / 2
      const start = Math.atan2(origin.point.y - pivotY, origin.point.x - pivotX)
      const end = Math.atan2(input.y - pivotY, input.x - pivotX)
      let delta = (end - start) * 180 / Math.PI
      if (input.modifiers?.shift) {
        const originalRotation = initial[0]?.rotation ?? 0
        delta = Math.round((originalRotation + delta) / 15) * 15 - originalRotation
      }
      return `translate(${pivotX}px, ${pivotY}px) rotate(${delta}deg) translate(${-pivotX}px, ${-pivotY}px)`
    }
    const handle = previewHandleRef.current
    const rotation = (initial[0]?.rotation ?? 0) * Math.PI / 180
    const localDx = dx * Math.cos(rotation) + dy * Math.sin(rotation)
    const localDy = -dx * Math.sin(rotation) + dy * Math.cos(rotation)
    let scaleX = 1, scaleY = 1
    const centerFactor = input.modifiers?.alt ? 2 : 1
    if (handle.includes('w') || handle.includes('e')) { const raw = (rect[2] + (handle.includes('w') ? -localDx : localDx) * centerFactor) / rect[2]; scaleX = Math.sign(raw || 1) * Math.max(100 / rect[2], Math.abs(raw)) }
    if (handle.includes('n') || handle.includes('s')) { const raw = (rect[3] + (handle.includes('n') ? -localDy : localDy) * centerFactor) / rect[3]; scaleY = Math.sign(raw || 1) * Math.max(100 / rect[3], Math.abs(raw)) }
    if (input.modifiers?.shift && handle.length === 2) scaleX = scaleY = Math.max(.02, Math.max(scaleX, scaleY))
    const centerX = rect[0] + rect[2] / 2
    const centerY = rect[1] + rect[3] / 2
    const newCenterX = input.modifiers?.alt ? centerX : centerX + ((handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0) * localDx / 2) * Math.cos(rotation) - ((handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0) * localDy / 2) * Math.sin(rotation)
    const newCenterY = input.modifiers?.alt ? centerY : centerY + ((handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0) * localDx / 2) * Math.sin(rotation) + ((handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0) * localDy / 2) * Math.cos(rotation)
    return `translate(${newCenterX}px, ${newCenterY}px) rotate(${initial[0]?.rotation ?? 0}deg) scale(${scaleX}, ${scaleY}) rotate(${-((initial[0]?.rotation ?? 0))}deg) translate(${-centerX}px, ${-centerY}px)`
  }
  const applyTransformPreviewMatrix = (matrix: string) => {
    if (movePreviewCanvasRef.current) { movePreviewCanvasRef.current.style.transformOrigin = '0 0'; movePreviewCanvasRef.current.style.transform = matrix }
    if (movePreviewOverflowCanvasRef.current) {
      const { zoom: currentZoom, panOffset: currentPan } = viewTransformRef.current
      movePreviewOverflowCanvasRef.current.style.transformOrigin = '0 0'
      movePreviewOverflowCanvasRef.current.style.transform = `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100}) ${matrix}`
    }
    const frames = stageRef.current?.querySelector<HTMLElement>('.engine-transform-preview-frames')
    if (frames) {
      frames.style.transformOrigin = '0 0'
      frames.style.transform = matrix
      const transform = new DOMMatrix(matrix)
      const determinant = transform.a * transform.d - transform.b * transform.c
      if (Math.abs(determinant) > 1e-8) {
        const inverse = new DOMMatrix([transform.d / determinant, -transform.b / determinant, -transform.c / determinant, transform.a / determinant, 0, 0])
        for (const visual of frames.querySelectorAll<HTMLElement>('[data-engine-selection-visual]')) {
          const shape = previewGeometryRef.current.find((item) => item.id === visual.dataset.engineSelectionVisual)
          const original = previewInitialGeometryRef.current.find((item) => item.id === visual.dataset.engineSelectionVisual)
          const beforeRotation = original?.rotation ?? 0
          const afterRotation = shape?.rotation ?? beforeRotation
          const counterTransform = new DOMMatrix().rotate(-beforeRotation).multiply(inverse).rotate(afterRotation)
          const controlTransform = `matrix(${counterTransform.a}, ${counterTransform.b}, ${counterTransform.c}, ${counterTransform.d}, 0, 0) scale(var(--handle-scale, 1))`
          for (const control of visual.querySelectorAll<HTMLElement>('.engine-selection__handle, .engine-selection__rotate, .engine-selection__rotate-hit')) {
            control.style.transformOrigin = 'center center'
            control.style.transform = controlTransform
          }
        }
      }
    }
    updateTransformFeedback(matrix)
  }
  const updateTransformFeedback = (matrixText: string) => {
    const origin = dragOriginRef.current
    const input = lastTransformInputRef.current
    if (!origin || !input || (origin.kind !== 'resize' && origin.kind !== 'rotate')) return
    const matrix = new DOMMatrix(matrixText)
    const left = input.x + 14
    const top = input.y + 14
    const inverseZoom = 100 / viewTransformRef.current.zoom
    if (origin.kind === 'resize') {
      const bounds = boundsOf(previewInitialGeometryRef.current.flatMap((shape) => shape.rect ? [shape.rect] : []))
      if (!bounds) return
      let width: number
      let height: number
      if (previewInitialGeometryRef.current.length === 1) {
        const original = previewInitialGeometryRef.current[0]!
        const rotation = original.rotation ?? 0
        const local = new DOMMatrix().rotate(-rotation).multiply(matrix).multiply(new DOMMatrix().rotate(rotation))
        width = (original.rect?.[2] ?? bounds[2]) * Math.hypot(local.a, local.b)
        height = (original.rect?.[3] ?? bounds[3]) * Math.hypot(local.c, local.d)
      } else {
        const corners = [
          new DOMPoint(bounds[0], bounds[1]), new DOMPoint(bounds[0] + bounds[2], bounds[1]),
          new DOMPoint(bounds[0], bounds[1] + bounds[3]), new DOMPoint(bounds[0] + bounds[2], bounds[1] + bounds[3]),
        ].map((point) => point.matrixTransform(matrix))
        width = Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x))
        height = Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y))
      }
      const label = dimensionTooltipRef.current
      if (label) {
        label.textContent = `${Math.round(width)} × ${Math.round(height)}`
        label.style.left = `${left}px`; label.style.top = `${top}px`
        label.style.transform = `scale(${inverseZoom})`; label.style.visibility = 'visible'
      }
      if (rotationTooltipRef.current) rotationTooltipRef.current.style.visibility = 'hidden'
      return
    }
    const startAngle = previewInitialGeometryRef.current[0]?.rotation ?? 0
    const angle = ((startAngle + Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) % 360 + 360) % 360
    const label = rotationTooltipRef.current
    if (label) {
      label.textContent = `${Math.round(angle % 360)}°`
      label.style.left = `${left}px`; label.style.top = `${top}px`
      label.style.transform = `scale(${inverseZoom})`; label.style.visibility = 'visible'
    }
    if (dimensionTooltipRef.current) dimensionTooltipRef.current.style.visibility = 'hidden'
  }
  const hideTransformFeedback = () => {
    if (dimensionTooltipRef.current) dimensionTooltipRef.current.style.visibility = 'hidden'
    if (rotationTooltipRef.current) rotationTooltipRef.current.style.visibility = 'hidden'
  }
  const showFeedback = useCallback((message: string) => {
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current)
    setFeedback(message)
    feedbackTimerRef.current = window.setTimeout(() => { setFeedback(null); feedbackTimerRef.current = null }, 2800)
  }, [])
  useEffect(() => () => { if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current); if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current) }, [])

  useLayoutEffect(() => {
    const updateOverflowMargin = () => {
      const stage = stageRef.current?.getBoundingClientRect()
      const slide = canvasRef.current?.getBoundingClientRect()
      if (!stage || !slide || zoom <= 0) return false
      const next = Math.max(120, Math.ceil(Math.max(slide.left - stage.left, stage.right - slide.right, slide.top - stage.top, stage.bottom - slide.bottom) / (zoom / 100) + 8))
      const bounded = Math.min(544, next)
      const changed = bounded !== overflowMargin
      editorEngine.setOverflowMargin(bounded)
      setOverflowMargin((current) => current === bounded ? current : bounded)
      return changed
    }
    updateOverflowMargin()
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => {
      if (updateOverflowMargin()) requestAnimationFrame(() => void editorEngine.refreshViewport().catch(() => undefined))
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [zoom, panOffset, engine.activeSlide?.id, overflowMargin])

  useLayoutEffect(() => {
    const adjustSelectionToolbar = () => {
      const toolbar = selectionToolbarRef.current
      const stage = stageRef.current?.getBoundingClientRect()
      const plane = canvasRef.current?.parentElement?.getBoundingClientRect()
      const canvas = canvasRef.current?.getBoundingClientRect()
      if (!toolbar || !stage || !plane || !canvas || zoom <= 0 || !selectionBounds) return
      toolbar.style.maxWidth = `${Math.max(180, stage.width - 24)}px`
      const toolbarRect = toolbar.getBoundingClientRect()
      const scale = canvas.width / slideWidth
      const width = toolbarRect.width
      const height = toolbarRect.height
      const selectedCenter = canvas.left + (selectionBounds[0] + selectionBounds[2] / 2) * scale
      const center = Math.max(stage.left + width / 2 + 8, Math.min(stage.right - width / 2 - 8, selectedCenter))
      const toolbarLeft = center - width / 2
      const selectedTop = canvas.top + selectionBounds[1] * scale
      const selectedBottom = canvas.top + (selectionBounds[1] + selectionBounds[3]) * scale
      const gap = 8
      const belowTop = selectedBottom + gap
      const aboveTop = selectedTop - height - gap
      const selectedIds = new Set(engine.selection?.shapeIds ?? [])
      const otherShapeRects = (engine.activeSlide?.shapes ?? [])
        .filter((shape) => !selectedIds.has(shape.id) && shape.rect)
        .map((shape) => {
          const [x, y, shapeWidth, shapeHeight] = shape.rect!
          const angle = (shape.rotation ?? 0) * Math.PI / 180
          const rotatedWidth = Math.abs(shapeWidth * Math.cos(angle)) + Math.abs(shapeHeight * Math.sin(angle))
          const rotatedHeight = Math.abs(shapeWidth * Math.sin(angle)) + Math.abs(shapeHeight * Math.cos(angle))
          const shapeCenterX = canvas.left + (x + shapeWidth / 2) * scale
          const shapeCenterY = canvas.top + (y + shapeHeight / 2) * scale
          return { left: shapeCenterX - rotatedWidth * scale / 2, right: shapeCenterX + rotatedWidth * scale / 2, top: shapeCenterY - rotatedHeight * scale / 2, bottom: shapeCenterY + rotatedHeight * scale / 2 }
        })
      const collisionCount = (top: number) => otherShapeRects.filter((rect) => toolbarLeft < rect.right && toolbarLeft + width > rect.left && top < rect.bottom && top + height > rect.top).length
      const belowFits = belowTop + height <= stage.bottom - 8
      const aboveFits = aboveTop >= stage.top + 8
      const belowCollisions = belowFits ? collisionCount(belowTop) : Number.POSITIVE_INFINITY
      const aboveCollisions = aboveFits ? collisionCount(aboveTop) : Number.POSITIVE_INFINITY
      const placeBelow = belowCollisions === 0 || belowCollisions <= aboveCollisions
      const top = placeBelow ? belowTop : aboveTop
      toolbar.style.left = `${(center - plane.left) / scale}px`
      toolbar.style.top = `${(top - plane.top) / scale}px`
      toolbar.style.transform = `translate(-50%, ${placeBelow ? '0' : '-100%'}) scale(${1 / scale})`
    }
    adjustSelectionToolbar()
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(adjustSelectionToolbar)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [zoom, slideWidth, selectionBounds?.[0], selectionBounds?.[1], selectionBounds?.[2], selectionBounds?.[3], toolbarBelowSelection, selectedShapes.map((shape) => shape.id).join(','), engine.activeSlide?.shapes, engine.selection?.shapeIds.join(',')])

  useEffect(() => {
    const drawFrames = () => {
      const frames = editorEngine.getLiveFrames()
      const preview = editorEngine.getMovePreviewFrame()
      const previewSnapshot = editorEngine.getMovePreviewSnapshot()
      const prepared = editorEngine.getCachedMovePreviewFrames()
      if (prepared && preparedMovePreviewRef.current !== prepared) {
        paintFrame(movePreviewBackgroundCanvasRef.current, prepared.activeBackground, 'canvas.movePreviewBackground')
        paintFrame(movePreviewOverflowBackgroundCanvasRef.current, prepared.overflowBackground, 'canvas.movePreviewOverflowBackground')
        paintFrame(movePreviewCanvasRef.current, prepared.selectedActiveShapes, 'canvas.movePreview')
        paintFrame(movePreviewOverflowCanvasRef.current, prepared.selectedShapes, 'canvas.movePreviewOverflow')
        preparedMovePreviewRef.current = prepared
      } else if (!prepared) preparedMovePreviewRef.current = null
      if (preview) {
        if (previewSnapshot) previewGeometryRef.current = previewSnapshot.shapes
        if (canvasRef.current) canvasRef.current.style.visibility = 'hidden'
        if (overflowCanvasRef.current) overflowCanvasRef.current.style.visibility = 'hidden'
        if (movePreviewBackgroundCanvasRef.current) movePreviewBackgroundCanvasRef.current.style.visibility = 'visible'
        if (movePreviewOverflowBackgroundCanvasRef.current) movePreviewOverflowBackgroundCanvasRef.current.style.visibility = 'visible'
        const { x, y } = movePreviewDeltaRef.current
        if (transformPreviewRef.current && previewKindRef.current !== 'move') applyTransformPreviewMatrix(lastTransformInputRef.current && dragOriginRef.current ? pointerPreviewMatrix(lastTransformInputRef.current, dragOriginRef.current) : currentPreviewMatrix())
        else if (movePreviewCanvasRef.current) { movePreviewCanvasRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`; movePreviewCanvasRef.current.style.transformOrigin = '0 0' }
        const { zoom: currentZoom, panOffset: currentPan } = viewTransformRef.current
        if (movePreviewOverflowCanvasRef.current) movePreviewOverflowCanvasRef.current.style.transform = transformPreviewRef.current && previewKindRef.current !== 'move' && lastTransformInputRef.current && dragOriginRef.current
          ? `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100}) ${pointerPreviewMatrix(lastTransformInputRef.current, dragOriginRef.current)}`
          : `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100}) translate3d(${x}px, ${y}px, 0)`
        if (movePreviewOverflowCanvasRef.current) movePreviewOverflowCanvasRef.current.style.transformOrigin = '0 0'
        if (movePreviewCanvasRef.current) movePreviewCanvasRef.current.style.visibility = 'visible'
        if (movePreviewOverflowCanvasRef.current) movePreviewOverflowCanvasRef.current.style.visibility = 'visible'
      } else {
        paintFrame(canvasRef.current, frames.active, 'canvas.active')
        if (canvasRef.current) canvasRef.current.style.visibility = 'visible'
        if (frames.overflow) {
          paintFrame(overflowCanvasRef.current, frames.overflow, 'canvas.overflow')
          if (overflowCanvasRef.current) overflowCanvasRef.current.style.visibility = 'visible'
        } else if (overflowCanvasRef.current) {
          overflowCanvasRef.current.style.visibility = 'hidden'
        }
        for (const layer of [movePreviewBackgroundCanvasRef.current, movePreviewOverflowBackgroundCanvasRef.current, movePreviewCanvasRef.current, movePreviewOverflowCanvasRef.current]) {
          if (!layer) continue
          layer.style.visibility = 'hidden'
        }
        clearTransformSelectionPreview()
      }
    }
    const unsubscribe = editorEngine.subscribeFrames(drawFrames)
    const unsubscribeGuides = editorEngine.subscribeToolGuides(setSmartGuides)
    const unsubscribeMovePreview = editorEngine.subscribeMovePreview((preview) => {
      if (!preview) { movePreviewDeltaRef.current = { x: 0, y: 0 }; setSmartGapGuides([]) }
      if (preview && dragOriginRef.current?.kind === 'move') {
        const initial = previewInitialGeometryRef.current.find((shape) => shape.rect)
        const current = preview.shapes.find((shape) => shape.rect)
        if (initial?.rect && current?.rect) {
          const delta = { x: current.rect[0] - initial.rect[0], y: current.rect[1] - initial.rect[1] }
          movePreviewDeltaRef.current = delta
          if (movePreviewCanvasRef.current?.style.visibility === 'visible') movePreviewCanvasRef.current.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`
          if (movePreviewOverflowCanvasRef.current?.style.visibility === 'visible') {
            const { zoom: currentZoom, panOffset: currentPan } = viewTransformRef.current
            movePreviewOverflowCanvasRef.current.style.transform = `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100}) translate3d(${delta.x}px, ${delta.y}px, 0)`
          }
        }
        const moved = preview.shapes.some((shape) => {
          const before = previewInitialGeometryRef.current.find((item) => item.id === shape.id)?.rect
          return !!before && !!shape.rect && (Math.abs(before[0] - shape.rect[0]) > 0.5 || Math.abs(before[1] - shape.rect[1]) > 0.5)
        })
        if (moved) {
          const snapshot = editorEngine.getSnapshot()
          const guides = findSmartGapGuides(preview.shapes, snapshot.activeSlide?.shapes ?? [])
          setSmartGapGuides((previous) => previous.length === guides.length && previous.every((guide, index) => {
            const next = guides[index]
            return !!next && guide.id === next.id && guide.label === next.label
              && ('x1' in guide ? 'x1' in next && Math.abs(guide.x1 - next.x1) < 0.5 && Math.abs(guide.x2 - next.x2) < 0.5 && Math.abs(guide.y - next.y) < 0.5 : 'y1' in next && Math.abs(guide.y1 - next.y1) < 0.5 && Math.abs(guide.y2 - next.y2) < 0.5 && Math.abs(guide.x - next.x) < 0.5)
          }) ? previous : guides)
        } else setSmartGapGuides([])
      }
        if (preview && transformPreviewRef.current && dragOriginRef.current?.kind !== 'move') {
        previewGeometryRef.current = preview.shapes
          if (preview.inputSequence === transformInputSequenceRef.current) {
            if (preview.renderedCurrentGeometry) {
              paintFrame(movePreviewCanvasRef.current, preview.frame, 'canvas.movePreview')
              paintFrame(movePreviewOverflowCanvasRef.current, preview.overflowFrame, 'canvas.movePreviewOverflow')
              if (movePreviewCanvasRef.current) movePreviewCanvasRef.current.style.transform = 'none'
              if (movePreviewOverflowCanvasRef.current) {
                const { zoom: currentZoom, panOffset: currentPan } = viewTransformRef.current
                movePreviewOverflowCanvasRef.current.style.transformOrigin = '0 0'
                movePreviewOverflowCanvasRef.current.style.transform = `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100})`
              }
            } else applyTransformPreviewMatrix(currentPreviewMatrix())
          }
      }
    })
    drawFrames()
    return () => { unsubscribe(); unsubscribeGuides(); unsubscribeMovePreview() }
  }, [slideWidth, slideHeight])

  useEffect(() => {
    const input = textInputRef.current
    if (!input || !editingShape || !textSelection) return
    if (composingText.current) return
    input.value = editingShape.text ?? ''
    input.focus()
    const anchor = caretOffset(editingShape.text ?? '', textSelection.anchor)
    const caret = caretOffset(editingShape.text ?? '', textSelection.caret)
    input.setSelectionRange(anchor, caret, anchor > caret ? 'backward' : 'forward')
  }, [editingShape?.id, editingShape?.text, textSelection?.anchor?.[0], textSelection?.anchor?.[1], textSelection?.caret?.[0], textSelection?.caret?.[1]])

  useEffect(() => {
    const input = textInputRef.current
    if (!input) return
    const handleBeforeInput = (event: InputEvent) => {
      if (composingText.current) return
      if (event.inputType === 'insertText' && event.data) {
        event.preventDefault()
        onTypeText(event.data)
      } else if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
        event.preventDefault()
        onTypeText(event.inputType === 'insertLineBreak' ? '\v' : '\n')
      } else if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
        event.preventDefault()
        onKey({ key: event.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete' })
      }
    }
    input.addEventListener('beforeinput', handleBeforeInput)
    return () => input.removeEventListener('beforeinput', handleBeforeInput)
  }, [editingShape?.id, onKey, onTypeText])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const modifier = event.metaKey || event.ctrlKey
      const slideFocused = target instanceof HTMLElement && !!target.closest('.slide-card')
      const key = event.key.toLocaleLowerCase()
      if (modifier) {
        const command = key === 'x' ? 'edit.cut' : key === 'c' ? 'edit.copy' : key === 'v' ? 'edit.paste' : key === 'a' ? 'edit.selectAll' : null
        if (key === 'd') {
          event.preventDefault()
          if (slideFocused) onExecute({ type: 'slide.duplicate', params: {} })
          else if (engine.selection?.shapeIds.length) onExecute({ type: 'custom', name: 'edit.duplicate', params: {} })
          return
        }
        if (command) {
          if (key === 'v') {
            clipboardPasteHandledRef.current = false
            if (clipboardPasteFallbackRef.current !== null) window.clearTimeout(clipboardPasteFallbackRef.current)
            clipboardPasteFallbackRef.current = window.setTimeout(() => {
              if (!clipboardPasteHandledRef.current) onExecute({ type: 'custom', name: 'edit.paste', params: {} })
              clipboardPasteFallbackRef.current = null
            }, 80)
            return
          }
          event.preventDefault()
          if ((key === 'c' || key === 'x') && engine.selection?.shapeIds.length) {
            onCopySelectionToSystemClipboard(key === 'x')
            return
          }
          onExecute({ type: command })
          return
        }
      }
      if (!modifier && event.key === 'Enter' && engine.selection?.shapeIds.length === 1) {
        const selected = engine.activeSlide?.shapes.find((shape) => shape.id === engine.selection?.shapeIds[0])
        if (selected?.text !== null && selected?.text !== undefined) {
          event.preventDefault()
          onExecute({ type: 'text.edit', params: { id: Number(selected.id) } })
          return
        }
      }
      if (!modifier && engine.selection?.shapeIds.length) {
        const direction = event.key === 'ArrowLeft' ? [-1, 0] : event.key === 'ArrowRight' ? [1, 0] : event.key === 'ArrowUp' ? [0, -1] : event.key === 'ArrowDown' ? [0, 1] : null
        if (direction) {
          event.preventDefault()
          const step = event.shiftKey ? 10 : 1
          onExecute({ type: 'custom', name: 'shape.move', params: { dx: direction[0] * step, dy: direction[1] * step } })
          return
        }
      }
      const historyKey = modifier && ['z', 'y'].includes(key)
      const deleteKey = !modifier && ['Backspace', 'Delete'].includes(event.key) && !!engine.selection?.shapeIds.length
      const deleteSlide = !modifier && ['Backspace', 'Delete'].includes(event.key) && slideFocused && !engine.selection?.shapeIds.length
      if (deleteSlide) {
        event.preventDefault()
        const activeId = engine.slides[engine.summary?.activeSlideIndex ?? 0]?.id
        if (activeId && engine.slides.length > 1) onExecute({ type: 'slide.delete', params: { index: engine.summary?.activeSlideIndex ?? 0 } })
        return
      }
      if (!historyKey && !deleteKey) return
      event.preventDefault()
      onKey({ key: event.key, modifiers: { ctrl: event.ctrlKey, meta: event.metaKey, cmd: event.metaKey, shift: event.shiftKey } })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (clipboardPasteFallbackRef.current !== null) window.clearTimeout(clipboardPasteFallbackRef.current)
      clipboardPasteFallbackRef.current = null
    }
  }, [engine.selection, engine.slides, engine.activeSlide?.shapes, engine.summary?.activeSlideIndex, onCopySelectionToSystemClipboard, onExecute, onKey])

  const sendPointer = (input: PointerInput): Promise<void> => {
    recordPerf(`pointer.event.${input.kind}`)
    const moveControlRemap = moveControlRemapRef.current
    if (moveControlRemap && (input.kind === 'drag' || input.kind === 'up')) {
      input = { ...input, x: moveControlRemap.anchor.x + input.x - moveControlRemap.start.x, y: moveControlRemap.anchor.y + input.y - moveControlRemap.start.y }
      if (input.kind === 'up') moveControlRemapRef.current = null
    }
    const origin = dragOriginRef.current
    const originalInput = input
    if (gridSnapEnabled && !input.modifiers?.alt && origin && (input.kind === 'drag' || input.kind === 'up') && origin.kind !== 'rotate') {
      const step = 20
      if (origin.kind === 'resize') {
        input = { ...input, x: Math.round(input.x / step) * step, y: Math.round(input.y / step) * step }
      } else if (origin.bounds) {
        const dx = input.x - origin.point.x
        const dy = input.y - origin.point.y
        const snappedDx = Math.round((origin.bounds[0] + dx) / step) * step - origin.bounds[0]
        const snappedDy = Math.round((origin.bounds[1] + dy) / step) * step - origin.bounds[1]
        input = { ...input, x: origin.point.x + snappedDx, y: origin.point.y + snappedDy }
      } else {
        input = { ...input, x: origin.point.x + Math.round((input.x - origin.point.x) / step) * step, y: origin.point.y + Math.round((input.y - origin.point.y) / step) * step }
      }
    }
    if (input.kind === 'drag' && origin?.kind === 'resize' && previewHandleRef.current.length === 2 && !textBoxResizeRef.current) {
      input = { ...input, modifiers: { ...input.modifiers, shift: true } }
    }
    if (import.meta.env.DEV && new URLSearchParams(location.search).get('test') === '1') (window as Window & { __folioLastSnap?: unknown }).__folioLastSnap = { enabled: gridSnapEnabled, origin, before: originalInput, after: input }
    if (input.kind === 'drag' && origin?.kind === 'move' && origin.bounds) {
      const delta = { x: input.x - origin.point.x, y: input.y - origin.point.y }
      movePreviewDeltaRef.current = delta
      if (movePreviewCanvasRef.current?.style.visibility === 'visible') movePreviewCanvasRef.current.style.transform = `translate3d(${delta.x}px, ${delta.y}px, 0)`
      if (movePreviewOverflowCanvasRef.current?.style.visibility === 'visible') {
        const { zoom: currentZoom, panOffset: currentPan } = viewTransformRef.current
        movePreviewOverflowCanvasRef.current.style.transform = `translate(calc(-50% + ${currentPan.x}px), calc(-50% + ${currentPan.y}px)) scale(${currentZoom / 100}) translate3d(${delta.x}px, ${delta.y}px, 0)`
      }
    }
    if (input.kind === 'drag' && transformPreviewRef.current && origin && origin.kind !== 'move') {
      lastTransformInputRef.current = input
      const initial = previewInitialGeometryRef.current
      if (initial.some((shape) => shape.rect)) {
        const matrix = pointerPreviewMatrix(input, origin)
        applyTransformPreviewMatrix(matrix)
      }
    } else if (input.kind === 'up') hideTransformFeedback()
    const previewSequence = input.kind === 'drag' && transformPreviewRef.current && origin?.kind !== 'move'
      ? ++transformInputSequenceRef.current
      : undefined
    if (previewSequence !== undefined && import.meta.env.DEV && new URLSearchParams(location.search).get('test') === '1') (window as Window & { __folioTransformInputSequence?: number }).__folioTransformInputSequence = previewSequence
    let engineInput = input
    const rotationRemap = rotationPointerRemapRef.current
    if (rotationRemap && (input.kind === 'drag' || input.kind === 'up')) {
      const dx = input.x - rotationRemap.pivotX
      const dy = input.y - rotationRemap.pivotY
      const radius = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx) + rotationRemap.angleOffset
      engineInput = { ...input, x: rotationRemap.pivotX + Math.cos(angle) * radius, y: rotationRemap.pivotY + Math.sin(angle) * radius }
    }
    return onPointer(engineInput, previewSequence)
  }
  const canvasPoint = (event: Pick<ReactPointerEvent<HTMLCanvasElement>, 'clientX' | 'clientY'>) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) return { x: 0, y: 0 }
    return { x: (event.clientX - bounds.left) / bounds.width * slideWidth, y: (event.clientY - bounds.top) / bounds.height * slideHeight }
  }
  const hasDraggedFiles = (event: ReactDragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes('Files')
  const handleFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFileDropActive(true)
  }
  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return
    event.preventDefault()
    event.stopPropagation()
    setFileDropActive(false)
    const file = event.dataTransfer.files[0]
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!file || !bounds) return
    const x = Math.max(0, Math.min(slideWidth, (event.clientX - bounds.left) / bounds.width * slideWidth))
    const y = Math.max(0, Math.min(slideHeight, (event.clientY - bounds.top) / bounds.height * slideHeight))
    onDropMedia(file, [x, y])
  }
  const handleCanvasPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    const html = event.clipboardData.getData('text/html')
    const folioClipboard = folioClipboardPayloadFromHtml(html)
    if (folioClipboard) {
      event.preventDefault()
      clipboardPasteHandledRef.current = true
      if (clipboardPasteFallbackRef.current !== null) window.clearTimeout(clipboardPasteFallbackRef.current)
      clipboardPasteFallbackRef.current = null
      onPasteFolioClipboard(folioClipboard)
      return
    }
    const image = Array.from(event.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (image) {
      event.preventDefault()
      clipboardPasteHandledRef.current = true
      if (clipboardPasteFallbackRef.current !== null) window.clearTimeout(clipboardPasteFallbackRef.current)
      clipboardPasteFallbackRef.current = null
      const file = new File([image], image.name || `clipboard-image-${Date.now()}.${image.type.split('/')[1] || 'png'}`, { type: image.type })
      onDropMedia(file, [slideWidth / 2, slideHeight / 2])
      return
    }
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()
    clipboardPasteHandledRef.current = true
    if (clipboardPasteFallbackRef.current !== null) window.clearTimeout(clipboardPasteFallbackRef.current)
    clipboardPasteFallbackRef.current = null
    const richShape = richTextShapeFromClipboard(html, text, slideWidth, slideHeight)
    if (richShape) {
      onInsertShapesBatch([richShape])
      return
    }
    const width = Math.min(slideWidth * 0.8, Math.max(180, Math.min(700, text.length * 9)))
    const height = Math.min(slideHeight * 0.7, Math.max(48, Math.min(240, text.split('\n').length * 36)))
    onExecute({ type: 'custom', name: 'shape.insert', params: { preset: 'rect', text, rect: [(slideWidth - width) / 2, (slideHeight - height) / 2, width, height] } })
  }
  const handleTextPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (event.defaultPrevented) return
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()
    const rich = richTextPayloadFromClipboard(event.clipboardData.getData('text/html'), text)
    if (rich) {
      onPasteRichText(rich)
      return
    }
    onTypeText(text)
  }
  const writeTextSelectionToClipboard = (event: ReactClipboardEvent<HTMLTextAreaElement>): boolean => {
    const input = event.currentTarget
    const plainText = input.value.slice(input.selectionStart, input.selectionEnd)
    if (!plainText) return false
    const paragraphs = editingShape?.textParagraphs
    if (!paragraphs?.length) return false
    const html = richTextHtmlForSelection(paragraphs, input.value, input.selectionStart, input.selectionEnd)
    if (!html) return false
    event.preventDefault()
    event.clipboardData.setData('text/plain', plainText)
    event.clipboardData.setData('text/html', html)
    return true
  }
  const handleTextCopy = (event: ReactClipboardEvent<HTMLTextAreaElement>) => { writeTextSelectionToClipboard(event) }
  const handleTextCut = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    if (!writeTextSelectionToClipboard(event)) return
    const input = event.currentTarget
    const anchor = textPositionAtOffset(input.value, input.selectionStart)
    const caret = textPositionAtOffset(input.value, input.selectionEnd)
    onExecute({ type: 'custom', name: 'text.select', params: { anchor, caret } })
    onKey({ key: 'Backspace' })
  }
  const pictureCropPointerDown = (event: ReactPointerEvent<HTMLElement>, edge: number) => {
    const shape = selectedPicture
    if (!shape?.rect) return
    event.preventDefault()
    event.stopPropagation()
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic pointers may not support capture. */ }
    pictureCropDragRef.current = { edge, start: canvasPoint(event), initial: pictureCropDraft, rect: shape.rect, rotation: shape.rotation ?? 0 }
  }
  const pictureCropPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = pictureCropDragRef.current
    if (!drag || (event.buttons & 1) === 0) return
    const point = canvasPoint(event)
    const radians = -drag.rotation * Math.PI / 180
    const dx = (point.x - drag.start.x) * Math.cos(radians) - (point.y - drag.start.y) * Math.sin(radians)
    const dy = (point.x - drag.start.x) * Math.sin(radians) + (point.y - drag.start.y) * Math.cos(radians)
    setPictureCropDraft((current) => {
      const next = [...current] as [number, number, number, number]
      const edge = drag.edge
      const delta = edge === 0 ? dx / drag.rect[2] : edge === 1 ? dy / drag.rect[3] : edge === 2 ? -dx / drag.rect[2] : -dy / drag.rect[3]
      const opposite = edge === 0 ? current[2] : edge === 1 ? current[3] : edge === 2 ? current[0] : current[1]
      next[edge] = Math.max(0, Math.min(.95 - opposite, drag.initial[edge] + delta))
      return next
    })
  }
  const finishPictureCropDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!pictureCropDragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    pictureCropDragRef.current = null
  }
  const applyPictureCropDraft = () => {
    if (!selectedPicture) return
    onExecute({ type: 'custom', name: 'picture.crop', params: { ids: [Number(selectedPicture.id)], left: pictureCropDraft[0], top: pictureCropDraft[1], right: pictureCropDraft[2], bottom: pictureCropDraft[3] } })
    setPictureCropMode(false)
  }
  const isOutsideSlide = (event: Pick<ReactPointerEvent<HTMLCanvasElement>, 'clientX' | 'clientY'>) => {
    const bounds = canvasRef.current?.getBoundingClientRect()
    return !!bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)
  }
  const handleOverflowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !isOutsideSlide(event)) return
    handlePointerDown(event)
  }
  const handleOverflowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) handlePointerMove(event)
  }
  const handleOverflowPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) handlePointerUp(event)
  }
  const finishTransformGesture = () => {
    document.documentElement.removeAttribute('data-folio-transforming')
    dragOriginRef.current = null
    moveControlRemapRef.current = null
    transformPreviewRef.current = false
    lastTransformInputRef.current = null
    rotationPointerRemapRef.current = null
    textBoxResizeRef.current = false
    transformMouseFallbackRef.current = false
    globalTransformCleanupRef.current?.()
    globalTransformCleanupRef.current = null
    editorEngine.setPreviewOnlyDrag(false)
    textFrameDragRef.current = false
    setIsDragging(false)
  }
  const settleInterruptedTransform = () => {
    if (!transformPreviewRef.current || dragOriginRef.current?.kind === 'move') return
    const last = lastTransformInputRef.current ?? dragOriginRef.current?.point
    if (!last) { finishTransformGesture(); return }
    void sendPointer({ kind: 'up', x: last.x, y: last.y, modifiers: lastTransformInputRef.current?.modifiers }).catch(() => undefined).finally(finishTransformGesture)
  }
  const handlePointerDown = (event: WorkspacePointerEvent) => {
    if (event.button !== undefined && event.button !== 0) return
    if (panMode) {
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Pointer capture is unavailable for synthetic events. */ }
      panStartRef.current = { x: event.clientX, y: event.clientY, offsetX: panOffset.x, offsetY: panOffset.y }
      setIsPanning(true)
      return
    }
    const pointerPoint = canvasPoint(event)
    const target = event.target instanceof Element ? event.target.closest('[data-engine-handle]') : null
    const kind = target?.getAttribute('data-engine-handle') === 'rotate' ? 'rotate' : target?.getAttribute('data-engine-handle') === 'resize' ? 'resize' : 'move'
    if (target) { event.stopPropagation?.(); event.preventDefault?.() }
    const currentSnapshot = editorEngine.getSnapshot()
    const selectedRects = currentSnapshot.activeSlide?.shapes.filter((shape) => currentSnapshot.selection?.shapeIds.includes(shape.id) && shape.rect).map((shape) => shape.rect as [number, number, number, number]) ?? []
    const currentBounds = boundsOf(selectedRects)
    const isMoveControl = target?.classList.contains('engine-selection__move') ?? false
    const point = isMoveControl && currentBounds ? { x: currentBounds[0] + currentBounds[2] / 2, y: currentBounds[1] + currentBounds[3] / 2 } : pointerPoint
    moveControlRemapRef.current = isMoveControl ? { start: pointerPoint, anchor: point } : null
    const pointInsideSelection = currentBounds && point.x >= currentBounds[0] && point.x <= currentBounds[0] + currentBounds[2] && point.y >= currentBounds[1] && point.y <= currentBounds[1] + currentBounds[3]
    const selectedIds = currentSnapshot.selection?.shapeIds ?? []
    const selectedShape = selectedIds.length === 1 ? currentSnapshot.activeSlide?.shapes.find((shape) => shape.id === selectedIds[0]) : null
    if (!drawingTool && !target && !currentSnapshot.selection?.textSelection && selectedShape
      && (selectedShape.textBox || selectedShape.placeholder) && hitsHiddenTextResizeHandle(selectedShape, point)) {
      event.preventDefault?.()
      return
    }
    textBoxResizeRef.current = selectedIds.length === 1
      && !!(selectedShape?.textBox || selectedShape?.placeholder)
    const shouldUseTransformPreview = kind !== 'move' && selectedIds.length > 0
    const shouldUseMovePreview = !drawingTool && kind === 'move' && !!pointInsideSelection && selectedIds.length > 0
    const shouldUsePreview = shouldUseMovePreview || shouldUseTransformPreview
    if (shouldUsePreview) document.documentElement.setAttribute('data-folio-transforming', '')
    if (!shouldUseTransformPreview) setIsDragging(true)
    const pointerCaptureTarget = shouldUseMovePreview ? stageRef.current?.querySelector('.slide-plane') as HTMLElement | null : event.currentTarget
    try { pointerCaptureTarget?.setPointerCapture(event.pointerId) } catch { /* Pointer capture is unavailable for synthetic events. */ }
    dragOriginRef.current = { point, kind, bounds: pointInsideSelection ? currentBounds : null }
    rotationPointerRemapRef.current = null
    let rustDownPoint = point
    if (kind === 'rotate' && (target?.classList.contains('engine-selection__rotate-hit') || target?.classList.contains('engine-selection__rotate'))) {
      const frame = target?.closest<HTMLElement>('.engine-selection')
      const frameId = frame?.dataset.engineSelectionId
      const rotateShape = currentSnapshot.activeSlide?.shapes.find((shape) => shape.id === frameId)
      const pivotX = currentBounds ? currentBounds[0] + currentBounds[2] / 2 : point.x
      const pivotY = currentBounds ? currentBounds[1] + currentBounds[3] / 2 : point.y
      if (rotateShape?.rect) {
        const [, , , height] = rotateShape.rect
        const radius = (rotateShape.flipV ? 1 : -1) * (height / 2 + 20)
        const angle = (rotateShape.rotation ?? 0) * Math.PI / 180
        const shapePivotX = rotateShape.rect[0] + rotateShape.rect[2] / 2
        const shapePivotY = rotateShape.rect[1] + height / 2
        const handlePoint = { x: shapePivotX - radius * Math.sin(angle), y: shapePivotY + radius * Math.cos(angle) }
        const actualAngle = Math.atan2(point.y - pivotY, point.x - pivotX)
        const rustAngle = Math.atan2(handlePoint.y - pivotY, handlePoint.x - pivotX)
        const angleOffset = rustAngle - actualAngle
        rotationPointerRemapRef.current = { pivotX, pivotY, angleOffset }
        rustDownPoint = handlePoint
      }
    }
    movePreviewDeltaRef.current = { x: 0, y: 0 }
    pointerDownClientRef.current = { x: event.clientX, y: event.clientY }
    previewKindRef.current = kind
    previewHandleRef.current = target?.className?.toString().match(/engine-selection__handle--([a-z]+)/)?.[1] ?? 'se'
    transformPreviewRef.current = shouldUsePreview
    if (shouldUseTransformPreview) transformInputSequenceRef.current = 0
    previewInitialGeometryRef.current = currentSnapshot.activeSlide?.shapes.filter((shape) => selectedIds.includes(shape.id) && shape.rect).map((shape) => ({ id: shape.id, rect: shape.rect, rotation: shape.rotation ?? 0, flipH: shape.flipH ?? false, flipV: shape.flipV ?? false })) ?? []
    editorEngine.setPreviewOnlyDrag(false)
    if (shouldUseTransformPreview) {
      transformMouseFallbackRef.current = false
      clearTransformSelectionPreview()
      const plane = stageRef.current?.querySelector('.slide-plane')
      const visuals = document.createElement('div')
      visuals.className = 'engine-transform-preview-frames'
      for (const source of plane?.querySelectorAll<HTMLElement>('.engine-selection[data-engine-selection-id]') ?? []) {
        const id = source.dataset.engineSelectionId
        if (!id) continue
        source.classList.add('engine-selection--transform-source')
        const visual = source.cloneNode(true) as HTMLElement
        visual.classList.remove('engine-selection--transform-source')
        visual.classList.add('engine-selection--preview')
        visual.dataset.engineSelectionVisual = id
        visual.removeAttribute('data-engine-selection-id')
        visuals.append(visual)
      }
      plane?.append(visuals)
      globalTransformCleanupRef.current?.()
    const onGlobalMove = (pointerEvent: PointerEvent) => { if (pointerEvent.pointerId === event.pointerId) { handlePointerMove(pointerEvent as unknown as WorkspacePointerEvent); handledTransformEventsRef.current.add(pointerEvent) } }
      const onGlobalUp = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return
        transformMouseFallbackRef.current = false
        globalTransformCleanupRef.current?.()
        globalTransformCleanupRef.current = null
        handlePointerUp(pointerEvent as unknown as WorkspacePointerEvent)
        handledTransformEventsRef.current.add(pointerEvent)
      }
      const onGlobalCancel = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== event.pointerId) return
        if (pointerEvent.pointerType === 'mouse') transformMouseFallbackRef.current = true
        else settleInterruptedTransform()
      }
      const onWindowBlur = () => settleInterruptedTransform()
      const onMouseMove = (mouseEvent: MouseEvent) => { if (transformMouseFallbackRef.current && (mouseEvent.buttons & 1) !== 0) handlePointerMove(mouseEvent as unknown as WorkspacePointerEvent) }
      const onMouseUp = (mouseEvent: MouseEvent) => { if (!transformMouseFallbackRef.current) return; transformMouseFallbackRef.current = false; globalTransformCleanupRef.current?.(); globalTransformCleanupRef.current = null; handlePointerUp(mouseEvent as unknown as WorkspacePointerEvent) }
      globalTransformCleanupRef.current = () => { window.removeEventListener('pointermove', onGlobalMove, true); window.removeEventListener('pointerup', onGlobalUp, true); window.removeEventListener('pointercancel', onGlobalCancel, true); window.removeEventListener('blur', onWindowBlur); window.removeEventListener('mousemove', onMouseMove, true); window.removeEventListener('mouseup', onMouseUp, true) }
      window.addEventListener('pointermove', onGlobalMove, true)
      window.addEventListener('pointerup', onGlobalUp, true)
      window.addEventListener('pointercancel', onGlobalCancel, true)
      // Capture-phase blur also sees the text editor losing focus when the user
      // presses a transform control. Only a real window blur should cancel a gesture.
      window.addEventListener('blur', onWindowBlur)
      window.addEventListener('mousemove', onMouseMove, true)
      window.addEventListener('mouseup', onMouseUp, true)
    }
    // Explicit transform controls leave text-edit mode first, so the engine cannot
    // consume the first drag as caret placement or a text-range selection.
    if ((isMoveControl || kind !== 'move') && currentSnapshot.selection?.textSelection) onKey({ key: 'Escape' })
    if (shouldUsePreview) {
      // Queue the selected-object preview before the model pointer-down so the first transform
      // frame cannot overtake preview preparation on the engine queue.
      editorEngine.setPreviewOnlyDrag(true)
      const hasTextToReflow = kind === 'resize' && currentSnapshot.activeSlide?.shapes.some((shape) => selectedIds.includes(shape.id) && !!shape.text?.length)
      const scaleTextOnCornerResize = !!hasTextToReflow && previewHandleRef.current.length === 2
      void editorEngine.beginTransformPreview(selectedIds, !!hasTextToReflow, scaleTextOnCornerResize).then(() => {
        if (shouldUseTransformPreview) editorEngine.setPreviewOnlyDrag(true)
      }).catch((error: unknown) => { transformPreviewRef.current = false; document.documentElement.removeAttribute('data-folio-transforming'); editorEngine.setPreviewOnlyDrag(false); clearTransformSelectionPreview(); console.error('Rust transform preview unavailable:', error) })
    }
    void sendPointer({ kind: 'down', ...rustDownPoint, modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }).then(() => {
      const snapshot = editorEngine.getSnapshot()
      const shapes = snapshot.activeSlide?.shapes.filter((shape) => snapshot.selection?.shapeIds.includes(shape.id) && shape.rect) ?? []
      dragOriginRef.current = { point, kind, bounds: boundsOf(shapes.map((shape) => shape.rect).filter((rect): rect is [number, number, number, number] => rect !== null)) }
    }).catch(() => undefined)
  }
  const openCanvasContextMenu = async (event: ReactMouseEvent<HTMLElement>) => {
    if (event.target instanceof Element && event.target.closest('.engine-text-input')) return
    event.preventDefault()
    const point = canvasPoint(event)
    const hit = await editorEngine.hitTest(point.x, point.y).catch(() => null)
    const snapshot = editorEngine.getSnapshot()
    const selectedIds = snapshot.selection?.shapeIds ?? []
    if (hit?.id !== undefined && !selectedIds.includes(String(hit.id))) {
      await editorEngine.execute({ type: 'custom', name: 'selection.select', params: { id: Number(hit.id) } }).catch(() => undefined)
    }
    const selectedAfter = editorEngine.getSnapshot().selection?.shapeIds ?? selectedIds
    setContextMenu(hit
      ? { kind: 'object', x: event.clientX, y: event.clientY, locked: hit.locked, selectionCount: selectedAfter.length }
      : { kind: 'canvas', x: event.clientX, y: event.clientY })
  }
  const slideContextAction = (action: 'grid' | 'fit' | 'duplicate-slide' | 'delete-slide' | 'new-before' | 'move-left' | 'move-right', index: number) => {
    if (action === 'grid') { onToggleGrid(); return }
    if (action === 'fit') { fitToArea(); return }
    if (action === 'new-before') { onExecute({ type: 'slide.new', params: { layout: 'blank', at: index } }); return }
    if (action === 'duplicate-slide') { const slide = engine.slides[index]; if (slide) onDuplicateSlide(slide.id); return }
    if (action === 'delete-slide') { onExecute({ type: 'slide.delete', params: { index } }); return }
    if (action === 'move-left' && index > 0) onMoveSlide(index, index - 1)
    if (action === 'move-right' && index < engine.slides.length - 1) onMoveSlide(index, index + 1)
  }
  const handlePointerMove = (event: WorkspacePointerEvent) => {
    const nativeEvent = (event as WorkspacePointerEvent & { nativeEvent?: Event }).nativeEvent ?? event as unknown as Event
    if (handledTransformEventsRef.current.has(nativeEvent)) return
    const eventStarted = perfNow()
    if (panStartRef.current) {
      panPendingRef.current = { x: event.clientX, y: event.clientY }
      if (!panFrameRef.current) panFrameRef.current = requestAnimationFrame(() => {
        panFrameRef.current = 0
        const pending = panPendingRef.current
        const start = panStartRef.current
        if (pending && start) setPanOffset({ x: start.offsetX + pending.x - start.x, y: start.offsetY + pending.y - start.y })
      })
      finishPerf('pointer.event.handler', eventStarted)
      return
    }
    const textStart = textPlacementStartRef.current
    if (placingText && textStart) {
      const point = canvasPoint(event)
      setTextPlacementPreview([Math.min(textStart.x, point.x), Math.min(textStart.y, point.y), Math.abs(point.x - textStart.x), Math.abs(point.y - textStart.y)])
      finishPerf('pointer.event.handler', eventStarted)
      return
    }
    const rectangleStart = rectanglePlacementStartRef.current
    if (placingRectangle && rectangleStart) {
      const point = canvasPoint(event)
      setRectanglePlacementPreview([Math.min(rectangleStart.x, point.x), Math.min(rectangleStart.y, point.y), Math.abs(point.x - rectangleStart.x), Math.abs(point.y - rectangleStart.y)])
      finishPerf('pointer.event.handler', eventStarted)
      return
    }
    const lineStart = linePlacementStartRef.current
    if (placingLine && lineStart) {
      const point = canvasPoint(event)
      setLinePlacementPreview([lineStart.x, lineStart.y, point.x, point.y])
      finishPerf('pointer.event.handler', eventStarted)
      return
    }
    const chartStart = chartPlacementStartRef.current
    if (placingChart && chartStart) {
      const point = canvasPoint(event)
      setChartPlacementPreview([Math.min(chartStart.x, point.x), Math.min(chartStart.y, point.y), Math.abs(point.x - chartStart.x), Math.abs(point.y - chartStart.y)])
      finishPerf('pointer.event.handler', eventStarted)
      return
    }
    if (((event.buttons ?? 0) & 1) === 0) { finishPerf('pointer.event.handler', eventStarted); return }
    void sendPointer({ kind: 'drag', ...canvasPoint(event), modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }).catch(() => undefined)
    finishPerf('pointer.event.handler', eventStarted)
  }
  const handleCanvasHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.buttons !== 0 || isDragging) return
    if (panMode) {
      const plane = stageRef.current?.querySelector<HTMLElement>('.slide-plane')
      if (plane) plane.style.cursor = ''
      return
    }
    const point = canvasPoint(event)
    const plane = stageRef.current?.querySelector<HTMLElement>('.slide-plane')
    if (!plane) return
    const sequence = ++hoverHitTestSequenceRef.current
    void editorEngine.hitTest(point.x, point.y).then((hit) => {
      if (sequence !== hoverHitTestSequenceRef.current || !plane.isConnected) return
      if (!hit) { plane.style.cursor = 'default'; return }
      if (editingShape && String(hit.id) === editingShape.id) { plane.style.cursor = 'text'; return }
      if (hit.locked) { plane.style.cursor = 'not-allowed'; return }
      if (hit.kind === 'rotate') {
        plane.style.cursor = rotateCursor()
        return
      }
      if (hit.kind === 'resize') {
        plane.style.cursor = (['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'] as const)[(hit.handle ?? 0) % 8] ?? 'nwse-resize'
        return
      }
      plane.style.cursor = 'move'
    }).catch(() => { if (sequence === hoverHitTestSequenceRef.current) plane.style.cursor = 'default' })
  }
  const handlePointerUp = (event: WorkspacePointerEvent) => {
    const nativeEvent = (event as WorkspacePointerEvent & { nativeEvent?: Event }).nativeEvent ?? event as unknown as Event
    if (handledTransformEventsRef.current.has(nativeEvent)) return
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* The pointer may already have left the document. */ }
    if (panStartRef.current) {
      const start = panStartRef.current
      const point = panPendingRef.current ?? { x: event.clientX, y: event.clientY }
      if (panFrameRef.current) cancelAnimationFrame(panFrameRef.current)
      panFrameRef.current = 0
      panPendingRef.current = null
      panStartRef.current = null
      setIsPanning(false)
      setPanOffset({ x: start.offsetX + point.x - start.x, y: start.offsetY + point.y - start.y })
      requestAnimationFrame(() => void editorEngine.refreshViewport().catch(() => undefined))
      return
    }
    const textStart = textPlacementStartRef.current
    if (placingText && textStart) {
      const point = canvasPoint(event)
      const width = Math.abs(point.x - textStart.x)
      const height = Math.abs(point.y - textStart.y)
      const rect: [number, number, number, number] = width < 8 && height < 8
        ? [Math.max(0, Math.min(slideWidth, textStart.x)), Math.max(0, Math.min(slideHeight, textStart.y)), Math.min(420, slideWidth), Math.min(90, slideHeight)]
        : [Math.min(textStart.x, point.x), Math.min(textStart.y, point.y), Math.max(100, width), Math.max(30, height)]
      textPlacementStartRef.current = null
      setTextPlacementPreview(null)
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* Capture can already be released by the browser. */ }
      onPlaceText(rect)
      return
    }
    const rectangleStart = rectanglePlacementStartRef.current
    if (placingRectangle && rectangleStart) {
      const point = canvasPoint(event)
      const width = Math.abs(point.x - rectangleStart.x)
      const height = Math.abs(point.y - rectangleStart.y)
      const rect: [number, number, number, number] = width < 8 && height < 8
        ? [Math.max(0, Math.min(888, rectangleStart.x)), Math.max(0, Math.min(468, rectangleStart.y)), 72, 72]
        : [Math.min(rectangleStart.x, point.x), Math.min(rectangleStart.y, point.y), Math.max(1, width), Math.max(1, height)]
      rectanglePlacementStartRef.current = null
      setRectanglePlacementPreview(null)
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* Capture can already be released by the browser. */ }
      onPlaceRectangle(rect, rectanglePreset)
      return
    }
    const lineStart = linePlacementStartRef.current
    if (placingLine && lineStart) {
      const point = canvasPoint(event)
      const dx = point.x - lineStart.x
      const dy = point.y - lineStart.y
      const rect: [number, number, number, number] = Math.hypot(dx, dy) < 8
        ? [lineStart.x, lineStart.y, 72, 0]
        : [Math.min(lineStart.x, point.x), Math.min(lineStart.y, point.y), Math.abs(dx), Math.abs(dy)]
      linePlacementStartRef.current = null
      setLinePlacementPreview(null)
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* Capture can already be released by the browser. */ }
      onPlaceLine(rect, Math.abs(dx) >= 1 && Math.abs(dy) >= 1 && dx * dy < 0, linePreset)
      return
    }
    const chartStart = chartPlacementStartRef.current
    if (placingChart && chartStart) {
      const point = canvasPoint(event)
      const width = Math.abs(point.x - chartStart.x)
      const height = Math.abs(point.y - chartStart.y)
      const rect: [number, number, number, number] = width < 8 && height < 8
        ? [Math.max(0, Math.min(480, chartStart.x)), Math.max(0, Math.min(270, chartStart.y)), 480, 270]
        : [Math.min(chartStart.x, point.x), Math.min(chartStart.y, point.y), Math.max(120, width), Math.max(90, height)]
      chartPlacementStartRef.current = null
      setChartPlacementPreview(null)
      try { event.currentTarget.releasePointerCapture?.(event.pointerId) } catch { /* Capture can already be released by the browser. */ }
      onPlaceChart(rect)
      return
    }
    const finishGesture = () => {
      finishTransformGesture()
    }
    const finishPointer = sendPointer({ kind: 'up', ...canvasPoint(event), modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } })
    if (transformPreviewRef.current) {
      void finishPointer.catch(() => undefined).finally(finishGesture)
      return
    }
    void finishPointer.catch(() => undefined)
    finishGesture()
  }
  const clearTransformSelectionPreview = () => {
    const plane = stageRef.current?.querySelector('.slide-plane')
    plane?.querySelector('.engine-transform-preview-frames')?.remove()
    plane?.querySelectorAll('.engine-selection--preview').forEach((node) => node.remove())
    plane?.querySelectorAll('.engine-selection--transform-source').forEach((node) => node.classList.remove('engine-selection--transform-source'))
  }
  const handleTextFramePointerDown = (event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (panMode) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = 8
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    if (x > edge && x < bounds.width - edge && y > edge && y < bounds.height - edge) {
      // The textarea is only an input/IME surface. Keep Rust's projected caret authoritative
      // instead of letting the browser move a private native selection that the engine cannot see.
      event.preventDefault()
      event.stopPropagation()
      textCaretPointerRef.current = event.pointerId
      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Synthetic pointers may not be capturable. */ }
      void sendPointer({ kind: 'down', ...canvasPoint(event), modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }).catch(() => undefined)
      return
    }
    event.preventDefault()
    textFrameDragRef.current = true
    handlePointerDown(event)
  }
  const handleTextFramePointerMove = (event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (textCaretPointerRef.current === event.pointerId && (event.buttons & 1) !== 0) {
      void sendPointer({ kind: 'drag', ...canvasPoint(event), modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }).catch(() => undefined)
      return
    }
    if (textFrameDragRef.current) handlePointerMove(event)
  }
  const handleTextFramePointerUp = (event: ReactPointerEvent<HTMLTextAreaElement>) => {
    if (textCaretPointerRef.current === event.pointerId) {
      textCaretPointerRef.current = null
      try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* The pointer may already have left the document. */ }
      void sendPointer({ kind: 'up', ...canvasPoint(event), modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey } }).catch(() => undefined)
      return
    }
    if (!textFrameDragRef.current) return
    textFrameDragRef.current = false
    handlePointerUp(event)
  }

  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onTypeText(event.shiftKey ? '\v' : '\n')
      return
    }
    if ((event.metaKey || event.ctrlKey) && ['c', 'x', 'v'].includes(event.key.toLocaleLowerCase())) return
    if (event.metaKey || event.ctrlKey || ['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape', 'Tab'].includes(event.key)) {
      if (event.key === 'Escape') { event.preventDefault(); onKey({ key: 'Escape' }); textInputRef.current?.blur(); return }
      event.preventDefault()
      onKey({ key: event.key, modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, cmd: event.metaKey, alt: event.altKey } })
    }
  }

  const handleCompositionUpdate = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingText.current = true
    const length = Array.from(event.data).length
    onComposeText(event.data, [0, length])
  }

  const handleCompositionStart = () => { composingText.current = true }

  const handleCompositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composingText.current = false
    onCommitText(event.data)
  }

  const measureFitZoom = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return null
    const { width, height } = stage.getBoundingClientRect()
    if (width <= 0 || height <= 0) return null

    // The slide is centered inside the stage padding; account for both sides.
    const styles = window.getComputedStyle(stage)
    const availableWidth = width - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight) - 32
    const availableHeight = height - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom) - 32
    if (availableWidth <= 0 || availableHeight <= 0) return null
    return Math.max(10, Math.min(200, Math.floor(Math.min(availableWidth / slideWidth, availableHeight / slideHeight) * 100)))
  }, [slideWidth, slideHeight])

  const fitToArea = useCallback(() => {
    const fitZoom = measureFitZoom()
    if (fitZoom === null) return
    autoFitRef.current = true
    fitZoomRef.current = fitZoom
    setPanOffset({ x: 0, y: 0 })
    onZoomChange(fitZoom)
    showFeedback(`${t('Slayt ekrana sığdırıldı')} (%${fitZoom}).`)
    requestAnimationFrame(() => void editorEngine.refreshViewport().catch(() => undefined))
  }, [measureFitZoom, onZoomChange, showFeedback, t])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const refit = () => {
      if (!autoFitRef.current) return
      const fitZoom = measureFitZoom()
      if (fitZoom === null) return
      fitZoomRef.current = fitZoom
      onZoomChange(fitZoom)
    }

    refit()
    const observer = new ResizeObserver(refit)
    observer.observe(stage)
    const onFullscreenChange = () => requestAnimationFrame(refit)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    window.addEventListener('resize', onFullscreenChange)
    return () => {
      observer.disconnect()
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      window.removeEventListener('resize', onFullscreenChange)
    }
  }, [measureFitZoom, onZoomChange])

  const setManualZoom = (nextZoom: number) => {
    autoFitRef.current = false
    onZoomChange(nextZoom)
    requestAnimationFrame(() => void editorEngine.refreshViewport().catch(() => undefined))
  }

  const rulerTabAlignments = ['l', 'ctr', 'r', 'dec'] as const
  const beginRulerPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!textRuler || !textSelection || !canvasRef.current) return
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tab-pos], [data-indent-kind]') : null
    const from = target?.dataset.tabPos ? Number(target.dataset.tabPos) : null
    const indentKind = target?.dataset.indentKind
    const marker = target?.dataset.tabPos ? 'tab' : indentKind === 'first' || indentKind === 'hanging' || indentKind === 'left' ? indentKind : null
    const drag: RulerTabDrag = { pointerId: event.pointerId, marker, from: Number.isFinite(from) ? from : null, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY }
    rulerTabDragRef.current = drag
    setRulerTabDrag(drag)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveRulerPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rulerTabDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const next = { ...drag, currentX: event.clientX, currentY: event.clientY }
    rulerTabDragRef.current = next
    setRulerTabDrag(next)
  }
  const finishRulerPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = rulerTabDragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !textRuler || !canvasRef.current || !topRulerRef.current) return
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3
    const rulerBounds = topRulerRef.current.getBoundingClientRect()
    const canvasBounds = canvasRef.current.getBoundingClientRect()
    const relativeX = (event.clientX - canvasBounds.left) / canvasBounds.width * slideWidth - textRuler.x
    const position = Math.max(0, Math.min(textRuler.width, Math.round(relativeX * 2) / 2))
    if (drag.marker === 'tab' && drag.from !== null && moved) {
      const outside = event.clientY > rulerBounds.bottom + 20
      void editorEngine.execute({ type: 'custom', name: 'format.tabs', params: outside ? { remove: drag.from } : { move: { from: drag.from, to: position } } }).catch(() => undefined)
    } else if (drag.marker && drag.marker !== 'tab' && moved) {
      const params = drag.marker === 'first'
        ? { indentFirst: position - textRuler.marginLeft }
        : drag.marker === 'hanging'
          ? { indentLeft: position, indentFirst: textRuler.marginLeft + textRuler.indent - position }
          : { indentLeft: position }
      void editorEngine.execute({ type: 'custom', name: 'format.paragraph', params }).catch(() => undefined)
    } else if (!drag.marker && !moved && event.clientX >= canvasBounds.left + textRuler.x / slideWidth * canvasBounds.width && event.clientX <= canvasBounds.left + (textRuler.x + textRuler.width) / slideWidth * canvasBounds.width) {
      const align = rulerTabAlignments[rulerTabKind]
      void editorEngine.execute({ type: 'custom', name: 'format.tabs', params: { add: { pos: position, align } } }).catch(() => undefined)
    }
    rulerTabDragRef.current = null
    setRulerTabDrag(null)
  }

  return <section className={`workspace${filmstripVisible ? '' : ' workspace--filmstrip-hidden'}`} aria-label={t('Slayt çalışma alanı')}>
      <div className={`stage${rulersVisible ? '' : ' stage--no-rulers'}`} ref={stageRef}>
      {rulersVisible && <><button type="button" className="ruler-corner" aria-label={t('Sekme hizalamasını değiştir')} title={t(`Sekme türü: ${['Sol', 'Orta', 'Sağ', 'Ondalık'][rulerTabKind]}`)} onClick={() => setRulerTabKind((kind) => ((kind + 1) % 4) as 0 | 1 | 2 | 3)}><RulerTabGlyph align={rulerTabAlignments[rulerTabKind]} /></button><div className="ruler ruler--top" aria-label={t('Üst cetvel')} ref={topRulerRef} onPointerDown={beginRulerPointer} onPointerMove={moveRulerPointer} onPointerUp={finishRulerPointer} onPointerCancel={finishRulerPointer}><RulerTicks direction="horizontal" length={slideWidth} />{textRuler && !textRuler.rotated && canvasRef.current && topRulerRef.current && <RulerIndentMarkers ruler={textRuler} canvas={canvasRef.current.getBoundingClientRect()} bounds={topRulerRef.current.getBoundingClientRect()} slideWidth={slideWidth} drag={rulerTabDrag} />} {textRuler && !textRuler.rotated && canvasRef.current && topRulerRef.current && textRuler.tabs.map((tab) => { const rulerBounds = topRulerRef.current!.getBoundingClientRect(); const canvasBounds = canvasRef.current!.getBoundingClientRect(); const x = canvasBounds.left + (textRuler.x + tab.pos) / slideWidth * canvasBounds.width - rulerBounds.left; const dragging = rulerTabDrag?.marker === 'tab' && rulerTabDrag.from === tab.pos; const previewX = dragging && canvasRef.current ? (eventSafeRulerX(rulerTabDrag!.currentX, canvasRef.current.getBoundingClientRect(), textRuler.x, slideWidth) - rulerBounds.left) : x; return <span key={`${tab.pos}-${tab.align}`} className={`ruler-tab-marker${dragging ? ' ruler-tab-marker--dragging' : ''}`} data-tab-pos={tab.pos} role="img" aria-label={`${t('Sekme durağı')} ${tab.pos} pt`} style={{ left: `${previewX}px` }}><RulerTabGlyph align={tab.align} /></span> })}</div><div className="ruler ruler--left" aria-label={t('Sol cetvel')}><RulerTicks direction="vertical" length={slideHeight} /></div></>}
      <div className="slide-area" onPointerDown={handleOverflowPointerDown} onPointerMove={handleOverflowPointerMove} onPointerUp={handleOverflowPointerUp} onPointerCancel={handleOverflowPointerUp} onDoubleClick={(event) => { if (event.target === event.currentTarget && isOutsideSlide(event)) void sendPointer({ kind: 'doubleClick', ...canvasPoint(event) }) }}>{engine.error ? <div className="engine-error" role="alert">{t('Sunum motoru yüklenemedi')}: {engine.error}</div> : <>
        <canvas ref={overflowCanvasRef} className="slide-overflow" style={{ width: `${slideWidth + overflowMargin * 2}px`, height: `${slideHeight + overflowMargin * 2}px`, transform: `translate(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px)) scale(${zoom / 100})`, maskImage: overflowMask(overflowMargin, slideWidth, slideHeight), WebkitMaskImage: overflowMask(overflowMargin, slideWidth, slideHeight) }} aria-label={t('Slayt dışına taşan nesnelerin soluk önizlemesi')} role="img" />
        <canvas ref={movePreviewOverflowBackgroundCanvasRef} className="slide-overflow move-preview-overflow-background" style={{ width: `${slideWidth + overflowMargin * 2}px`, height: `${slideHeight + overflowMargin * 2}px`, transform: `translate(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px)) scale(${zoom / 100})`, maskImage: overflowMask(overflowMargin, slideWidth, slideHeight), WebkitMaskImage: overflowMask(overflowMargin, slideWidth, slideHeight), visibility: 'hidden' }} aria-hidden="true" />
        <canvas ref={movePreviewOverflowCanvasRef} className="slide-overflow move-preview-overflow" style={{ width: `${slideWidth + overflowMargin * 2}px`, height: `${slideHeight + overflowMargin * 2}px`, transform: `translate(calc(-50% + ${panOffset.x}px), calc(-50% + ${panOffset.y}px)) scale(${zoom / 100})`, maskImage: overflowMask(overflowMargin, slideWidth, slideHeight), WebkitMaskImage: overflowMask(overflowMargin, slideWidth, slideHeight), visibility: 'hidden' }} aria-hidden="true" />
      <div className={`slide-plane${panMode ? ' slide-plane--pan' : ''}${drawingTool ? ' slide-plane--drawing' : ''}${placingText ? ' slide-plane--placing-text' : ''}${placingRectangle ? ' slide-plane--placing-rectangle' : ''}${placingLine ? ' slide-plane--placing-line' : ''}${placingChart ? ' slide-plane--placing-chart' : ''}${isPanning ? ' slide-plane--panning' : ''}${isDragging ? ' slide-plane--dragging' : ''}${fileDropActive ? ' slide-plane--file-drop' : ''}${moveablePocEnabled ? ' slide-plane--moveable-poc' : ''}`} style={{ width: `${slideWidth}px`, height: `${slideHeight}px`, transform: `translate(-50%, -50%) translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom / 100})`, '--slide-width': `${slideWidth}px`, '--slide-height': `${slideHeight}px`, '--grid-step': '20px', '--handle-scale': String(100 / zoom), '--handle-inset': '9px', '--rotate-hit-inset': `${11 + 18 * 100 / zoom}px`, '--rotate-control-inset': `${9 + 20 * 100 / zoom}px`, '--rotate-stem-length': `${20 * 100 / zoom}px` } as React.CSSProperties} onDragEnter={handleFileDragOver} onDragOver={handleFileDragOver} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDropActive(false) }} onDrop={handleFileDrop} onPaste={handleCanvasPaste} onPointerMove={(event) => { if (event.target === event.currentTarget) handlePointerMove(event) }} onPointerUp={(event) => { if (event.target === event.currentTarget) handlePointerUp(event) }} onPointerCancel={(event) => { if (event.target === event.currentTarget) handlePointerUp(event) }} onContextMenu={(event) => { void openCanvasContextMenu(event) }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) { event.preventDefault(); const bounds = canvasRef.current?.getBoundingClientRect(); if (bounds) { const keyboardEvent = { clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, target: event.target, preventDefault: () => event.preventDefault() } as unknown as ReactMouseEvent<HTMLElement>; void openCanvasContextMenu(keyboardEvent) } } }}>
        {fileDropActive && <div className="slide-plane__file-drop-hint" aria-live="polite">{t('Dosyayı slayda eklemek için bırakın')}</div>}
          {(smartGuides.length > 0 || smartGapGuides.length > 0) && <svg className="smart-guides" viewBox={`0 0 ${slideWidth} ${slideHeight}`} aria-hidden="true" data-testid="smart-guides" style={{ position: 'absolute', zIndex: 3, inset: 0, width: slideWidth, height: slideHeight, overflow: 'visible', pointerEvents: 'none' }}>
            {smartGuides.map((guide) => <line key={`${guide.vertical ? 'v' : 'h'}-${guide.pos}-${guide.from}-${guide.to}`} x1={guide.vertical ? guide.pos : guide.from} y1={guide.vertical ? guide.from : guide.pos} x2={guide.vertical ? guide.pos : guide.to} y2={guide.vertical ? guide.to : guide.pos} style={{ stroke: '#8b3dff', strokeWidth: 1.25, vectorEffect: 'non-scaling-stroke' }} />)}
            {smartGapGuides.map((guide) => {
              const halfTick = 4 * 100 / zoom
              const labelWidth = Math.max(24, guide.label.length * 7 + 12) * 100 / zoom
              const labelHeight = 18 * 100 / zoom
              const labelX = guide.axis === 'horizontal' ? (guide.x1 + guide.x2) / 2 - labelWidth / 2 : guide.x - labelWidth / 2
              const labelY = guide.axis === 'horizontal' ? guide.y - labelHeight - halfTick : (guide.y1 + guide.y2) / 2 - labelHeight / 2
              return <g key={guide.id} data-testid="smart-gap-guide" data-axis={guide.axis}>
                {guide.axis === 'horizontal' ? <>
                  <line x1={guide.x1} y1={guide.y} x2={guide.x2} y2={guide.y} />
                  <line x1={guide.x1} y1={guide.y - halfTick} x2={guide.x1} y2={guide.y + halfTick} />
                  <line x1={guide.x2} y1={guide.y - halfTick} x2={guide.x2} y2={guide.y + halfTick} />
                  <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={8 * 100 / zoom} />
                  <text x={(guide.x1 + guide.x2) / 2} y={labelY + labelHeight * .69}>{guide.label}</text>
                </> : <>
                  <line x1={guide.x} y1={guide.y1} x2={guide.x} y2={guide.y2} />
                  <line x1={guide.x - halfTick} y1={guide.y1} x2={guide.x + halfTick} y2={guide.y1} />
                  <line x1={guide.x - halfTick} y1={guide.y2} x2={guide.x + halfTick} y2={guide.y2} />
                  <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={8 * 100 / zoom} />
                  <text x={guide.x} y={labelY + labelHeight * .69}>{guide.label}</text>
                </>}
              </g>
            })}
            <style>{`.smart-guides [data-testid="smart-gap-guide"] line{stroke:#8b3dff;stroke-width:1;vector-effect:non-scaling-stroke}.smart-guides [data-testid="smart-gap-guide"] rect{fill:#8b3dff}.smart-guides [data-testid="smart-gap-guide"] text{fill:#fff;text-anchor:middle;font-size:${12 * 100 / zoom}px;font-family:inherit}`}</style>
          </svg>}
          <canvas ref={canvasRef} className="slide-canvas" style={{ width: slideWidth, height: slideHeight }} aria-label={t('Rust motoru tarafından oluşturulan slayt')} tabIndex={0} onPointerDown={(event) => {
            if (placingText) {
              event.preventDefault()
              event.stopPropagation()
              const point = canvasPoint(event)
              textPlacementStartRef.current = point
              setTextPlacementPreview([point.x, point.y, 0, 0])
              try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture can be unavailable for synthetic pointers. */ }
              return
            }
            if (placingRectangle) {
              event.preventDefault()
              event.stopPropagation()
              const point = canvasPoint(event)
              rectanglePlacementStartRef.current = point
              setRectanglePlacementPreview([point.x, point.y, 0, 0])
              try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture can be unavailable for synthetic pointers. */ }
              return
            }
            if (placingLine) {
              event.preventDefault()
              event.stopPropagation()
              const point = canvasPoint(event)
              linePlacementStartRef.current = point
              setLinePlacementPreview([point.x, point.y, point.x, point.y])
              try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture can be unavailable for synthetic pointers. */ }
              return
            }
            if (placingChart) {
              event.preventDefault()
              event.stopPropagation()
              const point = canvasPoint(event)
              chartPlacementStartRef.current = point
              setChartPlacementPreview([point.x, point.y, 0, 0])
              try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* Capture can be unavailable for synthetic pointers. */ }
              return
            }
            handlePointerDown(event)
          }} onPointerMove={(event) => { handlePointerMove(event); if (!textPlacementStartRef.current && !rectanglePlacementStartRef.current && !linePlacementStartRef.current && !chartPlacementStartRef.current) handleCanvasHover(event) }} onPointerLeave={() => { hoverHitTestSequenceRef.current += 1 }} onPointerUp={handlePointerUp} onPointerCancel={() => { textPlacementStartRef.current = null; setTextPlacementPreview(null); rectanglePlacementStartRef.current = null; setRectanglePlacementPreview(null); linePlacementStartRef.current = null; setLinePlacementPreview(null); chartPlacementStartRef.current = null; setChartPlacementPreview(null); setIsDragging(false) }} onDoubleClick={(event) => sendPointer({ kind: 'doubleClick', ...canvasPoint(event) })} />
          {textPlacementPreview && textPlacementPreview[2] > 0 && textPlacementPreview[3] > 0 && <div className="text-placement-preview" aria-hidden="true" style={{ left: textPlacementPreview[0], top: textPlacementPreview[1], width: textPlacementPreview[2], height: textPlacementPreview[3] }} />}
          {rectanglePlacementPreview && rectanglePlacementPreview[2] > 0 && rectanglePlacementPreview[3] > 0 && <div className="shape-placement-preview" aria-hidden="true" style={{ left: rectanglePlacementPreview[0], top: rectanglePlacementPreview[1], width: rectanglePlacementPreview[2], height: rectanglePlacementPreview[3] }} />}
          {chartPlacementPreview && chartPlacementPreview[2] > 0 && chartPlacementPreview[3] > 0 && <div className="shape-placement-preview chart-placement-preview" aria-hidden="true" style={{ left: chartPlacementPreview[0], top: chartPlacementPreview[1], width: chartPlacementPreview[2], height: chartPlacementPreview[3] }} />}
          {linePlacementPreview && <svg className="line-placement-preview" viewBox={`0 0 ${slideWidth} ${slideHeight}`} aria-hidden="true" style={{ position: 'absolute', zIndex: 6, inset: 0, width: slideWidth, height: slideHeight, overflow: 'visible', pointerEvents: 'none' }}><line x1={linePlacementPreview[0]} y1={linePlacementPreview[1]} x2={linePlacementPreview[2]} y2={linePlacementPreview[3]} style={{ stroke: 'var(--accent-strong)', strokeWidth: 2, vectorEffect: 'non-scaling-stroke' }} /></svg>}
          <canvas ref={movePreviewBackgroundCanvasRef} className="move-preview-background" aria-hidden="true" style={{ visibility: 'hidden' }} />
          <canvas ref={movePreviewCanvasRef} className="move-preview-active" aria-hidden="true" style={{ visibility: 'hidden' }} />
          {gridVisible && <div className="canvas-grid" aria-hidden="true" />}
          {engine.selection?.marquee && <div className="engine-marquee" style={{ left: engine.selection.marquee[0], top: engine.selection.marquee[1], width: engine.selection.marquee[2], height: engine.selection.marquee[3] }} aria-hidden="true" />}
          {selectedShapes.map((shape) => {
            const previewShape = transformPreviewRef.current ? previewGeometryRef.current.find((item) => item.id === shape.id) : null
            const rect = previewShape?.rect ?? shape.rect
            const rotation = previewShape?.rotation ?? shape.rotation ?? 0
            const cropHandleWidth = Math.min(18 * 100 / zoom, Math.max(6 * 100 / zoom, rect ? rect[2] * .38 : 18))
            const cropHandleHeight = Math.min(18 * 100 / zoom, Math.max(6 * 100 / zoom, rect ? rect[3] * .38 : 18))
            const resizeHandles = shape.locked ? [] : shape.textBox || shape.placeholder ? ['e', 'w'] as const : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
            return rect && <div className={`engine-selection${shape.placeholder ? ' engine-selection--placeholder' : ''}${shape.textBox ? ' engine-selection--text-box' : ''}${pictureCropMode && shape.id === selectedPicture?.id ? ' engine-selection--crop-mode' : ''}`} data-engine-selection-id={shape.id} key={shape.id} role="group" aria-label={`${shape.name} ${t('seçili')}`} style={{ left: rect[0], top: rect[1], width: rect[2], height: rect[3], transform: `rotate(${rotation}deg)` }}>
            {pictureCropMode && shape.id === selectedPicture?.id ? <>
              <div className="picture-crop__mask picture-crop__mask--top" style={{ height: `${pictureCropDraft[1] * 100}%` }} />
              <div className="picture-crop__mask picture-crop__mask--bottom" style={{ height: `${pictureCropDraft[3] * 100}%` }} />
              <div className="picture-crop__mask picture-crop__mask--left" style={{ top: `${pictureCropDraft[1] * 100}%`, bottom: `${pictureCropDraft[3] * 100}%`, width: `${pictureCropDraft[0] * 100}%` }} />
              <div className="picture-crop__mask picture-crop__mask--right" style={{ top: `${pictureCropDraft[1] * 100}%`, bottom: `${pictureCropDraft[3] * 100}%`, width: `${pictureCropDraft[2] * 100}%` }} />
              <div className="picture-crop__frame" style={{ left: `${pictureCropDraft[0] * 100}%`, top: `${pictureCropDraft[1] * 100}%`, right: `${pictureCropDraft[2] * 100}%`, bottom: `${pictureCropDraft[3] * 100}%` }} />
              {(['left', 'top', 'right', 'bottom'] as const).map((edge, index) => <span key={edge} className={`picture-crop__handle picture-crop__handle--${edge}`} style={{ width: `${cropHandleWidth}px`, height: `${cropHandleHeight}px`, ...(edge === 'left' ? { left: `${pictureCropDraft[0] * 100}%`, top: '50%' } : edge === 'top' ? { left: '50%', top: `${pictureCropDraft[1] * 100}%` } : edge === 'right' ? { left: `${(1 - pictureCropDraft[2]) * 100}%`, top: '50%' } : { left: '50%', top: `${(1 - pictureCropDraft[3]) * 100}%` }) }} role="slider" aria-label={`${t(edge === 'left' ? 'Sol kenar' : edge === 'top' ? 'Üst kenar' : edge === 'right' ? 'Sağ kenar' : 'Alt kenar')} ${t('kırpma')}`} onPointerDown={(event) => pictureCropPointerDown(event, index)} onPointerMove={pictureCropPointerMove} onPointerUp={finishPictureCropDrag} onPointerCancel={finishPictureCropDrag} />)}
              <div className="picture-crop__toolbar"><Button variant="accent" size="sm" onClick={applyPictureCropDraft}>{t('Kırpmayı uygula')}</Button><Button variant="ghost" size="sm" onClick={() => { setPictureCropDraft(shape.pictureCrop ?? [0, 0, 0, 0]); setPictureCropMode(false) }}>{t('İptal')}</Button></div>
            </> : <>
              {!moveablePocEnabled && resizeHandles.map((position) => <span key={position} className={`engine-selection__handle engine-selection__handle--${position}`} style={{ cursor: resizeCursor(position, rotation) }} data-engine-handle="resize" aria-label={t('Yeniden boyutlandır')} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />)}
              {!shape.locked && !moveablePocEnabled && (['nw', 'ne', 'se', 'sw'] as const).map((position) => <span key={`rotate-${position}`} className={`engine-selection__rotate-hit engine-selection__rotate-hit--${position}`} style={{ cursor: rotateCursor() }} data-engine-handle="rotate" aria-label={t('Döndür')} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />)}
              {!shape.locked && !moveablePocEnabled && <span className="engine-selection__rotate-stem" aria-hidden="true" />}
              {!shape.locked && <button type="button" className="engine-selection__move" data-engine-handle="move" aria-label={t('Taşı')} title={t('Taşı')} onPointerDown={moveablePocEnabled ? undefined : handlePointerDown} onPointerMove={moveablePocEnabled ? undefined : handlePointerMove} onPointerUp={moveablePocEnabled ? undefined : handlePointerUp} />}
              {!shape.locked && !moveablePocEnabled && <button type="button" className="engine-selection__rotate" style={{ cursor: rotateCursor() }} data-engine-handle="rotate" aria-label={t('Döndür')} title={t('Döndür')} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} />}
              {selectedPicture?.id === shape.id && <Button variant="secondary" size="sm" className="picture-crop__enter" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setPictureCropDraft(shape.pictureCrop ?? [0, 0, 0, 0]); setPictureCropMode(true) }}>{t('Kırp')}</Button>}
              {moveablePocEnabled && !shape.locked && <MoveableSelectionPoc enabled geometryKey={`${rect.join(',')}:${rotation}:${zoom}`} onDown={handlePointerDown} onMove={handlePointerMove} onUp={handlePointerUp} />}
            </>}
          </div>
          })}
          {selectionBounds && selectedShapes.length > 0 && !isDragging && !placingText && !drawingTool && !pictureCropMode && <div
            ref={selectionToolbarRef}
            className={`selection-toolbar${textOnlySelection ? ' selection-toolbar--text' : ''}`}
            role="toolbar"
            aria-label={t('Seçim araç çubuğu')}
            style={{ left: Math.max(4, Math.min(956, selectionBounds[0] + selectionBounds[2] / 2)), top: toolbarBelowSelection ? selectionBounds[1] + selectionBounds[3] + 12 : Math.max(8, selectionBounds[1] - 12), transform: `translate(-50%, ${toolbarBelowSelection ? '0' : '-100%'}) scale(${100 / zoom})` }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
          >
            {selectedShapes.some((shape) => shape.textBox || !!shape.text) && <>
              <Button variant="ghost" size="icon" aria-label={t('Yazı boyutunu küçült')} title={t('Yazı boyutunu küçült')} onClick={() => onExecute({ type: 'custom', name: 'format.shrink', params: {} })}>A−</Button>
              <Button variant="ghost" size="icon" aria-label={t('Yazı boyutunu büyüt')} title={t('Yazı boyutunu büyüt')} onClick={() => onExecute({ type: 'custom', name: 'format.grow', params: {} })}>A+</Button>
              <span className="selection-toolbar__divider" aria-hidden="true" />
              <Button variant="ghost" size="icon" aria-label={t('Hızlı kalın')} title={t('Hızlı kalın')} onClick={() => onExecute({ type: 'custom', name: 'format.bold', params: {} })}><strong>B</strong></Button>
              <Button variant="ghost" size="icon" aria-label={t('Hızlı italik')} title={t('Hızlı italik')} onClick={() => onExecute({ type: 'custom', name: 'format.italic', params: {} })}><em>I</em></Button>
              <Button variant="ghost" size="icon" aria-label={t('Altı çizili')} title={t('Altı çizili')} onClick={() => onExecute({ type: 'custom', name: 'format.underline', params: {} })}><u>U</u></Button>
              <select className="selection-toolbar__font-size" aria-label={t('Yazı boyutu')} value={commonFontSize} onChange={(event) => { const size = Number(event.currentTarget.value); if (size > 0) onExecute({ type: 'custom', name: 'format.size', params: { size } }) }}><option value="">{selectedFontSizes.some(Boolean) ? t('Karışık') : t('Punto')}</option>{['8', '10', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '60', '72'].map((size) => <option key={size} value={size}>{size}</option>)}</select>
              <select className="selection-toolbar__font-family" aria-label={t('Yazı tipi')} value={commonFontFamily} onChange={(event) => { const family = event.currentTarget.value; if (family) onExecute({ type: 'custom', name: 'format.font', params: { family } }) }}><option value="">{selectedFontFamilies.some(Boolean) ? t('Karışık') : t('Yazı tipi')}</option>{fontOptions.map((family) => <option key={family} value={family}>{family}</option>)}</select>
              <select className="selection-toolbar__alignment" aria-label={t('Hizalama')} value={commonParagraphAlignment} onChange={(event) => { const align = event.currentTarget.value; if (align) onExecute({ type: 'custom', name: 'format.align', params: { align } }) }}><option value="">{selectedParagraphAlignments.some(Boolean) ? t('Karışık') : t('Hizalama')}</option><option value="left">{t('Sol')}</option><option value="center">{t('Orta')}</option><option value="right">{t('Sağ')}</option><option value="justify">{t('İki yana yasla')}</option></select>
              <select className="selection-toolbar__spacing" aria-label={t('Karakter aralığı')} value={commonCharacterSpacing} onChange={(event) => { const pt = Number(event.currentTarget.value); if (Number.isFinite(pt)) onExecute({ type: 'custom', name: 'format.spacing', params: { pt } }) }}><option value="">{selectedCharacterSpacings.length ? t('Karışık') : t('Karakter aralığı')}</option>{commonCharacterSpacing && ![-3, -1.5, 0, 1.5, 3, 6].some((pt) => String(pt) === commonCharacterSpacing) && <option value={commonCharacterSpacing}>{commonCharacterSpacing} pt</option>}<option value="-3">−3 pt</option><option value="-1.5">−1,5 pt</option><option value="0">0 pt</option><option value="1.5">1,5 pt</option><option value="3">3 pt</option><option value="6">6 pt</option></select>
              <select className="selection-toolbar__spacing" aria-label={t('Satır aralığı')} value={commonLineSpacingKey} onChange={(event) => { const [kind, value] = event.currentTarget.value.split(':'); const number = Number(value); if (kind === 'pct' && Number.isFinite(number)) onExecute({ type: 'custom', name: 'format.lineSpacing', params: { lines: number } }) }}><option value="">{selectedLineSpacingKeys.length ? t('Karışık') : t('Satır aralığı')}</option>{commonLineSpacingKey && !lineSpacingPresets.includes(commonLineSpacingKey) && <option value={commonLineSpacingKey}>{commonLineSpacingKey.startsWith('pt:') ? `${commonLineSpacingKey.slice(3)} pt` : `${commonLineSpacingKey.slice(4)}×`}</option>}{[1, 1.15, 1.5, 2, 2.5, 3].map((lines) => <option key={lines} value={`pct:${lines}`}>{lines}×</option>)}</select>
              <Button variant="ghost" size="icon" aria-label={t('Madde işaretlerini aç veya kapat')} title={t('Madde işaretlerini aç veya kapat')} onClick={() => onExecute({ type: 'custom', name: 'format.bullets', params: {} })}>•</Button>
              <Button variant="ghost" size="icon" aria-label={t('Numaralı listeyi aç veya kapat')} title={t('Numaralı listeyi aç veya kapat')} onClick={() => onExecute({ type: 'custom', name: 'format.numbering', params: {} })}>1.</Button>
              <label className="selection-toolbar__color selection-toolbar__color--text" title={t('Yazı rengi')}><span aria-hidden="true">A</span><input type="color" aria-label={t('Yazı rengi')} defaultValue="#111827" onChange={(event) => onExecute({ type: 'custom', name: 'format.color', params: { color: event.currentTarget.value } })} /></label>
              <span className="selection-toolbar__divider" aria-hidden="true" />
            </>}
            {!textOnlySelection && selectedShapes.length === 1 && !selectedShapes[0]?.locked && !selectedShapes[0]?.pictureCrop && !selectedShapes[0]?.chart && !selectedShapes[0]?.table && <select aria-label={t('Şekil türü')} value={selectedShapes[0]?.preset ?? ''} onChange={(event) => onExecute({ type: 'custom', name: 'shape.change', params: { ids: [Number(selectedShapes[0]!.id)], preset: event.currentTarget.value } })}><option value="" disabled>{t('Şekil türü')}</option>{shapePresets.map(({ name, label }) => <option key={name} value={name}>{t(label)}</option>)}</select>}
            {!textOnlySelection && !selectedShapes.every((shape) => !!shape.pictureCrop) && <label className="selection-toolbar__color selection-toolbar__color--fill" title={t('Dolgu rengi')}><span aria-hidden="true" /><input type="color" aria-label={t('Dolgu rengi')} defaultValue="#ff6b3d" onChange={(event) => onExecute({ type: 'custom', name: 'shape.fill', params: { ids: selectedShapes.map((shape) => Number(shape.id)), color: event.currentTarget.value } })} /></label>}
            {!textOnlySelection && <label className="selection-toolbar__opacity" title={t('Saydamlık')}><span>{t('Saydamlık')}</span><input type="range" min="0" max="100" value={selectedOpacity} aria-label={t('Saydamlık')} onPointerDown={(event) => { event.stopPropagation(); opacityGestureOpenRef.current = true }} onChange={(event) => { opacityGestureOpenRef.current = true; onExecute({ type: 'custom', name: 'folio.elementOpacity', params: { ids: selectedShapes.map((shape) => Number(shape.id)), opacity: Number(event.currentTarget.value) / 100 } }) }} onPointerUp={() => { if (opacityGestureOpenRef.current) { opacityGestureOpenRef.current = false; onExecute({ type: 'custom', name: 'folio.elementOpacityEnd', params: { ids: selectedShapes.map((shape) => Number(shape.id)), opacity: Number(selectedOpacity) / 100 } }) } }} onKeyUp={() => { if (opacityGestureOpenRef.current) { opacityGestureOpenRef.current = false; onExecute({ type: 'custom', name: 'folio.elementOpacityEnd', params: { ids: selectedShapes.map((shape) => Number(shape.id)), opacity: Number(selectedOpacity) / 100 } }) } }} onBlur={() => { if (opacityGestureOpenRef.current) { opacityGestureOpenRef.current = false; onExecute({ type: 'custom', name: 'folio.elementOpacityEnd', params: { ids: selectedShapes.map((shape) => Number(shape.id)), opacity: Number(selectedOpacity) / 100 } }) } }} /></label>}
            {selectedShapes.length > 1 && <Button variant="ghost" size="icon" aria-label={t('Grupla')} title={t('Grupla')} onClick={() => onExecute({ type: 'custom', name: 'arrange.group', params: {} })}><Icon name="layers" /></Button>}
            {selectedShapes.length === 1 && selectedShapes[0]?.group && <Button variant="ghost" size="icon" aria-label={t('Grubu çöz')} title={t('Grubu çöz')} onClick={() => onExecute({ type: 'custom', name: 'arrange.ungroup', params: {} })}><Icon name="layers" /></Button>}
            <Button variant="ghost" size="icon" aria-label={t('Çoğalt')} title={t('Çoğalt')} onClick={() => onExecute({ type: 'custom', name: 'edit.duplicate', params: {} })}><Icon name="copy" /></Button>
            <Button variant="ghost" size="icon" aria-label={t('Sil')} title={t('Sil')} onClick={() => onExecute({ type: 'custom', name: 'edit.delete', params: {} })}><Icon name="trash" /></Button>
          </div>}
          <div ref={dimensionTooltipRef} className="engine-transform-tooltip engine-transform-tooltip--dimension" aria-hidden="true" />
          <div ref={rotationTooltipRef} className="engine-transform-tooltip engine-transform-tooltip--rotation" aria-hidden="true" />
          {editingShape?.rect && <textarea
            key={editingShape.id}
            ref={textInputRef}
            className="engine-text-input"
            aria-label={t('Slayt metnini düzenle')}
            defaultValue={editingShape.text ?? ''}
            spellCheck={false}
            style={{ left: editingShape.rect[0], top: editingShape.rect[1], width: editingShape.rect[2], height: editingShape.rect[3], transform: `rotate(${editingShape.rotation ?? 0}deg)`, transformOrigin: 'center center', fontFamily: editingShape.fontFamilies?.[0] ?? 'Inter, sans-serif' }}
            onKeyDown={handleTextKeyDown}
            onPaste={handleTextPaste}
            onCopy={handleTextCopy}
            onCut={handleTextCut}
            onPointerDown={handleTextFramePointerDown}
            onPointerMove={handleTextFramePointerMove}
            onPointerUp={handleTextFramePointerUp}
            onPointerCancel={handleTextFramePointerUp}
            onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); void sendPointer({ kind: 'doubleClick', ...canvasPoint(event) }).catch(() => undefined) }}
            onCompositionStart={handleCompositionStart}
            onCompositionUpdate={handleCompositionUpdate}
            onCompositionEnd={handleCompositionEnd}
          />}
          {showProjectedTextCaret && projectedTextCaret && <span className="engine-text-caret" aria-hidden="true" style={textCaretStyle(projectedTextCaret)} />}
        </div>
      </>}</div>
    </div>
    <SlideFilmstrip visible={filmstripVisible} slides={engine.slides} sections={engine.summary?.sections ?? []} activeSlideId={engine.slides[activeSlideIndex]?.id ?? null} onSelectSlide={onSelectSlide} onMoveSlide={onMoveSlide} onAddSlide={(at) => onExecute({ type: 'slide.new', params: { layout: 'blank', at } })} onDuplicateSlide={(index) => { const slide = engine.slides[index]; if (slide) onDuplicateSlide(slide.id) }} onDeleteSlide={(index) => onExecute({ type: 'slide.delete', params: { index } })} onRenameSlide={onRenameSlide} onToggleSlideHidden={onToggleSlideHidden} onSetTransition={onSetTransition} onAddSection={onAddSection} onRenameSection={onRenameSection} onRemoveSection={onRemoveSection} onMoveSection={onMoveSection} onOpenContextMenu={(index, x, y) => setContextMenu({ kind: 'slide', index, x, y })} />
    {contextMenu && <EditorContextMenu target={contextMenu} slideCount={engine.slides.length} onClose={() => setContextMenu(null)} onCommand={onExecute} onToggleGrid={onToggleGrid} onFit={fitToArea} onSlideAction={slideContextAction} />}
    {notesOpen && <section className="notes-panel" aria-label={t('Slayt notları')}><header><strong>{t('Slayt')} {activeSlideNumber} {t('notları')}</strong><Button variant="ghost" size="icon" aria-label={t('Notları kapat')} onClick={() => setNotesOpen(false)} icon={<Icon name="chevron-down" />} /></header><textarea aria-label={t('Slayt notları metni')} value={notesDraft} onChange={(event) => setNotesDraft(event.currentTarget.value)} placeholder={t('Bu slayt için konuşmacı notları yazın…')} /><Button variant="accent" size="sm" onClick={() => onExecute({ type: 'custom', name: 'slide.notes', params: { text: notesDraft, index: activeSlideIndex } })}>{t('Notları kaydet')}</Button></section>}
    <footer className="statusbar">
      <div className="statusbar__left">
        <Button variant="secondary" size="sm" className="statusbar__filmstrip-toggle" onClick={onToggleFilmstrip} aria-label={t(filmstripVisible ? 'Slaytları gizle' : 'Slaytları göster')} title={t(filmstripVisible ? 'Slaytları gizle' : 'Slaytları göster')} aria-pressed={filmstripVisible} icon={<Icon name="chevron-down" />}><span>{t('Slaytlar')}</span></Button>
        <span className="statusbar__slide-count">{t('Sayfa')} {activeSlideNumber} / {engine.slides.length}</span><span className="statusbar__separator" /><span className={`statusbar__save statusbar__save--${autosaveStatus}`} role="status" aria-live="polite"><Icon name={autosaveStatus === 'error' ? 'circle-question-mark' : 'file'} /> {t(autosaveLabels[autosaveStatus])}</span>
      </div>
      <div className="statusbar__right" role="group" aria-label={t('Görünüm kontrolleri')}>
        <Button variant={notesOpen ? 'secondary' : 'ghost'} size="sm" className="statusbar__action" aria-label={t('Notlar')} title={t('Slayt notlarını göster veya gizle')} aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)} icon={<Icon name="message-circle" />}><span className="statusbar__label">{t('Notlar')}</span></Button>
        <Button variant="accent" size="icon" className="statusbar__present" aria-label={t('Sunumu yap')} title={t('Sunumu tam ekranda göster')} onClick={onPresent} iconEffect="pulse" icon={<Icon name="play" />} />
        <span className="statusbar__separator" />
        <Button variant={panMode ? 'secondary' : 'ghost'} size="sm" className="statusbar__action statusbar__hand" aria-label={t(panMode ? 'El aracını kapat' : 'El aracı')} title={t(panMode ? 'Sürükleyerek görünümü taşı' : 'El aracını aç')} aria-pressed={panMode} onClick={() => setPanMode((active) => !active)} icon={<Icon name="hand" />}>{t('El')}</Button>
        <div className="statusbar__zoom" role="group" aria-label={`${t('Yakınlaştırma yüzde')} ${zoom}`}><Button variant="ghost" size="icon" aria-label={t('Uzaklaştır')} onClick={() => setManualZoom(Math.max(10, zoom - 10))}>−</Button><span>%{zoom}</span><Button variant="ghost" size="icon" aria-label={t('Yakınlaştır')} onClick={() => setManualZoom(Math.min(200, zoom + 10))} icon={<Icon name="plus" />} /></div>
        <Button variant="ghost" size="sm" className="statusbar__action statusbar__fit" onClick={fitToArea} icon={<Icon name="presentation" />}><span className="statusbar__label">{t('Ekrana sığdır')}</span></Button>
      </div>
      {(feedback || engine.commandError) && <div className="statusbar__feedback" role="status" aria-live="polite">{engine.commandError ?? feedback}</div>}
    </footer>
  </section>
}

function paintFrame(canvas: HTMLCanvasElement | null, frame: RenderFrame | null, metric: string): void {
  if (!canvas || !frame) return
  if (canvas.width !== frame.width) canvas.width = frame.width
  if (canvas.height !== frame.height) canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) return
  const copyStarted = perfNow()
  const pixelBuffer = frame.pixels.buffer
  const pixels = frame.pixels instanceof Uint8ClampedArray
    ? frame.pixels
    : pixelBuffer instanceof ArrayBuffer
      ? new Uint8ClampedArray(pixelBuffer, frame.pixels.byteOffset, frame.pixels.byteLength)
      : new Uint8ClampedArray(frame.pixels)
  const image = new ImageData(pixels, frame.width, frame.height)
  finishPerf(`${metric}.pixelView`, copyStarted)
  const putStarted = perfNow()
  context.putImageData(image, 0, 0)
  finishPerf(`${metric}.putImageData`, putStarted)
}

function RulerTicks({ direction, length }: { readonly direction: 'horizontal' | 'vertical'; readonly length: number }) {
  return <div className={`ruler-ticks ruler-ticks--${direction}`} aria-hidden="true">
    {Array.from({ length: Math.ceil(length / 100) + 1 }, (_, index) => <span className="ruler-tick" key={index}>
      {index % 2 === 0 && <span className="ruler-tick__label">{index * 100}</span>}
    </span>)}
  </div>
}

function eventSafeRulerX(clientX: number, canvas: DOMRect, textAreaX: number, slideWidth: number): number {
  const relative = (clientX - canvas.left) / canvas.width * slideWidth - textAreaX
  return canvas.left + (textAreaX + Math.max(0, relative)) / slideWidth * canvas.width
}

function RulerTabGlyph({ align }: { readonly align: 'l' | 'ctr' | 'r' | 'dec' }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 2v10M4 9l4 4 4-4" />{align === 'l' ? <path d="M8 13H3" /> : align === 'r' ? <path d="M8 13h5" /> : <path d="M4 13h8" />}{align === 'dec' && <circle cx="12.5" cy="5" r="1" />}</svg>
}

function RulerIndentMarkers({ ruler, canvas, bounds, slideWidth, drag }: { readonly ruler: TextRulerState; readonly canvas: DOMRect; readonly bounds: DOMRect; readonly slideWidth: number; readonly drag: RulerTabDrag | null }) {
  const left = ruler.marginLeft
  const first = left + ruler.indent
  const positions: Array<{ kind: 'first' | 'hanging' | 'left'; q: number }> = [{ kind: 'first', q: first }, { kind: 'hanging', q: left }, { kind: 'left', q: left }]
  return <>{positions.map(({ kind, q }) => {
    const x = drag?.marker === kind ? eventSafeRulerX(drag.currentX, canvas, ruler.x, slideWidth) - bounds.left : canvas.left + (ruler.x + q) / slideWidth * canvas.width - bounds.left
    return <span key={kind} className={`ruler-indent-marker ruler-indent-marker--${kind}${drag?.marker === kind ? ' ruler-indent-marker--dragging' : ''}`} data-indent-kind={kind} aria-hidden="true" style={{ left: `${x}px` }}><svg viewBox="0 0 12 12" focusable="false"><path d={kind === 'first' ? 'M1 1h10L6 7z' : kind === 'hanging' ? 'M1 11h10L6 5z' : 'M2 1v10h8'} /></svg></span>
  })}</>
}

type TextSelectionView = { readonly shape: string; readonly anchor: [number, number]; readonly caret: [number, number] }
function asTextSelection(value: unknown): TextSelectionView | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { shape?: unknown; anchor?: unknown; caret?: unknown }
  const point = (value: unknown): [number, number] | null => {
    if (!Array.isArray(value)) return null
    const [paragraph, character] = value
    return typeof paragraph === 'number' && typeof character === 'number' ? [paragraph, character] : null
  }
  const anchor = point(candidate.anchor)
  const caret = point(candidate.caret)
  if ((typeof candidate.shape !== 'string' && typeof candidate.shape !== 'number') || !anchor || !caret) return null
  return { shape: String(candidate.shape), anchor, caret }
}

function boundsOf(rectangles: readonly [number, number, number, number][]): [number, number, number, number] | null {
  if (!rectangles.length) return null
  const left = Math.min(...rectangles.map(([x]) => x))
  const top = Math.min(...rectangles.map(([, y]) => y))
  const right = Math.max(...rectangles.map(([x, , width]) => x + width))
  const bottom = Math.max(...rectangles.map(([, y, , height]) => y + height))
  return [left, top, right - left, bottom - top]
}

function hitsHiddenTextResizeHandle(shape: { readonly rect: [number, number, number, number] | null; readonly rotation?: number | null }, point: { readonly x: number; readonly y: number }): boolean {
  const rect = shape.rect
  if (!rect) return false
  const [x, y, width, height] = rect
  const centerX = x + width / 2
  const centerY = y + height / 2
  const angle = (shape.rotation ?? 0) * Math.PI / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const hiddenHandles = [
    [x, y], [centerX, y], [x + width, y],
    [x + width, y + height], [centerX, y + height], [x, y + height],
  ] as const
  return hiddenHandles.some(([handleX, handleY]) => {
    const dx = handleX - centerX
    const dy = handleY - centerY
    const worldX = centerX + dx * cos - dy * sin
    const worldY = centerY + dx * sin + dy * cos
    return Math.hypot(worldX - point.x, worldY - point.y) <= 7
  })
}

function resizeCursor(handle: string, rotation: number): string {
  const base = handle.length === 1
    ? (handle === 'n' || handle === 's' ? 90 : 0)
    : (handle === 'nw' || handle === 'se' ? 45 : 135)
  const axis = ((base + rotation) % 180 + 180) % 180
  const nearest = Math.round(axis / 45) % 4
  return (['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const)[nearest]!
}

function rotateCursor(): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><g fill="none" stroke="#ff6f3c" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15.7 7.5A6.2 6.2 0 1 0 16 11"/><path d="M12.8 4.8h3.4v3.4"/></g></svg>'
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 10 10, crosshair`
}

function overflowMask(margin: number, slideWidth: number, slideHeight: number): string {
  const width = slideWidth + margin * 2
  const height = slideHeight + margin * 2
  const path = `M0 0H${width}V${height}H0Z M${margin} ${margin}H${margin + slideWidth}V${margin + slideHeight}H${margin}Z`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="white" fill-rule="evenodd" d="${path}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

function caretOffset(text: string, caret: [number, number]): number {
  const paragraphs = text.split('\n')
  let offset = 0
  for (let index = 0; index < Math.min(caret[0], paragraphs.length); index += 1) offset += (paragraphs[index]?.length ?? 0) + 1
  const paragraph = paragraphs[caret[0]] ?? ''
  return offset + Array.from(paragraph).slice(0, caret[1]).join('').length
}

function textPositionAtOffset(text: string, offset: number): [number, number] {
  const prefix = text.slice(0, offset)
  const lines = prefix.split('\n')
  return [lines.length - 1, Array.from(lines.at(-1) ?? '').length]
}

function textCaretStyle([startX, startY, endX, endY]: [number, number, number, number]): React.CSSProperties {
  const dx = endX - startX
  const dy = endY - startY
  return {
    left: startX,
    top: startY,
    height: Math.max(1, Math.hypot(dx, dy)),
    // The engine endpoints run from the caret's top to bottom; CSS height already
    // points down, so rotate by the angle from the vertical axis.
    transform: `rotate(${Math.atan2(dy, dx) - Math.PI / 2}rad)`,
  }
}
