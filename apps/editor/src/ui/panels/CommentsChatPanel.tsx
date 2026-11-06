import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import type { EngineSlideView } from '../../features/engine/editorEngine'
import { useLocale } from '../../features/localization/locale'
import { loadDocumentComments, saveDocumentComments, type DocumentComment } from '../../features/engine/documentComments'

export function CommentsChatPanel({ slides, activeSlide, activeShape, documentKey, sharedComments, canComment, onSharedCommentsChange, onSelectSlide, onSelectShape, onClose }: { readonly slides: readonly EngineSlideView[]; readonly activeSlide: number; readonly activeShape: { readonly id: string; readonly name: string } | null; readonly documentKey: string; readonly sharedComments: readonly DocumentComment[] | null; readonly canComment: boolean; readonly onSharedCommentsChange: (comments: readonly DocumentComment[]) => void; readonly onSelectSlide: (slide: number) => void; readonly onSelectShape: (slide: number, shapeId: string) => void; readonly onClose: () => void }) {
  const { locale, t } = useLocale()
  const [messages, setMessages] = useState<readonly DocumentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [draft, setDraft] = useState('')
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  const [commentFilter, setCommentFilter] = useState<'all' | 'open' | 'resolved'>('all')
  const [mention, setMention] = useState<{ readonly start: number; readonly query: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sharedMode = sharedComments !== null

  useEffect(() => {
    if (sharedMode) { setLoading(false); setLoadedKey(documentKey); return }
    let active = true
    setLoading(true)
    void loadDocumentComments(documentKey).then((saved) => { if (active) { setMessages(saved); setLoadedKey(documentKey) } }).catch(() => { if (active) setSaveError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [documentKey, sharedMode])
  useEffect(() => { if (sharedComments !== null) setMessages(sharedComments) }, [sharedComments])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages.length])
  useEffect(() => {
    if (sharedMode || loading || loadedKey !== documentKey) return
    let active = true
    void saveDocumentComments(documentKey, messages).then(() => { if (active) setSaveError(false) }).catch(() => { if (active) setSaveError(true) })
    return () => { active = false }
  }, [documentKey, loadedKey, loading, messages, sharedMode])

  const commitMessages = async (next: readonly DocumentComment[]): Promise<boolean> => {
    if (sharedMode) {
      setMessages(next)
      onSharedCommentsChange(next)
      setSaveError(false)
      return true
    }
    try { await saveDocumentComments(documentKey, next); setMessages(next); setSaveError(false); return true }
    catch { setSaveError(true); return false }
  }

  const updateDraft = (value: string, caret: number) => {
    setDraft(value)
    const beforeCaret = value.slice(0, caret)
    const at = beforeCaret.lastIndexOf('@')
    if (at >= 0 && /^@[\p{L}\d]*$/u.test(beforeCaret.slice(at))) setMention({ start: at, query: beforeCaret.slice(at + 1).toLocaleLowerCase('tr') })
    else setMention(null)
  }

  const insertMention = (slide: number) => {
    const input = inputRef.current
    const start = mention?.start ?? draft.length
    const caret = input?.selectionStart ?? draft.length
    const slideWord = locale === 'en' ? 'Slide' : 'Slayt'
    const next = `${draft.slice(0, start)}@${slideWord} ${slide} ${draft.slice(caret)}`
    const nextCaret = start + `@${slideWord} ${slide} `.length
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(nextCaret, nextCaret) })
  }

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && mention) { setMention(null); return }
    if (event.key === 'Enter' && !event.shiftKey && !mention) { event.preventDefault(); void submitMessage() }
  }

  const submitMessage = async () => {
    const text = draft.trim()
    if (!text) return
    const slide = slides[activeSlide - 1]
    if (!slide) return
    const next = [...messages, { id: crypto.randomUUID(), author: t('Sen'), initials: 'T', time: new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date()), text, slideId: slide.id, slideIndex: activeSlide - 1, ...(activeShape ? { shapeId: activeShape.id, shapeName: activeShape.name } : {}) }]
    if (!await commitMessages(next)) return
    setDraft('')
    setMention(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitMessage() }

  const submitReply = async (messageId: string) => {
    const text = replyDraft.trim()
    if (!text) return
    const reply = { id: crypto.randomUUID(), author: t('Sen'), initials: 'T', time: new Intl.DateTimeFormat(locale === 'en' ? 'en' : 'tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date()), text }
    const next = messages.map((message) => message.id === messageId ? { ...message, replies: [...(message.replies ?? []), reply] } : message)
    if (await commitMessages(next)) { setReplyDraft(''); setReplyingTo(null) }
  }

  const toggleResolved = async (messageId: string) => {
    const next = messages.map((message) => message.id === messageId ? { ...message, resolved: !message.resolved } : message)
    await commitMessages(next)
  }

  const activeTitle = slides[activeSlide - 1]?.title ?? `${t('Slayt')} ${activeSlide}`
  const slideWord = locale === 'en' ? 'Slide' : 'Slayt'
  const visibleMessages = messages.filter((message) => commentFilter === 'all' || (commentFilter === 'resolved') === !!message.resolved)
  return <aside id="comments-chat-panel" className="comments-chat" aria-label={t('Yorumlar sohbeti')}>
    <header className="comments-chat__header">
      <div><span className="comments-chat__eyebrow">{t(sharedMode ? 'ORTAK YORUMLAR' : 'BU CİHAZDAKİ YORUMLAR')}</span><h2>{t('Yorumlar')} <span>{messages.length}</span></h2></div>
      <Button variant="secondary" size="icon" className="comments-chat__close" onClick={onClose} aria-label={t('Yorumları kapat')} title={t('Yorumları kapat')}>×</Button>
    </header>
    <div className="comments-chat__context"><Icon name="presentation" /><span>{t('Aktif slayt')}</span><button type="button" onClick={() => onSelectSlide(activeSlide)}>@{slideWord} {activeSlide} · {activeTitle}</button>{activeShape && <span className="comments-chat__anchor" title={t('Yorum bu nesneye bağlanır')}>{t('Nesne')}: {activeShape.name}</span>}</div>
    <div className="comments-chat__filters" role="group" aria-label={t('Yorum filtreleri')}><button type="button" aria-pressed={commentFilter === 'all'} onClick={() => setCommentFilter('all')}>{t('Tümü')} <span>{messages.length}</span></button><button type="button" aria-pressed={commentFilter === 'open'} onClick={() => setCommentFilter('open')}>{t('Açık')} <span>{messages.filter((message) => !message.resolved).length}</span></button><button type="button" aria-pressed={commentFilter === 'resolved'} onClick={() => setCommentFilter('resolved')}>{t('Çözüldü')} <span>{messages.filter((message) => message.resolved).length}</span></button></div>
    <div className="comments-chat__messages" ref={listRef} aria-live="polite" aria-label={t('Yorum mesajları')}>
      {loading ? <p className="comments-chat__empty">{t('Yorumlar yükleniyor…')}</p> : messages.length === 0 ? <p className="comments-chat__empty">{t('Henüz yorum yok. Bu slaytla ilgili ilk yorumu yazın.')}</p> : visibleMessages.length === 0 ? <p className="comments-chat__empty">{t('Bu filtrede yorum yok.')}</p> : visibleMessages.map((message) => <article className={`chat-message chat-message--own${message.resolved ? ' chat-message--resolved' : ''}`} data-comment-shape-id={message.shapeId} key={message.id}>
      <Avatar initials={message.initials} label={t(message.author)} tone="accent" />
        <div className="chat-message__body"><div className="chat-message__meta"><strong>{t(message.author)} · {t('Slayt')} {commentSlideIndex(message, slides) + 1}{message.shapeName ? ` · ${message.shapeName}` : ''}</strong><time>{message.time}</time></div><div className="chat-message__bubble">{renderMentions(message.text, onSelectSlide, slides.length, locale)} <button type="button" className="chat-mention" onClick={() => { const index = commentSlideIndex(message, slides); if (index >= 0) { if (message.shapeId) onSelectShape(index + 1, message.shapeId); else onSelectSlide(index + 1) } }}>{t(message.shapeId ? 'Nesneyi aç' : 'Slaytı aç')}</button></div>
          {(message.replies ?? []).map((reply) => <div className="chat-reply" key={reply.id}><Avatar initials={reply.initials} label={t(reply.author)} tone="blue" /><div><div className="chat-message__meta"><strong>{t(reply.author)}</strong><time>{reply.time}</time></div><p>{renderMentions(reply.text, onSelectSlide, slides.length, locale)}</p></div></div>)}
          <div className="chat-message__actions"><button type="button" onClick={() => { setReplyingTo(replyingTo === message.id ? null : message.id); setReplyDraft('') }} disabled={!canComment || message.resolved}>{t('Yanıtla')}</button><button type="button" onClick={() => void toggleResolved(message.id)} aria-pressed={message.resolved} disabled={!canComment}>{t(message.resolved ? 'Yeniden aç' : 'Çözüldü olarak işaretle')}</button>{message.resolved && <span>{t('Çözüldü')}</span>}</div>
          {replyingTo === message.id && <div className="chat-reply__composer"><textarea aria-label={t('Yanıt yaz')} rows={2} value={replyDraft} onChange={(event) => setReplyDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submitReply(message.id) } }} /><Button variant="accent" size="sm" disabled={!replyDraft.trim()} onClick={() => void submitReply(message.id)}>{t('Yanıt gönder')}</Button></div>}
        </div>
      </article>)}
    </div>
    {saveError && <p className="comments-chat__storage-error" role="status">{t('Yorumlar bu cihazda kaydedilemedi.')}</p>}
    <form className="comments-chat__composer" onSubmit={handleSubmit}>
      {mention && <div className="mention-picker" role="listbox" aria-label={t('Slayt etiketi seç')}>
        {slides.map((slide, index) => <button type="button" role="option" aria-selected={false} key={slide.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(index + 1)}><span>@{slideWord} {index + 1}</span><small>{slide.title || `${t('Slayt')} ${index + 1}`}</small></button>)}
      </div>}
      <label className="comments-chat__field"><span className="visually-hidden">{t('Yorum yaz')}</span><textarea ref={inputRef} rows={3} value={draft} onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)} onKeyDown={onDraftKeyDown} placeholder={t('Yorum yaz… (@ ile slayt etiketle)')} readOnly={!canComment} /></label>
      <div className="comments-chat__composer-footer"><button type="button" className="comments-chat__mention-button" disabled={!canComment} onClick={() => { const next = `${draft}@`; setDraft(next); setMention({ start: next.length - 1, query: '' }); requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length) }) }} aria-label={t('Slayt etiketle')}>@ <span>{t('Slayt etiketle')}</span></button><span>{canComment ? t('Enter ile gönder') : t('Yalnızca görüntüleme')}</span><button type="submit" className="comments-chat__send" disabled={!canComment || !draft.trim()} aria-label={t('Yorumu gönder')}><Icon name="arrow-up-right" /></button></div>
    </form>
  </aside>
}

function commentSlideIndex(message: DocumentComment, slides: readonly EngineSlideView[]): number {
  const currentIndex = slides.findIndex((slide) => slide.id === message.slideId)
  if (currentIndex >= 0) return currentIndex
  return Number.isInteger(message.slideIndex) && message.slideIndex! >= 0 && message.slideIndex! < slides.length ? message.slideIndex! : -1
}

function renderMentions(text: string, onSelectSlide: (slide: number) => void, slideCount: number, locale: 'tr' | 'en') {
  const slideWord = locale === 'en' ? 'Slide' : 'Slayt'
  const parts = text.split(new RegExp(`(@(?:Slayt|Slide)\\s+\\d+)`, 'g'))
  return parts.map((part, index) => {
    const match = /^@(?:Slayt|Slide)\s+(\d+)$/.exec(part)
    if (!match) return <span key={index}>{part}</span>
    const slide = Math.max(1, Math.min(Math.max(1, slideCount), Number(match[1])))
    return <button type="button" className="chat-mention" key={index} onClick={() => onSelectSlide(slide)} aria-label={`${slide}. ${locale === 'en' ? 'go to slide' : 'slayda git'}`}>{`@${slideWord} ${slide}`}</button>
  })
}
