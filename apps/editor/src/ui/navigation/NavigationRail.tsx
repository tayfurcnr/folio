import { motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { workspaceSections, type WorkspaceSection } from '../../app/sections'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'

const MotionButton = motion.create(Button)

type Props = { readonly active: WorkspaceSection | null; readonly onSelect: (section: WorkspaceSection) => void }

/** Folio adaptation of ATLAS's Rail: same grouped item slots and bottom actions,
 * with WP1's section order and the Folio brand asset. */
export function NavigationRail({ active, onSelect }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const reducedMotion = useReducedMotion()
  const mobileToggleRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!mobileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMobileOpen(false)
      mobileToggleRef.current?.focus()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  function select(section: WorkspaceSection) {
    onSelect(section)
    setMobileOpen(false)
  }

  return <aside className="rail-column">
    <nav className="rail" aria-label="Editör panelleri" data-mobile-open={mobileOpen}>
      <div className="rail__menu" id="folio-mobile-rail-menu">
        <div className="rail__items">
          {workspaceSections.map((section) => <FloatingRailItem key={section.id} item={{ id: section.id, label: section.label, icon: section.icon as IconName }} reducedMotion={!!reducedMotion} active={active === section.id} onSelect={() => select(section.id)} />)}
        </div>
        <FloatingRailItem item={{ id: 'help', label: 'Yardım', icon: 'circle-question-mark' }} reducedMotion={!!reducedMotion} active={false} onSelect={() => setMobileOpen(false)} bottom />
      </div>
      <Button ref={mobileToggleRef} variant="ghost" size="icon" className="rail__mobile-toggle" aria-label={mobileOpen ? 'Gezinme menüsünü kapat' : 'Gezinme menüsünü aç'} aria-expanded={mobileOpen} aria-controls="folio-mobile-rail-menu" onClick={() => setMobileOpen((open) => !open)} icon={<Icon name="ellipsis" />} />
    </nav>
  </aside>
}

type RailItemData = { readonly id: string; readonly label: string; readonly icon: IconName; readonly command?: string; readonly keepsTextSelection?: boolean }

function FloatingRailItem({ item, reducedMotion, active, onSelect, bottom = false }: {
  readonly item: RailItemData
  readonly reducedMotion: boolean
  readonly active: boolean
  readonly onSelect: () => void
  readonly bottom?: boolean
}) {
  const iconSize = useSpring(useMotionValue(20), { mass: .12, stiffness: 190, damping: 15 })

  function setHoverSize(hovered: boolean): void {
    if (reducedMotion) return
    iconSize.set(hovered ? 30 : 20)
  }

  return <div className={`shell-rail__item-slot rail__item-slot${bottom ? ' shell-rail__bottom rail__item-slot--bottom' : ''}`}>
    <MotionButton
      type="button"
      variant="ghost"
      size="md"
      className={`shell-rail__item rail-item${active ? ' is-active' : ''}`}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      aria-pressed={active}
      data-command={item.command}
      {...(item.keepsTextSelection ? { 'data-keeps-text-selection': '' } : {})}
      data-icon-effect="shake"
      onClick={onSelect}
      onMouseEnter={() => setHoverSize(true)}
      onMouseLeave={() => setHoverSize(false)}
      style={{ width: 64, height: 64 }}
      {...(reducedMotion ? {} : { whileTap: { scale: .94 } })}
    >
      <motion.span className="shell-rail__icon-wrap rail__icon-wrap" style={reducedMotion ? { width: 23, height: 23 } : { width: iconSize, height: iconSize }}>
        <Icon name={item.icon} />
      </motion.span>
      <span className="shell-rail__label rail__label">{item.label}</span>
    </MotionButton>
  </div>
}
