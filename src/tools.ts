// src/tools.ts
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { filterByScope, rankEntries, scoreEntries } from './search.js'
import { findUnique, MemoryStore, normalizeScope, type Importance, type MemoryEntry } from './store.js'

type AgentCwd = { agent?: { session?: { header?: { cwd?: string } } } }
const cwdOf = (exec?: unknown): string => {
  if (exec === null || typeof exec !== 'object') return ''
  const raw = (exec as AgentCwd).agent?.session?.header?.cwd
  return raw ? normalizeScope(raw) : ''
}
const clipLimit = (n: number | undefined, cfg: Config): number => {
  // NaN/Infinity 一律落回配置默认；默认值自身非有限数再落 8，最终钳 1-32
  const pick = (v: number | undefined): number | undefined =>
    v !== undefined && Number.isFinite(v) ? Math.trunc(v) : undefined
  return Math.max(1, Math.min(pick(n) ?? pick(cfg.searchLimit) ?? 8, 32))
}

// MemoryEntry 是 interface（隐式索引签名缺失），进 JsonValue 前过一遍结构化投影
const jsonEntry = (e: MemoryEntry) => ({
  id: e.id, text: e.text, scope: e.scope, importance: e.importance,
  ...(e.tags?.length ? { tags: [...e.tags] } : {}),
  source: e.source, createdAt: e.createdAt, updatedAt: e.updatedAt,
})

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
    render: (_args, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }],
  },
  execute: async (args, exec) => {
    const a = (args ?? {}) as { query?: string; scope?: string; limit?: number }
    try {
      const c = cfg()
      if (!c.enabled) return { disabled: true, message: 'dsh-local-memory is disabled (Settings → 本地记忆)' }
      if (a.scope !== undefined && a.scope !== 'all' && a.scope !== 'global' && a.scope !== 'workspace') {
        return { completion: 'failed' as const, error: `unknown scope ${String(a.scope)} (all|global|workspace)` }
      }
      const scope = a.scope ?? 'all'
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
        items: ordered.slice(0, limit).map(jsonEntry),
      }
    } catch (e) {
      return { completion: 'failed' as const, error: `internal: ${e instanceof Error ? e.message : String(e)}`, items: [] }
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
    render: (_args, v) => [{ type: 'text', text: JSON.stringify(v) }],
  },
  execute: async (args, exec) => {
    const a = (args ?? {}) as { action?: string; text?: string; old_text?: string; id?: string; scope?: string; importance?: Importance; tags?: string[] }
    const fail = (error: string) => ({ completion: 'failed' as const, error })
    try {
      const c = cfg()
      if (!c.enabled) return fail('plugin disabled')
      if (!c.allowAgentWrite) return fail('agent writes are disabled (Settings → 本地记忆)')
      if (a.action === 'add') {
        const scope = a.scope === 'workspace' ? (cwdOf(exec) || 'global') : 'global'
        // 回执按新 id 反查权威条目，不依赖快照末位（防并发/排序耦合）。本 store 为单进程同步实现，
        // add 返回值即权威快照；"外部 racer 在 add 执行中插条目"的形态在本 store 语义下不存在、不可测。
        const snap = store.add(
          { text: a.text ?? '', scope, ...(a.importance ? { importance: a.importance } : {}), ...(a.tags ? { tags: a.tags } : {}) },
          'agent', c.entryMaxChars,
        )
        const entry = snap.entries[snap.entries.length - 1]
        if (!entry) return fail('add produced no entry')
        return { completion: 'committed' as const, id: entry.id, revision: snap.revision }
      }
      if (a.action === 'replace' || a.action === 'remove') {
        if (a.action === 'replace' && a.text == null) return fail('replace requires text')
        const { entry, matches } = findTarget(store, a)
        if (!entry) {
          return fail(matches.length === 0 ? `no entry matched ${a.id ?? a.old_text}` : `ambiguous: ids ${matches.map((m) => m.id).join(', ')}`)
        }
        if (a.action === 'replace') {
          const next = spliceText(entry, a)
          // null 哨兵 = needle 未命中：显式 fail，禁止静默整条替换
          if (next === null) return fail('old_text not found in entry')
          const snap = store.update(entry.id, { text: next, ...(a.importance ? { importance: a.importance } : {}) }, undefined, c.entryMaxChars)
          return { completion: 'committed' as const, id: entry.id, revision: snap.revision }
        }
        const snap = store.remove(entry.id)
        return { completion: 'committed' as const, id: entry.id, revision: snap.revision }
      }
      return fail(`unknown action ${String(a.action)} (add|replace|remove)`)
    } catch (e) {
      return fail(`internal: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
})

// replace 语义 = 宿主 edit 工具的字面替换（前置保证：replace 必带 text）：
// id 定位 → text 为整条新文本；old_text 定位 → text 替换 old_text 在条目内的首次出现
// （冻结测试钉死：'alpha one' --alpha→'alpha two' 结果必须是 'alpha two one'，后续
// old_text='one' 才能命中两条并判 ambiguous）。
// 返回 null 哨兵 = needle 未命中 → execute 侧转 fail('old_text not found in entry')，
// 禁止静默整条替换。该分支实践上不可达：findUnique 的定位本就是大小写不敏感 contains
// （store.ts findUnique），能拿到 entry 即说明 needle 必在其 text 内；此分支纯防御
// findUnique 与 spliceText 两处匹配逻辑未来漂移。不可达 ⇒ 无测试（单进程同步 store 下
// 无法不 monkeypatch 内部函数构造该形态，不再造 vacuous 用例），仅注释存证。
const spliceText = (entry: MemoryEntry, a: { id?: string; old_text?: string; text?: string }): string | null => {
  const needle = a.id ? '' : (a.old_text ?? '').trim()
  if (!needle) return a.text ?? entry.text
  const at = entry.text.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return null
  return entry.text.slice(0, at) + (a.text ?? '') + entry.text.slice(at + needle.length)
}

const findTarget = (store: MemoryStore, a: { id?: string; oldText?: string; old_text?: string }) =>
  findUnique(store.snapshot().entries, { ...(a.id !== undefined ? { id: a.id } : {}), ...(a.old_text !== undefined ? { oldText: a.old_text } : a.oldText !== undefined ? { oldText: a.oldText } : {}) })
