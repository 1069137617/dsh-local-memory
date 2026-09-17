// test/tools.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MemoryStore } from '../lib/store.js'
import { makeSearchTool, makeRememberTool } from '../lib/tools.js'
import { DEFAULTS } from '../lib/config.js'

const harness = (cfg = DEFAULTS) => {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'dshlm-t')), 'm'))
  store.load()
  const current = { ...cfg }
  return { store, cfg: () => current, search: makeSearchTool(store, () => current), remember: makeRememberTool(store, () => current) }
}
const exec = (cwd) => ({ agent: { session: { header: { cwd } } }, signal: new AbortController().signal })

test('definitions are registered by name', () => {
  const h = harness()
  assert.equal(h.search.name, 'local_memory_search')
  assert.equal(h.remember.name, 'local_memory_remember')
})

test('remember add → search roundtrip (workspace scope from exec)', async () => {
  const h = harness()
  const r = await h.remember.execute({ action: 'add', text: '发布要隔 45 秒重跑', scope: 'workspace' }, exec('D:\\code\\x'))
  assert.equal(r.completion, 'committed')
  const s = await h.search.execute({ query: '发布' }, exec('D:\\code\\x'))
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0].scope, 'd:/code/x')
})

test('replace by unique old_text; ambiguous fails listing ids', async () => {
  const h = harness()
  await h.remember.execute({ action: 'add', text: 'alpha one' }, exec('C:\\w'))
  await h.remember.execute({ action: 'add', text: 'beta one' }, exec('C:\\w'))
  const ok = await h.remember.execute({ action: 'replace', old_text: 'alpha', text: 'alpha two' }, exec('C:\\w'))
  assert.equal(ok.completion, 'committed')
  const amb = await h.remember.execute({ action: 'replace', old_text: 'one', text: 'x' }, exec('C:\\w'))
  assert.equal(amb.completion, 'failed')
  assert.match(amb.error, /ambiguous/)
})

test('writes gated: allowAgentWrite=false → failed, not throw', async () => {
  const h = harness({ ...DEFAULTS, allowAgentWrite: false })
  const r = await h.remember.execute({ action: 'add', text: 'x' }, exec('C:\\w'))
  assert.equal(r.completion, 'failed')
})

test('disabled plugin → search says so', async () => {
  const h = harness({ ...DEFAULTS, enabled: false })
  const r = await h.search.execute({}, exec('C:\\w'))
  assert.equal(r.disabled, true)
})

test('no-agent exec degrades with scopeNote', async () => {
  const h = harness()
  await h.remember.execute({ action: 'add', text: 'g' }, exec('C:\\w'))
  const r = await h.search.execute({ scope: 'workspace' }, {})   // 无 agent
  assert.ok(r.scopeNote)
})

// ---- 额外钉死项（控制器评审带入，不改动上面 brief 6 用例）----

test('search rejects unknown scope instead of silently widening', async () => {
  const h = harness()
  const r = await h.search.execute({ scope: 'bogus' }, exec('C:\\w'))
  assert.equal(r.completion, 'failed')
  assert.match(r.error, /scope/)
})

test('replace without text fails: replace requires text', async () => {
  const h = harness()
  await h.remember.execute({ action: 'add', text: 'alpha one' }, exec('C:\\w'))
  const r = await h.remember.execute({ action: 'replace', old_text: 'alpha' }, exec('C:\\w'))
  assert.equal(r.completion, 'failed')
  assert.match(r.error, /replace requires text/)
})

test('remember add receipt resolves to the added entry in the store', async () => {
  const h = harness()
  const r = await h.remember.execute({ action: 'add', text: 'mine' }, exec('C:\\w'))
  assert.equal(r.completion, 'committed')
  const snap = h.store.snapshot()
  const mine = snap.entries.find((e) => e.id === r.id)
  assert.ok(mine, 'receipt id must resolve to a real entry')
  assert.equal(mine.text, 'mine')
})
