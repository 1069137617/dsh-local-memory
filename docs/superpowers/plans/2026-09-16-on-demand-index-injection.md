# 按需索引注入（injectMode）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `injectMode: 'full' | 'index'` 设置（默认 full 不改行为）：index 模式下 critical 条目全文注入、normal/low 只注入索引行，AI 经 `local_memory_search` 的 `ids` 参数按需展开全文。

**Architecture:** 四个独立可测单元沿既有 seam 落位——config.ts 加枚举键、render.ts 按模式分层渲染、tools.ts 检索加 ids 精确取回、MemoryPage.tsx 设置页加分段控件行；README/版本/发布收尾。存储格式与 RPC 协议零改动。

**Tech Stack:** TypeScript（tsc host 半 + esbuild client bundle）、node:test（测试 import `../lib/*.js`，跑前需 build）、@deepseek-ai/schemastery 3.18.2（`z.const` + `z.union` 已核实存在于 d.ts）、React 18（客户端半）。

**Spec:** `docs/superpowers/specs/2026-09-16-on-demand-index-injection-design.md`（已批准）

## Global Constraints

- 默认行为不变：`injectMode` 默认 `'full'`，full 模式渲染输出与 0.2.0 逐字节一致（既有 render 测试是回归锁）。
- 不新增任何运行时依赖；peerDependencies 不动。
- 展开通道只扩现有工具（`ids` 参数），**不新建工具定义**。
- 索引摘要长度固定 80 字符，不设配置项（YAGNI，spec 已钉）。
- 测试跑 `npm test`（pretest 自动 build）；单文件调试用 `npm run build; node --test test/<file>.mjs`。
- 发布门禁：`npm test` 全绿才可 publish（prepublishOnly 真跑）。
- 本机 link: 安装：**绝不** `npm prune` / `npm ci --omit=dev`。
- 宿主半（config/render/tools/index）改动需用户重启 dsh 生效；客户端半（MemoryPage/locales/styles）仅需刷新页面。
- 提交信息风格沿用仓库：`feat(scope): ...` / `test(scope): ...` / `docs: ...`。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/config.ts` | Modify | Config 增 `injectMode` 枚举键（schema + DEFAULTS + Pick 白名单） |
| `test/config.test.mjs` | Modify | 默认值与非法枚举拒绝的用例 |
| `src/render.ts` | Modify | index 模式分层渲染 + 展开指引行 |
| `test/render.test.mjs` | Modify | 索引行格式/省略号/指引行/回归锁 |
| `src/tools.ts` | Modify | search 工具 `ids` 参数：精确取回、missing、优先级、形态校验 |
| `test/tools.test.mjs` | Modify | ids 语义用例 |
| `src/MemoryPage.tsx` | Modify | 设置区「注入模式」分段控件行；cfg 合并循环纳入 injectMode |
| `src/locales.ts` | Modify | zh/en 各 4 词条 |
| `README.md` / `README.zh.md` | Modify | 设置表行 + 按需索引小节 |
| `package.json` | Modify | version 0.3.0（发布任务内） |

---

### Task 1: config — `injectMode` 枚举键

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.mjs`

**Interfaces:**
- Produces: `Config.injectMode: 'full' | 'index'`；`DEFAULTS.injectMode === 'full'`；`ConfigSchema` 拒绝其他值。Task 2/3/4 按此消费。

- [ ] **Step 1: 探针确认 schemastery 枚举写法**

```powershell
cd C:\Users\一诺吖\Documents\DSH\dsh-local-memory
node -e "import('@deepseek-ai/schemastery').then(({default:z})=>{const s=z.union([z.const('full'),z.const('index')]);console.log('ok:',s('full'), s('index'));try{s('nope');console.log('BUG: accepted invalid')}catch{console.log('rejects invalid: ok')}})"
```

预期输出 `ok: ...` 与 `rejects invalid: ok`。**若 `z.const`/`z.union` 运行时报缺失**：改用兜底写法 `injectMode: z.string()`，并在 `validateConfig` 加 `if (v.injectMode !== 'full' && v.injectMode !== 'index') throw new Error('injectMode must be full|index')`——后续步骤中的 schema 断言语义不变（非法值仍被拒），只是拒绝点从 schema 移到 validate。

