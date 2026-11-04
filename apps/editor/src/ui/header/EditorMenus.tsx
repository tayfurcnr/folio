import { useEffect, useRef, useState } from 'react'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { ToggleSwitch } from '../components/ToggleSwitch'

type MenuName = 'file' | 'edit' | 'view'
type MenuDefinition = { readonly label: string; readonly icon: IconName; readonly items: readonly string[] }

const menuItems: Record<MenuName, MenuDefinition> = {
  file: { label: 'Dosya', icon: 'file', items: ['Yeni sunum', 'Sunum aç…', 'Kaydet', 'Kopyasını kaydet'] },
  edit: { label: 'Düzenle', icon: 'settings-2', items: ['Kes', 'Kopyala', 'Yapıştır'] },
  view: { label: 'Görünüm', icon: 'presentation', items: ['Cetveller'] },
}

type Props = {
  readonly colorMode: 'light' | 'dark'
  readonly rulersVisible: boolean
  readonly onColorModeChange: (mode: 'light' | 'dark') => void
  readonly onToggleRulers: () => void
}

export function EditorMenus({ colorMode, rulersVisible, onColorModeChange, onToggleRulers }: Props) {
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

  return <nav className="topbar__menus" aria-label="Ana menü" ref={rootRef}>
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
        ><span>{menu.label}</span><Icon name="chevron-down" className="menu-trigger__chevron" /></Button>
        {openMenu === key && <div className="menu-popover" role="menu" aria-label={menu.label}>
          {menu.items.map((item) => item === 'Cetveller' ? <div key={item} className="menu-popover__item--toggle" role="group" aria-label="Cetveller ayarı">
            <Icon name="ruler" /><span>{item}</span><ToggleSwitch checked={rulersVisible} onChange={onToggleRulers} ariaLabel="Cetveller" />
          </div> : <Button
            key={item}
            variant="menu-item"
            size="sm"
            role="menuitem"
            disabled={key !== 'view'}
            onClick={() => {
              setOpenMenu(null)
            }}
            icon={<Icon name={menuItemIcon(key, item)} />}
          ><span>{item}</span></Button>)}
          {key === 'view' && <div className="menu-popover__appearance">
            <div className="menu-popover__appearance-label"><Icon name="palette" /><span>Arayüz görünümü</span></div>
            <ToggleSwitch
              checked={colorMode === 'dark'}
              onChange={(dark) => onColorModeChange(dark ? 'dark' : 'light')}
              ariaLabel="Koyu görünüm"
              title="Açık ve koyu görünüm arasında geçiş yap"
              uncheckedIcon={<Icon name="sun" />}
              checkedIcon={<Icon name="moon" />}
            />
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
  return 'clipboard'
}
