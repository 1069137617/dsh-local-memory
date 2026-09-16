# dsh-local-memory 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立第三方 DSH 插件 `dsh-local-memory`：本地 JSONL 记忆，每轮注入 runtime-context 快照、注册 `local_memory_search`/`local_memory_remember` 两工具、Web 设置面板「本地记忆」管理页（查看+编辑）。

**Architecture:** 宿主半（cordis 插件，Node ESM）持 store（`~/.dsh/local-memory/entries.jsonl`），经 `systemPrompt.context()` 注入、`tools.register()` 暴露读写、`connection.rpc.handle()` 供页面 CRUD；浏览器半（esbuild CJS bundle）用 `settings.section` 槽挂 React 页，条目走 RPC、配置走 `settingsScope.bind`。不 import 任何 dsh-mnemon 包。

**Tech Stack:** TypeScript 5.9.3（strict）、@deepseek-ai/cordis ^4.0.2、dsh-tools/dsh-settings/dsh-system-prompt/dsh-home-paths（peer >=0.1.5-rc.1）、@deepseek-ai/schemastery >=3.18.1、React 18（仅浏览器半、external）、esbuild、node:test。

**Spec:** `docs/superpowers/specs/2026-09-16-dsh-local-memory-design.md`（含全部宿主接缝 file:line 证据）。工程骨架平移 `C:\Users\一诺吖\Documents\DSH\dsh-reasoning-tiers`。

## Global Constraints

- 插件目录：`C:\Users\一诺吖\Documents\DSH\dsh-local-memory`；包名/`name` 导出：宿主半 `local-memory`，浏览器半同名，RPC channel 唯一 `/local-memory`。
- **零 dsh-mnemon 依赖**（dependencies/peer/dev 都不许出现，wiring 测试断言之）。
- peer 版本下限：`@deepseek-ai/cordis ^4.0.2`；`@deepseek-ai/dsh-{tools,settings,system-prompt,home-paths,client-connection}` `>=0.1.5-rc.1`；dev 精确锁这些包的 `0.1.5-rc.2`。**例外**：`@deepseek-ai/schemastery` 版本线独立（peer `>=3.18.1`、dev `3.18.2`，实测宿主 bundled 即 3.18.2，0.1.5-rc.x 不存在）。
- `link:` 安装模式下 Node 从**插件自己的 node_modules** 解析宿主包——绝不在插件目录跑 `npm ci --omit=dev` / `npm prune`（既有事故经验）。
- 所有身份常量：设置节 `local-memory`（`applies:'live'`）；context `name:'local-memory:snapshot'`、`order:200`、不用 `complete`；工具名 `local_memory_search`、`local_memory_remember`；设置页槽 entry id `local-memory`、`order:45`；locale NS `local-memory`；CSS 类前缀 `dshlm-`。
- scope 归一化（全库唯一实现，store.ts 导出）：trim → `\`→`/` → 去尾 `/` → 盘符小写；`global` 恒为字面量 `'global'`。
- 单条 text 上限 `entryMaxChars`（默认 2000）；快照预算 `maxInjectionChars`（默认 4000）；`searchLimit` 默认 8 上限 32；坏行容忍、原子写（tmp+rename，Windows EPERM 时 unlink 重试一次）。
- 注入 `text()` 与 RPC handler 内部**任何异常必须 catch**：前者返回 `''`，后者返回 `{ok:false,error:{code:'store-error',…}}`，绝不冒泡打断宿主。
- 提交节奏：每个 Task 末 `git commit`；`git init` 在 Task 1（workspace 根无 .git，docs 两份文档一并纳入插件仓）。
- 平台语义按 Windows 目标机验证（盘符大小写、rename 行为）。
- 安装生效需**重启 `dsh web`**（bundles 仅启动读取）；重启会断当前会话（本 GUI 会话就跑在该进程里）——冒烟只能由用户主动执行，见 Task 9。离线装前自检用 `dsh --profile web --dump-config`（不占端口）。
- defineTool 的 parameters DSL **不用 enum 关键字**（宿主 DSL 未证实支持），取值约束写进 description 并在 execute 内校验。

## File Structure

```
dsh-local-memory/
├── package.json  tsconfig.json  tsconfig.client.json  cordis.patch.yml(宿主行 insert)  LICENSE(MIT)  .gitignore
├── docs/superpowers/{specs,plans}/…            # Task 1 从 workspace 根拷入本仓
├── scripts/build.mjs  scripts/verify-install.mjs   # 平移，仅改日志前缀/包名常量
├── scripts/migrate-from-mnemon.mjs                 # Task 8（读 memories.json，非破坏复制）
├── src/
│   ├── config.ts     # schemastery 设置节 schema + DEFAULTS + validateConfig   → Task 3
│   ├── store.ts      # MemoryStore(同步 CRUD)+normalizeScope+RevisionConflictError+findUnique → Task 2
│   ├── search.ts     # rankEntries / filterByScope / scoreEntries               → Task 3
│   ├── render.ts     # renderSnapshot(snapshot, cfg, cwd)                        → Task 3
│   ├── tools.ts      # makeSearchTool / makeRememberTool                         → Task 4
│   ├── protocol.ts   # RPC_CHANNEL + createRpcHandler                            → Task 5
│   ├── index.ts      # 宿主半 apply()：settings/store/tools/injection/rpc 接线    → Task 4(工具) 5(RPC) 6(注入终装)
│   ├── client.ts     # 浏览器半 apply()：locale+settings.section+RPC 桥           → Task 6
│   ├── MemoryPage.tsx + api.ts（RPC/binder 结构类型 + bindScope）                 → Task 6
│   └── locales.ts  styles.ts                                                     → Task 6
└── test/ store search render config protocol tools wiring client-bundle migrate  *.test.mjs
```

依赖边：`store ← (search, render, tools, protocol)`；`(tools, protocol) ← index`；测试只 import `lib/`（pretest 先 build）。

---

### Task 1: 骨架 + 空插件装活

**Files:**
- Create: `dsh-local-memory/package.json`、`tsconfig.json`、`tsconfig.client.json`、`cordis.patch.yml`、`.gitignore`、`LICENSE`、`src/index.ts`(stub)、`src/client.ts`(stub)、`scripts/build.mjs`、`scripts/verify-install.mjs`、`test/wiring.test.mjs`
- Copy-in: `docs/superpowers/specs/2026-09-16-dsh-local-memory-design.md`、本 plan 文件

**Interfaces:**
- Consumes: 无（首任务）
- Produces: 可 `npm run build`/`npm test`/`npm run verify:install web` 的空壳；后续任务只加文件不改骨架

- [ ] **Step 1: 写 wiring 失败测试（只断言骨架形状）**

```js
// test/wiring.test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('package shape', () => {
  assert.equal(pkg.name, 'dsh-local-memory')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.deepEqual(pkg.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale'],
  })
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
})

test('no mnemon anywhere in manifests', () => {
  const blob = JSON.stringify(pkg)
  assert.ok(!blob.includes('dsh-mnemon'), 'package.json must not reference dsh-mnemon')
})

