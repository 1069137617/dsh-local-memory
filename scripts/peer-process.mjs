// 跨进程回归的对手进程（由 test/concurrency.test.mjs 以真实 spawn 启动）。
// 放在 scripts/ 而非 test/：Node 默认发现规则含 **/test/**/*.mjs，
// 留在 test/ 下会被当成测试用例执行并"静默通过"，虚增计数。
//
// 用法: node scripts/peer-process.mjs <mode> <dir> <readyFile> <goFile>
//   hold-and-write : load（此时磁盘含 victim）→ 等 GO → 写一条自己的条目
//                    用于验证"对手仅持旧副本、不持更新戳"时，已删条目是否被复活
//   read-only      : load → 报告条目数 → 等 GO → 再报告一次（不做任何写）
//                    用于验证纯读路径能否感知对手的写入
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'

const [mode, dir, ready, go] = process.argv.slice(2)
if (!mode || !dir || !ready || !go) {
  console.error('usage: node scripts/peer-process.mjs <hold-and-write|read-only> <dir> <readyFile> <goFile>')
  process.exit(2)
}

const waitFor = async (file) => { while (!existsSync(file)) await new Promise((r) => setTimeout(r, 10)) }
const idsOnDisk = () => {
  try { return readFileSync(join(dir, 'entries.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) }
  catch { return [] }
}

const store = new MemoryStore(dir)
store.load()

if (mode === 'hold-and-write') {
  writeFileSync(ready, JSON.stringify(store.snapshot().entries.map((e) => e.id)), 'utf8')
  await waitFor(go)
  store.add({ text: 'peer-new', scope: 'global' }, 'agent')
  process.exit(0)
}

if (mode === 'read-only') {
  writeFileSync(ready, String(store.snapshot().entries.length), 'utf8')
  await waitFor(go)
  // 纯读：不调用任何写方法
  const after = store.snapshot()
  writeFileSync(`${ready}.after`, JSON.stringify({ count: after.entries.length, revision: after.revision, disk: idsOnDisk().length }), 'utf8')
  process.exit(0)
}

console.error(`unknown mode ${mode}`)
process.exit(3)
