import { useEffect, useRef, useState } from 'react'
import { useLocale } from '../../features/localization/locale'
import { EngineFrame } from '../workspace/EngineFrame'
import { Button } from '../components/Button'
import { PresenterRealtimeClient, type PresenterSession, type PresenterState } from '../../features/engine/collaborationClient'

export type { PresenterState } from '../../features/engine/collaborationClient'

export function PresenterRemote({ channelName, remoteSession, endpoint }: { readonly channelName?: string; readonly remoteSession?: PresenterSession; readonly endpoint?: string }) {
  const { t } = useLocale()
  const [state, setState] = useState<PresenterState | null>(null)
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null)
  const remoteClient = useRef<PresenterRealtimeClient | null>(null)

  useEffect(() => {
    if (remoteSession && endpoint) {
      setConnectionMessage(t('Uzaktan kumandaya bağlanıyor…'))
      const client = new PresenterRealtimeClient(endpoint, remoteSession, 'remote', remoteSession.token, {
        onReady: () => setConnectionMessage(null),
        onState: setState,
        onEnded: () => { setState(null); setConnectionMessage(t('Sunum sona erdi.')) },
      })
      remoteClient.current = client
      void client.connect().catch(() => setConnectionMessage(t('Uzaktan kumanda bağlantısı kurulamadı.')))
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); client.navigate(1) }
        else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); client.navigate(-1) }
        else if (event.key === 'Escape') window.close()
      }
      window.addEventListener('keydown', onKeyDown)
      return () => { client.close(); window.removeEventListener('keydown', onKeyDown); if (remoteClient.current === client) remoteClient.current = null }
    }
    if (!channelName) return
    const channel = new BroadcastChannel(channelName)
    const onMessage = (event: MessageEvent<{ type?: string; state?: PresenterState }>) => {
      if (event.data.type === 'state' && event.data.state) setState(event.data.state)
    }
    channel.addEventListener('message', onMessage)
    channel.postMessage({ type: 'ready' })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') { event.preventDefault(); channel.postMessage({ type: 'navigate', direction: 1 }) }
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); channel.postMessage({ type: 'navigate', direction: -1 }) }
      else if (event.key === 'Escape') channel.postMessage({ type: 'close' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { channel.removeEventListener('message', onMessage); channel.close(); window.removeEventListener('keydown', onKeyDown) }
  }, [channelName, remoteSession, endpoint, t])

  const sendNavigation = (direction: -1 | 1) => {
    if (remoteSession) { remoteClient.current?.navigate(direction); return }
    if (!channelName) return
    const channel = new BroadcastChannel(channelName)
    channel.postMessage({ type: 'navigate', direction })
    channel.close()
  }

  return <main className="presenter-remote" aria-label={t('Sunucu görünümü')}>
    <header className="presenter-remote__header"><div><strong>{state?.title ?? t('Sunucu görünümü')}</strong><span>{state ? `${state.index + 1} / ${state.total}` : t('Sunum bağlantısı bekleniyor…')}</span></div><Button variant="secondary" size="sm" onClick={() => window.close()}>{t('Pencereyi kapat')}</Button></header>
    <section className="presenter-remote__content">
      <div className="presenter-remote__slide">{state?.frame ? <EngineFrame frame={state.frame} className="presenter-remote__frame" label={`${t('Slayt')} ${state.index + 1}`} /> : <p>{connectionMessage ?? t('Sunum bağlantısı bekleniyor…')}</p>}</div>
      <aside className="presenter-remote__notes" aria-label={t('Konuşmacı notları')}><h2>{t('Konuşmacı notları')}</h2><div>{state?.notes?.trim() || t('Bu slayt için konuşmacı notu yok.')}</div></aside>
    </section>
    <footer className="presenter-remote__footer"><Button variant="secondary" size="sm" disabled={!state || state.index <= 0} onClick={() => sendNavigation(-1)}>{t('Önceki slayt')}</Button><span>{t('Ok tuşlarıyla slaytları kontrol edin · Esc ile sunumdan çıkın')}</span><Button variant="accent" size="sm" disabled={!state || state.index >= state.total - 1} onClick={() => sendNavigation(1)}>{t('Sonraki slayt')}</Button></footer>
  </main>
}