test('peer floors', () => {
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-tools'], '>=0.1.5-rc.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-system-prompt'], '>=0.1.5-rc.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd C:\Users\一诺吖\Documents\DSH\dsh-local-memory; node --test`
Expected: FAIL（package.json 不存在）

- [ ] **Step 3: 写 package.json**

以 `dsh-reasoning-tiers/package.json` 为底（`pwsh`: `[System.IO.File]::ReadAllText(...)` 读，无 BOM UTF-8 中文坑见全局记忆），逐项改：

```json
{
  "name": "dsh-local-memory",
  "version": "0.1.0",
  "description": "独立本地记忆插件：JSONL 记忆条目、每轮 runtime-context 注入、local_memory_search/local_memory_remember 工具、设置面板管理页。不依赖 dsh-mnemon。",
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "memory", "local-memory", "runtime-context"],
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "license": "MIT",
  "repository": { "type": "git", "url": "" },
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./client": { "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "README.md", "README.zh.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-locale"] }
  },
  "engines": { "node": ">=20" },
  "os": ["darwin", "linux", "win32"],
  "scripts": {
    "prepare": "npm run build",
    "build": "npm run build:host && npm run build:client",
    "build:host": "tsc -p tsconfig.json",
    "build:client": "node scripts/build.mjs",
    "watch": "node scripts/build.mjs --watch",
    "clean": "node -e \"require('node:fs').rmSync('lib',{recursive:true,force:true})\"",
    "typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit",
    "pretest": "npm run build",
    "test": "node --test",
    "verify:install": "node scripts/verify-install.mjs",
    "prepublishOnly": "npm test"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.2",
    "@deepseek-ai/dsh-home-paths": ">=0.1.5-rc.1",
    "@deepseek-ai/dsh-settings": ">=0.1.5-rc.1",
    "@deepseek-ai/dsh-system-prompt": ">=0.1.5-rc.1",
    "@deepseek-ai/dsh-tools": ">=0.1.5-rc.1",
    "@deepseek-ai/schemastery": ">=3.18.1"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "4.0.2",
    "@deepseek-ai/dsh-client-connection": "0.1.5-rc.2",
    "@deepseek-ai/dsh-client-locale": "0.1.5-rc.2",
    "@deepseek-ai/dsh-client-ui-renderer": "0.1.5-rc.2",
    "@deepseek-ai/dsh-client-ui-settings": "0.1.5-rc.2",
    "@deepseek-ai/dsh-client-ui-slots": "0.1.5-rc.2",
    "@deepseek-ai/dsh-home-paths": "0.1.5-rc.2",
    "@deepseek-ai/dsh-settings": "0.1.5-rc.2",
    "@deepseek-ai/dsh-system-prompt": "0.1.5-rc.2",
    "@deepseek-ai/dsh-tools": "0.1.5-rc.2",
    "@deepseek-ai/schemastery": "3.18.2",
    "@types/node": "^24.0.0",
    "@types/react": "~18.3.1",
    "@types/react-dom": "~18.3.0",
    "esbuild": "^0.28.2",
    "react": "^18.3.1",
    "typescript": "5.9.3"
  },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

（dev 包版本以 reasoning-tiers 现装的 `0.1.5-rc.2` 为准；五个 dsh-* 包实测均有 0.1.5-rc.2；schemastery 用 3.18.2，见全局约束例外条。）

- [ ] **Step 4: 平移骨架文件**

- `tsconfig.json`、`tsconfig.client.json`：从 `dsh-reasoning-tiers/` 拷贝后**必须重写 include 数组**（原文件是逐文件字面列表；照抄会让后续新增 src 文件被静默漏编译）：
  - tsconfig.json → `"include": ["src/index.ts", "src/config.ts", "src/store.ts", "src/search.ts", "src/render.ts", "src/tools.ts", "src/protocol.ts"]`（暂不存在的文件不匹配任何东西，安全；Task 4/5 逐个到位）
  - tsconfig.client.json → `"include": ["src/client.ts", "src/MemoryPage.tsx", "src/api.ts", "src/locales.ts", "src/styles.ts"]`
- `scripts/build.mjs`：原样拷贝；仅把两处日志前缀字符串 `dsh-reasoning-tiers` 改为 `dsh-local-memory`（`build.mjs:152,158`）。
- `scripts/verify-install.mjs`：拷贝后打开文件，把内部出现的包名/目录常量 `dsh-reasoning-tiers` 全部替换为 `dsh-local-memory`。
- `cordis.patch.yml`：宿主行（裁决 2026-09-16：普通 DSH bundle 插件必须经 bundle patch 挂载，先例=dsh-reasoning-tiers/dsh-think-follow 的 patch 文件与 verify-install check 5；"Source 包不自激活 patch"仅适用 mnemon Source，移植错误）：

```yaml
# dsh-local-memory bundle patch: one host row over the profile.
# The row is what makes the package visible to the Loader; the browser half
# rides along through the package.json `dsh.client` declaration.
# No `config:` block on purpose — defaults live in src/config.ts.
- insert:
    - id: local-memory
      name: dsh-local-memory
```
- `.gitignore`：`node_modules/`、`lib/`、`*.tsbuildinfo`、`.superpowers/`。
- `LICENSE`：拷 reasoning-tiers 的 MIT，版权行改本插件。

- [ ] **Step 5: stub 半体 + 安装依赖**

```ts
// src/index.ts（stub，Task 4 重写）
import type { Context } from '@deepseek-ai/cordis'
export const name = 'local-memory'
export const inject = [] as const
export function apply(_ctx: Context): void { /* wired in Task 4/5/6 */ }
```

```ts
// src/client.ts（stub，Task 6 重写）
import type { Context } from '@deepseek-ai/cordis'
export const name = 'local-memory'
export const inject = [] as const
export function apply(_ctx: Context): void { /* wired in Task 6 */ }
```

Run: `npm i`（在插件目录）→ `npm test` → 预期 wiring 3 绿（pretest 的 `build:client` 对 stub client 也要过：client.ts 无宿主包 value import，纯净闸门天然满足）。

- [ ] **Step 6: 装前离线自检**

Run: `npm run typecheck; npm run verify:install web`
Expected: 通过（verify-install 从 profile 重放宿主解析）。

- [ ] **Step 7: 挂进 profile（不重启）**

编辑 `C:\Users\一诺吖\.dsh\profiles\web\package.json`：`dependencies` 加 `"dsh-local-memory": "link:C:/Users/一诺吖/Documents/DSH/dsh-local-memory"`；`dsh.profile.bundles` 在 `"dsh-reasoning-tiers"` 之后插 `"dsh-local-memory"`。
Run: `dsh --profile web --dump-config | Select-String 'local-memory'`
Expected: 条目出现且命令不占端口正常退出。

- [ ] **Step 8: 建仓提交**

```powershell
git init; git add -A; git commit -m "chore: scaffold dsh-local-memory (tasks wiring green)"
```

（workspace 根的 spec/plan 两份文档 `Copy-Item` 到 `docs/superpowers/{specs,plans}/` 一并入仓。）

---

### Task 2: store.ts（JSONL 存储核心）

**Files:**
- Create: `src/store.ts`、`test/store.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces（后续全部依赖，签名冻结）：
  - `type Importance = 'critical' | 'normal' | 'low'`
  - `interface MemoryEntry { id: string; text: string; scope: string; importance: Importance; tags?: string[]; source: 'agent' | 'ui'; createdAt: string; updatedAt: string }`
  - `interface StoreSnapshot { entries: MemoryEntry[]; revision: string; corruptLines: number }`
  - `class RevisionConflictError extends Error { current: string }`
  - `normalizeScope(raw: string): string`
  - `class MemoryStore { constructor(dir: string); load(): StoreSnapshot; snapshot(): StoreSnapshot; revision(): string; byId(id: string): MemoryEntry | undefined; newId(): string; add(input: { text: string; scope: string; importance?: Importance; tags?: string[] }, source: 'agent' | 'ui', maxChars?: number, when?: { createdAt?: string; updatedAt?: string }): StoreSnapshot; update(id: string, patch: { text?: string; importance?: Importance; tags?: string[] }, expectedRevision?: string, maxChars?: number): StoreSnapshot; remove(id: string, expectedRevision?: string): StoreSnapshot }`（`when` 仅供 Task 8 迁移保留原时间戳，常规调用不传）
  - `findUnique(entries: MemoryEntry[], q: { id?: string; oldText?: string }): { entry?: MemoryEntry; matches: MemoryEntry[] }`
  - `validateEntryText(text: string, maxChars: number): string`（trim + 去控制字符 + 长度闸，抛 `Error('…')`）

- [ ] **Step 1: 写失败测试**

```js
// test/store.test.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
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
  const { writeFileSync } = await import('node:fs')   // 见下方注记①：顶层改为静态 import
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
```

注记①（实现前修正测试写法）：顶部静态 `import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'`，删掉用例内 dynamic import。

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test test/store.test.mjs`（不 pretest；lib 未产出）
Expected: FAIL `Cannot find module '../lib/store.js'`

- [ ] **Step 3: 实现 store.ts**

```ts
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Importance = 'critical' | 'normal' | 'low'
export interface MemoryEntry {
  id: string; text: string; scope: string; importance: Importance
  tags?: string[]; source: 'agent' | 'ui'; createdAt: string; updatedAt: string
}
export interface StoreSnapshot { entries: MemoryEntry[]; revision: string; corruptLines: number }

export class RevisionConflictError extends Error {
  constructor(public readonly current: string) { super(`revision conflict, current ${current}`) }
}

