// test/protocol.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MemoryStore } from '../lib/store.js'
import { DEFAULTS } from '../lib/config.js'
import { createRpcHandler, RPC_CHANNEL } from '../lib/protocol.js'

const mk = (cfg = DEFAULTS) => {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'dshlm-p')), 'm'))
  store.load()
  const current = { ...cfg }
  return { store, cfg: () => current, h: createRpcHandler({ store, cfg: () => current, workspaces: () => ['D:\\proj'] }) }
}

test('channel', () => assert.equal(RPC_CHANNEL, '/local-memory'))
test('snapshot + workspace-list', async () => {
  const { h } = mk()
  assert.deepEqual((await h('snapshot', {})).value.entries, [])
  assert.deepEqual((await h('workspace-list', {})).value, ['d:/proj'])
})
test('add/update/remove flow with revision guard', async () => {
  const { h } = mk()
  const added = await h('add', { text: '第一条', scope: 'global', importance: 'critical' })
  assert.equal(added.ok, true)
  const snap = added.value
  const id = snap.entries[0].id
  const stale = await h('update', { id, text: 'x', expectedRevision: 'nope' })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'revision-conflict')
  const upd = await h('update', { id, text: '改后', expectedRevision: snap.revision })
  assert.equal(upd.ok, true)
  assert.equal(upd.value.entries[0].text, '改后')
  const rm = await h('remove', { id })
  assert.equal(rm.value.entries.length, 0)
})
test('bad input rejected; unknown endpoint; store error sanitized', async () => {
  const { h } = mk({ ...DEFAULTS, entryMaxChars: 5 })
  assert.equal((await h('add', { text: 'way too long for the limit', scope: 'global' })).ok, false)
  assert.equal((await h('nope', {})).error.code, 'unknown-endpoint')
})
