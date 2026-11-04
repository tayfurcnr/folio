import type { ReactNode } from 'react'

type AvatarProps = {
  readonly initials: string
  readonly label: string
  readonly tone?: 'accent' | 'blue' | 'violet'
}

export function Avatar({ initials, label, tone = 'accent' }: AvatarProps) {
  return <span className={`avatar avatar--${tone}`} role="img" aria-label={label} title={label}>{initials}</span>
}

export function AvatarGroup({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return <div className="avatar-group" role="group" aria-label={label}>{children}</div>
}

export function AvatarGroupCount({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return <span className="avatar avatar-group__count" role="img" aria-label={label} title={label}>{children}</span>
}
