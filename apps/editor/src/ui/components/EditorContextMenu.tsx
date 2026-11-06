import { useEffect, useLayoutEffect, useRef } from 'react'
import type { EngineCommand } from '@folio/engine-adapter'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import { useLocale } from '../../features/localization/locale'

export type ContextMenuTarget =
  | { readonly kind: 'canvas'; readonly x: number; readonly y: number }
  | { readonly kind: 'object'; readonly x: number; readonly y: number; readonly locked?: boolean; readonly selectionCount: number }
  | { readonly kind: 'slide'; readonly x: number; readonly y: number; readonly index: number }

type ContextAction = 'grid' | 'fit' | 'duplicate-slide' | 'delete-slide' | 'new-before' | 'move-left' | 'move-right'
type Item = { readonly label: string; readonly icon: IconName; readonly command?: EngineCommand; readonly action?: ContextAction; readonly disabled?: boolean; readonly separator?: false } | { readonly separator: true }
type Props = { readonly target: ContextMenuTarget; readonly slideCount: number; readonly onClose: () => void; readonly onCommand: (command: EngineCommand) => void; readonly onToggleGrid: () => void; readonly onFit: () => void; readonly onSlideAction: (action: ContextAction, index: number) => void }

export function EditorContextMenu({ target, slideCount, onClose, onCommand, onToggleGrid, onFit, onSlideAction }: Props) {
  const { t } = useLocale()
  const menuRef = useRef<HTMLDivElement>(null)
  const focusReturnRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const entries: Item[] = target.kind === 'object' ? [
    { label: 'Kes', icon: 'line-segment', command: { type: 'edit.cut' } },
    { label: 'Kopyala', icon: 'copy', command: { type: 'edit.copy' } },
    { label: 'Yapıştır', icon: 'clipboard', command: { type: 'edit.paste' } },
    { label: 'Çoğalt', icon: 'copy', command: { type: 'custom', name: 'edit.duplicate', params: {} } },
    { label: 'Sil', icon: 'trash', command: { type: 'edit.delete' } },
    { separator: true },
    { label: 'En öne getir', icon: 'layers', command: { type: 'custom', name: 'arrange.bringToFront', params: {} } },
    { label: 'En arkaya gönder', icon: 'layers', command: { type: 'custom', name: 'arrange.sendToBack', params: {} } },
    { label: target.locked ? 'Kilidi aç' : 'Kilitle', icon: 'lock', command: { type: 'custom', name: 'shape.lock', params: { locked: !target.locked } } },
    ...(target.selectionCount > 1 ? [
      { separator: true } as const,
      ...([['Sola hizala', 'left'], ['Ortala', 'center'], ['Sağa hizala', 'right'], ['Üste hizala', 'top'], ['Dikey ortala', 'middle'], ['Alta hizala', 'bottom']] as const).map(([label, edge]) => ({ label, icon: 'align-left' as const, command: { type: 'custom' as const, name: 'arrange.align', params: { edge, to: 'selection' } } })),
    ] : []),
  ] : target.kind === 'canvas' ? [
    { label: 'Yapıştır', icon: 'clipboard', command: { type: 'edit.paste' } },
    { label: 'Tümünü seç', icon: 'shapes', command: { type: 'edit.selectAll' } },
    { separator: true },
    { label: 'Yeni slayt', icon: 'plus', action: 'new-before' },
    { label: 'Izgara', icon: 'layout-template', action: 'grid' },
    { label: 'Ekrana sığdır', icon: 'presentation', action: 'fit' },
  ] : [
    { label: 'Yeni slayt ekle', icon: 'plus', action: 'new-before' },
    { label: 'Slaytı çoğalt', icon: 'copy', action: 'duplicate-slide' },
    { label: 'Slaytı sil', icon: 'trash', action: 'delete-slide' },
    { separator: true },
    { label: 'Sola taşı', icon: 'arrow-up-right', action: 'move-left', disabled: target.index <= 0 },
    { label: 'Sağa taşı', icon: 'arrow-up-right', action: 'move-right', disabled: target.index >= slideCount - 1 },
    { separator: true },
    { label: 'Başlık düzeni', icon: 'layout-template', command: { type: 'custom', name: 'slide.layout', params: { layout: 'title', index: target.index } } },
    { label: 'Başlık ve içerik düzeni', icon: 'layout-template', command: { type: 'custom', name: 'slide.layout', params: { layout: 'titleAndContent', index: target.index } } },
    { label: 'Boş düzen', icon: 'layout-template', command: { type: 'custom', name: 'slide.layout', params: { layout: 'blank', index: target.index } } },
  ]

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8))}px`
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [target])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) onClose() }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); focusReturnRef.current?.focus({ preventScroll: true }); return }
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
      const index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
      if (next >= 0 && items.length) { event.preventDefault(); items[next]?.focus() }
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('pointerdown', onPointerDown, true); window.removeEventListener('keydown', onKeyDown) }
  }, [onClose])

  const invoke = (item: Item) => {
    if (item.separator) return
    onClose()
    if (item.command) onCommand(item.command)
    else if (item.action === 'grid') onToggleGrid()
    else if (item.action === 'fit') onFit()
    else if (item.action) onSlideAction(item.action, target.kind === 'slide' ? target.index : 0)
  }

  return <div ref={menuRef} className="editor-context-menu" role="menu" aria-label={t('Bağlam menüsü')}>
    {entries.map((item, index) => item.separator
      ? <div key={`separator-${index}`} className="editor-context-menu__separator" role="separator" />
      : <Button key={`${item.label}-${index}`} variant="menu-item" size="sm" role="menuitem" tabIndex={-1} disabled={item.disabled || (target.kind === 'slide' && item.action === 'delete-slide' && slideCount <= 1)} onClick={() => invoke(item)} icon={<Icon name={item.icon} />}>{t(item.label)}</Button>)}
  </div>
}
