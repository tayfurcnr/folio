import logoUrl from '../../../../../logo/folio_logo.svg?url'
import appIconUrl from '../../../../../logo/folio-icon.svg?url'
import { Icon } from '../components/Icon'
import { Button } from '../components/Button'
import { EditorMenus } from './EditorMenus'
import type { EngineCommand } from '@folio/engine-adapter'
import { useLocale } from '../../features/localization/locale'
import type { RecentPresentation } from '../../features/engine/documentAutosave'
import { useEffect, useRef, useState } from 'react'

type ManagedInvite = { readonly shareId: string; readonly role: 'edit' | 'comment' | 'view'; readonly createdAt: number; readonly href?: string }
type Props = { readonly documentTitle: string; readonly openError?: string | null; readonly onDismissOpenError?: () => void; readonly colorMode: 'light' | 'dark'; readonly rulersVisible: boolean; readonly gridVisible: boolean; readonly gridSnapEnabled: boolean; readonly commentsOpen: boolean; readonly canUndo: boolean; readonly canRedo: boolean; readonly hasSelection: boolean; readonly onUndo: () => void; readonly onRedo: () => void; readonly onCommand: (command: EngineCommand) => void; readonly onRenamePresentation: (title: string) => void; readonly onExport: (format: 'pdf' | 'pptx') => Promise<void>; readonly onSharePresentation: () => Promise<void>; readonly onCreateCollaborationLink: (role: 'edit' | 'comment' | 'view') => Promise<string>; readonly onListCollaborationLinks: () => Promise<ManagedInvite[]>; readonly onRevokeCollaborationLink: (shareId: string) => Promise<void>; readonly onNewPresentation: () => void; readonly onOpenPresentation: () => void; readonly onSavePresentation: (copy: boolean) => void; readonly recentPresentations: readonly RecentPresentation[]; readonly onOpenRecentPresentation: (documentId: string) => void; readonly onPresent: () => void; readonly onToggleComments: () => void; readonly onColorModeChange: (mode: 'light' | 'dark') => void; readonly onToggleRulers: () => void; readonly onToggleGrid: () => void; readonly onToggleGridSnap: () => void }

