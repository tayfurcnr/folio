import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineAdapter, EngineAdapterError } from '../src/index.ts'

function fakeLoader() {
  const created = []
  let loads = 0
  const loader = async () => {
    loads += 1
    return { default: async () => {}, engineRevision: () => 'test-revision', createSession: () => {
      const state = { slides: [], calls: [], freed: false }
      created.push(state)
      return {
        free() { state.freed = true },
        setLocale(locale) { state.locale = locale },
        execute(command, params) { state.calls.push([command, params]); return { result: null, revision: state.calls.length, dirty: true, canUndo: true, canRedo: false } },
        createBlankSlide() { state.calls.push(['slide.new', '{"layout":"blank"}']); return { result: { id: '1' }, revision: 1, dirty: true, canUndo: true, canRedo: false } },
        insertShapesBatch(shapes) { state.calls.push(['batch', shapes]); return { result: {}, revision: 1, dirty: true, canUndo: true, canRedo: false } },
        pointer(kind, x, y, mods) { state.calls.push(['pointer', kind, x, y, mods]); return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
        hitTest() { return null },
        key(key, mods) { state.calls.push(['key', key, mods]); return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
        composeText() { return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
        commitText() { return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
        getDocumentSummary() { return { slides: [] } }, getSlideProjection(id) { return { id } },
        getSelectionProjection() { return { shapeIds: [] } }, renderSlide() { return { width: 1, height: 1, pixels: new Uint8Array(4) } },
        undo() { return { revision: 1 } }, redo() { return { revision: 1 } },
        importPptx() { return { importedSlideCount: 0 } }, exportPptx() { return new Uint8Array([1, 2]) },
      }
    } }
  }
  return { loader, created, get loads() { return loads } }
}

test('loads WASM once, creates isolated sessions and frees closed sessions', async () => {
  const fake = fakeLoader(); const adapter = createEngineAdapter(fake.loader)
  assert.deepEqual(await adapter.initialize(), { engine: 'deckcraft', revision: 'test-revision', protocolVersion: 1 })
  const [first, second] = await Promise.all([adapter.createSession(), adapter.createSession()])
  assert.equal(fake.loads, 1); assert.notEqual(first, second)
  await adapter.setLocale(first, 'tr'); assert.equal(fake.created[0].locale, 'tr')
  await adapter.execute(first, { type: 'slide.new', params: { layout: 'blank' } })
  assert.equal(fake.created[0].calls.length, 1); assert.equal(fake.created[1].calls.length, 0)
  adapter.closeSession(first); assert.equal(fake.created[0].freed, true)
  await assert.rejects(adapter.getDocumentSummary(first), (error) => error instanceof EngineAdapterError && error.code === 'SESSION_NOT_FOUND')
})

test('forwards typed pointer, batch and import/export calls', async () => {
  const fake = fakeLoader(); const adapter = createEngineAdapter(fake.loader); const id = await adapter.createSession()
  await adapter.insertShapesBatch(id, [{ name: 'one' }]); await adapter.pointer(id, { kind: 'down', x: 2, y: 3, modifiers: { shift: true } })
  assert.deepEqual(await adapter.exportPptx(id), new Uint8Array([1, 2]))
  assert.equal((await adapter.importPptx(id, new Uint8Array([3]))).importedSlideCount, 0)
})

test('preserves Ctrl modifiers when cmd is explicitly false', async () => {
  const fake = fakeLoader(); const adapter = createEngineAdapter(fake.loader); const id = await adapter.createSession()
  await adapter.key(id, { key: 'a', modifiers: { ctrl: true, cmd: false } })
  await adapter.pointer(id, { kind: 'down', x: 1, y: 2, modifiers: { ctrl: true, cmd: false } })
  assert.deepEqual(JSON.parse(fake.created[0].calls.find(([type]) => type === 'key')[2]), { cmd: true })
  assert.deepEqual(JSON.parse(fake.created[0].calls.find(([type]) => type === 'pointer')[4]), { cmd: true })
})

test('normalizes structured WASM errors with per-operation ids', async () => {
  const loader = async () => ({ default: async () => {}, engineRevision: () => 'test-revision', createSession: () => ({
    free() {}, execute() { throw { code: 'INVALID_INPUT', message: 'bad payload', retryable: false } },
  }) })
  const adapter = createEngineAdapter(loader); const id = await adapter.createSession()
  await assert.rejects(adapter.execute(id, { type: 'edit.undo' }), (error) => {
    assert.ok(error instanceof EngineAdapterError); assert.equal(error.code, 'INVALID_INPUT'); assert.equal(error.message, 'bad payload'); assert.ok(error.operationId)
    return true
  })
})