- [ ] **Step 2: 写失败测试**

`test/config.test.mjs` 末尾追加：

```js
test('injectMode: default full, enum enforced', () => {
  assert.equal(DEFAULTS.injectMode, 'full')
  assert.equal(ConfigSchema.parse(DEFAULTS).injectMode, 'full')
  assert.equal(ConfigSchema.parse({ ...DEFAULTS, injectMode: 'index' }).injectMode, 'index')
  assert.throws(() => ConfigSchema.parse({ ...DEFAULTS, injectMode: 'nope' }))
})
```

- [ ] **Step 3: 跑测试确认失败**

```powershell
npm run build; node --test test/config.test.mjs
```

预期：新用例 FAIL（`injectMode` 为 undefined / 未拒绝非法值），其余 PASS。

- [ ] **Step 4: 实现**

`src/config.ts` 三处：

```ts
// BaseConfig 内，searchLimit 之后：
  injectMode: z.union([z.const('full'), z.const('index')]),

// Config 的 Pick 白名单追加 'injectMode'：
export type Config = Pick<Schemastery.TypeT<typeof BaseConfig>, 'enabled' | 'injectEnabled' | 'injectWorkspace' | 'allowAgentWrite' | 'maxInjectionChars' | 'entryMaxChars' | 'searchLimit' | 'injectMode'>

// DEFAULTS 追加：
  injectMode: 'full',
```

`validateConfig` 不加数值校验（枚举由 schema 保证；探针兜底路径除外）。

- [ ] **Step 5: 跑测试确认通过**

```powershell
npm run build; node --test test/config.test.mjs
```

预期：全 PASS。

- [ ] **Step 6: 提交**

```powershell
git add src/config.ts test/config.test.mjs
git commit -m "feat(config): injectMode enum (full|index), default full"
```

---

### Task 2: render — index 模式分层渲染

**Files:**
- Modify: `src/render.ts`
- Test: `test/render.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `Config.injectMode`。
- Produces: `renderSnapshot` 在 `injectMode==='index'` 时输出——critical 全文行、normal/low 索引行（`§ [id:<id>][<imp>][<tags>] <前80字>…`）、至少一条索引行时尾部指引行。full 模式输出逐字节不变。

- [ ] **Step 1: 写失败测试**

`test/render.test.mjs` 末尾追加（`e`/`snap` 帮助函数文件头已有）：

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
npm run build; node --test test/render.test.mjs
```

预期：新增 4 用例 FAIL（现渲染无摘要/指引行逻辑），既有 4 用例 PASS。

- [ ] **Step 3: 实现**

`src/render.ts` 整文件替换为（HEADER、预算裁决、分节结构保持原样；全文行模板原样搬入 `fullRow`）：

