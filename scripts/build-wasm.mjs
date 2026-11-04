import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = resolve(root, 'crates/folio-wasm/Cargo.toml')
const out = resolve(root, 'apps/editor/public/wasm')
mkdirSync(out, { recursive: true })

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', manifest])
run('wasm-bindgen', [resolve(root, 'crates/folio-wasm/target/wasm32-unknown-unknown/release/folio_wasm.wasm'), '--target', 'web', '--out-dir', out, '--out-name', 'folio_wasm'])
