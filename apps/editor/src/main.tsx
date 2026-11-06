import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import iconUrl from '../../../logo/folio-icon.svg?url'
import { App } from './App'
import { LocaleProvider } from './features/localization/locale'
import { PresenterRemote } from './ui/presentation/PresenterRemote'
import { collaborationEndpoint } from './features/engine/collaborationClient'
import './styles/tokens.css'
import './styles/button-system.css'
import './styles/app.css'

const favicon = document.createElement('link')
favicon.rel = 'icon'
favicon.type = 'image/svg+xml'
favicon.href = iconUrl
document.head.append(favicon)

const root = document.getElementById('root')
if (!root) throw new Error('React root element was not found')

const presenterChannel = new URLSearchParams(location.search).get('presenter')
const remoteHash = new URLSearchParams(location.hash.slice(1))
const remoteSessionId = remoteHash.get('presenterRemote')
const remoteToken = remoteHash.get('token')
createRoot(root).render(
  <StrictMode>
    <LocaleProvider>{remoteSessionId && remoteToken
      ? <PresenterRemote endpoint={collaborationEndpoint} remoteSession={{ sessionId: remoteSessionId, token: remoteToken }} />
      : presenterChannel ? <PresenterRemote channelName={presenterChannel} /> : <App />}</LocaleProvider>
  </StrictMode>,
)
