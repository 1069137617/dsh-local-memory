// test/store.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { MemoryStore, RevisionConflictError, normalizeScope, findUnique, validateEntryText } from '../lib/store.js'

const dir = () => join(mkdtempSync(join(tmpdir(), 'dshlm-')), 'mem')
const fresh = () => { const s = new MemoryStore(dir()); s.load(); return s }

test('normalizeScope: win paths lowercase drive, slashes, no tail', () => {
  assert.equal(normalizeScope('D:\\code\\HyperFRP\\'), 'd:/code/hyperfrp')
  assert.equal(normalizeScope('  D:/a/b  '), 'd:/a/b')
  assert.equal(normalizeScope('global'), 'global')
  assert.equal(normalizeScope('/srv/x/'), '/srv/x')
})

test('add/persist/load roundtrip', () => {
  const s = fresh()
  const snap = s.add({ text: '上线前先跑 gate', scope: 'global', importance: 'critical', tags: ['deploy'] }, 'ui')
  assert.equal(snap.entries.length, 1)
  assert.equal(snap.entries[0].importance, 'critical')
  assert.match(snap.revision, /^[0-9a-f]{12}$/)
  const t = new MemoryStore(s.dir)
  t.load()
  assert.equal(t.snapshot().entries[0].text, '上线前先跑 gate')
})

test('update + remove bump revision; conflict throws', () => {
  const s = fresh()
  const r0 = s.add({ text: 'a', scope: 'global' }, 'agent').revision
  const e = s.snapshot().entries[0]
  assert.throws(() => s.update(e.id, { text: 'b' }, 'deadbeefdead'), RevisionConflictError)
  const r1 = s.update(e.id, { text: 'b' }, r0).revision
  assert.notEqual(r1, r0)
  s.remove(e.id, r1)
  assert.equal(s.snapshot().entries.length, 0)
})

test('corrupt lines counted, file survives', () => {
  const s = fresh()
  s.add({ text: 'ok', scope: 'global' }, 'ui')
  writeFileSync(join(s.dir, 'entries.jsonl'), readFileSync(join(s.dir, 'entries.jsonl'), 'utf8') + 'garbage-line\n', 'utf8')
  s.load()
  assert.equal(s.snapshot().corruptLines, 1)
  assert.equal(s.snapshot().entries.length, 1)
})

test('findUnique: 0/1/many', () => {
  const entries = [{ id: 'x1', text: 'alpha beta' }, { id: 'x2', text: 'beta gamma' }]
  assert.equal(findUnique(entries, { oldText: 'alpha' }).entry?.id, 'x1')
  assert.equal(findUnique(entries, { oldText: 'beta' }).matches.length, 2)
  assert.equal(findUnique(entries, { oldText: 'zzz' }).matches.length, 0)
  assert.equal(findUnique(entries, { id: 'x2' }).entry?.id, 'x2')
})

test('validateEntryText gates', () => {
  assert.equal(validateEntryText('  hi\u0007  ', 2000), 'hi')
  assert.throws(() => validateEntryText('x'.repeat(10), 9))
  assert.throws(() => validateEntryText('   ', 9))
})

test('add with tags:[] omits tags key in persisted JSON', () => {
  const s = fresh()
  s.add({ text: 'pinned', scope: 'global', tags: [] }, 'ui')
  const line = readFileSync(join(s.dir, 'entries.jsonl'), 'utf8').trim()
  const raw = JSON.parse(line)
  assert.ok(!('tags' in raw), 'tags key must be absent when empty')
  assert.ok(!('tags' in s.snapshot().entries[0]), 'in-memory entry must not carry tags either')
})

test('update sets tags then clears them back to absent', () => {
  const s = fresh()
  s.add({ text: 'pinned', scope: 'global' }, 'ui')
  const id = s.snapshot().entries[0].id
  const withTags = s.update(id, { tags: ['x'] })
  assert.deepEqual(withTags.entries[0].tags, ['x'])
  assert.ok('tags' in JSON.parse(readFileSync(join(s.dir, 'entries.jsonl'), 'utf8').trim()))
  const cleared = s.update(id, { tags: [] })
  assert.ok(!('tags' in cleared.entries[0]), 'cleared entry must not carry tags')
  assert.ok(!('tags' in JSON.parse(readFileSync(join(s.dir, 'entries.jsonl'), 'utf8').trim())), 'cleared JSON must omit tags key')
})
