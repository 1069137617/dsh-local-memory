// test/concurrency.test.mjs
// 并发回归（issue #1 发现 1）：同一 DSH_HOME 下多个进程写 entries.jsonl。
// 根因：flush() 的 tmp 路径只由目标文件路径派生（src/store.ts:144），
// 所有写者共用同一个 .tmp —— 互相覆盖，且先完成者 rename 走后，后到者 rename 抛 ENOENT。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../lib/store.js'

// 写者进程脚本放在 scripts/ 而非 test/：Node 的默认发现规则含 **/test/**/*.mjs，
// 留在 test/ 下会被当成测试文件执行（无参数静默退出 ⇒ 虚增一个"假通过"的用例）。
const WORKER = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'concurrent-writer.mjs')
const newDir = () => join(mkdtempSync(join(tmpdir(), 'dshlm-conc-')), 'mem')
const entryFile = (dir) => join(dir, 'entries.jsonl')

// 4 进程 × 5 条，起跑线对齐后同时写同一文件
const runConcurrent = async (procs = 4, per = 5) => {
  const dir = newDir()
  mkdirSync(dir, { recursive: true }) // 子进程要在起跑前读到 GO，目录须先存在
  const go = join(dir, 'GO')
  const kids = []
  for (let i = 0; i < procs; i += 1) {
    const tag = `p${i}`
    const child = spawn(process.execPath, [WORKER, dir, String(per), tag, go], { stdio: ['ignore', 'pipe', 'pipe'] })
    const rec = { tag, child, err: '' }
    child.stderr.on('data', (d) => { rec.err += d })
    kids.push(rec)
  }
  await new Promise((r) => setTimeout(r, 250))
  writeFileSync(go, 'go', 'utf8') // 起跑枪
  const codes = await Promise.all(kids.map((k) => new Promise((res) => k.child.on('close', (code) => res(code)))))
  return { dir, codes, kids, expected: procs * per }
}

test('concurrent writers: flush must not consume a foreign file at the shared <file>.tmp path', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'first', scope: 'global' }, 'ui')
  // 模拟"另一个进程正持有旧版共享 tmp"：此时本进程 flush 不得动它
  const shared = join(s.dir, 'entries.jsonl.tmp')
  writeFileSync(shared, 'DECOY', 'utf8')
  s.add({ text: 'second', scope: 'global' }, 'ui')
  assert.ok(existsSync(shared), 'flush renamed away a foreign file at the shared .tmp path')
  assert.equal(readFileSync(shared, 'utf8'), 'DECOY', 'flush overwrote a foreign file at the shared .tmp path')
  assert.ok(!readFileSync(entryFile(s.dir), 'utf8').includes('DECOY'), 'foreign content leaked into entries.jsonl')
})

test('concurrent writers: no writer process crashes', async () => {
  const { dir, codes, kids } = await runConcurrent()
  const failed = kids.filter((_, i) => codes[i] !== 0)
  const why = failed.map((k) => `${k.tag} rc=${codes[kids.indexOf(k)]} ${k.err.split('\n')[0]}`).join(' | ')
  assert.deepEqual(failed.map((k) => k.tag), [], `${failed.length}/${kids.length} writer(s) crashed: ${why} (dir=${dir})`)
})

// ---- 条目级合并（issue #1 发现 1 第二层：整体覆盖会静默抹掉对手的写入）----
// 以下三条用"直接改盘"精确构造另一个进程留下的磁盘状态。

test('merge: an entry written by another process survives a local flush', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'mine-original', scope: 'global' }, 'ui')
  // 另一个进程写入了它的条目（磁盘 = 外部条目 + 我的条目）
  const m = JSON.parse(readFileSync(entryFile(s.dir), 'utf8').trim())
  const foreign = { ...m, id: 'foreign00001', text: 'written-by-other-process' }
  writeFileSync(entryFile(s.dir), `${JSON.stringify(foreign)}\n${JSON.stringify(m)}\n`, 'utf8')

  s.add({ text: 'mine-second', scope: 'global' }, 'ui') // 本次 flush 不得整体覆盖
  const texts = readFileSync(entryFile(s.dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).text)
  assert.ok(texts.includes('written-by-other-process'), `foreign entry was silently overwritten; disk has: ${texts.join(' , ')}`)
  assert.ok(texts.includes('mine-second'))
  assert.ok(texts.includes('mine-original'))
})

test('merge: an entry removed locally is not resurrected by the merge', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'keep-me', scope: 'global' }, 'ui')
  s.add({ text: 'delete-me', scope: 'global' }, 'ui')
  const gone = s.snapshot().entries.find((e) => e.text === 'delete-me')
  s.remove(gone.id)
  // 另一个进程仍持有旧集合（含我刚删掉的那条）并写回磁盘
  const kept = s.snapshot().entries.find((e) => e.text === 'keep-me')
  writeFileSync(entryFile(s.dir), `${JSON.stringify({ ...kept, id: gone.id, text: 'delete-me' })}\n${JSON.stringify(kept)}\n`, 'utf8')

  s.add({ text: 'trigger', scope: 'global' }, 'ui') // 触发一次 flush（含合并）
  const texts = readFileSync(entryFile(s.dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).text)
  assert.ok(!texts.includes('delete-me'), `locally removed entry was resurrected: ${texts.join(' , ')}`)
  assert.ok(texts.includes('trigger'))
})

