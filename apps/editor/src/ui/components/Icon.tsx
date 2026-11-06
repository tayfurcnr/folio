import iconSprite from '../../assets/atlas-icons.svg?url'

export type IconName =
  | 'layout-template' | 'palette' | 'shapes' | 'images' | 'paintbrush' | 'layers'
  | 'sparkles' | 'circle-question-mark' | 'file' | 'settings-2' | 'presentation' | 'message-circle'
  | 'share-2' | 'play' | 'chevron-down' | 'chevron-right' | 'search' | 'plus' | 'ellipsis' | 'image' | 'sticky-note'
  | 'cloud' | 'users-round' | 'type' | 'table' | 'chart-column' | 'star' | 'video'
  | 'eye' | 'eye-off' | 'lock' | 'lock-open' | 'undo-2' | 'redo-2' | 'fast-forward' | 'trash'
  | 'hand'
  | 'pencil'
  | 'zoom-in' | 'zoom-out' | 'sun' | 'moon' | 'align-left' | 'clipboard' | 'line-segment' | 'copy' | 'download' | 'ruler' | 'arrow-up-right'

export function Icon({ name, className = '' }: { readonly name: IconName; readonly className?: string }) {
  return <svg className={`icon ${className}`.trim()} aria-hidden="true" focusable="false">
    <use href={`${iconSprite}#${name}`} />
  </svg>
}
