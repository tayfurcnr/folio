import { Button } from './Button.js'
import { Icon } from './Icon.js'

type PanelSearchProps = {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly placeholder: string
  readonly ariaLabel: string
  readonly disabled?: boolean
  readonly filter?: {
    readonly ariaLabel: string
    readonly expanded: boolean
    readonly title: string
    readonly onToggle: () => void
  }
}

export function PanelSearch({ value, onChange, placeholder, ariaLabel, disabled = false, filter }: PanelSearchProps) {
  return <div className="panel-search">
    <label className="panel-search__field">
      <Icon name="search" />
      <input type="search" value={value} onChange={(event) => onChange(event.currentTarget.value)} placeholder={placeholder} aria-label={ariaLabel} autoComplete="off" disabled={disabled} />
    </label>
    {filter && <Button variant="secondary" size="icon" className="panel-search__filter" aria-label={filter.ariaLabel} aria-expanded={filter.expanded} title={filter.title} onClick={filter.onToggle}><Icon name="settings-2" /></Button>}
  </div>
}
