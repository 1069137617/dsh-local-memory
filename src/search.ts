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

// 字面字符即 brief 规定的 CJK 码位区间 U+3400-U+9FFF ∪ U+3040-U+30FF（已按码点核验）
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
