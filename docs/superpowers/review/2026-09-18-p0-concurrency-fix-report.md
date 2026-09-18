# P0 修复报告 — 跨进程并发写丢数据与进程崩溃（issue #1 发现 1）

- **日期**：2026-09-18
- **范围**：`1069137617/dsh-local-memory#1` 的 P0 两项（tmp 唯一性 + 消除整体覆盖），另含修复过程中实证发现的两个衍生缺陷
- **版本**：0.3.0 → **0.3.1**
- **方法**：严格 TDD（先写测试、亲眼看它失败、再实现），全程以真实 `spawn` 复现为准，不凭代码阅读下结论

---

## 结论先行

| 项 | 修复前（实测） | 修复后（实测） |
|---|---|---|
| 并发写者崩溃 | **6 / 8** | **0 / 20** |
| 并发写入存活 | **10 / 80** | **200 / 200** |
| 条目录入撕裂/重复 id | 0 | 0 |
| 官方测试 | 52 / 52 | **61 / 61** |
| typecheck ×2 / build / verify:install | rc=0 | **rc=0** |

**P0 两项均已达成并验证。** 过程中还实证发现并修复了 2 个衍生缺陷（见第三、四节），二者都不是原报告提到的，但都会造成"回执说成功、实际不一致"。

---

## 一、根因（两条，均为实证而非推断）

### 根因 1：tmp 名只由文件路径派生（原报告发现 1）

`src/store.ts` 原 `flush()`：`const tmp = this.file + '.tmp'`。同一 memory 目录的所有写者**共用一个 `.tmp`**：互相覆盖；先完成者 `rename` 走后，后到者 `rename` 抛 ENOENT 直接打挂进程。

**修复**：tmp 名带写入者身份 —— `${file}.${process.pid}.${seq}.tmp`。

### 根因 2：Windows 上 `rename` 覆盖已存在文件不是原子的（修复根因 1 后**才暴露**）

修完根因 1 后压力测试仍有崩溃，抓到的堆栈是新形态：

```
Error: EPERM: operation not permitted, rename '…entries.jsonl.20460.2.tmp' -> '…entries.jsonl'
    at MemoryStore.flush (lib/store.js:159:17)
Error: ENOENT: no such file or directory, unlink 'D:\Temp\diag-1\entries.jsonl'
    at MemoryStore.flush (lib/store.js:158:17)
```

原 EPERM 兜底里的 `unlinkSync(this.file)` **自身无保护**，竞争时抛 ENOENT/EPERM 直接打挂进程。这是**第二个独立根因**，不是根因 1 的残留。

**修复**：抽出 `publish(tmp)`，对 `EPERM`/`EACCES`/`EBUSY`/`ENOENT` 做**有界重试 + 同步退避**（tmp 是本进程私有且完整的，属竞争而非损坏，清目标后重试即可收敛）；超限则原样上抛，**宁可失败也不静默丢写入**。

---

## 二、P0 第 2 项：消除整体覆盖（文件锁 + 条目级合并）

按用户拍板方案实现：**锁 → 重读磁盘合并 → 应用本次变更 → 写 tmp → rename → 释放锁**。

### 锁定设计

- `flush()` 全程持 `O_EXCL` 锁文件（`entries.jsonl.lock`，内容为 pid）
- **有限等待 + 超时上抛**：累计 2s 仍拿不到锁则抛 `local-memory store is locked by another process`（fail-loud，绝不无锁覆盖）
- **陈旧锁回收**：锁内 pid 已不存在（`process.kill(pid,0)` → ESRCH）则夺锁，避免崩溃进程留下僵尸锁
- **抖动退避**：纯线性退避会让 N 个写者同频重试形成活锁，加随机量打散

### 合并语义

- 对手新写的 id → 并入
- **tombstone 压制**：本进程显式删除过的 id 不因对手磁盘旧副本而复活
- 同 id 双方都有 → `updatedAt` 较新者胜，陈旧副本不覆盖较新版本
- **顺序**：外来条目排在本地条目之前，保证本地新 `add` 仍在末位 —— 这是 `tools.ts:120` 回执按 `entries[len-1]` 反查的**既有契约**，专门写了测试钉住

---

## 三、衍生缺陷 A：Windows 上锁竞争不只抛 EEXIST

**发现方式**：合并实现后压力测试仍崩溃，错误为 `EPERM: open 'entries.jsonl.lock'`。写定向探针（12 进程抢同一把锁）量化：

```
O_EXCL 竞争错误码分布: EEXIST×30271  EPERM×2033   （退出码全 0）
```

**根因**：目标文件处于"删除挂起"态时 `open` 直接返回 **EPERM**。原 `withLock` 只把 `EEXIST` 当竞争，其余一律上抛 → 高并发下打挂写者。

**修复**：`EPERM`/`EACCES`/`EBUSY` 一并按竞争重试（`EEXIST` 才走夺锁判定）。**验证**：EPERM 出现轮次 3/6 → **0/6**。

---

## 四、衍生缺陷 B：flush 失败后内存未回滚

