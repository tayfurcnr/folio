import test from 'node:test'
import assert from 'node:assert/strict'
import { createEngineAdapter, EngineAdapterError } from '../src/index.ts'

function fakeLoader() {
  const created = []
  let loads = 0
  const loader = async () => {
    loads += 1
    return { default: async () => {}, createSession: () => {
      const state = { slides: [], calls: [], freed: false }
      created.push(state)
      return {
        free() { state.freed = true },
        execute(command, params) { state.calls.push([command, params]); return { result: null, revision: state.calls.length, dirty: true, canUndo: true, canRedo: false } },
        insertShapesBatch(shapes) { state.calls.push(['batch', shapes]); return { result: {}, revision: 1, dirty: true, canUndo: true, canRedo: false } },
        pointer() { return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
        key() { return { result: null, revision: 1, dirty: false, canUndo: false, canRedo: false } },
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
  assert.equal((await adapter.initialize()).engine, 'deckcraft')
  const [first, second] = await Promise.all([adapter.createSession(), adapter.createSession()])
  assert.equal(fake.loads, 1); assert.notEqual(first, second)
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

test('normalizes structured WASM errors with per-operation ids', async () => {
  const loader = async () => ({ default: async () => {}, createSession: () => ({
    free() {}, execute() { throw { code: 'INVALID_INPUT', message: 'bad payload', retryable: false } },
  }) })
  const adapter = createEngineAdapter(loader); const id = await adapter.createSession()
  await assert.rejects(adapter.execute(id, { type: 'edit.undo' }), (error) => {
    assert.ok(error instanceof EngineAdapterError); assert.equal(error.code, 'INVALID_INPUT'); assert.equal(error.message, 'bad payload'); assert.ok(error.operationId)
    return true
  })
})
