import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Button } from '../components/Button'

type Props = { readonly zoom: number; readonly onZoomChange: (zoom: number) => void; readonly rulersVisible: boolean; readonly onToggleFilmstrip: () => void; readonly filmstripVisible: boolean }

export function EditorWorkspace({ zoom, onZoomChange, rulersVisible, onToggleFilmstrip, filmstripVisible }: Props) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const slideAreaRef = useRef<HTMLDivElement>(null)
  const autoFitRef = useRef(true)
  const fitZoomRef = useRef(zoom)

  const measureFitZoom = useCallback(() => {
    const area = slideAreaRef.current
    if (!area) return null
    const { width, height } = area.getBoundingClientRect()
    if (width <= 0 || height <= 0) return null

    // Keep a compact 16px breathing room on each side.
    return Math.max(10, Math.min(100, Math.floor(Math.min((width - 32) / 960, (height - 32) / 540) * 100)))
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
    const area = slideAreaRef.current
    if (!area) return

    const refit = () => {
      if (!autoFitRef.current) return
      const fitZoom = measureFitZoom()
      if (fitZoom === null) return
      fitZoomRef.current = fitZoom
      onZoomChange(fitZoom)
    }

    refit()
    const observer = new ResizeObserver(refit)
    observer.observe(area)
    return () => observer.disconnect()
  }, [measureFitZoom, onZoomChange])

  const setManualZoom = (nextZoom: number) => {
    autoFitRef.current = false
    onZoomChange(nextZoom)
  }

  return <section className={`workspace${filmstripVisible ? '' : ' workspace--filmstrip-hidden'}`} aria-label="Slayt çalışma alanı">
    <div className={`stage${rulersVisible ? '' : ' stage--no-rulers'}`}>
      {rulersVisible && <><div className="ruler-corner" aria-hidden="true" /><div className="ruler ruler--top" aria-label="Üst cetvel statik görünüm"><RulerTicks direction="horizontal" /></div><div className="ruler ruler--left" aria-label="Sol cetvel statik görünüm"><RulerTicks direction="vertical" /></div></>}
      <div className="slide-area" ref={slideAreaRef}><div className="slide-canvas" style={{ transform: `scale(${zoom / 100})` }} aria-label="Slayt görünümü" /></div>
    </div>
    {filmstripVisible && <Filmstrip />}
    <footer className="statusbar">
      <div className="statusbar__left"><span className="statusbar__slide-count">Slayt önizlemesi · 1 / 3</span><span className="statusbar__separator" /><span className="statusbar__save"><Icon name="cloud" /> Kaydetme kapalı</span><Button variant="ghost" size="sm" className="statusbar__filmstrip-toggle" onClick={onToggleFilmstrip} aria-pressed={filmstripVisible}>{filmstripVisible ? 'Şeridi gizle' : 'Şeridi göster'}</Button></div>
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

function Filmstrip() {
  const slides = ['Başlık', 'İçindekiler', 'Teşekkürler']
  return <div className="filmstrip" aria-label="Slayt şeridi statik önizleme"><div className="filmstrip__items" aria-label="Üç statik slayt önizlemesi">
    {slides.map((label, index) => <div className={`filmstrip__entry${index === 0 ? ' filmstrip__entry--active' : ''}`} key={label}>
      <div className={`slide-card${index === 0 ? ' slide-card--active' : ''}`} tabIndex={0} aria-label={`${index + 1}. slayt: ${label}`}>
        <span className="slide-card__index">{index + 1}</span><div className={`slide-card__preview slide-card__preview--${index + 1}`} /><span className="slide-card__label">{label}</span>
      </div>
      {index < slides.length - 1 && <div className="slide-gap" aria-label={`${index + 1}. ve ${index + 2}. slayt arası işlemler`}>
        <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__insert" disabled aria-label={`${index + 2}. slayttan önce slayt ekle`} title="Slayt ekleme motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="plus" />} />
        <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__transition" disabled aria-label={`${index + 2}. slayt geçişini düzenle`} title="Geçişler motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="fast-forward" />} />
        <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__section" disabled aria-label={`${index + 2}. slayttan bölüm başlat`} title="Bölümler motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="layers" />} />
      </div>}
    </div>)}
    <Button variant="outline" size="icon" className="slide-add" disabled aria-label="Yeni slayt ekleme motor bağlantısını bekliyor" title="Yeni slayt ekleme motor bağlantısıyla etkinleşecek" icon={<Icon name="plus" />} />
  </div></div>
}