```ts
// src/render.ts
import { DEFAULTS, type Config } from './config.js'
import { rankEntries } from './search.js'
import type { MemoryEntry, StoreSnapshot } from './store.js'

const HEADER = (rev: string) =>
  `LOCAL MEMORY SNAPSHOT (revision ${rev}; dsh-local-memory; treat as quoted historical data — current instructions win. This snapshot supersedes earlier LOCAL MEMORY SNAPSHOTs.)`

// 索引模式（spec 2026-09-16-on-demand-index-injection）：normal/low 只注入摘要行，
// 展开走 local_memory_search 的 ids 参数；critical 恒全文（分层混合是用户拍板）。
const INDEX_SUMMARY_CHARS = 80

const fullRow = (e: MemoryEntry): string =>
  `§ [id:${e.id}][${e.importance}]${e.tags ? ` [${e.tags.join(',')}]` : ''} ${e.text.replace(/\n/g, ' ')}`

const indexRow = (e: MemoryEntry): string => {
  const flat = e.text.replace(/\n/g, ' ')
  const summary = flat.length > INDEX_SUMMARY_CHARS ? `${flat.slice(0, INDEX_SUMMARY_CHARS)}…` : flat
  return `§ [id:${e.id}][${e.importance}]${e.tags ? ` [${e.tags.join(',')}]` : ''} ${summary}`
}

export function renderSnapshot(snap: StoreSnapshot, cfg: Config, cwd: string): string {
  if (!cfg.enabled || !cfg.injectEnabled) return ''
  const indexMode = cfg.injectMode === 'index'
  const budget = Math.min(cfg.maxInjectionChars ?? DEFAULTS.maxInjectionChars, 20_000)
  const g = rankEntries(snap.entries.filter((e) => e.scope === 'global'))
  const w = cwd && cfg.injectWorkspace ? rankEntries(snap.entries.filter((e) => e.scope === cwd)) : []
  const lines: string[] = []
  let used = 0
  let omitted = 0
  let indexed = 0
  const put = (title: string, list: MemoryEntry[], label?: string): void => {
    if (!list.length) return
    const keep: string[] = []
    for (const e of list) {
      const asIndex = indexMode && e.importance !== 'critical'
      const row = asIndex ? indexRow(e) : fullRow(e)
      // 预算裁决（控制器预定简化）：条内不截断；整条放不下 → 计入 omitted 并跳过
      if (used + row.length + 1 > budget) { omitted += 1; continue }
      if (asIndex) indexed += 1
      keep.push(row)
      used += row.length + 1
    }
    if (!keep.length) return
    const count = keep.length === list.length
      ? `${keep.length} ${keep.length === 1 ? 'entry' : 'entries'}`
      : `${keep.length} of ${list.length} entries`
    const paren = [label, count].filter(Boolean).join(', ')
    lines.push(`Contents of ${title} (${paren}, ${used}/${budget} chars):`, ...keep)
  }
  put(`global memory`, g)
  put(`workspace memory`, w, cwd || undefined)
  // 短提示只针对"参与渲染但一条都放不下"；被开关/作用域过滤掉的条目不算，
  // 因此候选数用 g+w 而非 snap.entries.length（injectWorkspace=false 冻结测试要求返回 ''）。
  const candidates = g.length + w.length
  if (!lines.length) return candidates ? `${HEADER(snap.revision)}\n(0 of ${candidates} entries fit the ${budget}-char budget — call local_memory_search)` : ''
  if (indexed > 0) lines.push('(normal/low entries are index-only — call local_memory_search with ids=["..."] or query to expand full text)')
  if (omitted > 0) lines.push(`(${omitted} entries omitted — call local_memory_search to retrieve them)`)
  if (snap.corruptLines > 0) lines.push(`(warning: ${snap.corruptLines} unreadable lines were skipped in entries.jsonl)`)
  return `${HEADER(snap.revision)}\n${lines.join('\n')}`
}
```

注意：`cfg.injectMode === 'index'` 对缺键（undefined，旧配置持久层未含新键）天然落 full——向后兼容由构造保证。

- [ ] **Step 4: 跑测试确认通过**

```powershell
npm run build; node --test test/render.test.mjs
```

预期：8 用例全 PASS（含 4 条既有回归锁）。

- [ ] **Step 5: 提交**

```powershell
git add src/render.ts test/render.test.mjs
git commit -m "feat(render): index mode - critical full, normal/low summaries with expand hint"
```

---

### Task 3: tools — `local_memory_search` 的 `ids` 参数

**Files:**
- Modify: `src/tools.ts`
- Test: `test/tools.test.mjs`

**Interfaces:**
- Consumes: `MemoryStore.snapshot()`（现有）、`clipLimit`/`jsonEntry`（现有）。
- Produces: search 工具新参数 `ids?: string[]`——非空时优先于 query，按传入顺序精确取回全文条目，未命中 id 进 `missing: string[]`；空数组按未提供处理；非字符串数组形态 → `{completion:'failed'}`。Task 4/5 依赖工具名与参数名不变。

- [ ] **Step 1: 写失败测试**

`test/tools.test.mjs` 末尾追加（`harness`/`exec` 文件头已有）：