export const normalizeScope = (raw: string): string => {
  const s = (raw ?? '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (!s) return s
  if (s === 'global') return 'global'
  return /^[A-Za-z]:\//.test(s) ? s[0].toLowerCase() + s.slice(1) : s
}

export const validateEntryText = (text: string, maxChars: number): string => {
  const t = (text ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()
  if (!t) throw new Error('entry text is empty')
  if (t.length > maxChars) throw new Error(`entry text exceeds ${maxChars} chars`)
  return t
}

const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12)

export function findUnique(entries: MemoryEntry[], q: { id?: string; oldText?: string }): { entry?: MemoryEntry; matches: MemoryEntry[] } {
  if (q.id) {
    const hit = entries.filter((e) => e.id === q.id)
    return { entry: hit[0], matches: hit }
  }
  const needle = (q.oldText ?? '').trim().toLowerCase()
  const matches = needle ? entries.filter((e) => e.text.toLowerCase().includes(needle)) : []
  return { entry: matches.length === 1 ? matches[0] : undefined, matches }
}

const IMPORTANCES: readonly Importance[] = ['critical', 'normal', 'low']

export class MemoryStore {
  private entries: MemoryEntry[] = []
  private corrupt = 0
  constructor(public readonly dir: string) {}
  get file(): string { return join(this.dir, 'entries.jsonl') }

  load(): StoreSnapshot {
    this.entries = []
    this.corrupt = 0
    let raw = ''
    try { raw = readFileSync(this.file, 'utf8') } catch { raw = '' }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (typeof parsed?.id !== 'string' || typeof parsed?.text !== 'string') throw new Error('shape')
        this.entries.push(this.adopt(parsed))
      } catch { this.corrupt += 1 }
    }
    return this.snapshot()
  }

  private adopt(raw: Record<string, unknown>): MemoryEntry {
    const tags = Array.isArray(raw.tags) ? (raw.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 8) : []
    const now = new Date().toISOString()
    return Object.freeze({
      id: String(raw.id), text: String(raw.text),
      scope: typeof raw.scope === 'string' && raw.scope ? raw.scope : 'global',
      importance: IMPORTANCES.includes(raw.importance as Importance) ? (raw.importance as Importance) : 'normal',
      ...(tags.length ? { tags } : {}),
      source: raw.source === 'agent' ? 'agent' : 'ui',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
    })
  }

  revision(): string {
    return digest(this.entries.map((e) => [e.id, e.text, e.scope, e.importance, e.tags ?? [], e.updatedAt]).sort((a, b) => (a[0] < b[0] ? -1 : 1)))
  }
  snapshot(): StoreSnapshot { return { entries: [...this.entries], revision: this.revision(), corruptLines: this.corrupt } }
  byId(id: string): MemoryEntry | undefined { return this.entries.find((e) => e.id === id) }

  newId(): string {
    for (let i = 0; i < 5; i += 1) {
      const id = randomUUID().replace(/-/g, '').slice(0, 12)
      if (!this.byId(id)) return id
    }
    throw new Error('id generation failed')
  }

  add(input: { text: string; scope: string; importance?: Importance; tags?: string[] }, source: 'agent' | 'ui', maxChars = 2000, when?: { createdAt?: string; updatedAt?: string }): StoreSnapshot {
    const now = new Date().toISOString()
    const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 8).map((t) => t.slice(0, 32))
    const entry: MemoryEntry = {
      id: this.newId(), text: validateEntryText(input.text, maxChars),
      scope: input.scope === 'global' ? 'global' : normalizeScope(input.scope) || 'global',
      importance: input.importance ?? 'normal', ...(tags.length ? { tags } : {}),
      source, createdAt: when?.createdAt ?? now, updatedAt: when?.updatedAt ?? now,
    }
    this.entries.push(entry)
    this.flush()
    return this.snapshot()
  }

  update(id: string, patch: { text?: string; importance?: Importance; tags?: string[] }, expectedRevision?: string, maxChars = 2000): StoreSnapshot {
    this.guard(expectedRevision)
    const entry = this.byId(id)
    if (!entry) throw new Error(`no entry ${id}`)
    const tags = patch.tags === undefined ? entry.tags
      : ((patch.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 8).map((t) => t.slice(0, 32)))
    const next: MemoryEntry = {
      ...entry,
      text: patch.text === undefined ? entry.text : validateEntryText(patch.text, maxChars),
      ...(patch.importance ? { importance: patch.importance } : {}),
      ...(tags?.length ? { tags } : {}),
      updatedAt: new Date().toISOString(),
    }
    if (!tags?.length) delete (next as { tags?: string[] }).tags
    this.entries[this.entries.indexOf(entry)] = next
    this.flush()
    return this.snapshot()
  }

  remove(id: string, expectedRevision?: string): StoreSnapshot {
    this.guard(expectedRevision)
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) throw new Error(`no entry ${id}`)
    this.entries.splice(i, 1)
    this.flush()
    return this.snapshot()
  }

  private guard(expected?: string): void {
    if (expected !== undefined && expected !== this.revision()) throw new RevisionConflictError(this.revision())
  }

  private flush(): void {
    mkdirSync(this.dir, { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''), 'utf8')
    try { renameSync(tmp, this.file) }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') { unlinkSync(this.file); renameSync(tmp, this.file) }
      else { try { unlinkSync(tmp) } catch { /* best effort */ } ; throw e }
    }
  }
}
```

注意：`update` 里 `Object.freeze` 的旧条目不被改动——新对象替换数组槽位（实现如上）；测试若发现 freeze 阻碍 `delete next.tags` 则将 `next` 声明为普通可扩对象（已如此）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test`
Expected: store 6 项 + wiring 3 项全 PASS

- [ ] **Step 5: Commit**

```powershell
git add -A; git commit -m "feat: JSONL memory store with revisions, atomic writes, corrupt-line tolerance"
```

---

### Task 3: config.ts + search.ts + render.ts（纯函数层）

**Files:**
- Create: `src/config.ts`、`src/search.ts`、`src/render.ts`
- Test: `test/config.test.mjs`、`test/search.test.mjs`、`test/render.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `MemoryEntry/StoreSnapshot/Importance/normalizeScope`
- Produces:
  - `type Config`（§4 七字段）、`const ConfigSchema`（schemastery）、`const DEFAULTS: Config`、`validateConfig(v: Config): void`
  - `rankEntries(list: MemoryEntry[]): MemoryEntry[]`、`filterByScope(entries: MemoryEntry[], scope: 'all' | 'global' | 'workspace', cwd: string): MemoryEntry[]`、`scoreEntries(entries: MemoryEntry[], query: string): MemoryEntry[]`
  - `renderSnapshot(snap: StoreSnapshot, cfg: Config, cwd: string): string`

- [ ] **Step 1: 失败测试（三份）**

```js
// test/config.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS, validateConfig, ConfigSchema } from '../lib/config.js'

test('defaults', () => {
  assert.equal(DEFAULTS.enabled, true)
  assert.equal(DEFAULTS.maxInjectionChars, 4000)
  assert.equal(DEFAULTS.searchLimit, 8)
})
test('validateConfig ranges', () => {
  assert.doesNotThrow(() => validateConfig({ ...DEFAULTS }))
  assert.throws(() => validateConfig({ ...DEFAULTS, maxInjectionChars: 10 }))
  assert.throws(() => validateConfig({ ...DEFAULTS, searchLimit: 33 }))
  assert.throws(() => validateConfig({ ...DEFAULTS, entryMaxChars: 10_000 }))
})
test('schema parses booleans/numbers', () => {
  assert.equal(ConfigSchema.parse(DEFAULTS).injectWorkspace, true)
})
```

```js
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
```

```js
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
```

- [ ] **Step 2: 运行确认失败**（`node --test test/config.test.mjs test/search.test.mjs test/render.test.mjs`，Cannot find module）

- [ ] **Step 3: 实现**

```ts
// src/config.ts
import z from '@deepseek-ai/schemastery'

export const ConfigSchema = z.object({
  enabled: z.boolean(),
  injectEnabled: z.boolean(),
  injectWorkspace: z.boolean(),
  allowAgentWrite: z.boolean(),
  maxInjectionChars: z.number(),
  entryMaxChars: z.number(),
  searchLimit: z.number(),
})
export type Config = z.infer<typeof ConfigSchema>

export const DEFAULTS: Config = {
  enabled: true, injectEnabled: true, injectWorkspace: true, allowAgentWrite: true,
  maxInjectionChars: 4000, entryMaxChars: 2000, searchLimit: 8,
}

