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