```js
test('search ids: exact fetch in given order, bypasses scope filter', async () => {
  const h = harness()
  const a = await h.remember.execute({ action: 'add', text: 'alpha entry', scope: 'workspace' }, exec('D:\\code\\x'))
  const b = await h.remember.execute({ action: 'add', text: 'beta entry' }, exec('D:\\code\\x'))
  const r = await h.search.execute({ ids: [b.id, a.id], query: 'alpha' }, exec('D:\\code\\x'))
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.items.map((i) => i.id), [b.id, a.id])   // ids 优先于 query；按传入顺序
  assert.equal(r.items[1].text, 'alpha entry')               // 取回的是全文
  assert.equal(r.missing, undefined)
})
test('search ids: missing ids reported, not an error', async () => {
  const h = harness()
  const a = await h.remember.execute({ action: 'add', text: 'real' }, exec('C:\\w'))
  const r = await h.search.execute({ ids: [a.id, 'deadbeef0000'] }, exec('C:\\w'))
  assert.equal(r.items.length, 1)
  assert.deepEqual(r.missing, ['deadbeef0000'])
})
test('search ids: empty array behaves as absent (falls through to query path)', async () => {
  const h = harness()
  await h.remember.execute({ action: 'add', text: 'kw target' }, exec('C:\\w'))
  const r = await h.search.execute({ ids: [], query: 'kw' }, exec('C:\\w'))
  assert.equal(r.completion, undefined)
  assert.equal(r.items.length, 1)
  assert.equal(r.missing, undefined)
})
test('search ids: limit clips id results', async () => {
  const h = harness()
  const ids = []
  for (const t of ['one', 'two', 'three']) ids.push((await h.remember.execute({ action: 'add', text: t }, exec('C:\\w'))).id)
  const r = await h.search.execute({ ids, limit: 2 }, exec('C:\\w'))
  assert.equal(r.items.length, 2)
  assert.equal(r.count, 2)
})
test('search ids: malformed ids fail explicitly', async () => {
  const h = harness()
  const r1 = await h.search.execute({ ids: 'not-an-array' }, exec('C:\\w'))
  assert.equal(r1.completion, 'failed')
  assert.match(r1.error, /ids/)
  const r2 = await h.search.execute({ ids: [123] }, exec('C:\\w'))
  assert.equal(r2.completion, 'failed')
})
test('search ids: disabled plugin still gates', async () => {
  const h = harness({ ...DEFAULTS, enabled: false })
  const r = await h.search.execute({ ids: ['whatever'] }, exec('C:\\w'))
  assert.equal(r.disabled, true)
})
```

- [ ] **Step 2: 跑测试确认失败**

```powershell
npm run build; node --test test/tools.test.mjs
```

预期：6 新用例 FAIL（ids 被忽略走 query 路径 → items 空/missing undefined 断言崩），既有 9 用例 PASS。

- [ ] **Step 3: 实现**

`src/tools.ts` 三处修改：

1）`makeSearchTool` 的 `description` 整串替换为：

```ts
  description: 'Search this plugin\'s local memory store (dsh-local-memory; independent of Mnemon). Empty query lists the most recent entries. ids: exact fetch by entry id (from the injected snapshot index) — bypasses ranking and scope, returns full text, use this to expand index lines. scope: "all" (default) | "global" | "workspace" (current session cwd). limit <= 32.',
```

2）`parameters` 中 `limit` 之后追加：

```ts
    ids: { type: 'json', description: 'string array of entry ids; exact full-text fetch in given order, bypasses ranking and scope filter. Max 32.' },
```

3）`execute` 内，在 `const cwd = cwdOf(exec)` 之前（即 scope 校验之后）插入 ids 分支，并把参数解构类型补 `ids?: unknown`：

```ts
      const a = (args ?? {}) as { query?: string; scope?: string; limit?: number; ids?: unknown }
```

```ts
      // ids 精确取回（spec 2026-09-16）：非空数组时优先于 query；作用域过滤不适用
      // （id 是权威定位）；空数组按未提供处理；形态非法显式 failed 不静默。
      if (a.ids !== undefined) {
        if (!Array.isArray(a.ids) || a.ids.some((x) => typeof x !== 'string')) {
          return { completion: 'failed' as const, error: 'ids must be an array of entry id strings' }
        }
        if (a.ids.length > 0) {
          const wanted = a.ids as string[]
          const snap = store.snapshot()
          const limit = clipLimit(a.limit, c)
          const picked = wanted.map((id) => snap.entries.find((e) => e.id === id))
          const found = picked.filter((e): e is MemoryEntry => e !== undefined)
          const missing = wanted.filter((_, i) => picked[i] === undefined)
          return {
            revision: snap.revision,
            count: Math.min(found.length, limit),
            items: found.slice(0, limit).map(jsonEntry),
            ...(missing.length ? { missing } : {}),
          }
        }
      }
```