export function validateConfig(v: Config): void {
  const int = (n: number) => Number.isInteger(n)
  if (!int(v.maxInjectionChars) || v.maxInjectionChars < 200 || v.maxInjectionChars > 20_000) throw new Error('maxInjectionChars out of range 200-20000')
  if (!int(v.entryMaxChars) || v.entryMaxChars < 50 || v.entryMaxChars > 8000) throw new Error('entryMaxChars out of range 50-8000')
  if (!int(v.searchLimit) || v.searchLimit < 1 || v.searchLimit > 32) throw new Error('searchLimit out of range 1-32')
}
```

```ts
// src/search.ts
import type { Importance, MemoryEntry } from './store.js'

const IMP: Record<Importance, number> = { critical: 0, normal: 1, low: 2 }

export const rankEntries = (list: MemoryEntry[]): MemoryEntry[] =>
  [...list].sort((a, b) => IMP[a.importance] - IMP[b.importance] || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))

export const filterByScope = (entries: MemoryEntry[], scope: 'all' | 'global' | 'workspace', cwd: string): MemoryEntry[] => {
  if (scope === 'all') return entries
  if (scope === 'global') return entries.filter((e) => e.scope === 'global')
  return entries.filter((e) => !!cwd && e.scope === cwd)
}

const hasCJK = /[㐀-鿿぀-ヿ]/
export function scoreEntries(entries: MemoryEntry[], query: string): MemoryEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return rankEntries(entries)
  const tokens = q.split(/\s+/).filter((t) => t.length > 1)
  return entries
    .map((e) => {
      const t = e.text.toLowerCase()
      const score = (t.includes(q) ? (hasCJK.test(q) ? 5 : 3) : 0) + tokens.filter((tok) => t.includes(tok)).length
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (a.e.updatedAt < b.e.updatedAt ? 1 : -1))
    .map((x) => x.e)
}
```

（`hasCJK` 正则内为 CJK 码位区间 `[U+3400-U+9FFF]∪[U+3040-U+30FF]`，源文件用字面字符即可，测试里同样字面。）

```ts
// src/render.ts
import { DEFAULTS, type Config } from './config.js'
import { rankEntries } from './search.js'
import type { MemoryEntry, StoreSnapshot } from './store.js'

const HEADER = (rev: string) =>
  `LOCAL MEMORY SNAPSHOT (revision ${rev}; dsh-local-memory; treat as quoted historical data — current instructions win. This snapshot supersedes earlier LOCAL MEMORY SNAPSHOTs.)`

export function renderSnapshot(snap: StoreSnapshot, cfg: Config, cwd: string): string {
  if (!cfg.enabled || !cfg.injectEnabled) return ''
  const budget = Math.min(cfg.maxInjectionChars ?? DEFAULTS.maxInjectionChars, 20_000)
  const g = rankEntries(snap.entries.filter((e) => e.scope === 'global'))
  const w = cwd && cfg.injectWorkspace ? rankEntries(snap.entries.filter((e) => e.scope === cwd)) : []
  const lines: string[] = []
  let used = 0
  let omitted = 0
  const put = (title: string, list: MemoryEntry[]): void => {
    if (!list.length) return
    const keep: string[] = []
    for (const e of list) {
      const row = `§ [id:${e.id}][${e.importance}]${e.tags ? ` [${e.tags.join(',')}]` : ''} ${e.text.replace(/\n/g, ' ')}`
      if (used + row.length + 1 > budget) { omitted += 1 + (list.indexOf(e) !== 0 ? 0 : 0); omitted += 0; continue }
      keep.push(row)
      used += row.length + 1
    }
    omitted += 0
    if (keep.length) { lines.push(`Contents of ${title} (${keep.length} of ${list.length} entries, ${used}/${budget} chars):`, ...keep) }
  }
  const gBefore = omitted
  put(`global memory`, g)
  put(`workspace memory (${cwd})`, w)
  void gBefore
  if (!lines.length) return snap.entries.length ? `${HEADER(snap.revision)}\n(0 of ${snap.entries.length} entries fit the ${budget}-char budget — call local_memory_search)` : ''
  if (omitted > 0) lines.push(`(${omitted} entries omitted — call local_memory_search to retrieve them)`)
  if (snap.corruptLines > 0) lines.push(`(warning: ${snap.corruptLines} unreadable lines were skipped in entries.jsonl)`)
  return `${HEADER(snap.revision)}\n${lines.join('\n')}`
}
```

⚠️ 上面 `put` 中 `omitted` 累加语句故意留了直白版——**实现时简化为**：`for` 循环内 `else { omitted += 1; continue }`（即"放不下的整条计入 omitted"），删掉 `gBefore/void` 噪音行。测试断言只依赖最终文本。

- [ ] **Step 4: `npm test` 全绿**
- [ ] **Step 5: Commit** `feat: config schema, search scoring, snapshot renderer`

---

### Task 4: tools.ts + 宿主半终装（settings watch + 两工具 + 注入）

**Files:**
- Modify: `src/index.ts`（替换 stub）、Create: `src/tools.ts`
- Test: `test/tools.test.mjs`

**Interfaces:**
- Consumes: `MemoryStore` 全家（Task 2）、`Config/DEFAULTS/validateConfig`（Task 3）、`renderSnapshot`、`rankEntries/filterByScope/scoreEntries`
- Produces: `makeSearchTool(store, cfg, max?: () => Config)` → 实为 `makeSearchTool(store: MemoryStore, cfg: () => Config): ToolDefinition`、`makeRememberTool(store: MemoryStore, cfg: () => Config): ToolDefinition`；宿主导出常量 `CONTEXT_NAME='local-memory:snapshot'`、`CONTEXT_ORDER=200`

- [ ] **Step 1: 失败测试**

```js
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
```

- [ ] **Step 2: 确认失败**（Cannot find module tools.js）

- [ ] **Step 3: 实现 tools.ts**

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { filterByScope, rankEntries, scoreEntries } from './search.js'
import { MemoryStore, normalizeScope, type Importance } from './store.js'

type AgentCwd = { agent?: { session?: { header?: { cwd?: string } } } }
const cwdOf = (exec: unknown): string => {
  const raw = (exec as AgentCwd).agent?.session?.header?.cwd
  return raw ? normalizeScope(raw) : ''
}
const clipLimit = (n: number | undefined, cfg: Config): number =>
  Math.max(1, Math.min(Math.trunc(n ?? cfg.searchLimit), 32))

export const makeSearchTool = (store: MemoryStore, cfg: () => Config) => defineTool({
  name: 'local_memory_search',
  description: 'Search this plugin\'s local memory store (dsh-local-memory; independent of Mnemon). Empty query lists the most recent entries. scope: "all" (default) | "global" | "workspace" (current session cwd). limit <= 32.',
  parameters: {
    query: { type: 'string', description: 'Keywords; empty = recent first.' },
    scope: { type: 'string', description: 'all | global | workspace. Defaults to all.' },
    limit: { type: 'integer', description: 'Max items, 1-32.' },
  },
  output: {
    schema: { type: 'json' },
    render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  execute: async (args: unknown, exec: unknown) => {
    const a = (args ?? {}) as { query?: string; scope?: string; limit?: number }
    const c = cfg()
    if (!c.enabled) return { disabled: true, message: 'dsh-local-memory is disabled (Settings → 本地记忆)' }
    const scope = a.scope === 'global' || a.scope === 'workspace' ? a.scope : 'all'
    const cwd = cwdOf(exec)
    const snap = store.snapshot()
    let filtered = filterByScope(snap.entries, scope, cwd)
    const degraded = scope === 'workspace' && !cwd
    if (degraded) filtered = snap.entries
    const ordered = a.query?.trim() ? scoreEntries(filtered, a.query) : rankEntries(filtered)
    const limit = clipLimit(a.limit, c)
    return {
      revision: snap.revision,
      count: Math.min(ordered.length, limit),
      ...(degraded ? { scopeNote: 'cwd unavailable — searched all scopes' } : {}),
      items: ordered.slice(0, limit),
    }
  },
})

export const makeRememberTool = (store: MemoryStore, cfg: () => Config) => defineTool({
  name: 'local_memory_remember',
  description: 'Write dsh-local-memory entries. action "add" (text, optional scope global|workspace, importance critical|normal|low, tags) | "replace" (id or unique old_text, new text) | "remove" (id or unique old_text). Returns a receipt with completion committed|failed.',
  parameters: {
    action: { type: 'string', description: 'add | replace | remove.' },
    text: { type: 'string', description: 'Entry text (add/replace).' },
    old_text: { type: 'string', description: 'Unique substring locating an entry (replace/remove).' },
    id: { type: 'string', description: 'Exact entry id (replace/remove).' },
    scope: { type: 'string', description: 'global | workspace; default global (add only).' },
    importance: { type: 'string', description: 'critical | normal | low (optional).' },
    tags: { type: 'json', description: 'string array, max 8 (optional).' },
  },
  output: {
    schema: { type: 'json' },
    render: (_a: unknown, v: unknown) => [{ type: 'text', text: JSON.stringify(v) }],
  },
  execute: async (args: unknown, exec: unknown) => {
    const a = (args ?? {}) as { action?: string; text?: string; old_text?: string; id?: string; scope?: string; importance?: Importance; tags?: string[] }
    const c = cfg()
    const fail = (error: string) => ({ completion: 'failed' as const, error })
    if (!c.enabled) return fail('plugin disabled')
    if (!c.allowAgentWrite) return fail('agent writes are disabled (Settings → 本地记忆)')
    try {
      if (a.action === 'add') {
        const scope = a.scope === 'workspace' ? (cwdOf(exec) || 'global') : 'global'
        const snap = store.add({ text: a.text ?? '', scope, importance: a.importance, tags: a.tags }, 'agent', c.entryMaxChars)
        const entry = snap.entries[snap.entries.length - 1]
        return { completion: 'committed' as const, id: entry.id, revision: snap.revision }
      }
      if (a.action === 'replace' || a.action === 'remove') {
        const { entry, matches } = store.snapshot() && findTarget(store, a)
        if (!entry) {
          return fail(matches.length === 0 ? `no entry matched ${a.id ?? a.old_text}` : `ambiguous: ids ${matches.map((m) => m.id).join(', ')}`)
        }
        const snap = a.action === 'replace'
          ? store.update(entry.id, { text: a.text ?? entry.text, importance: a.importance }, undefined, c.entryMaxChars)
          : store.remove(entry.id)
        return { completion: 'committed' as const, id: entry.id, revision: snap.revision }
      }
      return fail(`unknown action ${String(a.action)} (add|replace|remove)`)
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e))
    }
  },
})

import { findUnique } from './store.js'
const findTarget = (store: MemoryStore, a: { id?: string; oldText?: string; old_text?: string }) =>
  findUnique(store.snapshot().entries, { id: a.id, oldText: a.old_text ?? a.oldText })
```

