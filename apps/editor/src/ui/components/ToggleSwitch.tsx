import type { ReactNode } from 'react'
import { Button } from './Button.js'

export type ToggleSwitchProps = {
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly ariaLabel: string
  readonly checkedIcon?: ReactNode
  readonly uncheckedIcon?: ReactNode
  readonly className?: string
  readonly disabled?: boolean
  readonly title?: string
}

/** Compact Folio toggle; optional icons are drawn inside the sliding track. */
export function ToggleSwitch({ checked, onChange, ariaLabel, checkedIcon, uncheckedIcon, className = '', disabled = false, title }: ToggleSwitchProps) {
  const classes = ['ui-switch', className].filter(Boolean).join(' ')
  return <Button
    variant="ghost"
    size="md"
    className={classes}
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    title={title}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className="ui-switch__track" data-checked={checked} aria-hidden="true">
      {uncheckedIcon && <span className="ui-switch__icon ui-switch__icon--unchecked">{uncheckedIcon}</span>}
      {checkedIcon && <span className="ui-switch__icon ui-switch__icon--checked">{checkedIcon}</span>}
      <span className="ui-switch__thumb" />
    </span>
  </Button>
}
