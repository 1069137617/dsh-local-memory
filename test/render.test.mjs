// test/render.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderSnapshot } from '../lib/render.js'
import { DEFAULTS } from '../lib/config.js'

const snap = (entries) => ({ entries, revision: 'abcdef012345', corruptLines: 0 })
const e = (id, text, extra = {}) => ({ id, text, scope: 'global', importance: 'normal', source: 'ui',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra })

test('off switches yield empty string', () => {
  assert.equal(renderSnapshot(snap([e('1', 'x')]), { ...DEFAULTS, enabled: false }, ''), '')
  assert.equal(renderSnapshot(snap([e('1', 'x')]), { ...DEFAULTS, injectEnabled: false }, ''), '')
  assert.equal(renderSnapshot(snap([]), DEFAULTS, ''), '')
})
test('sections and budget', () => {
  const text = renderSnapshot(snap([e('1', 'g-entry'), e('2', 'w-entry', { scope: 'd:/p' })]), DEFAULTS, 'd:/p')
  assert.match(text, /LOCAL MEMORY SNAPSHOT \(revision abcdef012345/)
  assert.match(text, /Contents of global memory \(1 entry/)
  assert.match(text, /Contents of workspace memory \(d:\/p, 1 entry/)
})
test('omitted counted and announced', () => {
  const big = Array.from({ length: 20 }, (_, i) => e(String(i), 'x'.repeat(100)))
  const text = renderSnapshot(snap(big), { ...DEFAULTS, maxInjectionChars: 300 }, '')
  assert.match(text, /entries omitted — call local_memory_search/)
  assert.ok((text.match(/^§ /gm) ?? []).length < 20)
})
test('injectWorkspace=false hides ws section', () => {
  const text = renderSnapshot(snap([e('2', 'w', { scope: 'd:/p' })]), { ...DEFAULTS, injectWorkspace: false }, 'd:/p')
  assert.equal(text, '')
})
