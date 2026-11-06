import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { ToggleSwitch } from '../components/ToggleSwitch'
import type { EngineCommand } from '@folio/engine-adapter'
import { useLocale } from '../../features/localization/locale'
import type { RecentPresentation } from '../../features/engine/documentAutosave'

type MenuName = 'file' | 'edit' | 'view'
type MenuDefinition = { readonly label: string; readonly icon: IconName; readonly items: readonly string[] }

const menuItems: Record<MenuName, MenuDefinition> = {
  file: { label: 'Dosya', icon: 'file', items: ['Yeni sunum', 'Sunum aç…', 'Kaydet', 'Kopyasını kaydet'] },
  edit: { label: 'Düzenle', icon: 'settings-2', items: ['Kes', 'Kopyala', 'Yapıştır', 'Çoğalt', 'Sil', 'Tümünü seç'] },
  view: { label: 'Görünüm', icon: 'presentation', items: ['Cetveller', 'Izgara', 'Izgaraya yasla'] },
}

type Props = {
  readonly colorMode: 'light' | 'dark'
  readonly rulersVisible: boolean
  readonly gridVisible: boolean
  readonly gridSnapEnabled: boolean
  readonly onColorModeChange: (mode: 'light' | 'dark') => void
  readonly onToggleRulers: () => void
  readonly onToggleGrid: () => void
  readonly onToggleGridSnap: () => void
  readonly onCommand: (command: EngineCommand) => void
  readonly onNewPresentation: () => void
  readonly onOpenPresentation: () => void
  readonly onSavePresentation: (copy: boolean) => void
  readonly recentPresentations: readonly RecentPresentation[]
  readonly onOpenRecentPresentation: (documentId: string) => void
  readonly hasSelection: boolean
}

export function EditorMenus({ colorMode, rulersVisible, gridVisible, gridSnapEnabled, onColorModeChange, onToggleRulers, onToggleGrid, onToggleGridSnap, onCommand, onNewPresentation, onOpenPresentation, onSavePresentation, recentPresentations, onOpenRecentPresentation, hasSelection }: Props) {
  const { locale, setLocale, t } = useLocale()
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenMenu(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpenMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [])

  return <nav className="topbar__menus" aria-label={t('Ana menü')} ref={rootRef}>
    {(Object.keys(menuItems) as MenuName[]).map((key) => {
      const menu = menuItems[key]
      return <div className="menu-wrap" key={key}>
        <Button
          variant="ghost"
          size="md"
          className={`menu-trigger${openMenu === key ? ' is-open' : ''}`}
          aria-expanded={openMenu === key}
          aria-haspopup="menu"
          onClick={() => setOpenMenu(openMenu === key ? null : key)}
          iconEffect="shake"
          icon={<Icon name={menu.icon} />}
        ><span>{t(menu.label)}</span><Icon name="chevron-down" className="menu-trigger__chevron" /></Button>
        {openMenu === key && <div className="menu-popover" role="menu" aria-label={t(menu.label)}>
          {menu.items.map((item) => ['Cetveller', 'Izgara', 'Izgaraya yasla'].includes(item) ? <div key={item} className="menu-popover__item--toggle" role="group" aria-label={`${t(item)} ayarı`}>
            <Icon name={item === 'Cetveller' ? 'ruler' : 'layout-template'} /><span>{t(item)}</span><ToggleSwitch checked={item === 'Cetveller' ? rulersVisible : item === 'Izgara' ? gridVisible : gridSnapEnabled} onChange={item === 'Cetveller' ? onToggleRulers : item === 'Izgara' ? onToggleGrid : onToggleGridSnap} ariaLabel={t(item)} />
          </div> : <Button
            key={item}
            variant="menu-item"
            size="sm"
            role="menuitem"
            disabled={key !== 'file' && !menuAction(key, item, hasSelection)}
            onClick={() => {
              const action = menuAction(key, item, hasSelection)
              if (action === 'new-presentation') onNewPresentation()
              else if (key === 'file' && item === 'Sunum aç…') onOpenPresentation()
              else if (key === 'file' && item === 'Kaydet') onSavePresentation(false)
              else if (key === 'file' && item === 'Kopyasını kaydet') onSavePresentation(true)
              else if (action) onCommand(action)
              setOpenMenu(null)
            }}
            icon={<Icon name={menuItemIcon(key, item)} />}
          ><span>{t(item)}</span></Button>)}
          {key === 'file' && recentPresentations.length > 0 && <div className="menu-popover__recent" aria-label={t('Son sunumlar')}>
            <span className="menu-popover__recent-heading">{t('Son sunumlar')}</span>
            {recentPresentations.map((presentation) => <Button key={presentation.documentId} variant="menu-item" size="sm" role="menuitem" title={presentation.title} onClick={() => { onOpenRecentPresentation(presentation.documentId); setOpenMenu(null) }} icon={<Icon name="file" />}><span>{presentation.title}</span></Button>)}
          </div>}
          {key === 'view' && <div className="menu-popover__appearance">
            <div className="menu-popover__appearance-label"><Icon name="palette" /><span>{t('Arayüz görünümü')}</span></div>
            <ToggleSwitch
              checked={colorMode === 'dark'}
              onChange={(dark) => onColorModeChange(dark ? 'dark' : 'light')}
              ariaLabel={t('Koyu görünüm')}
              title={t('Açık ve koyu görünüm arasında geçiş yap')}
              uncheckedIcon={<Icon name="sun" />}
              checkedIcon={<Icon name="moon" />}
            />
          </div>}
          {key === 'view' && <div className="menu-popover__language" role="group" aria-label={t('Arayüz dilini seç')}>
            <span>{t('Arayüz dilini seç')}</span>
            <div><Button variant={locale === 'tr' ? 'secondary' : 'ghost'} size="sm" aria-pressed={locale === 'tr'} onClick={() => setLocale('tr')}>TR</Button><Button variant={locale === 'en' ? 'secondary' : 'ghost'} size="sm" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>EN</Button></div>
          </div>}
        </div>}
      </div>
    })}
  </nav>
}

function menuItemIcon(menu: MenuName, item: string): IconName {
  if (menu === 'view') return 'ruler'
  if (menu === 'file') {
    if (item === 'Yeni sunum') return 'plus'
    if (item === 'Sunum aç…') return 'file'
    if (item === 'Kaydet') return 'download'
    return 'copy'
  }
  if (item === 'Kes') return 'line-segment'
  if (item === 'Kopyala') return 'copy'
  if (item === 'Yapıştır') return 'clipboard'
  if (item === 'Çoğalt') return 'copy'
  if (item === 'Sil') return 'trash'
  return 'shapes'
}

function menuAction(menu: MenuName, item: string, hasSelection: boolean): EngineCommand | 'new-presentation' | null {
  if (menu === 'file') return item === 'Yeni sunum' ? 'new-presentation' : null
  if (menu !== 'edit') return null
  if (item === 'Kes') return hasSelection ? { type: 'edit.cut' } : null
  if (item === 'Kopyala') return hasSelection ? { type: 'edit.copy' } : null
  if (item === 'Yapıştır') return { type: 'edit.paste' }
  if (item === 'Çoğalt') return hasSelection ? { type: 'custom', name: 'edit.duplicate', params: {} } : null
  if (item === 'Sil') return hasSelection ? { type: 'edit.delete' } : null
  return { type: 'edit.selectAll' }
}
