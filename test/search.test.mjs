// test/search.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rankEntries, filterByScope, scoreEntries } from '../lib/search.js'

const e = (id, text, extra = {}) => ({ id, text, scope: 'global', importance: 'normal', source: 'ui',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: extra.updatedAt ?? '2026-01-01T00:00:00.000Z', ...extra })

test('rank: critical first, then recency', () => {
  const r = rankEntries([e('a', 'x'), e('b', 'y', { importance: 'critical' }), e('c', 'z', { updatedAt: '2026-06-01T00:00:00.000Z' })])
  assert.deepEqual(r.map((x) => x.id), ['b', 'c', 'a'])
})
test('filterByScope', () => {
  const list = [e('a', 'x'), e('b', 'y', { scope: 'd:/p' }), e('c', 'z', { scope: 'd:/q' })]
  assert.deepEqual(filterByScope(list, 'global', 'd:/p').map((x) => x.id), ['a'])
  assert.deepEqual(filterByScope(list, 'workspace', 'd:/p').map((x) => x.id), ['b'])
  assert.equal(filterByScope(list, 'all', '').length, 3)
})
test('scoreEntries: phrase>token, CJK substring, zero filtered', () => {
  const list = [e('a', 'deploy via ftp publish'), e('b', 'unrelated 记忆系统'), e('c', 'ftp')]
  assert.deepEqual(scoreEntries(list, 'ftp publish').map((x) => x.id), ['a', 'c'])
  assert.deepEqual(scoreEntries(list, '记忆').map((x) => x.id), ['b'])
  assert.deepEqual(scoreEntries(list, 'nope'), [])
})
