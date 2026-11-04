import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = resolve(root, 'crates/folio-wasm/Cargo.toml')
const output = resolve(root, 'apps/editor/public/wasm-test')
mkdirSync(output, { recursive: true })
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('cargo', ['rustc', '--manifest-path', manifest, '--release', '--target', 'wasm32-unknown-unknown', '--lib', '--', '--cfg', 'test', '-A', 'explicit_builtin_cfgs_in_flags'])
run('wasm-bindgen', [resolve(root, 'crates/folio-wasm/target/wasm32-unknown-unknown/release/folio_wasm.wasm'), '--target', 'web', '--out-dir', output, '--out-name', 'folio_wasm'])