export function EditorHeader({ documentTitle, openError, onDismissOpenError, colorMode, rulersVisible, gridVisible, gridSnapEnabled, commentsOpen, canUndo, canRedo, hasSelection, onUndo, onRedo, onCommand, onRenamePresentation, onExport, onSharePresentation, onCreateCollaborationLink, onListCollaborationLinks, onRevokeCollaborationLink, onNewPresentation, onOpenPresentation, onSavePresentation, recentPresentations, onOpenRecentPresentation, onPresent, onToggleComments, onColorModeChange, onToggleRulers, onToggleGrid, onToggleGridSnap }: Props) {
  const { t } = useLocale()
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState(documentTitle)
  const [shareOpen, setShareOpen] = useState(false)
  const [exportError, setExportError] = useState(false)
  const [shareError, setShareError] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)
  const [managedInvites, setManagedInvites] = useState<ManagedInvite[]>([])
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null)
  const shareWrapRef = useRef<HTMLDivElement>(null)
  const shareTriggerRef = useRef<HTMLElement>(null)
  const commitTitle = () => {
    const title = draftTitle.trim()
    if (title) onRenamePresentation(title)
    else setDraftTitle(documentTitle)
    setRenaming(false)
  }
  const exportFile = async (format: 'pdf' | 'pptx') => {
    setShareOpen(false)
    setExportError(false)
    try { await onExport(format) } catch { setExportError(true) }
  }
  const shareFile = async () => {
    setShareOpen(false)
    setShareError(false)
    try { await onSharePresentation() } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setShareError(true) }
  }
  const createInvite = async (role: 'edit' | 'comment' | 'view') => {
    setInviteBusy(true)
    setShareError(false)
    setInviteCopied(false)
    try { setInviteLink(await onCreateCollaborationLink(role)); setManagedInvites(await onListCollaborationLinks()) }
    catch { setShareError(true) }
    finally { setInviteBusy(false) }
  }
  const revokeInvite = async (shareId: string) => {
    setRevokingInvite(shareId)
    try { await onRevokeCollaborationLink(shareId); setManagedInvites(await onListCollaborationLinks()); if (managedInvites.find((item) => item.shareId === shareId)?.href) setInviteLink(null) }
    catch { setShareError(true) }
    finally { setRevokingInvite(null) }
  }
  useEffect(() => {
    if (!shareOpen) return
    void onListCollaborationLinks().then(setManagedInvites).catch(() => setShareError(true))
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !shareWrapRef.current?.contains(event.target)) setShareOpen(false)
    }
    const handleMenuKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setShareOpen(false)
        shareTriggerRef.current?.focus()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = [...(shareWrapRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
      if (!items.length) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current <= 0 ? items.length : current) - 1
      items[index]?.focus()
    }
    window.addEventListener('pointerdown', closeFromOutside)
    window.addEventListener('keydown', handleMenuKey)
    requestAnimationFrame(() => shareWrapRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus())
    return () => { window.removeEventListener('pointerdown', closeFromOutside); window.removeEventListener('keydown', handleMenuKey) }
  }, [shareOpen, onListCollaborationLinks])
  return <header className="topbar">
    <div className="topbar__left">
      <a className="brand" href="#editor" aria-label={t('Folio editör ana sayfa')}>
        <img className="brand__full" src={logoUrl} alt="Folio" />
        <img className="brand__icon" src={appIconUrl} alt="" />
      </a>
      <EditorMenus colorMode={colorMode} rulersVisible={rulersVisible} gridVisible={gridVisible} gridSnapEnabled={gridSnapEnabled} onColorModeChange={onColorModeChange} onToggleRulers={onToggleRulers} onToggleGrid={onToggleGrid} onToggleGridSnap={onToggleGridSnap} onCommand={onCommand} onNewPresentation={onNewPresentation} onOpenPresentation={onOpenPresentation} onSavePresentation={onSavePresentation} recentPresentations={recentPresentations} onOpenRecentPresentation={onOpenRecentPresentation} hasSelection={hasSelection} />
      <div className="topbar__history" role="group" aria-label={t('Geri al ve ileri al')}>
        <Button variant="secondary" size="icon" className="topbar__history-button topbar__history-button--undo" disabled={!canUndo} onClick={onUndo} aria-label={t('Geri al')} title={t('Son işlemi geri al')} icon={<Icon name="undo-2" />} />
        <Button variant="secondary" size="icon" className="topbar__history-button topbar__history-button--redo" disabled={!canRedo} onClick={onRedo} aria-label={t('İleri al')} title={t('Son işlemi yinele')} icon={<Icon name="redo-2" />} />
      </div>
      <div className="topbar__document">
      <span className="topbar__document-separator" aria-hidden="true" />
      <div className="topbar__title" aria-label={`${t('Sunum adı')}: ${documentTitle}`} title={t('Sunum adı')}>
        <Icon name="file" />{renaming
          ? <input autoFocus aria-label={t('Sunum adı')} value={draftTitle} maxLength={120} style={{ width: 'min(180px, 22vw)', padding: '4px 6px', border: '1px solid var(--accent)', borderRadius: 5, outline: 'none', background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 12 }} onChange={(event) => setDraftTitle(event.currentTarget.value)} onBlur={commitTitle} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } else if (event.key === 'Escape') { setDraftTitle(documentTitle); setRenaming(false) } }} />
          : <span>{documentTitle}</span>}
      </div>
      <Button variant="ghost" size="icon" className="topbar__rename" aria-label={t('Sunum adını değiştir')} title={t('Sunum adını değiştir')} onClick={() => { setDraftTitle(documentTitle); setRenaming(true) }} icon={<Icon name="pencil" />} />
      </div>
    </div>
    <div className="topbar__right">
      <Button variant="secondary" size="icon" className="topbar__icon-button" aria-label={t(commentsOpen ? 'Yorumları kapat' : 'Yorumları aç')} title={t('Yorumlar')} aria-expanded={commentsOpen} aria-controls="comments-chat-panel" onClick={onToggleComments} icon={<Icon name="message-circle" />} />
      <div className="topbar__share-wrap" ref={shareWrapRef}>
        <Button ref={shareTriggerRef} variant="secondary" size="sm" className="topbar__share" aria-expanded={shareOpen} aria-haspopup="menu" aria-controls="share-export-menu" onClick={() => setShareOpen((open) => !open)} icon={<Icon name="share-2" />}>{t('Paylaş')}</Button>
        {shareOpen && <div id="share-export-menu" className="topbar__share-popover" role="menu" aria-label={t('Sunumu paylaş')}>
          <strong>{t('Sunumu paylaş')}</strong>
          <Button variant="menu-item" size="sm" role="menuitem" disabled={inviteBusy} onClick={() => void createInvite('edit')} icon={<Icon name="pencil" />}>{inviteBusy ? t('Bağlantı hazırlanıyor') : t('Düzenleyebilir bağlantı oluştur')}</Button>
          <Button variant="menu-item" size="sm" role="menuitem" disabled={inviteBusy} onClick={() => void createInvite('comment')} icon={<Icon name="message-circle" />}>{t('Yorum yapabilir bağlantı oluştur')}</Button>
          <Button variant="menu-item" size="sm" role="menuitem" disabled={inviteBusy} onClick={() => void createInvite('view')} icon={<Icon name="eye" />}>{t('Görüntüleyebilir bağlantı oluştur')}</Button>
          {inviteLink && <div className="topbar__invite-link"><input aria-label={t('Paylaşım bağlantısı')} readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} /><Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setInviteCopied(true)).catch(() => setShareError(true)) }}>{inviteCopied ? t('Kopyalandı') : t('Bağlantıyı kopyala')}</Button></div>}
          {managedInvites.length > 0 && <section className="topbar__managed-invites" aria-label={t('Erişim bağlantıları')}><span>{t('Erişim bağlantıları')}</span>{managedInvites.map((invite) => <div className="topbar__managed-invite" key={invite.shareId}><span>{t(invite.role === 'edit' ? 'Düzenleyebilir' : invite.role === 'comment' ? 'Yorum yapabilir' : 'Görüntüleyebilir')}</span><div>{invite.href && <Button variant="ghost" size="sm" role="menuitem" onClick={() => { void navigator.clipboard.writeText(invite.href!).catch(() => setShareError(true)) }}>{t('Kopyala')}</Button>}<Button variant="ghost" size="sm" role="menuitem" disabled={revokingInvite === invite.shareId} onClick={() => void revokeInvite(invite.shareId)}>{revokingInvite === invite.shareId ? t('İptal ediliyor') : t('İptal et')}</Button></div></div>)}</section>}
          <div className="topbar__share-divider" />
          <Button variant="menu-item" size="sm" role="menuitem" onClick={() => void shareFile()} icon={<Icon name="share-2" />}>{t('PowerPoint dosyasını paylaş')}</Button>
          <Button variant="menu-item" size="sm" role="menuitem" onClick={() => void exportFile('pdf')} icon={<Icon name="file" />}>{t('PDF olarak indir')}</Button>
          <Button variant="menu-item" size="sm" role="menuitem" onClick={() => void exportFile('pptx')} icon={<Icon name="presentation" />}>{t('PowerPoint olarak indir')}</Button>
        </div>}
        {exportError && <span className="topbar__share-error" role="status">{t('Dışa aktarma başarısız oldu')}</span>}
        {shareError && <span className="topbar__share-error" role="status">{t('Paylaşım başarısız oldu')}</span>}
      </div>
      <Button variant="accent" size="sm" className="topbar__present" onClick={onPresent} iconEffect="pulse" icon={<Icon name="play" />}>{t('Sunumu Yap')}</Button>
      {openError && <div className="topbar__open-error" role="alert"><span>{t('Sunum açılamadı')}: {openError}</span><Button variant="ghost" size="icon" aria-label={t('Hata mesajını kapat')} onClick={onDismissOpenError}>×</Button></div>}
    </div>
  </header>
}
