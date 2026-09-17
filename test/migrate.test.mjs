// test/migrate.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseAndMap } from '../scripts/migrate-from-mnemon.mjs'
import { MemoryStore } from '../lib/store.js'

const src = JSON.stringify({ version: 1, entries: [
  { content: 'fact one', created_at: '2026-09-12T08:10:10.812Z', updated_at: '2026-09-12T08:10:10.812Z', target: 'memory', importance: 'normal' },
  { content: 'user pref', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z', target: 'user', importance: 'critical' },
  { content: '', target: 'memory' },
  { content: 'x'.repeat(50), target: 'memory', importance: 'weird' },
  { content: 'br', target: 'memory', branches: ['feat/x'] },
] })

test('parseAndMap: map, tag, skip empty, clamp importance, clip', () => {
  const r = parseAndMap(src, { maxChars: 20 })
  assert.equal(r.mapped.length, 4)
  assert.equal(r.skipped.length, 1)
  assert.equal(r.clipped, 1)
  assert.equal(r.mapped[1].tags.includes('user'), true)
  assert.equal(r.mapped[1].importance, 'critical')
  assert.equal(r.mapped[2].importance, 'normal')
  assert.equal(r.mapped[2].text.length, 20)
  assert.equal(r.mapped[3].tags.includes('branch:feat/x'), true)
  assert.equal(r.mapped[0].createdAt, '2026-09-12T08:10:10.812Z')
})

test('apply via store preserves timestamps; rerun dedupes', () => {
  const store = new MemoryStore(join(mkdtempSync(join(tmpdir(), 'dshlm-m')), 'm'))
  store.load()
  const r = parseAndMap(src, { maxChars: 2000 })
  for (const m of r.mapped) store.add(m, m.source, 2000, { createdAt: m.createdAt, updatedAt: m.updatedAt })
  const e0 = store.snapshot().entries.find((e) => e.text === 'fact one')
  assert.equal(e0.createdAt, '2026-09-12T08:10:10.812Z')
  const again = parseAndMap(src, { maxChars: 2000, existing: store.snapshot().entries.map((e) => e.text) })
  assert.equal(again.mapped.length, 0)
  assert.equal(again.skipped.filter((s) => s.reason === 'duplicate').length, 4)
})
