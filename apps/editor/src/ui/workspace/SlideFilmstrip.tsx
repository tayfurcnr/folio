import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'

type Slide = { readonly id: string; readonly title: string; readonly preview: number }

type Props = {
  readonly visible: boolean
  readonly activeSlide: number
  readonly onSelectSlide: (slide: number) => void
}

const initialSlides: Slide[] = [
  { id: 'title', title: 'Başlık', preview: 1 },
  { id: 'contents', title: 'İçindekiler', preview: 2 },
  { id: 'thanks', title: 'Teşekkürler', preview: 3 },
]

/** Filmstrip interaction shell; slide data will be supplied by the presentation engine. */
export function SlideFilmstrip({ visible, activeSlide, onSelectSlide }: Props) {
  const [slides, setSlides] = useState(initialSlides)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  const itemsRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const updateEdges = useCallback(() => {
    const items = itemsRef.current
    if (!items) return
    setEdges({ left: items.scrollLeft > 1, right: items.scrollLeft + items.clientWidth < items.scrollWidth - 1 })
  }, [])

  useLayoutEffect(() => {
    const items = itemsRef.current
    if (!items) return
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    observer.observe(items)
    return () => observer.disconnect()
  }, [updateEdges])

  const scroll = (direction: -1 | 1) => {
    const items = itemsRef.current
    if (!items) return
    items.scrollBy({ left: direction * Math.max(180, items.clientWidth * 0.72), behavior: 'smooth' })
  }

  const moveSlide = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return
    setSlides((current) => {
      const from = current.findIndex((slide) => slide.id === sourceId)
      const to = current.findIndex((slide) => slide.id === targetId)
      if (from < 0 || to < 0) return current
      const reordered = [...current]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved)
      return reordered
    })
  }

  const activeId = slides[activeSlide - 1]?.id

  return <div className="filmstrip" aria-label="Slayt şeridi statik önizleme" aria-hidden={!visible} inert={!visible}>
    <Button variant="secondary" size="icon" className={`filmstrip__scroll filmstrip__scroll--left${edges.left ? '' : ' filmstrip__scroll--hidden'}`} onClick={() => scroll(-1)} aria-label="Slaytları sola kaydır" tabIndex={edges.left ? 0 : -1} icon={<Icon name="chevron-right" />} />
    <div className="filmstrip__items" ref={itemsRef} onScroll={updateEdges} aria-label="Üç statik slayt önizlemesi">
      {slides.map((slide, index) => {
        const isActive = activeId === slide.id
        return <div
          className={`filmstrip__entry${isActive ? ' filmstrip__entry--active' : ''}${draggedId === slide.id ? ' filmstrip__entry--dragging' : ''}${dropTargetId === slide.id ? ' filmstrip__entry--drop-target' : ''}`}
          key={slide.id}
          draggable
          onDragStart={(event) => {
            setDraggedId(slide.id)
            event.dataTransfer.effectAllowed = 'move'
            event.dataTransfer.setData('text/plain', slide.id)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'move'
            if (draggedId !== slide.id) setDropTargetId(slide.id)
          }}
          onDrop={(event) => {
            event.preventDefault()
            const sourceId = event.dataTransfer.getData('text/plain') || draggedId
            if (sourceId) moveSlide(sourceId, slide.id)
            setDraggedId(null)
            setDropTargetId(null)
          }}
          onDragEnd={() => {
            setDraggedId(null)
            setDropTargetId(null)
          }}
        >
          <button type="button" className={`slide-card${isActive ? ' slide-card--active' : ''}`} onClick={() => onSelectSlide(index + 1)} aria-label={`${index + 1}. slaytı seç: ${slide.title}. Sürükleyerek sıralayın.`} aria-pressed={isActive}>
            <span className="slide-card__index">{index + 1}</span><div className={`slide-card__preview slide-card__preview--${slide.preview}`} /><span className="slide-card__label">{slide.title}</span>
          </button>
          {index < slides.length - 1 && <div className="slide-gap" aria-label={`${index + 1}. ve ${index + 2}. slayt arası işlemler`}>
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__insert" disabled aria-label={`${index + 2}. slayttan önce slayt ekle`} title="Slayt ekleme motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="plus" />} />
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__transition" disabled aria-label={`${index + 2}. slayt geçişini düzenle`} title="Geçişler motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="fast-forward" />} />
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__section" disabled aria-label={`${index + 2}. slayttan bölüm başlat`} title="Bölümler motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="layers" />} />
          </div>}
        </div>
      })}
      <Button variant="outline" size="icon" className="slide-add" disabled aria-label="Yeni slayt ekleme motor bağlantısını bekliyor" title="Yeni slayt ekleme motor bağlantısıyla etkinleşecek" icon={<Icon name="plus" />} />
    </div>
    <Button variant="secondary" size="icon" className={`filmstrip__scroll filmstrip__scroll--right${edges.right ? '' : ' filmstrip__scroll--hidden'}`} onClick={() => scroll(1)} aria-label="Slaytları sağa kaydır" tabIndex={edges.right ? 0 : -1} icon={<Icon name="chevron-right" />} />
  </div>
}