（实现时把 `findUnique` import 移到文件顶部、删掉 `store.snapshot() &&` 冗余调用——那是笔误保护；`const { entry, matches } = findTarget(store, a)`。`tags` 用 `{ type: 'json' }` 逃生门传数组。）

- [ ] **Step 4: 重写 src/index.ts（settings+tools+injection；RPC Task 5 补）**

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { ConfigSchema, DEFAULTS, validateConfig, type Config } from './config.js'
import { renderSnapshot } from './render.js'
import { makeRememberTool, makeSearchTool } from './tools.js'
import { MemoryStore, normalizeScope } from './store.js'

export const name = 'local-memory'
export const inject = ['tools', 'settings'] as const
export const CONTEXT_NAME = 'local-memory:snapshot'
export const CONTEXT_ORDER = 200

type AgentLike = { agent?: { session?: { header?: { cwd?: string } } } }

export function apply(ctx: Context): void {
  const scope = ctx.settings.register('local-memory', ConfigSchema, { base: DEFAULTS, applies: 'live', validate: validateConfig })
  let cfg: Config = { ...DEFAULTS, ...scope.get() }
  ctx.effect(() => scope.watch((v) => { cfg = { ...DEFAULTS, ...v } }), 'local-memory: settings watch')

  const store = new MemoryStore(dshHomePath('local-memory'))
  store.load()
  const cfgRef = (): Config => cfg

  ctx.effect(() => ctx.tools.register(makeSearchTool(store, cfgRef)), 'local-memory: search tool')
  ctx.effect(() => ctx.tools.register(makeRememberTool(store, cfgRef)), 'local-memory: remember tool')

  ctx.inject(['systemPrompt'], ({ systemPrompt }) => {
    ctx.effect(() => systemPrompt.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: (c) => {
        try {
          const cwdRaw = (c as AgentLike).agent?.session?.header?.cwd
          return renderSnapshot(store.snapshot(), cfgRef(), cwdRaw ? normalizeScope(cwdRaw) : '')
        } catch { return '' }
      },
    }), 'local-memory: snapshot')
  })
}
```

注：`@deepseek-ai/dsh-system-prompt` 的 `declare module` augment 若因未装该 dev 包缺失类型，Task 1 Step 5 已把它列入 devDeps；`scope.watch` 的回调签名以安装到的 dsh-settings `.d.ts` 为准（`watch(cb):disposer`，index.d.ts:83-110）。

- [ ] **Step 5: `npm run typecheck && npm test` 全绿**
- [ ] **Step 6: Commit** `feat: memory tools + live settings + per-turn snapshot injection`

---

### Task 5: protocol.ts（RPC）+ 宿主接线

**Files:**
- Create: `src/protocol.ts`、`test/protocol.test.mjs`
- Modify: `src/index.ts`（追加 connection rpc 注册）

**Interfaces:**
- Consumes: `MemoryStore`、`Config`
- Produces: `const RPC_CHANNEL = '/local-memory'`；`type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }`；`createRpcHandler(deps: { store: MemoryStore; cfg: () => Config; workspaces: () => string[] }): (endpoint: string, payload: unknown) => Promise<RpcResult>`；endpoint 集合：`snapshot | workspace-list | add | update | remove`

- [ ] **Step 1: 失败测试**

```js
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
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现 protocol.ts**

```ts
import type { Config } from './config.js'
import { MemoryStore, normalizeScope, RevisionConflictError, type Importance } from './store.js'

export const RPC_CHANNEL = '/local-memory'
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
const err = (code: string, message: string, details: Record<string, unknown> = {}): RpcResult => ({ ok: false, error: { code, message, details } })

export interface RpcDeps { store: MemoryStore; cfg: () => Config; workspaces: () => string[] }

export function createRpcHandler({ store, cfg, workspaces }: RpcDeps) {
  return async (endpoint: string, payload: unknown): Promise<RpcResult> => {
    try {
      const p = (payload ?? {}) as Record<string, unknown>
      const c = cfg()
      switch (endpoint) {
        case 'snapshot': return { ok: true, value: store.snapshot() }
        case 'workspace-list': return { ok: true, value: workspaces().map(normalizeScope) }
        case 'add': {
          const snap = store.add({
            text: String(p.text ?? ''), scope: String(p.scope ?? 'global'),
            ...(p.importance ? { importance: p.importance as Importance } : {}),
            ...(Array.isArray(p.tags) ? { tags: p.tags as string[] } : {}),
          }, 'ui', c.entryMaxChars)
          return { ok: true, value: snap }
        }
        case 'update': {
          const guard = checkExpected(p, store)
          if (guard) return guard
          const snap = store.update(String(p.id), {
            ...(p.text !== undefined ? { text: String(p.text) } : {}),
            ...(p.importance ? { importance: p.importance as Importance } : {}),
            ...(Array.isArray(p.tags) ? { tags: p.tags as string[] } : {}),
          }, undefined, c.entryMaxChars)
          return { ok: true, value: snap }
        }
        case 'remove': {
          const guard = checkExpected(p, store)
          if (guard) return guard
          return { ok: true, value: store.remove(String(p.id)) }
        }
        default: return err('unknown-endpoint', String(endpoint))
      }
    } catch (e) {
      if (e instanceof RevisionConflictError) return err('revision-conflict', e.message, { current: e.current })
      return err('store-error', e instanceof Error ? e.message : String(e))
    }
  }
}

function checkExpected(p: Record<string, unknown>, store: MemoryStore): RpcResult | undefined {
  if (typeof p.expectedRevision === 'string' && p.expectedRevision && p.expectedRevision !== store.revision()) {
    return err('revision-conflict', 'revision moved', { current: store.revision() })
  }
  return undefined
}
```

- [ ] **Step 4: index.ts 追加（`apply` 内、injection 之后）**

```ts
  ctx.inject(['connection'], ({ connection }) => {
    ctx.effect(async () => {
      const workspaces = (): string[] => {
        const reg = ctx.get('workspaceRegistry') as { list?: () => { path: string }[] } | undefined
        return reg?.list?.().map((w) => w.path) ?? []
      }
      const handler = createRpcHandler({ store, cfgRef, workspaces })
      return connection.rpc.handle(RPC_CHANNEL, (endpoint, payload) => handler(endpoint, payload))
    }, 'local-memory: rpc')
  })
```

