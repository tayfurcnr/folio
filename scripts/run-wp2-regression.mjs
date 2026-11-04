import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, extname, resolve, sep } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = resolve(root, 'apps/editor/public')
const reportPath = resolve(root, 'docs/WP2-REGRESSION-RESULTS.md')
mkdirSync(resolve(root, 'docs'), { recursive: true })
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json' }
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const path = resolve(publicRoot, `.${pathname}`)
  if (!path.startsWith(publicRoot + sep) && path !== publicRoot) { response.writeHead(403).end(); return }
  try { const body = readFileSync(path); response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' }); response.end(body) }
  catch { response.writeHead(404).end('not found') }
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('could not open local regression server')
const browser = spawn('/home/kairos/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote', '--disable-extensions', '--user-data-dir=/tmp/chrome-profile-folio-wp2-regression', '--remote-debugging-port=0', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
let stderr = ''
browser.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
const browserWs = await new Promise((resolveWs, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Chrome DevTools did not start: ${stderr}`)), 15000)
  const poll = setInterval(async () => {
    const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timeout); clearInterval(poll); resolveWs(match[1]); return }
    try {
      const response = await fetch('http://127.0.0.1:9222/json/version')
      const info = await response.json()
      if (info.webSocketDebuggerUrl) { clearTimeout(timeout); clearInterval(poll); resolveWs(info.webSocketDebuggerUrl) }
    } catch {}
  }, 100)
  browser.on('close', (code) => { clearTimeout(timeout); clearInterval(poll); reject(new Error(`Chrome exited ${code}: ${stderr}`)) })
})
const socket = new WebSocket(browserWs)
await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const callbacks = pending.get(message.id); pending.delete(message.id)
    message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result)
  }
})
function cdp(method, params = {}, sessionId) {
  const id = ++nextId
  return new Promise((resolveCommand, rejectCommand) => {
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand })
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}
const { targetId } = await cdp('Target.createTarget', { url: `http://127.0.0.1:${address.port}/wp2-regression.html` })
await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true })
await cdp('Page.enable', {}, sessionId)
await cdp('Runtime.enable', {}, sessionId)
const browserErrors = []
const onEvent = (event) => {
  const message = JSON.parse(event.data)
  if (message.sessionId !== sessionId) return
  if (message.method === 'Runtime.exceptionThrown') browserErrors.push({ exception: message.params.exceptionDetails.text })
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push({ console: message.params.args.map((arg) => arg.value ?? arg.description).join(' ') })
}
socket.addEventListener('message', onEvent)
let browserResult
for (let attempt = 0; attempt < 160; attempt += 1) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  const evaluated = await cdp('Runtime.evaluate', { expression: `({status:document.querySelector('#results')?.dataset.status,text:document.querySelector('#results')?.textContent})`, returnByValue: true }, sessionId)
  browserResult = evaluated.result?.value
  if (browserResult?.status === 'pass' || browserResult?.status === 'fail') break
}
socket.removeEventListener('message', onEvent)
await cdp('Target.closeTarget', { targetId })
socket.close()
browser.kill('SIGTERM')
server.close()
if (!browserResult || !['pass', 'fail'].includes(browserResult.status)) {
  writeFileSync(reportPath, `# WP2 Regression Results\n\nStatus: FAIL\n\nBrowser run did not finish. Diagnostics: ${JSON.stringify(browserErrors)}\n`)
  process.exitCode = 1
} else {
  const result = JSON.parse(browserResult.text)
  const diagnostics = browserErrors.length ? JSON.stringify(browserErrors) : 'No JavaScript console errors or uncaught exceptions.'
  result.markdown = result.markdown.replace('## Interpretation', `## Browser diagnostics\n\n${diagnostics}\n\n## Interpretation`)
  writeFileSync(reportPath, result.markdown)
  console.log(`Wrote ${reportPath}`)
  console.log(result.markdown)
  if (browserResult.status !== 'pass' || browserErrors.length > 0) process.exitCode = 1
}
