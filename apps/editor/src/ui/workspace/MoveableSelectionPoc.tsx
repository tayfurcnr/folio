import { useLayoutEffect, useRef } from 'react'
import type Moveable from 'moveable'

type GestureKind = 'move' | 'resize' | 'rotate'
type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type WorkspacePointerEvent = {
  readonly currentTarget: HTMLElement
  readonly target: EventTarget | null
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
  readonly buttons?: number
  readonly button?: number
  preventDefault?(): void
  stopPropagation?(): void
}
type MoveableEvent = {
  readonly clientX: number
  readonly clientY: number
  readonly inputEvent?: PointerEvent
  readonly direction?: number[]
}
type Props = {
  readonly enabled: boolean
  readonly geometryKey: string
  readonly onDown: (event: WorkspacePointerEvent) => void
  readonly onMove: (event: WorkspacePointerEvent) => void
  readonly onUp: (event: WorkspacePointerEvent) => void
}

const directions: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export function MoveableSelectionPoc({ enabled, geometryKey, onDown, onMove, onUp }: Props) {
  const markerRef = useRef<HTMLSpanElement>(null)
  const managerRef = useRef<Moveable | null>(null)
  const handlersRef = useRef({ onDown, onMove, onUp })
  handlersRef.current = { onDown, onMove, onUp }

  useLayoutEffect(() => {
    if (!enabled || !markerRef.current) return
    const frame = markerRef.current.parentElement
    const stage = frame?.closest<HTMLElement>('.stage')
    const moveButton = frame?.querySelector<HTMLElement>('.engine-selection__move')
    if (!frame || !stage || !moveButton) return
    const gestureHost = {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    } as unknown as HTMLElement

    let activeKind: GestureKind | null = null
    let activeHandle: ResizeHandle = 'se'
    let manager: Moveable | null = null
    let cancelled = false

    const eventFor = (event: MoveableEvent, kind: GestureKind, buttons: number): WorkspacePointerEvent => {
      const input = event.inputEvent
      const target = markerRef.current
      if (target) {
        target.dataset.engineHandle = kind
        target.className = kind === 'move'
          ? 'moveable-poc-marker engine-selection__move'
          : kind === 'rotate'
            ? 'moveable-poc-marker engine-selection__rotate'
            : `moveable-poc-marker engine-selection__handle engine-selection__handle--${activeHandle}`
      }
      return {
        // Moveable owns the native pointer stream. Avoid stealing pointer capture from its controls.
        currentTarget: gestureHost,
        target,
        // Moveable already forwards every gesture through its own callbacks. A native
        // pointerId would also match EditorWorkspace's window pointer listeners and
        // feed the same mouse gesture into the Rust preview a second time.
        pointerId: -1,
        clientX: event.clientX,
        clientY: event.clientY,
        shiftKey: input?.shiftKey ?? false,
        ctrlKey: input?.ctrlKey ?? false,
        altKey: input?.altKey ?? false,
        metaKey: input?.metaKey ?? false,
        buttons,
        button: 0,
        preventDefault: () => input?.preventDefault(),
        stopPropagation: () => input?.stopPropagation(),
      }
    }
    const begin = (event: MoveableEvent, kind: GestureKind, handle: ResizeHandle = 'se') => {
      activeKind = kind
      activeHandle = handle
      const controlBox = manager?.getControlBoxElement()
      if (controlBox) controlBox.style.visibility = 'hidden'
      handlersRef.current.onDown(eventFor(event, kind, 1))
    }
    const move = (event: MoveableEvent, kind: GestureKind) => {
      if (activeKind === kind) handlersRef.current.onMove(eventFor(event, kind, 1))
    }
    const end = (event: MoveableEvent, kind: GestureKind) => {
      if (activeKind !== kind) return
      handlersRef.current.onUp(eventFor(event, kind, 0))
      activeKind = null
      requestAnimationFrame(() => {
        const currentManager = manager
        if (!currentManager || managerRef.current !== currentManager) return
        currentManager.updateRect()
        currentManager.getControlBoxElement().style.visibility = ''
      })
    }

    void import('moveable').then(({ default: MoveableLibrary }) => {
      if (cancelled) return
      manager = new MoveableLibrary(stage, {
        target: frame,
        container: stage,
        rootContainer: stage,
        dragTarget: moveButton,
        draggable: true,
        resizable: true,
        rotatable: true,
        renderDirections: directions,
        rotationPosition: 'top',
        origin: false,
        useResizeObserver: true,
        useAccuratePosition: true,
        className: 'folio-moveable-poc',
      })
      managerRef.current = manager
      manager.on('dragStart', (event) => {
        if (event.inputEvent?.target instanceof Element && event.inputEvent.target.closest('.moveable-control-box')) return
        begin(event, 'move')
      })
      manager.on('drag', (event) => move(event, 'move'))
      manager.on('dragEnd', (event) => end(event, 'move'))
      manager.on('resizeStart', (event) => {
        const [x = 0, y = 0] = event.direction ?? []
        const handle: ResizeHandle = y < 0 ? (x < 0 ? 'nw' : x > 0 ? 'ne' : 'n')
          : y > 0 ? (x < 0 ? 'sw' : x > 0 ? 'se' : 's')
            : x < 0 ? 'w' : 'e'
        begin(event, 'resize', handle)
      })
      manager.on('resize', (event) => move(event, 'resize'))
      manager.on('resizeEnd', (event) => end(event, 'resize'))
      manager.on('rotateStart', (event) => begin(event, 'rotate'))
      manager.on('rotate', (event) => move(event, 'rotate'))
      manager.on('rotateEnd', (event) => end(event, 'rotate'))
    })

    return () => {
      cancelled = true
      manager?.destroy()
      managerRef.current = null
    }
  }, [enabled])

  useLayoutEffect(() => {
    managerRef.current?.updateRect()
  }, [geometryKey])

  return <span ref={markerRef} className="moveable-poc-marker" style={{ display: 'none' }} aria-hidden="true" />
}