test('merge: foreign entries must not displace the add receipt (tools.ts reads entries[len-1])', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'mine-original', scope: 'global' }, 'ui')
  const m = JSON.parse(readFileSync(entryFile(s.dir), 'utf8').trim())
  writeFileSync(entryFile(s.dir), `${JSON.stringify({ ...m, id: 'foreign00002', text: 'foreign' })}\n${JSON.stringify(m)}\n`, 'utf8')

  const snap = s.add({ text: 'the-new-one', scope: 'global' }, 'ui')
  const last = snap.entries[snap.entries.length - 1]
  assert.equal(last.text, 'the-new-one', `receipt contract broken: entries[len-1] is "${last.text}"`)
})

test('merge: a newer foreign revision of the same id wins; an older one does not clobber', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'v1', scope: 'global' }, 'ui')
  const mine = s.snapshot().entries[0]

  // 对手持有该条的更新版本（updatedAt 更晚）并写回磁盘
  const newer = { ...mine, text: 'v2-from-other-process', updatedAt: new Date(Date.now() + 60_000).toISOString() }
  writeFileSync(entryFile(s.dir), `${JSON.stringify(newer)}\n`, 'utf8')
  s.add({ text: 'trigger-1', scope: 'global' }, 'ui')
  let seen = s.snapshot().entries.find((e) => e.id === mine.id)
  assert.equal(seen.text, 'v2-from-other-process', 'newer foreign revision must win')

  // 对手再持有陈旧版本（updatedAt 更早）写回磁盘：不得覆盖本地较新的版本
  const older = { ...mine, text: 'v0-stale-from-other-process', updatedAt: new Date(Date.now() - 60_000).toISOString() }
  const keep = readFileSync(entryFile(s.dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.id !== mine.id)
  writeFileSync(entryFile(s.dir), `${JSON.stringify(older)}\n${keep.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8')
  s.add({ text: 'trigger-2', scope: 'global' }, 'ui')
  seen = s.snapshot().entries.find((e) => e.id === mine.id)
  assert.equal(seen.text, 'v2-from-other-process', 'stale foreign revision must not clobber a newer local one')
})

// 写失败必须回滚内存状态：add/update/remove 都是"先改内存、再 flush"，
// 而 flush 可能因锁超时/IO 竞争抛错。若内存不回滚，就会出现
// "磁盘没写成功、但内存/注入里有这条" —— agent 收到 failed 回执，
// 随后 render 却把它注入了上下文，甚至可能被下一次成功的 flush 悄悄持久化。
test('a failed flush must not leave the mutation visible in memory', () => {
  const s = new MemoryStore(newDir())
  s.load()
  s.add({ text: 'baseline', scope: 'global' }, 'ui')
  const before = s.snapshot().entries.map((e) => e.text)

  // 伪造"另一个进程持锁"：锁文件由本进程写死，且 owner pid 是活着的自己 ⇒ 不会被夺锁
  writeFileSync(s.lockFile, String(process.pid), 'utf8')
  try {
    assert.throws(
      () => s.add({ text: 'must-not-stick', scope: 'global' }, 'ui'),
      /locked by another process/,
      'expected the lock timeout to surface as an error (fail-loud)',
    )
    const after = s.snapshot().entries.map((e) => e.text)
    assert.deepEqual(after, before, `failed add leaked into memory: ${after.join(' , ')}`)

    // update / remove 同样不得留下半成品
    const id = s.snapshot().entries[0].id
    assert.throws(() => s.update(id, { text: 'must-not-stick-either' }), /locked by another process/)
    assert.equal(s.snapshot().entries[0].text, 'baseline', 'failed update leaked into memory')
    assert.throws(() => s.remove(id), /locked by another process/)
    assert.equal(s.snapshot().entries.length, 1, 'failed remove leaked into memory')
  } finally {
    rmSync(s.lockFile, { force: true })
  }
})

test('merge: concurrent writers lose nothing (all adds survive)', async () => {
  const { dir, codes, expected, kids } = await runConcurrent()
  assert.deepEqual(codes.filter((c) => c !== 0), [], `${kids.filter((_, i) => codes[i] !== 0).length} writer(s) crashed`)
  const lines = readFileSync(entryFile(dir), 'utf8').trim().split('\n')
  const parsed = lines.map((l) => { try { return JSON.parse(l) } catch { return null } })
  assert.equal(parsed.filter(Boolean).length, lines.length, 'torn/corrupt line found in entries.jsonl')
  const ids = parsed.filter(Boolean).map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids found')
  assert.equal(ids.length, expected, `lost ${expected - ids.length}/${expected} concurrently added entries`)
})

// 锁的获取在 Windows 上不只是 EEXIST 竞争：目标文件处于"删除挂起"态时 open 返回
// EPERM（实证：12 进程抢同一把锁，EEXIST×30271  EPERM×2033）。这类 EPERM 必须按
// 竞争处理（重试），当成致命错误上抛就会在高并发下打挂写者。
// 高竞争用例：10 进程 × 8 条 = 80 次加锁/解锁，足以把该路径打出来。
test('merge: high-contention lock churn must not crash writers', async () => {
  const { dir, codes, kids, expected } = await runConcurrent(10, 8)
  const failed = kids.filter((_, i) => codes[i] !== 0)
  const why = failed.map((k) => k.err.split('\n').find((l) => l.startsWith('Error:')) ?? '').join(' | ')
  assert.deepEqual(failed.map((k) => k.tag), [], `${failed.length}/${kids.length} writer(s) crashed: ${why} (dir=${dir})`)
  const ids = readFileSync(entryFile(dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l).id)
  assert.equal(ids.length, expected, `lost ${expected - ids.length}/${expected} entries under high contention`)
})