定稿依据（原"双写法待 tsc 裁决"已在规划期解决）：`HostConnectionRpc.handle(channel, handler): () => Promise<void>` **两参、无 authority 选项**（dsh-client-connection@0.1.5-rc.2 `lib/types/rpc.d.ts:104-111`）；`ConnectionRpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>`（同文件 :76）——endpoint 是第一参数，不做 payload 转发。返回的 disposer 从 async effect 体直接 return（Promise<Disposer> 是合法 effect 结果，cordis fiber.d.ts:157-159）。

- [ ] **Step 5: `npm run typecheck && npm test` 全绿**（typecheck 即 handler 签名裁决）
- [ ] **Step 6: Commit** `feat: management RPC endpoints over connection.rpc`

---

### Task 6: 浏览器半（设置页 + locale + 样式 + bundle 契约）

**Files:**
- Modify: `src/client.ts`（替换 stub）
- Create: `src/api.ts`、`src/MemoryPage.tsx`、`src/locales.ts`、`src/styles.ts`、`test/client-bundle.test.mjs`
- Modify: `test/wiring.test.mjs`（追加注入名单断言）

**Interfaces:**
- Consumes: Task 5 `RPC_CHANNEL` 字符串值（**不 import protocol**——bundle 禁止 value import 宿主包；channel 常量在 `api.ts` 复制一份）；宿主 settings namespace `local-memory`
- Produces: 设置页 entry id `local-memory`（`settings.section`）；页面 props 面 `{ settings: SettingsFace; call: RpcCall; t: (key: string) => string }`

- [ ] **Step 1: 失败测试（bundle 契约 + wiring 追加）**

```js
// test/client-bundle.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('client bundle obeys loader contract', () => {
  execSync('node scripts/build.mjs', { stdio: 'pipe' })
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(code.startsWith('window.__ModuleLoader__.load({'))
  assert.ok(code.includes('"dsh-local-memory"'))
  assert.ok(!code.includes('dsh-mnemon'))
  assert.ok(!/require\("node:/.test(code), 'bundle must not require node builtins')
})
```

`test/wiring.test.mjs` 追加：

```js
test('client half injects exactly slots+locale+connection', () => {
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  assert.match(client, /export const inject = \['slots', 'locale', 'connection'\]/)
  assert.match(client, /settings\.section/)
})
test('host half wires named seams', () => {
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(host, /local-memory:snapshot/)
  assert.match(host, /'\/local-memory'|RPC_CHANNEL/)
  assert.match(host, /CONTEXT_ORDER = 200/)
})
```

- [ ] **Step 2: 确认失败**（`node --test test/client-bundle.test.mjs test/wiring.test.mjs`）

- [ ] **Step 3: api.ts（结构类型 + bindScope 平移）**

```ts
// src/api.ts — structural types only; zero value imports of host packages.
export const RPC_CHANNEL = '/local-memory'

export type PathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

export interface SettingsFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
  mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<void>
  readonly writable?: boolean
}

/** Re-home prototype methods onto own properties (useSyncExternalStore detaches `this`).
 *  Same fix as dsh-reasoning-tiers/src/capabilities.ts:190-217. */
export function bindScope(scope: SettingsFace): SettingsFace {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (l) => scope.subscribe(l),
    mutate: (ops, rev) => scope.mutate(ops, rev),
    writable: scope.writable,
  }
}

export interface StoreSnapshotView {
  entries: Array<{ id: string; text: string; scope: string; importance: string; tags?: string[]; updatedAt: string }>
  revision: string
  corruptLines: number
}
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
export type RpcCall = <T>(endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult<T>>
```

- [ ] **Step 4: locales.ts + styles.ts**

```ts
// src/locales.ts
export const NS = 'local-memory'
export const zh = {
  pageLabel: '本地记忆', hint: '本插件与 Mnemon 无关；条目存于 ~/.dsh/local-memory/entries.jsonl。',
  add: '添加条目', edit: '编辑', save: '保存', cancel: '取消', remove: '删除',
  filterPlaceholder: '过滤文本…', scopeAll: '全部', scopeGlobal: '全局',
  revisionLabel: 'revision', corruptBadge: (n: string) => `${n} 行损坏`,
  conflictNotice: '外部已变更，数据已刷新。', confirmRemove: '删除这条记忆？',
  textPlaceholder: '记忆内容（≤设置的上限）', tagsPlaceholder: '逗号分隔标签（可选）',
  scopeLabel: '作用域', importanceLabel: '重要度', updatedAtLabel: '更新于',
  empty: '还没有记忆条目。', settingsTitle: '注入与工具设置',
  disabled: '已禁用', refresh: '刷新',
}
export const en = {
  pageLabel: 'Local Memory', hint: 'Independent of Mnemon; entries live in ~/.dsh/local-memory/entries.jsonl.',
  add: 'Add entry', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete',
  filterPlaceholder: 'Filter text…', scopeAll: 'All', scopeGlobal: 'Global',
  revisionLabel: 'revision', corruptBadge: (n: string) => `${n} corrupt lines`,
  conflictNotice: 'Changed elsewhere — view refreshed.', confirmRemove: 'Delete this memory?',
  textPlaceholder: 'Memory text', tagsPlaceholder: 'comma,separated,tags',
  scopeLabel: 'Scope', importanceLabel: 'Importance', updatedAtLabel: 'Updated',
  empty: 'No entries yet.', settingsTitle: 'Injection & tools settings',
  disabled: 'Disabled', refresh: 'Refresh',
}
```

