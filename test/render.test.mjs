// test/render.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderSnapshot, safeRenderSnapshot } from '../lib/render.js'
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

// ---- P2：entryMaxChars × maxInjectionChars 可配成「写入即失明」----
// validateConfig 对两者独立校验（entryMaxChars 上限 8000、maxInjectionChars 下限 200），
// 而 put() 是「整条放不下就跳过、条内不截断」⇒ 一条合法写入可以永远进不了注入，
// 而 add 照常回执 committed。修法：每组至少强制注入排名第一的那条。
test('budget: a single entry larger than the whole budget is still injected', () => {
  const text = renderSnapshot(snap([e('big', 'x'.repeat(300))]), { ...DEFAULTS, maxInjectionChars: 200 }, '')
  assert.match(text, /\[id:big\]/, 'an entry bigger than the budget must not be silently invisible')
  assert.match(text, /x{300}/, 'the first entry is injected in full (no intra-entry truncation, per spec)')
})

test('budget: the guaranteed row does not resurrect entries filtered off by switches', () => {
  const only = snap([e('w1', 'ws-only', { scope: 'd:/p' })])
  assert.equal(renderSnapshot(only, { ...DEFAULTS, injectWorkspace: false }, 'd:/p'), '')
})

// 强制注入首条会让 used 超过 budget（条内不截断是 spec 冻结的）。超支必须显式说明，
// 否则分组头出现 "331/200 chars" 这种读者无法解释的数字。
test('budget: an over-budget group says so instead of printing an unexplained overrun', () => {
  const text = renderSnapshot(snap([e('big', 'x'.repeat(300))]), { ...DEFAULTS, maxInjectionChars: 200 }, '')
  assert.match(text, /over budget|exceeds|mandatory|kept/i, 'an over-budget header must be explained')
})

test('total line: absent for a single group, present when several groups render', () => {
  const single = renderSnapshot(snap([e('g1', 'only-global')]), DEFAULTS, '')
  assert.doesNotMatch(single, /total \d+\/4000 chars across/)
  const two = renderSnapshot(snap([e('g1', 'g'), e('w1', 'w', { scope: 'd:/p' })]), DEFAULTS, 'd:/p')
  assert.match(two, /\(total \d+\/4000 chars across 2 groups\)/)
})

test('budget: the summary header reports this group own chars, not the running total', () => {
  const text = renderSnapshot(snap([
    e('g1', 'g'.repeat(30)), e('g2', 'g'.repeat(30)), e('w1', 'w'.repeat(20), { scope: 'd:/p' }),
  ]), DEFAULTS, 'd:/p')
  const gUsed = Number(/Contents of global memory \([^)]*?(\d+)\/4000/.exec(text)?.[1])
  const wUsed = Number(/Contents of workspace memory \([^)]*?(\d+)\/4000/.exec(text)?.[1])
  const gRows = text.split('\n').filter((l) => l.startsWith('§') && l.includes('[id:g')).join('').length
  const wRows = text.split('\n').filter((l) => l.startsWith('§') && l.includes('[id:w')).join('').length
  assert.equal(gUsed, gRows + 2, 'global header must report its own two rows plus their newlines')
  assert.equal(wUsed, wRows + 1, 'workspace header must report its own row, not the running total')
  assert.match(text, /\(2 of 3 entries|\b3 entries\b|total/i, 'a running total must still be discoverable')
})

// 注入回调在 index.ts 里 catch 成空串；renderSnapshot 自身不得吞掉渲染失败。
test('render: a corrupt snapshot entry surfaces instead of blanking the snapshot', () => {
  const bad = { ...e('ok', 'fine'), text: undefined }
  const text = renderSnapshot(snap([e('ok', 'fine'), bad]), DEFAULTS, '')
  assert.match(text, /\[id:ok\]/)
})

test('safeRenderSnapshot: reports render failures instead of silently blanking', () => {
  const boom = { entries: null, revision: 'x', corruptLines: 0 }
  const seen = []
  const out = safeRenderSnapshot(boom, DEFAULTS, '', (err) => seen.push(err))
  assert.equal(out, '', 'a failed render degrades to no injection')
  assert.equal(seen.length, 1, 'the failure must reach the caller logger, not vanish')
  assert.ok(seen[0] instanceof Error)
})

test('safeRenderSnapshot: passes a healthy render through untouched', () => {
  const s = snap([e('1', 'fine')])
  assert.equal(safeRenderSnapshot(s, DEFAULTS, '', () => { throw new Error('must not be called') }), renderSnapshot(s, DEFAULTS, ''))
})