**发现方式**：分析锁超时路径时发现——`add`/`update`/`remove` 都是"先改内存、再 flush"，而 flush 可能抛错。原实现不回滚，于是出现**磁盘没写成功、内存里却有这条**：agent 收到 `failed` 回执，随后 `render` 却把它注入上下文，甚至被下一次成功的 flush 悄悄持久化。

**测试**（先看它失败）：`failed add leaked into memory: baseline , must-not-stick` ✅ RED 确认。

**修复**：抽出 `commit(mutate)` —— 变更与落盘绑定，flush 抛错则恢复内存与 tombstone。

> 实现时这个测试**第二次抓到我自己的 bug**：首版写 `const before = this.entries`（引用而非拷贝），而 `mutate` 用 `push`/`splice` 原地改的正是它，"恢复"等于没恢复。测试仍红，改为 `this.entries.slice()` 后转绿。**这正是 TDD 的价值——测试抓住了修复本身的错误。**

---

## 五、验证证据

### 并发压力（真实 `spawn`，起跑线对齐）

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 4 进程 × 10 条 × 5 轮（真实规模） | 6/8 崩溃、10/80 存活 | **0/20 崩溃、200/200 存活** |
| 12 进程 × 15 条 × 4 轮（极限） | — | 0 崩溃、720/720 存活 |

### 新增回归测试（`test/concurrency.test.mjs`，9 个用例）

1. flush 不得吞掉共享 `.tmp` 路径上的外来文件
2. 写者进程不崩溃
3. 另一进程写入的条目在本进程 flush 后存活（**修复前红**）
4. 本地删除的条目不被合并复活
5. 外来条目不挤掉 add 回执契约
6. 同 id：较新外来版本胜、陈旧版本不覆盖
7. flush 失败不得让变更留在内存（**修复前红**）
8. 并发写者零丢失（**修复前红：lost 15/20**）
9. 高竞争锁翻腾不崩溃

### 门禁

```
npm test            → tests 61 / pass 61 / fail 0   （52 原有 + 9 新增）
npm run typecheck   → rc=0（host + client 双 tsconfig）
npm run build       → rc=0，客户端产物自检通过
npm run verify:install web → All checks passed, rc=0
```

---

## 六、如实披露

### 过程失误（据实记录，非对方缺陷）

| # | 我的错误 | 真相 |
|---|---|---|
| S1 | 首个并发测试超时 120s | 我的脚手架 bug：`newDir()` 返回 `mem` 子目录但未创建，子进程 `existsSync(GO)` 永远为假而死等。加 `mkdirSync` 修复 |
| S2 | 测试辅助文件放在 `test/helpers/` | Node 默认发现规则含 `**/test/**/*.mjs`，它被当成测试执行并"静默通过"，把计数从 54 虚增到 55。已移到 `scripts/concurrent-writer.mjs`，并去掉"无参数静默退出"的伪装（改为 usage + exit 2） |
| S3 | `commit` 首版回滚无效 | 存了数组引用而非浅拷贝；被 4 号测试抓住，改 `.slice()` 后转绿 |
| S4 | 压力脚本两处自身 bug | `kids.find(...)` 无错误时返回 undefined 未判空；`close` 事件注册前可能已触发。均属测量工具缺陷，与被测对象无关 |
| S5 | 迁移辅助脚本时 PowerShell 编码破坏 CJK 路径 | `(Get-Content) -replace` 重写文件导致 `一诺吖` 变乱码、模块解析失败。改用 write 工具直接落盘 |

### 已知边界（未解决，已写入 README）

1. **删除 vs 并发更新的竞态**：一方删除、另一方恰好并发持有该条目且时间戳更新时，删除可能失败、条目存活。tombstone 只对"已见过的副本"生效。**未修**，已在两版 README 的"已知边界"中明确声明。
2. **锁等待上限 2s**：量化实测单次 `add` 持锁约 **11–13.5ms**（400 条时 13.52ms，随文件增长）。约十几个进程同时打同一文件时，尾部写者的排队时间必然超过 2s 预算 → 报 `locked by another process`。这是**用户选定的"有限等待 + 超时上抛"策略的设计内行为**（fail-loud，不静默丢数据），不是缺陷。
3. **性能未优化**：每次写入仍全量重写文件（O(n)，400 条约 13.5ms）。本次 P0 未触碰该设计。
4. **未做**：原报告发现 2/3/4（预算口径、分组头计数器、文档漂移中我未核的部分）不在本次 P0 范围内；README 漂移已顺手修正 4 处（id 描述、注入示例真值、`shown` 措辞、版本 pin）。

---

## 附：改动清单

| 文件 | 变更 |
|---|---|
| `src/store.ts` | tmp 唯一性、`publish()` 有界重试、`withLock()` 跨进程锁、`mergeFromDisk()` 条目级合并、tombstone、`commit()` 回滚 |
| `test/concurrency.test.mjs` | 新增，9 个并发回归用例 |
| `scripts/concurrent-writer.mjs` | 新增，真实 spawn 的写者进程 |
| `README.md` / `README.zh.md` | 并发语义与已知边界、故障排查新增锁超时条目、修正 4 处漂移、版本 pin |
| `package.json` | 0.3.0 → 0.3.1 |

> 本轮复现脚本位于 `%TEMP%\lm-verify\`（临时目录，未入库）。
