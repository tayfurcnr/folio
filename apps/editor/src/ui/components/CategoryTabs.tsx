import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { Icon } from './Icon.js'
import { useLocale } from '../../features/localization/locale'

type CategoryTabsProps = {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly items: readonly { readonly value: string; readonly label: string; readonly icon?: ReactElement }[]
  readonly className: string
  readonly panelId?: string
}

export function CategoryTabs({ label, value, onChange, items, className, panelId }: CategoryTabsProps) {
  const { t } = useLocale()
  const layoutId = useId()
  const reducedMotion = useReducedMotion()
  const viewport = useRef<HTMLDivElement>(null)
  const tabs = useRef(new Map<string, HTMLButtonElement>())
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false })

  const updateEdges = useCallback(() => {
    const node = viewport.current
    if (!node) return
    const max = Math.max(0, node.scrollWidth - node.clientWidth)
    const next = { overflow: max > 1, left: node.scrollLeft > 1, right: node.scrollLeft < max - 1 }
    setEdges((current) => current.overflow === next.overflow && current.left === next.left && current.right === next.right ? current : next)
  }, [])

  const reveal = useCallback((node: HTMLButtonElement | null) => {
    const frame = viewport.current
    if (!frame || !node) return
    const bounds = frame.getBoundingClientRect()
    const item = node.getBoundingClientRect()
    const max = Math.max(0, frame.scrollWidth - frame.clientWidth)
    const left = bounds.left + (frame.scrollLeft > 1 ? 34 : 0)
    const right = bounds.right - (frame.scrollLeft < max - 1 ? 34 : 0)
    const delta = item.left < left ? item.left - left : item.right > right ? item.right - right : 0
    if (delta) frame.scrollBy({ left: delta, behavior: reducedMotion ? 'instant' : 'smooth' })
  }, [reducedMotion])

  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(node)
    for (const tab of tabs.current.values()) observer.observe(tab)
    node.addEventListener('scroll', updateEdges, { passive: true })
    updateEdges()
    return () => { observer.disconnect(); node.removeEventListener('scroll', updateEdges) }
  }, [items, updateEdges])

  useLayoutEffect(() => { reveal(tabs.current.get(value) ?? null) }, [value, reveal])

  const scroll = (direction: -1 | 1) => {
    const node = viewport.current
    if (!node) return
    node.scrollBy({ left: direction * node.clientWidth * .75, behavior: reducedMotion ? 'instant' : 'smooth' })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : direction ? (index + direction + items.length) % items.length : -1
    if (target < 0) return
    event.preventDefault()
    const next = items[target]
    if (!next) return
    onChange(next.value)
    tabs.current.get(next.value)?.focus()
  }

  return <LayoutGroup id={layoutId}><div className={`category-tabs category-tabs-native ${className}`} data-overflow={edges.overflow} data-left={edges.left} data-right={edges.right}>
    <div className="category-tabs-native__viewport" ref={viewport} role="tablist" aria-label={t(label)} onFocusCapture={(event) => { if (event.target instanceof HTMLButtonElement) reveal(event.target) }}>
      {items.map((item, index) => <button
        key={item.value}
        ref={(node) => { if (node) tabs.current.set(item.value, node); else tabs.current.delete(item.value) }}
        type="button"
        role="tab"
        id={`${className}-tab-${item.value}`}
        aria-selected={value === item.value}
        aria-controls={panelId ?? `${className}-panel`}
        data-value={item.value}
        data-state={value === item.value ? 'active' : 'inactive'}
        tabIndex={value === item.value ? 0 : -1}
        className="category-tabs-native__tab"
        onClick={() => onChange(item.value)}
        onKeyDown={(event) => handleKeyDown(event, index)}
      >
        {value === item.value && <motion.span className="category-tabs-native__selection" layoutId={`category-tab-selection-${layoutId}`} transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 38 }} aria-hidden="true" />}
        {item.icon && <span className="category-tabs-native__icon" aria-hidden="true">{item.icon}</span>}
        <span className="category-tabs-native__label">{t(item.label)}</span>
      </button>)}
    </div>
    {edges.overflow && <>
      <button className="category-tabs-native__scroll category-tabs-native__scroll--left" type="button" aria-label={t('Filtreleri sola kaydır')} disabled={!edges.left} onClick={() => scroll(-1)}><Icon name="chevron-right" /></button>
      <button className="category-tabs-native__scroll category-tabs-native__scroll--right" type="button" aria-label={t('Filtreleri sağa kaydır')} disabled={!edges.right} onClick={() => scroll(1)}><Icon name="chevron-right" /></button>
    </>}
  </div></LayoutGroup>
}
