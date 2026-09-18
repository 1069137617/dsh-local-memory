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
  return /^[A-Za-z]:\//.test(s) ? s.toLowerCase() : s
}

export const validateEntryText = (text: string, maxChars: number): string => {
  const t = (text ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()
  if (!t) throw new Error('entry text is empty')
  if (t.length > maxChars) throw new Error(`entry text exceeds ${maxChars} chars`)
  return t
}

const digest = (v: unknown): string => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12)

// 同步退避：本 store 的写路径是同步的（add/update/remove → flush），拿不到 await，
// 而 publish/withLock 的重试需要给持句柄者一点时间释放。用 Atomics.wait 做真正的同步睡眠。
const sleep = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

// 跨进程锁的等待上限：锁忙时同步退避重试，累计到此值仍拿不到就上抛（fail-loud）。
// 取 2s —— 对工具调用足够宽容，又不会让设置页/工具调用挂死到不可接受。
const LOCK_TIMEOUT_MS = 2000

// 合并时用来判定"谁更新"的时间戳比较：ISO 串可直接字典序比较，非法值退化为 0。
const ts = (v: string): number => { const n = Date.parse(v); return Number.isFinite(n) ? n : 0 }

export function findUnique(entries: MemoryEntry[], q: { id?: string; oldText?: string }): { entry?: MemoryEntry; matches: MemoryEntry[] } {
  if (q.id) {
    const hit = entries.filter((e) => e.id === q.id)
    return hit[0] ? { entry: hit[0], matches: hit } : { matches: hit }
  }
  const needle = (q.oldText ?? '').trim().toLowerCase()
  const matches = needle ? entries.filter((e) => e.text.toLowerCase().includes(needle)) : []
  const one = matches.length === 1 ? matches[0] : undefined
  return one ? { entry: one, matches } : { matches }
}

const IMPORTANCES: readonly Importance[] = ['critical', 'normal', 'low']

export class MemoryStore {
  private entries: MemoryEntry[] = []
  private corrupt = 0
  // 本进程显式删除过的 id：合并时用来压制"对手磁盘上仍持有该条"导致的复活
  private tombstones = new Set<string>()
  constructor(public readonly dir: string) {}
  get file(): string { return join(this.dir, 'entries.jsonl') }
  get lockFile(): string { return this.file + '.lock' }

