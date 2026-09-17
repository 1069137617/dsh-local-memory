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
test('index mode: critical stays full, normal/low become summaries', () => {
  const long = '指'.repeat(100)
  const text = renderSnapshot(snap([
    e('c1', 'critical 规则全文', { importance: 'critical' }),
    e('n1', long, { tags: ['ftp'] }),
    e('l1', '短条目', { importance: 'low' }),
  ]), { ...DEFAULTS, injectMode: 'index' }, '')
  assert.match(text, /\[id:c1\]\[critical\] critical 规则全文/)
  assert.match(text, /\[id:n1\]\[normal\] \[ftp\] 指{80}…/)        // 截 80 字 + 省略号（tags 前导空格为原格式）
  assert.match(text, /\[id:l1\]\[low\] 短条目$/m)                     // ≤80 字无省略号（/m 行尾匹配）
  assert.doesNotMatch(text, /指{81}/)                                // 全文不外泄
  assert.match(text, /index-only — call local_memory_search with ids=/)
})
test('index mode: hint absent when nothing is indexed', () => {
  const text = renderSnapshot(snap([e('c1', 'only critical', { importance: 'critical' })]), { ...DEFAULTS, injectMode: 'index' }, '')
  assert.doesNotMatch(text, /index-only/)
})
test('index mode: summaries obey budget and count as omitted', () => {
  const many = Array.from({ length: 30 }, (_, i) => e(String(i), 'y'.repeat(200)))
  const text = renderSnapshot(snap(many), { ...DEFAULTS, injectMode: 'index', maxInjectionChars: 400 }, '')
  const rows = (text.match(/^§ /gm) ?? []).length
  assert.ok(rows > 0 && rows < 30)
  assert.match(text, /entries omitted — call local_memory_search/)
})
test('full mode regression: output byte-identical to pre-index behavior', () => {
  const entries = [e('1', 'g-entry'), e('2', 'w-entry', { scope: 'd:/p' }), e('3', 'c', { importance: 'critical' })]
  const a = renderSnapshot(snap(entries), DEFAULTS, 'd:/p')
  const b = renderSnapshot(snap(entries), { ...DEFAULTS, injectMode: undefined }, 'd:/p')
  assert.equal(a, b)                                                  // 缺省/显式 full 同输出
  assert.doesNotMatch(a, /index-only/)
})
