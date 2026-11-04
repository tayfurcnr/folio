import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Avatar } from '../components/Avatar'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'

type Message = { readonly id: number; readonly author: string; readonly initials: string; readonly tone: 'accent' | 'blue' | 'violet'; readonly time: string; readonly text: string; readonly own?: boolean }

const slideLabels = ['Başlık', 'İçindekiler', 'Teşekkürler']
const initialMessages: Message[] = [
  { id: 1, author: 'Ekip üyesi', initials: 'E', tone: 'blue', time: '10:24', text: 'Kapak başlığını biraz daha belirgin yapalım mı? @Slayt 1' },
  { id: 2, author: 'Sen', initials: 'T', tone: 'accent', time: '10:26', text: 'Olur. Başlığı büyütüp alt başlığı kısaltacağım. @Slayt 1', own: true },
  { id: 3, author: 'Ekip üyesi', initials: 'E', tone: 'blue', time: '10:31', text: 'İçindekilerdeki maddeler arasına biraz daha boşluk iyi olur. @Slayt 2' },
]

export function CommentsChatPanel({ activeSlide, onSelectSlide, onClose }: { readonly activeSlide: number; readonly onSelectSlide: (slide: number) => void; readonly onClose: () => void }) {
  const [messages, setMessages] = useState(initialMessages)
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState<{ readonly start: number; readonly query: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [messages.length])

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
    const next = `${draft.slice(0, start)}@Slayt ${slide} ${draft.slice(caret)}`
    const nextCaret = start + `@Slayt ${slide} `.length
    setDraft(next)
    setMention(null)
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(nextCaret, nextCaret) })
  }

  const onDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && mention) { setMention(null); return }
    if (event.key === 'Enter' && !event.shiftKey && !mention) { event.preventDefault(); submitMessage() }
  }

  const submitMessage = () => {
    const text = draft.trim()
    if (!text) return
    setMessages((current) => [...current, { id: Date.now(), author: 'Sen', initials: 'T', tone: 'accent', time: new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(new Date()), text, own: true }])
    setDraft('')
    setMention(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submitMessage() }

  return <aside id="comments-chat-panel" className="comments-chat" aria-label="Yorumlar sohbeti">
    <header className="comments-chat__header">
      <div><span className="comments-chat__eyebrow">SUNUM SOHBETİ · ÖRNEK</span><h2>Yorumlar <span>{messages.length}</span></h2></div>
      <Button variant="secondary" size="icon" className="comments-chat__close" onClick={onClose} aria-label="Yorumları kapat" title="Yorumları kapat">×</Button>
    </header>
    <div className="comments-chat__context"><Icon name="presentation" /><span>Aktif slayt</span><button type="button" onClick={() => onSelectSlide(activeSlide)}>@Slayt {activeSlide} · {slideLabels[activeSlide - 1]}</button></div>
    <div className="comments-chat__messages" ref={listRef} aria-live="polite" aria-label="Yorum mesajları">
      {messages.map((message) => <article className={`chat-message${message.own ? ' chat-message--own' : ''}`} key={message.id}>
        {!message.own && <Avatar initials={message.initials} label={message.author} tone={message.tone} />}
        <div className="chat-message__body"><div className="chat-message__meta"><strong>{message.author}</strong><time>{message.time}</time></div><div className="chat-message__bubble">{renderMentions(message.text, onSelectSlide)}</div></div>
        {message.own && <Avatar initials={message.initials} label={message.author} tone={message.tone} />}
      </article>)}
    </div>
    <form className="comments-chat__composer" onSubmit={handleSubmit}>
      {mention && <div className="mention-picker" role="listbox" aria-label="Slayt etiketi seç">
        {slideLabels.map((label, index) => <button type="button" role="option" aria-selected={false} key={label} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(index + 1)}><span>@Slayt {index + 1}</span><small>{label}</small></button>)}
      </div>}
      <label className="comments-chat__field"><span className="visually-hidden">Yorum yaz</span><textarea ref={inputRef} rows={3} value={draft} onChange={(event) => updateDraft(event.target.value, event.target.selectionStart)} onKeyDown={onDraftKeyDown} placeholder="Yorum yaz… (@ ile slayt etiketle)" /></label>
      <div className="comments-chat__composer-footer"><button type="button" className="comments-chat__mention-button" onClick={() => { const next = `${draft}@`; setDraft(next); setMention({ start: next.length - 1, query: '' }); requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(next.length, next.length) }) }} aria-label="Slayt etiketle">@ <span>Slayt etiketle</span></button><span>Enter ile gönder</span><button type="submit" className="comments-chat__send" disabled={!draft.trim()} aria-label="Yorumu gönder"><Icon name="arrow-up-right" /></button></div>
    </form>
  </aside>
}

function renderMentions(text: string, onSelectSlide: (slide: number) => void) {
  const parts = text.split(/(@Slayt\s+\d+)/g)
  return parts.map((part, index) => {
    const match = /^@Slayt\s+(\d+)$/.exec(part)
    if (!match) return <span key={index}>{part}</span>
    const slide = Math.max(1, Math.min(slideLabels.length, Number(match[1])))
    return <button type="button" className="chat-mention" key={index} onClick={() => onSelectSlide(slide)} aria-label={`${slide}. slayda git: ${slideLabels[slide - 1]}`}>{`@Slayt ${slide}`}</button>
  })
}
