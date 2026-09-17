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
