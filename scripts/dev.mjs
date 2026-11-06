import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const collabPort = Number(process.env.FOLIO_COLLAB_PORT ?? 4175)
const webPort = Number(process.env.FOLIO_WEB_PORT ?? 5173)
const webHost = process.env.FOLIO_WEB_HOST ?? '0.0.0.0'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const collaboration = spawn(process.execPath, ['apps/collab-server/server.mjs'], {
  cwd: root,
  env: { ...process.env, FOLIO_COLLAB_HOST: '127.0.0.1', FOLIO_COLLAB_PORT: String(collabPort) },
  stdio: 'inherit',
})
const editor = spawn(npm, ['run', 'dev', '--workspace', '@folio/editor', '--', '--host', webHost, '--port', String(webPort), '--strictPort'], {
  cwd: root,
  env: { ...process.env, FOLIO_COLLAB_PROXY_TARGET: `http://127.0.0.1:${collabPort}` },
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

let stopping = false
function stop(signal = 'SIGTERM') {
  if (stopping) return
  stopping = true
  for (const child of [editor, collaboration]) if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal))
for (const child of [editor, collaboration]) child.on('exit', (code) => {
  if (!stopping) {
    process.exitCode = code ?? 1
    stop()
  }
})
