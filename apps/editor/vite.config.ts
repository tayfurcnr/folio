import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const folioRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    fs: { allow: [folioRoot] },
  },
  build: { target: 'es2022', sourcemap: true },
})
