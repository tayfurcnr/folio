import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import type { RenderFrame } from '@folio/engine-adapter'
import { finishPerf, perfNow } from '../../features/engine/perfDiagnostics'

export function EngineFrame({ frame, className, label, style }: { readonly frame: RenderFrame | null; readonly className?: string; readonly label: string; readonly style?: CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !frame) return
    canvas.width = frame.width
    canvas.height = frame.height
    const context = canvas.getContext('2d')
    if (!context) return
    const copyStarted = perfNow()
    const pixels = new Uint8ClampedArray(frame.pixels)
    const image = new ImageData(pixels, frame.width, frame.height)
    const prefix = className === 'slide-overflow' ? 'canvas.overflow' : className === 'slide-canvas' ? 'canvas.active' : 'canvas.thumbnail'
    finishPerf(`${prefix}.pixelCopy`, copyStarted)
    const putStarted = perfNow()
    context.putImageData(image, 0, 0)
    finishPerf(`${prefix}.putImageData`, putStarted)
  }, [frame])
  return <canvas ref={canvasRef} className={className} style={style} aria-label={label} role="img" />
}