  load(): StoreSnapshot {
    this.entries = []
    this.corrupt = 0
    this.tombstones.clear() // 重新 load = 以磁盘为真值，本地删除意图作废
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
    const rows = this.entries.map((e) => [e.id, e.text, e.scope, e.importance, e.tags ?? [], e.updatedAt] as const)
    return digest(rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)))
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
      importance: input.importance !== undefined && IMPORTANCES.includes(input.importance) ? input.importance : 'normal', ...(tags.length ? { tags } : {}),
      source, createdAt: when?.createdAt ?? now, updatedAt: when?.updatedAt ?? now,
    }
    this.commit(() => { this.entries.push(entry) })
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
    this.commit(() => { this.entries[this.entries.indexOf(entry)] = next })
    return this.snapshot()
  }

  remove(id: string, expectedRevision?: string): StoreSnapshot {
    this.guard(expectedRevision)
    const i = this.entries.findIndex((e) => e.id === id)
    if (i < 0) throw new Error(`no entry ${id}`)
    this.commit(() => {
      this.entries.splice(i, 1)
      this.tombstones.add(id) // 登记删除意图：防止对手磁盘上的旧副本在合并时把它复活
    })
    return this.snapshot()
  }

  private guard(expected?: string): void {
    if (expected !== undefined && expected !== this.revision()) throw new RevisionConflictError(this.revision())
  }

  // 变更与落盘绑定：先把内存改动做完，再 flush；flush 抛错（锁超时 / IO 竞争）就把内存
  // 恢复到改动前的快照。否则会出现"磁盘没写成功、内存里却有这条"——agent 收到 failed
  // 回执，随后 render 却把它注入上下文，甚至被下一次成功的 flush 悄悄持久化。
  // 必须存浅拷贝：mutate 用 push/splice/下标赋值原地改数组，存引用等于没回滚。
  // （条目自身是冻结的 Object.freeze，浅拷贝足够；mergeFromDisk 会整体替换数组。）
  private commit(mutate: () => void): void {
    const before = this.entries.slice()
    const beforeTombstones = new Set(this.tombstones)
    mutate()
    try { this.flush() }
    catch (e) { this.entries = before; this.tombstones = beforeTombstones; throw e }
  }

  // 同一 memory 目录可能被多个进程写（多实例 / web+CLI 并行），tmp 名必须带写入者
  // 身份：只用 `<file>.tmp` 会让所有写者共用一个临时文件——互相覆盖，且先完成者
  // rename 走后，后到者 rename 抛 ENOENT 打挂进程（issue #1 发现 1，实证复现）。
  private tmpSeq = 0

  private flush(): void {
    mkdirSync(this.dir, { recursive: true })
    this.withLock(() => {
      this.mergeFromDisk()
      const tmp = `${this.file}.${process.pid}.${(this.tmpSeq += 1)}.tmp`
      writeFileSync(tmp, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''), 'utf8')
      this.publish(tmp)
    })
  }

  // 跨进程互斥：O_EXCL 建锁文件，失败即视为"对手持有"。
  // 有限等待后仍拿不到则上抛（fail-loud）——宁可让本次写入失败，也不无锁写入去覆盖对手。
  // 陈旧锁处理：锁文件里记 pid，若该 pid 已不存在（进程崩溃留下的僵尸锁）则夺锁。
  private withLock<T>(fn: () => T): T {
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    let held = false
    for (let attempt = 0; ; attempt += 1) {
      try { writeFileSync(this.lockFile, String(process.pid), { flag: 'wx' }); held = true; break }
      catch (e) {
        // Windows 上竞争不只表现为 EEXIST：目标文件处于"删除挂起"态时 open 直接返回
        // EPERM（实证：12 进程抢同一把锁 → EEXIST×30271  EPERM×2033）。两者都是
        // "别人正持有"，一律重试；把 EPERM 当致命错误上抛会在高并发下打挂写者。
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') throw e
        if (code === 'EEXIST' && this.reclaimIfDeadOwner()) continue
        if (Date.now() >= deadline) throw new Error(`local-memory store is locked by another process (${this.lockFile}); gave up after ${LOCK_TIMEOUT_MS}ms`)
        // 抖动退避：纯线性退避会让 N 个写者形成同频重试的活锁，加随机量打散
        sleep(Math.min(2 + attempt * 2, 25) + Math.floor(Math.random() * 8))
      }
    }
    try { return fn() } finally { if (held) { try { unlinkSync(this.lockFile) } catch { /* best effort */ } } }
  }

  private reclaimIfDeadOwner(): boolean {
    let owner = ''
    try { owner = readFileSync(this.lockFile, 'utf8').trim() } catch { return true } // 锁已消失：直接重试建锁
    const pid = Number(owner)
    if (!Number.isInteger(pid) || pid <= 0) return false
    try { process.kill(pid, 0); return false } // 存活：正常等待
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') return false
      try { unlinkSync(this.lockFile) } catch { /* 对手也在夺：让它去 */ }
      return true
    }
  }

  // 锁内把"磁盘上有、本进程没有"的条目并进来（issue #1 发现 1 第二层：本进程内存数组
  // 整体覆盖磁盘会静默抹掉对手的写入）。语义：
  // - 对手新写的 id：并入（tombstone 压制本进程显式删过的 id，防复活）
  // - 同 id 双方都有：updatedAt 较新者胜（本地较新则保留本地，对手较新则采纳对手）
  // - 顺序：外来条目排在本地条目之前，保证本地新 add 的条目仍在末位
  //   （tools.ts:120 的回执按 entries[len-1] 反查，此契约必须守住）
  private mergeFromDisk(): void {
    let raw = ''
    try { raw = readFileSync(this.file, 'utf8') } catch { return } // 尚无文件：无需合并
    const local = new Map(this.entries.map((e) => [e.id, e]))
    const foreign: MemoryEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let parsed: Record<string, unknown>
      try { parsed = JSON.parse(line) as Record<string, unknown> } catch { continue } // 坏行留给 corruptLines 统计
      if (typeof parsed?.id !== 'string' || typeof parsed?.text !== 'string') continue
      const id = String(parsed.id)
      if (this.tombstones.has(id)) continue
      const mine = local.get(id)
      if (!mine) { foreign.push(this.adopt(parsed)); continue }
      const theirs = this.adopt(parsed)
      if (ts(theirs.updatedAt) > ts(mine.updatedAt)) local.set(id, theirs) // 对手更新：采纳
    }
    if (!foreign.length && local.size === this.entries.length
      && this.entries.every((e) => local.get(e.id) === e)) return // 无变化：保持原数组引用
    const merged = [...foreign]
    for (const e of this.entries) merged.push(local.get(e.id) ?? e)
    this.entries = merged
  }

  // Windows 上 rename 覆盖已存在文件不是原子的：并发下会抛 EPERM（对手或杀软仍持句柄）
  // 或 ENOENT（对手刚把目标移走）。这类错误是竞争而非损坏——tmp 是本进程私有且完整的，
  // 清掉目标再重试即可收敛（issue #1 发现 1 第二根因，实证堆栈：原兜底 unlinkSync 自身
  // 无保护，竞争时抛 ENOENT/EPERM 直接打挂进程，实测 4/4 崩溃）。
  // 有界重试后仍失败则原样上抛：宁可失败也不静默丢掉这次写入。
  private publish(tmp: string): void {
    let last: unknown
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { renameSync(tmp, this.file); return }
      catch (e) {
        last = e
        const code = (e as NodeJS.ErrnoException).code
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY' && code !== 'ENOENT') break
        try { unlinkSync(this.file) } catch { /* 已被对手移走或仍被占：留给下一轮重试 */ }
        sleep(2 + attempt * 3) // 让持句柄者释放；本 store 全同步，只能用同步退避
      }
    }
    try { unlinkSync(tmp) } catch { /* best effort */ }
    throw last
  }
}
