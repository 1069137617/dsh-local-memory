// test/readme-parity.test.mjs
// README 的注入格式示例必须与真实渲染一致。此前两版示例的数字**都是错的**
// （声称 139/204，真值 112/65 与 79/42），且两版文本不同却共用同一组数字 ——
// 说明从写入文档那一刻起就没验证过。这个测试把"文档即真值"钉住。
//
// 只比对数字与模板措辞，不比 revision（内容指纹，示例里必然是示意值）。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULTS } from '../lib/config.js'
import { renderSnapshot } from '../lib/render.js'
import { MemoryStore } from '../lib/store.js'

const CWD = 'd:/code/x'
const EX = {
  'README.md': [
    { id: '9d99782417fe', importance: 'critical', tags: ['ftp'], text: 'Redeploys need a 45s cooldown' },
    { id: '6e2bfd8ae791', importance: 'low', tags: [], text: 'Legacy project notes' },
    { id: '2a647ba3910a', importance: 'normal', tags: [], text: 'Test baseline for this repo is 29/29' },
  ],
  'README.zh.md': [
    { id: '9d99782417fe', importance: 'critical', tags: ['ftp'], text: '发布要隔 45 秒重跑' },
    { id: '6e2bfd8ae791', importance: 'low', tags: [], text: '旧项目备忘' },
    { id: '2a647ba3910a', importance: 'normal', tags: [], text: '本仓库测试基线 29/29' },
  ],
}

const exampleBlock = (file) => {
  const md = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  // 必须锚定到小节标题：文件里还有别的 ``` 块（安装片段），直接找第一个围栏会吞掉整篇文档。
  const section = /##\s*(?:Injection format example|注入格式示例)([\s\S]*)/.exec(md)
  assert.ok(section, `${file}: could not find the injection format example section`)
  const block = /```\n([\s\S]*?)```/.exec(section[1])
  assert.ok(block, `${file}: the example section has no fenced block`)
  return block[1].trim()
}

const render = (rows) => {
  const dir = mkdtempSync(join(tmpdir(), 'lm-parity-'))
  const s = new MemoryStore(dir)
  s.load()
  for (const r of rows) {
    s.add({ text: r.text, scope: r.id === '2a647ba3910a' ? CWD : 'global', importance: r.importance, tags: r.tags }, 'ui', 8000)
  }
  // 覆写为示例里的 id：id 长度参与行长度，不还原就比对不成
  writeFileSync(s.file, readFileSync(s.file, 'utf8').trim().split('\n')
    .map((l, i) => JSON.stringify({ ...JSON.parse(l), id: rows[i].id })).join('\n') + '\n', 'utf8')
  s.load()
  return renderSnapshot(s.snapshot(), DEFAULTS, CWD)
}

const stripRev = (s) => s.replace(/revision [0-9a-f]+/, 'revision <REV>')

for (const [file, rows] of Object.entries(EX)) {
  test(`${file}: the injection example matches real output byte-for-byte`, () => {
    const doc = exampleBlock(file)
    const real = render(rows)
    assert.equal(stripRev(doc), stripRev(real), `${file} example drifted from the real renderer`)
  })

  test(`${file}: the example documents the running-total line for multi-group output`, () => {
    assert.match(exampleBlock(file), /\(total \d+\/4000 chars across 2 groups\)/)
  })
}
