import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { SlideId } from '@folio/engine-adapter'
import type { EngineSlideView } from '../../features/engine/editorEngine'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { EngineFrame } from './EngineFrame'
import { useLocale } from '../../features/localization/locale'

type Props = {
  readonly visible: boolean
  readonly slides: readonly EngineSlideView[]
  readonly sections: ReadonlyArray<{ name: string; slideIds: readonly SlideId[] }>
  readonly activeSlideId: SlideId | null
  readonly onSelectSlide: (slide: SlideId) => void
  readonly onMoveSlide: (from: number, to: number) => void
  readonly onAddSlide: (at: number) => void
  readonly onDuplicateSlide: (index: number) => void
  readonly onDeleteSlide: (index: number) => void
  readonly onRenameSlide: (index: number, name: string) => void
  readonly onToggleSlideHidden: (index: number, hidden: boolean) => void
  readonly onSetTransition: (index: number) => void
  readonly onAddSection: (index: number, name: string) => void
  readonly onRenameSection: (index: number, name: string) => void
  readonly onRemoveSection: (index: number, withSlides: boolean) => void
  readonly onMoveSection: (index: number, to: number) => void
  readonly onOpenContextMenu: (index: number, x: number, y: number) => void
}

/** Filmstrip visuals stay local; slide identity and ordering come only from Rust Session projections. */
export function SlideFilmstrip({ visible, slides, sections, activeSlideId, onSelectSlide, onMoveSlide, onAddSlide, onDuplicateSlide, onDeleteSlide, onRenameSlide, onToggleSlideHidden, onSetTransition, onAddSection, onRenameSection, onRemoveSection, onMoveSection, onOpenContextMenu }: Props) {
  const { t } = useLocale()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [sectionMenuSlide, setSectionMenuSlide] = useState<number | null>(null)
  const [sectionDraft, setSectionDraft] = useState('')
  const [sectionCreateAt, setSectionCreateAt] = useState<number | null>(null)
  const [confirmSectionDelete, setConfirmSectionDelete] = useState(false)
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
  }, [updateEdges, slides.length])

  const scroll = (direction: -1 | 1) => {
    const items = itemsRef.current
    if (!items) return
    items.scrollBy({ left: direction * Math.max(180, items.clientWidth * 0.72), behavior: 'smooth' })
  }

  const sectionAt = (index: number) => sections.findIndex((section) => section.slideIds.includes(slides[index]?.id))
  const manageSection = (index: number) => {
    const sectionIndex = sectionAt(index)
    const section = sections[sectionIndex]
    const previousSectionIndex = index > 0 ? sectionAt(index - 1) : -1
    const startsSection = sectionIndex >= 0 && sectionIndex !== previousSectionIndex
    setSectionCreateAt(sectionIndex < 0 || !startsSection ? index : null)
    setSectionDraft(sectionIndex >= 0 && startsSection ? section?.name ?? '' : t('Yeni bölüm'))
    setConfirmSectionDelete(false)
    setSectionMenuSlide((current) => current === index ? null : index)
  }
  const saveSectionName = (index: number) => {
    const name = sectionDraft.trim()
    if (!name) return
    const sectionIndex = sectionAt(index)
    if (sectionCreateAt !== null) onAddSection(sectionCreateAt, name)
    else onRenameSection(sectionIndex, name)
    setSectionMenuSlide(null)
    setSectionCreateAt(null)
  }

  return <div className="filmstrip" aria-label={t('Slayt şeridi')} aria-hidden={!visible} inert={!visible}>
    <Button variant="secondary" size="icon" className={`filmstrip__scroll filmstrip__scroll--left${edges.left ? '' : ' filmstrip__scroll--hidden'}`} onClick={() => scroll(-1)} aria-label={t('Slaytları sola kaydır')} tabIndex={edges.left ? 0 : -1} icon={<Icon name="chevron-right" />} />
    <div className="filmstrip__items" ref={itemsRef} onScroll={updateEdges} aria-label={`${slides.length} ${t('slayt önizlemesi')}`}>
      {slides.map((slide, index) => {
        const isActive = activeSlideId === slide.id
        const currentSectionIndex = sectionAt(index)
        const previousSectionIndex = index > 0 ? sectionAt(index - 1) : -1
        const startsSection = currentSectionIndex >= 0 && currentSectionIndex !== previousSectionIndex
        return <div
          className={`filmstrip__entry${isActive ? ' filmstrip__entry--active' : ''}${slide.hidden ? ' filmstrip__entry--hidden' : ''}${draggedId === slide.id ? ' filmstrip__entry--dragging' : ''}${dropTargetId === slide.id ? ' filmstrip__entry--drop-target' : ''}`}
          data-slide-hidden={slide.hidden ? 'true' : 'false'}
          key={slide.id}
          data-slide-id={slide.id}
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
            const from = slides.findIndex((item) => item.id === sourceId)
            const to = from >= 0 && from < index ? index - 1 : index
            if (from >= 0 && from !== to) onMoveSlide(from, to)
            setDraggedId(null)
            setDropTargetId(null)
          }}
          onDragEnd={() => { setDraggedId(null); setDropTargetId(null) }}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onOpenContextMenu(index, event.clientX, event.clientY) }}
        >
          <div className="slide-card-frame">
            <div className="slide-section-label"><span>{startsSection ? sections[currentSectionIndex]?.name : ''}</span><Button variant="ghost" size="icon" aria-label={`${startsSection ? sections[currentSectionIndex]?.name : `${index + 1}. ${t('Slayt')}`} ${t('bölüm seçenekleri')}`} aria-expanded={sectionMenuSlide === index} onClick={() => manageSection(index)} icon={<Icon name={startsSection ? 'ellipsis' : 'layers'} />} />
              {sectionMenuSlide === index && <section className="slide-section-popover" aria-label={t('Bölüm seçenekleri')} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <label>{t(sectionCreateAt !== null ? 'Yeni bölüm adı' : 'Bölüm adı')}<input autoFocus value={sectionDraft} onChange={(event) => setSectionDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveSectionName(index); if (event.key === 'Escape') setSectionMenuSlide(null) }} /></label>
                <Button variant="accent" size="sm" disabled={!sectionDraft.trim()} onClick={() => saveSectionName(index)}>{t(sectionCreateAt !== null ? 'Bölüm oluştur' : 'Adı kaydet')}</Button>
                {startsSection && sectionCreateAt === null && index < slides.length - 1 && <Button variant="ghost" size="sm" onClick={() => { setSectionCreateAt(index + 1); setSectionDraft(t('Yeni bölüm')); setConfirmSectionDelete(false) }}>{t('Sonraki slayttan yeni bölüm başlat')}</Button>}
                {startsSection && sectionCreateAt === null && !confirmSectionDelete && <div className="slide-section-popover__actions"><div className="slide-section-popover__move"><Button variant="secondary" size="sm" disabled={currentSectionIndex <= 0} aria-label={`${sections[currentSectionIndex]?.name} ${t('bölümünü sola taşı')}`} onClick={() => { onMoveSection(currentSectionIndex, currentSectionIndex - 1); setSectionMenuSlide(null) }}>←</Button><Button variant="secondary" size="sm" disabled={currentSectionIndex >= sections.length - 1} aria-label={`${sections[currentSectionIndex]?.name} ${t('bölümünü sağa taşı')}`} onClick={() => { onMoveSection(currentSectionIndex, currentSectionIndex + 1); setSectionMenuSlide(null) }}>→</Button></div><Button variant="ghost" size="sm" onClick={() => { onRemoveSection(currentSectionIndex, false); setSectionMenuSlide(null) }}>{t('Bölümü kaldır')}</Button><Button variant="ghost" size="sm" onClick={() => setConfirmSectionDelete(true)}>{t('Bölümü ve slaytları sil…')}</Button></div>}
                {startsSection && confirmSectionDelete && <div className="slide-section-popover__confirm"><p>{t('Bu bölümdeki slaytlar kalıcı olarak silinecek.')}</p><Button variant="secondary" size="sm" onClick={() => setConfirmSectionDelete(false)}>{t('İptal')}</Button><Button variant="danger" size="sm" onClick={() => { onRemoveSection(currentSectionIndex, true); setSectionMenuSlide(null) }}>{t('Sil ve devam et')}</Button></div>}
              </section>}
            </div>
            <button type="button" className={`slide-card${isActive ? ' slide-card--active' : ''}`} onClick={() => onSelectSlide(slide.id)} aria-label={`${index + 1}. ${t('slaytı seç')}: ${slide.title}. ${t('Silmek için Delete, çoğaltmak için Ctrl veya Command D, sıralamak için sürükleyin.')}`} title={t('Silmek için Delete, çoğaltmak için Ctrl veya Command D, sıralamak için sürükleyin.')} aria-pressed={isActive}>
              <span className="slide-card__index">{index + 1}</span>
              <EngineFrame frame={slide.thumbnail} className="slide-card__preview" label={`${slide.title} ${t('slayt önizlemesi')}`} />
              {renamingId === slide.id ? <input className="slide-card__label slide-card__rename" aria-label={t('Slayt adını değiştir')} value={renameDraft} autoFocus onClick={(event) => event.stopPropagation()} onChange={(event) => setRenameDraft(event.currentTarget.value)} onBlur={() => { if (renameDraft.trim()) onRenameSlide(index, renameDraft.trim()); setRenamingId(null) }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setRenamingId(null); setRenameDraft(slide.title) } }} /> : <span className="slide-card__label" onDoubleClick={(event) => { event.stopPropagation(); setRenameDraft(slide.title); setRenamingId(slide.id) }} title={t('Yeniden adlandırmak için çift tıklayın')}>{slide.title || `${t('Slayt')} ${index + 1}`}</span>}
            </button>
            <div className="slide-card__actions" role="group" aria-label={`${index + 1}. ${t('slayt işlemleri')}`}>
              <Button variant="secondary" size="icon" aria-label={`${index + 1}. ${t('Slaytı çoğalt')}`} title={t('Slaytı çoğalt')} onClick={() => onDuplicateSlide(index)} icon={<Icon name="copy" />} />
              <Button variant="secondary" size="icon" aria-label={`${index + 1}. ${t(slide.hidden ? 'Slaytı göster' : 'Slaytı gizle')}`} title={t(slide.hidden ? 'Slaytı göster' : 'Slaytı gizle')} aria-pressed={Boolean(slide.hidden)} onClick={() => onToggleSlideHidden(index, !slide.hidden)} icon={<Icon name={slide.hidden ? 'eye' : 'eye-off'} />} />
              <Button variant="secondary" size="icon" aria-label={`${index + 1}. ${t('Slaytı sil')}`} title={t(slides.length > 1 ? 'Slaytı sil' : 'Sunumda en az bir slayt kalmalı')} disabled={slides.length <= 1} onClick={() => onDeleteSlide(index)} icon={<Icon name="trash" />} />
            </div>
          </div>
          {index < slides.length - 1 && <div className="slide-gap" aria-label={`${index + 1}. / ${index + 2}. ${t('slayt arası işlemler')}`}>
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__insert" onClick={() => onAddSlide(index + 1)} aria-label={`${index + 2}. ${t('slayttan önce slayt ekle')}`} title={t('Araya yeni slayt ekle')} icon={<Icon name="plus" />} />
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__transition" onClick={() => onSetTransition(index + 1)} aria-label={`${index + 2}. ${t('slayta solma geçişi uygula')}`} title={t('Sonraki slayta solma geçişi uygula')} icon={<Icon name="fast-forward" />} />
            <Button variant="secondary" size="icon" className="slide-gap__button slide-gap__section" onClick={() => manageSection(index + 1)} aria-label={`${index + 2}. ${t('slayttan bölüm başlat')}`} title={t('Sonraki slayttan bölüm başlat veya bölümü yönet')} icon={<Icon name="layers" />} />
          </div>}
        </div>
      })}
      <Button variant="outline" size="icon" className="slide-add" onClick={() => onAddSlide(slides.length)} aria-label={t('Yeni slayt ekle')} title={t('Yeni slayt ekle')} icon={<Icon name="plus" />} />
    </div>
    <Button variant="secondary" size="icon" className={`filmstrip__scroll filmstrip__scroll--right${edges.right ? '' : ' filmstrip__scroll--hidden'}`} onClick={() => scroll(1)} aria-label={t('Slaytları sağa kaydır')} tabIndex={edges.right ? 0 : -1} icon={<Icon name="chevron-right" />} />
  </div>
}
