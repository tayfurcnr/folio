import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import iconUrl from '../../../logo/folio-icon.svg?url'
import { App } from './App'
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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
