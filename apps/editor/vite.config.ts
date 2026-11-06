import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const folioRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [folioRoot] },
    proxy: {
      '/api': {
        target: process.env.FOLIO_COLLAB_PROXY_TARGET ?? 'http://127.0.0.1:4175',
        ws: true,
        configure(proxy) {
          // Same-origin Vite requests are already checked at the browser boundary.
          // The local collaboration service intentionally listens only on loopback.
          proxy.on('proxyReq', (request) => request.removeHeader('origin'))
          proxy.on('proxyReqWs', (request) => request.removeHeader('origin'))
        },
      },
    },
  },
  build: { target: 'es2022', sourcemap: true },
})
