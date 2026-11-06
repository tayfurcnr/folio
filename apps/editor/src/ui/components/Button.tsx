import { forwardRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ForwardedRef, type HTMLAttributes, type MouseEventHandler, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'menu-item' | 'accent' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'icon'
export type ButtonIconEffect = 'spin' | 'bounce' | 'shake' | 'pulse'

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'> & {
  readonly as?: 'button' | 'summary' | 'a'
  readonly variant?: ButtonVariant
  readonly size?: ButtonSize
  readonly iconEffect?: ButtonIconEffect
  readonly icon?: ReactNode
  readonly onClick?: MouseEventHandler<HTMLElement>
}

/** Single visual and interaction source for buttons and disclosure triggers. */
export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { as = 'button', variant = 'secondary', size = 'md', iconEffect, icon, className = '', type = 'button', disabled, children, href, onClick, title, ...props },
  ref,
) {
  const [showUnavailable, setShowUnavailable] = useState(false)
  const unavailableMessage = typeof title === 'string' ? title : 'Bu işlem henüz kullanılamıyor.'
  const handleClick: MouseEventHandler<HTMLElement> = (event) => {
    if (disabled) {
      event.preventDefault()
      setShowUnavailable(true)
      window.setTimeout(() => setShowUnavailable(false), 2200)
      return
    }
    onClick?.(event)
  }
  const classes = ['ui-button', `ui-button--${variant}`, `ui-button--${size}`, as === 'summary' ? 'ui-button--summary' : '', className].filter(Boolean).join(' ')
  const content = <>{icon && <span className="ui-button__icon" aria-hidden="true">{icon}</span>}{children}{showUnavailable && <span className="ui-button__unavailable" role="status">{unavailableMessage}</span>}</>
  if (as === 'summary') {
    const summaryProps = props as HTMLAttributes<HTMLElement>
    return <summary ref={ref} className={classes} data-icon-effect={iconEffect} title={title} aria-disabled={disabled || undefined} {...summaryProps}>{content}</summary>
  }

  if (as === 'a') {
    const anchorProps = props as AnchorHTMLAttributes<HTMLAnchorElement>
    return <a
      ref={ref as ForwardedRef<HTMLAnchorElement>}
      href={disabled ? undefined : href}
      title={title}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : anchorProps.tabIndex}
      className={classes}
      data-icon-effect={iconEffect}
      {...anchorProps}
    >{content}</a>
  }

  return <button
    ref={ref as ForwardedRef<HTMLButtonElement>}
    type={type}
    title={title}
    disabled={disabled}
    aria-disabled={disabled || undefined}
    className={classes}
    data-icon-effect={iconEffect}
    {...props}
    onClick={handleClick}
  >{content}</button>
})