```ts
// src/styles.ts — 平移 dsh-reasoning-tiers/src/styles.ts 的注入结构，样式体换为：
const CSS = `
.dshlm-page { font-size: 14px; }
.dshlm-toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.dshlm-row { border-bottom: 1px solid rgba(128,128,128,.2); padding: 8px 2px; }
.dshlm-meta { color: #999; font-size: 12px; margin-right: 6px; }
.dshlm-text { white-space: pre-wrap; }
.dshlm-badge { background: #b35; color: #fff; border-radius: 8px; padding: 0 8px; font-size: 12px; }
.dshlm-notice { background: rgba(255,160,0,.15); padding: 4px 8px; border-radius: 4px; margin: 4px 0; }
.dshlm-edit textarea, .dshlm-add textarea { width: 100%; min-height: 60px; }
`
export function injectStyles(): void {
  const ID = 'dsh-local-memory-styles'
  if (typeof document === 'undefined' || document.getElementById(ID)) return
  const el = document.createElement('style')
  el.id = ID
  el.textContent = CSS
  document.head.appendChild(el)
}
```

（styles.ts 的函数外壳若 reasoning-tiers 版有 disposer 返回值/防重入细节，以拷贝后最小改造为准，行为契约：幂等、返回 void。）

- [ ] **Step 5: MemoryPage.tsx（完整页）**

```tsx
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { bindScope, type RpcCall, type SettingsFace, type StoreSnapshotView } from './api.js'
import type { Config } from './config.js'   // type-only：erased，不入 bundle
import { zh, en } from './locales.ts'

type Translator = (key: keyof typeof zh) => string
interface Props { settings: SettingsFace; call: RpcCall; t: Translator }
type Draft = { id?: string; text: string; scope: string; importance: 'critical' | 'normal' | 'low'; tags: string }

export function MemoryPage({ settings, call, t }: Props): JSX.Element {
  const face = useMemo(() => bindScope(settings), [settings])
  const cfg = useSyncExternalStore(face.subscribe, face.getSnapshot) as Config
  const [data, setData] = useState<StoreSnapshotView | null>(null)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('')
  const [scopeTab, setScopeTab] = useState<'all' | 'global' | 'workspace'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const r = await call<StoreSnapshotView>('snapshot')
    if (r.ok) { setData(r.value); return r.value }
    setNotice(`${r.error.code}: ${r.error.message}`); return null
  }, [call])

  useEffect(() => {
    void refresh()
    void call<string[]>('workspace-list').then((r) => { if (r.ok) setWorkspaces(r.value) })
  }, [refresh])

  const rows = useMemo(() => {
    if (!data) return []
    const wsKeys = new Set(workspaces)
    return data.entries.filter((e) => (scopeTab === 'all' ? true : scopeTab === 'global' ? e.scope === 'global' : wsKeys.has(e.scope)))
      .filter((e) => !filter.trim() || e.text.toLowerCase().includes(filter.trim().toLowerCase()))
  }, [data, scopeTab, filter, workspaces])

  const send = useCallback(async (endpoint: string, input: Record<string, unknown>) => {
    const r = await call(endpoint, { ...input, expectedRevision: data?.revision })
    if (r.ok) { setData(r.value as StoreSnapshotView); setNotice(''); return true }
    if (r.error.code === 'revision-conflict') { setNotice(t('conflictNotice')); await refresh() }
    else setNotice(`${r.error.code}: ${r.error.message}`)
    return false
  }, [call, data, refresh, t])

  const field = (path: string, value: unknown) => void face.mutate([{ op: 'set', path: [path], value }]).catch((e: Error) => setNotice(String(e)))

  return (
    <div className="dshlm-page">
      <h3>{t('pageLabel')}</h3>
      <p className="dshlm-meta">{t('hint')}{data ? ` — ${t('revisionLabel')}: ${data.revision}` : ''}</p>
      {data && data.corruptLines > 0 && <span className="dshlm-badge">{t('corruptBadge')(String(data.corruptLines))}</span>}
      {notice && <div className="dshlm-notice">{notice} </div>}
      <div className="dshlm-toolbar">
        <button onClick={() => void refresh()}>{t('refresh')}</button>
        <input placeholder={t('filterPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {(['all', 'global', 'workspace'] as const).map((s) => (
          <button key={s} onClick={() => setScopeTab(s)} style={{ opacity: scopeTab === s ? 1 : 0.5 }}>
            {s === 'all' ? t('scopeAll') : s === 'global' ? t('scopeGlobal') : 'workspace'}
          </button>
        ))}
        <button onClick={() => setDraft({ text: '', scope: 'global', importance: 'normal', tags: '' })}>{t('add')}</button>
      </div>
      {draft && (
        <div className="dshlm-add">
          <textarea placeholder={t('textPlaceholder')} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
            <option value="global">{t('scopeGlobal')}</option>
            {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: e.target.value as Draft['importance'] })}>
            {['critical', 'normal', 'low'].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <input placeholder={t('tagsPlaceholder')} value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          <button disabled={!draft.text.trim()} onClick={async () => {
            const tags = draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
            const ok = draft.id
              ? await send('update', { id: draft.id, text: draft.text, importance: draft.importance, tags })
              : await send('add', { text: draft.text, scope: draft.scope, importance: draft.importance, tags })
            if (ok) setDraft(null)
          }}>{t('save')}</button>
          <button onClick={() => setDraft(null)}>{t('cancel')}</button>
        </div>
      )}
      {rows.length === 0 && <p className="dshlm-meta">{t('empty')}</p>}
      {rows.map((e) => (
        <div key={e.id} className="dshlm-row">
          <div className="dshlm-text">{e.text}</div>
          <div>
            <span className="dshlm-meta">{e.scope === 'global' ? t('scopeGlobal') : e.scope}</span>
            <span className="dshlm-meta">{e.importance}</span>
            {e.tags?.map((tg) => <span key={tg} className="dshlm-meta">#{tg}</span>)}
            <span className="dshlm-meta">{t('updatedAtLabel')} {e.updatedAt.slice(0, 16)}</span>
            <button onClick={() => setDraft({ id: e.id, text: e.text, scope: e.scope, importance: e.importance as Draft['importance'], tags: (e.tags ?? []).join(',') })}>{t('edit')}</button>{' '}
            <button onClick={() => { if (window.confirm(t('confirmRemove'))) void send('remove', { id: e.id }) }}>{t('remove')}</button>
          </div>
        </div>
      ))}
      <h4>{t('settingsTitle')}</h4>
      {(['enabled', 'injectEnabled', 'injectWorkspace', 'allowAgentWrite'] as const).map((k) => (
        <label key={k} className="dshlm-row">
          <input type="checkbox" checked={Boolean((cfg as unknown as Record<string, unknown>)[k])} disabled={face.writable === false} onChange={(ev) => field(k, ev.target.checked)} /> {k}
        </label>
      ))}
      {(['maxInjectionChars', 'entryMaxChars', 'searchLimit'] as const).map((k) => (
        <label key={k} className="dshlm-row">{k}{' '}
          <input type="number" defaultValue={Number((cfg as unknown as Record<string, unknown>)[k] ?? 0)} disabled={face.writable === false}
            onBlur={(ev) => field(k, Number(ev.target.value))} />
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: client.ts 终装**

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'   // ctx.connection augment；若实装导出路径不同，以 node_modules 内 .d.ts 为准调整（Task 6 Step 7 验证）
import { RPC_CHANNEL, bindScope } from './api.js'
import { MemoryPage } from './MemoryPage.tsx'
import { NS, en, zh } from './locales.ts'
import { injectStyles } from './styles.ts'

export const name = 'local-memory'
export const inject = ['slots', 'locale', 'connection']

const SLOT = 'settings.section'
const ORDER = 45

export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'local-memory: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-memory: dictionaries')
  ctx.inject(['settingsScope'], (scope) => {
    const translate = scope.locale.bind(NS)
    const call = <T,>(endpoint: string, payload?: unknown, signal?: AbortSignal) =>
      scope.connection.rpc.call(RPC_CHANNEL, endpoint, payload ?? {}, signal) as Promise<import('./api.ts').RpcResult<T>>
    scope.slots.inject(SLOT, () =>
      scope.slots.register(
        { name: SLOT, id: 'local-memory', order: ORDER, label: () => translate('pageLabel'), locale: NS,
          inject: () => ({ settings: bindScope(scope.settingsScope.bind({ namespace: 'local-memory' })), call, t: translate }) },
        MemoryPage,
      ))
  })
}
```

- [ ] **Step 7: 构建 + 测试全绿**

Run: `npm run build; npm test`
Expected: bundle 闸门打印 `lib/client.js ok — id=dsh-local-memory, requires=[@deepseek-ai/dsh-client-connection,…]`（具体 requires 以实际 import 为准）；client-bundle/wiring 新断言 PASS。

- [ ] **Step 8: Commit** `feat: browser settings page (local memory manager)`

---

### Task 7: 文档 + 装前自检收口 + 0.1.0

**Files:**
- Create: `README.md`、`README.zh.md`
- Modify: 无（骨架期文件若漂移一并修正）

**Interfaces:**
- Consumes: 全部已完成任务
- Produces: 可交付文档与最终验证记录

- [ ] **Step 1: README.zh.md（含以下必备小节）**

```
# dsh-local-memory —— 独立本地记忆插件
- 三能力：每轮注入 LOCAL MEMORY SNAPSHOT；工具 local_memory_search/local_memory_remember；设置面板「本地记忆」管理页
- 与 dsh-mnemon 完全独立，可并行共存
- 安装（web profile）：
  1. dsh profile 的 package.json dependencies 加 "dsh-local-memory": "link:<repo路径>"
  2. dsh.profile.bundles 追加 "dsh-local-memory"
  3. 重启 dsh web（bundles 仅启动读取）
- 数据位置 ~/.dsh/local-memory/entries.jsonl；格式=每行一 JSON（字段表）
- 设置节字段表（§4 七项，默认值）；注入格式示例；故障排查（坏行徽标/revision 冲突/禁用态）
```

README.md 为镜像英文版（同结构）。

- [ ] **Step 2: 全量验证**

```powershell
npm run clean; npm run build; npm run typecheck; npm test; npm run verify:install web
dsh --profile web --dump-config | Select-String 'local-memory'
```

Expected: 全绿；dump 中出现 local-memory bundle 条目。

- [ ] **Step 3: Commit + tag**

```powershell
git add -A; git commit -m "docs: bilingual README + verification; release 0.1.0"; git tag v0.1.0
```

（npm 发布、Codeup/GitHub 推送、awesome 投稿均不在本计划内——按全局约定另行发起。人工冒烟移至 Task 9，因重启 `dsh web` 会断当前会话，只能由用户择机执行。）

---

### Task 8: 迁移原记忆数据（mnemon runtime → dsh-local-memory，非破坏复制）

**Files:**
- Create: `scripts/migrate-from-mnemon.mjs`、`test/migrate.test.mjs`

**Interfaces:**
- Consumes: Task 2 `MemoryStore.add(input, source, maxChars, when)`；数据源（已实测存在）：`C:\Users\一诺吖\.mnemon\runtime\memories.json`，形状 `{ version:1, entries:[{ content, created_at, updated_at, target:'memory'|'user', importance?, tags?, branches? }] }`（当前 16 条；USER.md 是同目录投影，真源只有这份 JSON）
- Produces: CLI（`--input <path>` 默认 `%USERPROFILE%\.mnemon\runtime\memories.json`、`--target <dir>` 默认 `dshHomePath('local-memory')`、`--max-chars` 默认 2000、`--dry-run`（默认）/`--apply`、`--include-user` 默认开）；可测导出 `parseAndMap(jsonText: string, opts): { mapped: MappedEntry[]; skipped: {reason:string}[]; clipped: number }`，`MappedEntry = { text: string; scope: 'global'; importance: Importance; tags: string[]; createdAt?: string; updatedAt?: string; source: 'ui' }`
- **语义**：非破坏复制——只读源文件，mnemon 数据零改动；幂等：目标库中已存在完全相同 text 的条目则 skip（`duplicate`）。迁移条目统一 `scope:'global'` + tag `from-mnemon`（workspace 专属事实在文本里自带路径，v1 不做路径猜定）；`target:'user'` 加 tag `user`；`branches:[b]` 逐条转 `branch:<b>` tag；`importance` 直通（非法值回落 normal）。

- [ ] **Step 1: 失败测试**

```js
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
```

- [ ] **Step 2: 确认失败**（Cannot find module migrate-from-mnemon.mjs）

- [ ] **Step 3: 实现脚本**

```js
#!/usr/bin/env node
/** Migrate mnemon runtime memories.json → dsh-local-memory store. Read-only on the source; idempotent by exact text. */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const IMP = new Set(['critical', 'normal', 'low'])

export function parseAndMap(jsonText, { maxChars = 2000, existing = [] } = {}) {
  const mapped = []
  const skipped = []
  let clipped = 0
  const have = new Set(existing)
  let parsed
  try { parsed = JSON.parse(jsonText) } catch (e) { throw new Error(`input is not valid JSON: ${e.message}`) }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : []
  for (const raw of entries) {
    const text0 = typeof raw?.content === 'string' ? raw.content.trim() : ''
    if (!text0) { skipped.push({ reason: 'empty' }); continue }
    let text = text0
    if (text.length > maxChars) { text = text.slice(0, maxChars - 1) + '…'; clipped += 1 }
    if (have.has(text)) { skipped.push({ reason: 'duplicate' }); continue }
    const tags = ['from-mnemon']
    if (raw.target === 'user') tags.push('user')
    for (const b of Array.isArray(raw.branches) ? raw.branches : []) {
      if (typeof b === 'string' && b) tags.push(`branch:${b}`.slice(0, 32))
    }
    mapped.push({
      text, scope: 'global',
      importance: IMP.has(raw.importance) ? raw.importance : 'normal',
      tags: tags.slice(0, 8), source: 'ui',
      ...(typeof raw.created_at === 'string' ? { createdAt: raw.created_at } : {}),
      ...(typeof raw.updated_at === 'string' ? { updatedAt: raw.updated_at } : {}),
    })
  }
  return { mapped, skipped, clipped }
}

async function main(argv) {
  const args = new Set(argv)
  const flag = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt
  }
  const input = flag('--input', join(homedir(), '.mnemon', 'runtime', 'memories.json'))
  const maxChars = Number(flag('--max-chars', '2000'))
  const apply = args.has('--apply')
  const { dshHomePath } = await import('@deepseek-ai/dsh-home-paths')
  const { MemoryStore } = await import('../lib/store.js')
  const target = flag('--target', dshHomePath('local-memory'))
  const store = new MemoryStore(target)
  store.load()
  const report = parseAndMap(readFileSync(input, 'utf8'), { maxChars, existing: store.snapshot().entries.map((e) => e.text) })
  console.log(JSON.stringify({ input, target, apply, mapped: report.mapped.length, skipped: report.skipped, clipped: report.clipped }, null, 2))
  if (!apply) { console.log('(dry-run; pass --apply to import)'); return }
  for (const m of report.mapped) {
    store.add(m, m.source, maxChars, { ...(m.createdAt ? { createdAt: m.createdAt } : {}), ...(m.updatedAt ? { updatedAt: m.updatedAt } : {}) })
  }
  console.log(`imported ${report.mapped.length}; store now ${store.snapshot().entries.length} entries, revision ${store.revision()}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2))
}
```

- [ ] **Step 4: `npm test` 全绿**（新 migrate 2 项 + 既有）

- [ ] **Step 5: dry-run 真实数据**

Run: `node scripts/migrate-from-mnemon.mjs --dry-run`
Expected: `mapped=16`（或 16−空条数），`clipped` 计数与最长条目（npm 发布那条约 900+ 字符，应无截断）；输出留在报告文件。

- [ ] **Step 6: --apply 正式导入 + 复核**

```powershell
node scripts/migrate-from-mnemon.mjs --apply
node -e "const{MemoryStore}=await import('./lib/store.js');const{dshHomePath}=await import('@deepseek-ai/dsh-home-paths');const s=new MemoryStore(dshHomePath('local-memory'));s.load();console.log(s.snapshot().entries.length, s.revision())"
node scripts/migrate-from-mnemon.mjs --apply   # 幂等验证：mapped=0
```

Expected: `16 <rev>`；二次运行 `mapped=0, skipped 全 duplicate`。

- [ ] **Step 7: Commit** `feat: non-destructive migration from mnemon runtime memories.json`

---

### Task 9: 用户激活与人工冒烟（用户重启 dsh web 后执行）

**Files:**
- Modify: 无（验证任务；发现问题回 Task 1-8 对应任务修复循环）

**Interfaces:**
- Consumes: 全部任务 + Task 8 已导入的 16 条真实记忆
- Produces: 冒烟结论（记入台账）与 mnemon 侧去重决定（交用户）

- [ ] **Step 1: 用户操作——重启 `dsh web`**（当前 GUI 会话跑在该进程内，重启前保存会话）

- [ ] **Step 2: 冒烟清单（用户逐项过，控制器解读结果）**

```
□ 新会话上下文出现 "LOCAL MEMORY SNAPSHOT (revision …)"，含迁移来的 16 条（预算 4000 内按重要度/新先出，省略数标注）
□ 设置 → 「本地记忆」页渲染正常：列表/过滤/编辑/删除/添加闭环；config 区改动即时生效
□ "用 local_memory_remember 记一条：测试条目" → committed receipt；UI 刷新可见；下轮快照出现该条
□ local_memory_search 查询「npm」命中迁移来的发布经验条
□ 关 enabled → 下轮快照消失、工具返回禁用文本；开回即时恢复
□ mnemon 三层记忆照常（共存无冲突）；~/.mnemon/runtime/memories.json 未被改动（mtime/大小不变）
□ 观察双注入冗余：若希望关掉 mnemon 的 runtime 注入避免重复上下文，走 mnemon 设置（用户决定，本计划不改 mnemon）
```

- [ ] **Step 3: 台账记录冒烟结论**；全部通过则计划收口，进入最终 whole-branch review

---

## Self-Review（writing-plans 要求，已执行）

1. **Spec 覆盖**：查看=Task 6 页面+Task 5 RPC；注入=Task 4；按需读+Agent 写=Task 4 工具；数据模型/预算/归一化=Task 2/3；配置热载=Task 4；错误容忍（坏行、冲突、禁用）=Task 2/5/6 测试；共存不冲突=常量隔离+断言（wiring test）。无遗漏。
2. **占位符扫描**：Task 3 render 的 `put` 伪简化处已给出"实现时改写规则"（非 TBD，是裁决指令）；Task 5 handler 双写法以 `tsc` 实型为唯一裁决点——两处均为**有依据的单一收敛**，其余无占位。
3. **类型一致性**：`MemoryStore.add(input, source, maxChars, when)` 四参签名在 tools/protocol（不传 when）与 Task 8 迁移脚本（传 when）调用处一致；`StoreSnapshot` 字段与 api.ts 视图一致；`RPC_CHANNEL='/local-memory'` 三处（protocol 定义、index import 使用、client api.ts 复制值）同名；`bindScope` 返回面与 MemoryPage Props 对齐；context name/order 与 spec §5 对齐。✓

**补记（2026-09-16，开发启动时追加，非原评审轮次）**：应新增需求「迁移原记忆数据」追加 Task 8（非破坏复制 `~/.mnemon/runtime/memories.json`，真源=JSON 非 MEMORY.md 投影，幂等按 exact-text dedupe，时间戳经 `add()` 新增可选 `when` 参数保留）与 Task 9（用户重启激活 + 冒烟，含"mnemon 数据未改动"与"双注入冗余处置"两项验证）；原 Task 7 的人工冒烟步骤并入 Task 9，全局约束同步改引。spec 文档为审定基线，按"历史文档只读"原则不改。