（`MemoryEntry` 类型已在文件头 import 列表中存在，无需新增。）

- [ ] **Step 4: 跑测试确认通过**

```powershell
npm run build; node --test test/tools.test.mjs
```

预期：15 用例全 PASS。

- [ ] **Step 5: 提交**

```powershell
git add src/tools.ts test/tools.test.mjs
git commit -m "feat(tools): local_memory_search ids param - exact full-text expansion"
```

---

### Task 4: UI — 设置页「注入模式」分段控件行

**Files:**
- Modify: `src/MemoryPage.tsx`
- Modify: `src/locales.ts`

**Interfaces:**
- Consumes: Task 1 的设置键名 `injectMode`（经现有 `field()` 提交）；现有 `dshlm-seg`/`dshlm-seg-btn`/`dshlm-seg-on` 样式。
- Produces: 无下游任务依赖（终端 UI）。

- [ ] **Step 1: locales 加词条**

`src/locales.ts`：`zh` 字典中 `'allowAgentWrite.desc'` 相关键之后（保持设置键相邻）加：

```ts
  'injectMode.label': '注入模式',
  'injectMode.desc': '按需索引：critical 条目保留全文，normal/low 只注入摘要行，AI 用 local_memory_search 按 id 展开细节。',
  'injectMode.full': '全文',
  'injectMode.index': '按需索引',
```

`en` 字典对应位置加：

```ts
  'injectMode.label': 'Injection mode',
  'injectMode.desc': 'On-demand index: critical entries stay full-text; normal/low inject summary lines the agent expands via local_memory_search(ids=…).',
  'injectMode.full': 'Full text',
  'injectMode.index': 'On-demand index',
```

- [ ] **Step 2: MemoryPage 合并循环纳入 injectMode**

```ts
const SETTING_KEYS = ['enabled', 'injectEnabled', 'injectWorkspace', 'allowAgentWrite'] as const
const NUMBER_KEYS = ['maxInjectionChars', 'entryMaxChars', 'searchLimit'] as const
const MODE_KEYS = ['injectMode'] as const
```

cfg 合并 useMemo 内循环改为：

```ts
    for (const k of [...SETTING_KEYS, ...NUMBER_KEYS, ...MODE_KEYS]) {
```

- [ ] **Step 3: 设置区加分段控件行**

`MemoryPage.tsx` 中 `{NUMBER_KEYS.map(...)}` 整块之后、`</div>`（`.dshlm-settings` 收尾）之前插入：

```tsx
        <div className="dshlm-setrow">
          <div className="dshlm-setrow-text">
            <div className="dshlm-setrow-label">{t('injectMode.label')}</div>
            <div className="dshlm-setrow-desc">{t('injectMode.desc')}</div>
          </div>
          <div className="dshlm-setrow-control">
            <div className="dshlm-seg" role="radiogroup" aria-label={t('injectMode.label')}>
              {(['full', 'index'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={String(cfg.injectMode ?? 'full') === m}
                  className={String(cfg.injectMode ?? 'full') === m ? 'dshlm-seg-btn dshlm-seg-on' : 'dshlm-seg-btn'}
                  disabled={!cfgReady || !writable}
                  onClick={() => field('injectMode', m)}
                >
                  {t(m === 'full' ? 'injectMode.full' : 'injectMode.index')}
                </button>
              ))}
            </div>
          </div>
        </div>
```

（`String(cfg.injectMode ?? 'full')`：cfg 是 `Partial<Config>`，快照未就绪时落 'full'。）

- [ ] **Step 4: 构建 + 类型检查验证**

```powershell
npm run build; npm run typecheck
```

预期：build 双半成功、纯净性闸门 `requires=[react, react/jsx-runtime]`、typecheck 退出 0。UI 无单测（仓库既定：客户端半由 client-bundle.test 的构建契约 + 人工冒烟覆盖）。

