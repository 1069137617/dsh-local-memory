// 并发回归测试的写者进程（由 test/concurrency.test.mjs 以真实 spawn 启动）。
// 注意：必须放在 scripts/ 而非 test/ —— Node 默认发现规则含 **/test/**/*.mjs，
// 放在 test/ 下会被当成测试用例执行并"静默通过"，虚增测试计数。
import { existsSync } from 'node:fs'
import { MemoryStore } from '../lib/store.js'

const [dir, count, tag, go] = process.argv.slice(2)
if (!dir || !go) {
  console.error('usage: node scripts/concurrent-writer.mjs <dir> <count> <tag> <goFile>')
  process.exit(2)
}

const store = new MemoryStore(dir)
store.load()
// 起跑线对齐：等父进程写 GO 文件后所有写者同时开跑，尽量逼近真实并发
while (!existsSync(go)) { /* spin */ }
for (let i = 0; i < Number(count); i += 1) {
  store.add({ text: `${tag}-${i}`, scope: 'global' }, 'agent')
}
