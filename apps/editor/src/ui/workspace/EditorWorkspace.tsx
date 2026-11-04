import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Button } from '../components/Button'
import { SlideFilmstrip } from './SlideFilmstrip'

type Props = { readonly zoom: number; readonly onZoomChange: (zoom: number) => void; readonly rulersVisible: boolean; readonly onToggleFilmstrip: () => void; readonly filmstripVisible: boolean; readonly activeSlide: number; readonly onSelectSlide: (slide: number) => void }

export function EditorWorkspace({ zoom, onZoomChange, rulersVisible, onToggleFilmstrip, filmstripVisible, activeSlide, onSelectSlide }: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const autoFitRef = useRef(true)
  const fitZoomRef = useRef(zoom)

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
    return Math.max(10, Math.min(100, Math.floor(Math.min(availableWidth / 960, availableHeight / 540) * 100)))
  }, [])

  const fitToArea = useCallback(() => {
    const fitZoom = measureFitZoom()
    if (fitZoom === null) return
    autoFitRef.current = true
    fitZoomRef.current = fitZoom
    onZoomChange(fitZoom)
    setFeedback(`Slayt ekrana sığdırıldı (%${fitZoom}).`)
  }, [measureFitZoom, onZoomChange])

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
  }

  return <section className={`workspace${filmstripVisible ? '' : ' workspace--filmstrip-hidden'}`} aria-label="Slayt çalışma alanı">
      <div className={`stage${rulersVisible ? '' : ' stage--no-rulers'}`} ref={stageRef}>
      {rulersVisible && <><div className="ruler-corner" aria-hidden="true" /><div className="ruler ruler--top" aria-label="Üst cetvel statik görünüm"><RulerTicks direction="horizontal" /></div><div className="ruler ruler--left" aria-label="Sol cetvel statik görünüm"><RulerTicks direction="vertical" /></div></>}
      <div className="slide-area"><div className="slide-canvas" style={{ transform: `scale(${zoom / 100})` }} aria-label="Slayt görünümü" /></div>
    </div>
    <SlideFilmstrip visible={filmstripVisible} activeSlide={activeSlide} onSelectSlide={onSelectSlide} />
    <footer className="statusbar">
      <div className="statusbar__left">
        <Button variant="secondary" size="sm" className="statusbar__filmstrip-toggle" onClick={onToggleFilmstrip} aria-label={filmstripVisible ? 'Slaytları gizle' : 'Slaytları göster'} title={filmstripVisible ? 'Slaytları gizle' : 'Slaytları göster'} aria-pressed={filmstripVisible} icon={<Icon name="chevron-down" />}><span>Slaytlar</span></Button>
        <span className="statusbar__slide-count">Sayfa {activeSlide} / 3</span><span className="statusbar__separator" /><span className="statusbar__save"><Icon name="cloud" /> Kaydetme Kapalı</span>
      </div>
      <div className="statusbar__right" role="group" aria-label="Görünüm kontrolleri">
        <Button variant="ghost" size="sm" className="statusbar__action" aria-label="Notlar" title="Notlar motor bağlantısıyla kullanılabilir olacak" onClick={() => setFeedback('Notlar paneli motor bağlantısını bekliyor.')} icon={<Icon name="message-circle" />}><span className="statusbar__label">Notlar</span></Button>
        <Button variant="accent" size="icon" className="statusbar__present" aria-label="Sunumu yap" title="Sunum modu motor bağlantısını bekliyor" onClick={() => setFeedback('Sunum modu motor bağlantısını bekliyor.')} icon={<Icon name="play" />} />
        <span className="statusbar__separator" />
        <Button variant="ghost" size="sm" className="statusbar__action statusbar__hand" aria-label="El aracı" title="El aracı motor bağlantısıyla etkinleşecek" onClick={() => setFeedback('El aracı motor bağlantısını bekliyor.')} icon={<Icon name="hand" />}>El</Button>
        <div className="statusbar__zoom" role="group" aria-label={`Yakınlaştırma yüzde ${zoom}`}><Button variant="ghost" size="icon" aria-label="Uzaklaştır" onClick={() => setManualZoom(Math.max(10, zoom - 10))}>−</Button><span>%{zoom}</span><Button variant="ghost" size="icon" aria-label="Yakınlaştır" onClick={() => setManualZoom(Math.min(100, zoom + 10))} icon={<Icon name="plus" />} /></div>
        <Button variant="ghost" size="sm" className="statusbar__action statusbar__fit" onClick={fitToArea} icon={<Icon name="presentation" />}><span className="statusbar__label">Ekrana sığdır</span></Button>
      </div>
      {feedback && <div className="statusbar__feedback" role="status">{feedback}</div>}
    </footer>
  </section>
}
function RulerTicks({ direction }: { readonly direction: 'horizontal' | 'vertical' }) {
  return <div className={`ruler-ticks ruler-ticks--${direction}`} aria-hidden="true">
    {Array.from({ length: direction === 'horizontal' ? 14 : 9 }, (_, index) => <span className="ruler-tick" key={index}>
      {index % 2 === 0 && <span className="ruler-tick__label">{index * 100}</span>}
    </span>)}
  </div>
}