- [ ] **Step 5: 提交**

```powershell
git add src/MemoryPage.tsx src/locales.ts
git commit -m "feat(ui): injection mode segmented control on settings page"
```

---

### Task 5: 文档 + 全量回归 + 发布 0.3.0

**Files:**
- Modify: `README.md`、`README.zh.md`、`package.json`

**Interfaces:**
- Consumes: Task 1–4 全部产出。
- Produces: npm `dsh-local-memory@0.3.0` + GitHub tag `v0.3.0`。

- [ ] **Step 1: README 双语更新**

`README.md`：
1. Capabilities 第 2 条 `local_memory_search (query/scope/limit retrieval ...)` 改为 `local_memory_search (query/scope/limit retrieval, plus ids for exact full-text expansion of index lines)`。
2. Settings 表 `searchLimit` 行后加：

```markdown
| `injectMode` | `full` (`full`/`index`) | `index`: critical entries stay full-text, normal/low inject 80-char summary lines the agent expands via `local_memory_search(ids=[…])` |
```

3. 注入格式示例小节后加短节：

```markdown
## On-demand index mode

With `injectMode: "index"` the snapshot keeps `critical` entries verbatim and renders normal/low entries as one-line summaries (`§ [id:…][importance][tags] first 80 chars…`), cutting the standing context to roughly a third. A trailing hint tells the agent to expand any line via `local_memory_search` with `ids`. Default is `full` (no behavior change until opted in); toggling back restores the previous rendering byte-for-byte.
```

`README.zh.md` 对应位置：
1. 能力第 2 条加「`ids` 精确展开索引行全文」。
2. 设置表加：

```markdown
| `injectMode` | `full`（`full`/`index`） | `index`：critical 保留全文，normal/low 只注入 80 字摘要行，AI 用 `local_memory_search(ids=[…])` 按需展开 |
```

3. 注入格式示例后加：

```markdown
## 按需索引模式

`injectMode` 设为 `index` 后：critical 条目仍逐字注入；normal/low 只注入一行摘要（`§ [id:…][importance][tags] 前80字…`），常驻上下文约降至三分之一。快照尾部自带指引行，AI 据此用 `local_memory_search` 的 `ids` 参数按 id 展开全文。默认 `full`，行为与旧版完全一致；切回即逐字节恢复原渲染。
```

- [ ] **Step 2: 全量测试回归**

```powershell
npm test
```

预期：41 + 11（Task1 1 + Task2 4 + Task3 6）= 52 全 PASS。

- [ ] **Step 3: 版本号 + 提交 + 推送**

`package.json` `"version": "0.2.0"` → `"0.3.0"`。

```powershell
git add -A
git commit -m "chore(release): 0.3.0 - on-demand index injection (injectMode)"
git tag v0.3.0
git push origin master
git push origin v0.3.0
```

- [ ] **Step 4: npm publish**

```powershell
npm publish
```

预期：`+ dsh-local-memory@0.3.0`（prepublishOnly 再跑全量测试）。复核：

```powershell
npm view dsh-local-memory version --registry=https://registry.npmjs.org/
```

预期输出 `0.3.0`。

- [ ] **Step 5: 生效提示（用户操作）**

宿主半（config/render/tools）已变：提醒用户**保存会话 → 重启 dsh**；重启后设置页出现「注入模式」行，切到「按需索引」，下一回合起注入即为分层索引格式。

---

## Self-Review 结论

1. **Spec 覆盖**：配置✅（T1）渲染分层/摘要/指引行/预算✅（T2）ids 语义含空数组/missing/优先级/limit/形态✅（T3）UI 行与词条✅（T4）README/版本/发布✅（T5）。无遗漏。
2. **占位符扫描**：无 TBD/“类似上文”；schema 探针步骤给出两种确定结局。
3. **类型一致性**：`injectMode: 'full'|'index'`（T1 产出）→ T2 `cfg.injectMode === 'index'`、T4 `field('injectMode', m)` 消费一致；`missing`/`items` 字段名 T3 测试与实现一致；测试计数 41→52 与既有用例数吻合。
