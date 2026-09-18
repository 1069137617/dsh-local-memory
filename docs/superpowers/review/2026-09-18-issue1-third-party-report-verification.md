# 第三方分析报告核对文档 — dsh-local-memory issue #1

- **核对对象**：GitHub issue [`1069137617/dsh-local-memory#1`](https://github.com/1069137617/dsh-local-memory/issues/1)「测试中发现的漏洞 以下是分析报告」（作者 `FuRongJun-1999`，2026-09-17 提交，open，0 评论）
- **被核对版本**：本仓库 `master` @ `2cf897c`（v0.3.0）
- **核对日期**：2026-09-18
- **核对方式**：**不转述**对方结论。所有判定由本轮独立复现得出——自建脚本（`repro.mjs` / `probe_render.mjs` / `sample.mjs`，位于 `%TEMP%\lm-verify\`，**不引用**本仓库 `test/*.mjs` 的任何断言）；宿主行号引用则直接打开本机 DSH 检出逐行比对。
- **环境**：Windows，Node（本机 `pwsh` 实为 Windows PowerShell 5.1 Desktop）；宿主 `@deepseek-ai/dsh-api-gateway` / `dsh-host-frontend-static` / `dsh-client-connection` 取自 `D:\DeepSeekHarness\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`。

---

## 结论先行

| # | 报告的发现 | 我的核对判定 |
|---|---|---|
| 1 | 🔴 跨进程并发写 → 丢数据 + 进程崩溃 | ✅ **完全属实**，已独立复现（我的数据比报告更差） |
| 2 | 🟡 注入预算是"正文预算" | ⚠️ **机制属实，但报告的量化前提错误**（默认是 4000 不是 400） |
| 3 | 🟡 分组头 `used` 跨组累加，语义误导 | ✅ **完全属实**，已独立复现 |
| 4 | ⚪ README 与实现漂移 5 条 | ⚠️ **4 条属实，1 条（4.2）是报告误判** |
| — | 报告称"宿主行号引用逐条属实" | ✅ **成立**，5 处引用我逐行验过 |
| 5 | （报告未发现）**`entryMaxChars` 与 `maxInjectionChars` 可配成"写入必失明"组合** | 🔴 **报告遗漏**，见下文第五节 |

**一句话**：报告的核心指控（发现 1）**成立且严重**，我复现出的破坏比它报告的更彻底；它的两条"中等"发现里有一条量化前提是错的；它的文档漂移清单里有一条自己判错了；同时它**漏掉了一个同源缺陷**（配置组合可让写入静默不可见）。

---

## 一、发现 1（跨进程并发）— 属实，已独立复现

### 机制核对（源码级）

`src/store.ts:142-151`：

```ts
private flush(): void {
  mkdirSync(this.dir, { recursive: true })
  const tmp = this.file + '.tmp'                 // ← L144：tmp 名只由文件路径派生
  writeFileSync(tmp, ...)                         // ← L145
  try { renameSync(tmp, this.file) }              // ← L146
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') { unlinkSync(this.file); renameSync(tmp, this.file) }
    else { try { unlinkSync(tmp) } catch {} ; throw e }   // ← L149：ENOENT 直接上抛
  }
}
```

报告的机制描述**准确**：`tmp` 与写入者身份无关，同一 memory 目录的所有写者共用一个 `.tmp`。L149 对非 EPERM 错误不做重试，直接上抛 → 未捕获异常。

配套条件也核实：

- `src/index.ts:32` 是全仓库**唯一**的 `store.load()` 调用点（`Select-String '\.load\(\)'` 仅命中此一处）；此后 `snapshot()` / `revision()` 均从内存 `this.entries` 计算 → 报告"读一次后再不重读磁盘"**属实**。
- 设计文档 `docs/superpowers/specs/2026-09-16-dsh-local-memory-design.md:47` 原文：**"写入串行化：宿主单进程内用一个 in-flight promise 链即可，无文件锁。"** → 报告称"这是显式写下的单进程假设，而非疏漏"**属实**。
- `grep 'concurren|race|parallel|spawn|worker_threads|ENOENT' test/` → **无命中**，"官方测试零覆盖"**属实**。

### 我的独立复现（8 进程 × 每人 10 条，真实 `spawn`，起跑线对齐）

```
=== A 组：8 进程 × 每人 10 条，并发写同一 entries.jsonl ===
磁盘存活条目 : 10 / 80
崩溃进程     : 6 / 8  退出码=[1,1,0,1,0,1,1,1]
崩溃原因     : Error: ENOENT: no such file or directory, rename
               'D:\Temp\lm-A-tUt2qw\entries.jsonl.tmp' -> 'D:\Temp\lm-A-tUt2qw\entries.jsonl'
撕裂/坏行    : 0 | 重复 id : 0
```

| 指标 | 报告值 | 我的复现值 |
|---|---|---|
| 磁盘存活 | 22 / 80（丢 72%） | **10 / 80（丢 87.5%）** |
| 崩溃进程 | 5 / 8 | **6 / 8** |
| 崩溃原因 | `ENOENT … rename '…entries.jsonl.tmp'` | **逐字相同** |

> 我的丢失率比报告更高，属并发时序差异（起跑对齐方式不同），不是分歧。**结论一致：并发写会静默丢数据并让写进程崩溃。**

### 乐观锁对跨进程失明 — 我的复现

```
=== B 组：乐观锁对跨进程写入是否可见 ===
B.1  外部改盘后本进程 revision 不变 : true  (bf84efb594e3 -> bf84efb594e3)
B.1b 新 load() 能看到外部条目      : true  (entries=2)
B.2  本进程再写一次后外部条目存活  : false | 磁盘最终=2 条: mine-original , mine-second
```

B.1 + B.1b 合起来是对报告主张的最强证明：**外部进程写盘后，本进程 `revision()` 完全不动**（锁对跨进程失明），而**重新 `load()` 明明能看到那条外部条目** —— 即数据确实在磁盘上，只是本进程不重读。B.2 证明随后一次 `flush()` 用内存数组**整体覆盖**，外部条目被无提示抹掉。

### 与 README 的矛盾（报告此处论证成立）

- `README.md:51` 把 `expectedRevision` 乐观锁描述为"concurrent movers are rejected"的通用保护；
- `README.md:85` 把"another window / an agent write"列为**受乐观锁保护的正常场景**；
- `README.zh.md:85`：**"revision 已被别处推进（另一窗口/Agent 写入），页面已自动重拉，重试提交即可。"**

而设计文档 L47 自己承认"无文件锁"。**同一进程内**（设置页 + agent 工具共享 `index.ts` 的单例 store）这三处都成立；**跨独立进程**则不成立。报告指出的自相矛盾**成立**。

### 判定

**✅ 属实（高危）。** 触发条件为同一 `DSH_HOME` 下两个及以上进程写（多实例、web + CLI 并行、并发 CI）。

**对报告建议的评价**：`tmp` 名加进程唯一后缀（`process.pid` + 计数器）是**最低成本且必须**的一步——它能立刻消除崩溃与 tmp 互相覆盖，但它**不能**修复丢数据（B.2 的整体覆盖仍存在）。要真正对齐 README 承诺，需要"写前重读 + 合并"或真正的文件锁。报告把这两层区分开了，这个层次是对的。

---

## 二、发现 2（注入预算是正文预算）— 机制属实，量化前提错误

### 报告错在哪

报告原文两处写 **"`maxInjectionChars`（默认 400）"**，并称实测"预算 400 / 实际注入 647 / 超支 +61.7%"。

真值 `src/config.ts:33`：

```ts
maxInjectionChars: 4000, entryMaxChars: 2000, searchLimit: 8, injectMode: 'full',
```

**默认是 4000，不是 400**（且 `validateConfig` 强制区间 200–20000，`config.ts:38`）。我的探针直接打印 `DEFAULTS.maxInjectionChars = 4000` 确认。所以报告那组"400 / 647"的数字来自它**自己设的 400 配置**，不是默认行为——它在结论里把"我设的值"写成了"默认值"。

### 机制本身：成立

`render.ts` 中 `budget` 只用于 `put()` 内的**行**裁决（`L41`：`used + row.length + 1 > budget`），而 `HEADER`（`L6-7`/`L62`）、尾部提示行（`L59-61`）都在预算之外。我实测：

```
=== 发现 2：正文预算 vs 实际注入 ===
配置预算        : 400
实际注入总长    : 534
超支            : +33.5%
头部(HEADER)长  : 181
```

**`HEADER` 实测 181 字符**——与报告写的 181 **精确吻合**，说明它确实量过。

> 我的超支率（+33.5%）与报告的 +61.7% 不同，原因是我构造的条目使 `omitted` 提示行较短；两者都>0，**机制结论一致：`maxInjectionChars` 约束的是条目正文，不含头部与提示行**。

### 判定

**⚠️ 部分属实。** 机制与"应按文档说明是正文预算"的建议**成立**；但报告"默认 400"是**事实性错误**（真值 4000），其 +61.7% 不能作为默认配置下的表现引用。默认 4000 时固定开销占比约 4.5%，影响远小于报告给人的印象。

---

## 三、发现 3（分组头计数器跨组累加）— 属实，已复现

`render.ts:31` 单个 `let used = 0` 在所有分组间共享；`L51` 却把它打进**每个**分组头：`(${paren}, ${used}/${budget} chars)`。

我的独立复现（global 组 2 条共 138 字符；workspace 组 1 条 87 字符）：

```
Contents of global memory (2 entries, 138/4000 chars):
Contents of workspace memory (ws, 1 entry, 225/4000 chars):
```

workspace 头报 **225**，而该组**自己只有 87 字符**（225 = 138 + 87）。同一份输出里两个分母都是 4000，含义却不同。

> 报告用 3 条/2 条给出 102 → 170 的例子，我用不同数据得到 138 → 225，**同一机制、独立确认**。

### 判定

**✅ 属实。** 纯可读性问题，不影响功能与预算裁决（`omitted` 判定用的是累计 `used`，逻辑自洽）。报告建议"分组头报本组字数、累计数移到汇总行"**合理**。

---

## 四、发现 4（文档漂移）— 4 条属实，1 条是报告误判

我生成了真值样本（`sample.mjs`，直接调 `lib/render.js`）：

```
--- full 模式真值 ---
LOCAL MEMORY SNAPSHOT (revision bf84efb594e3; dsh-local-memory; …)
Contents of global memory (3 entries, 139/4000 chars):
§ [id:9d99782417fe][critical] [ftp] Redeploys need a 45s cooldown
Contents of workspace memory (d:/code/x, 1 entry, 204/4000 chars):
§ [id:2a647ba3910a][normal] Test baseline for this repo is 29/29
```

| # | 报告主张 | 我的判定 | 证据 |
|---|---|---|---|
| 4.1 | README 示例用 `##` 标题 + `- [scope\|importance]` 行 | ✅ **属实** | `README.md:69` 有 `## LOCAL MEMORY SNAPSHOT (3 entries, 512/4000 chars, cwd d:/code/x)`、`:71-73` 为 `- [global\|critical] …`；真值无 `##`，行首为 `§ [id:…][importance]` |
| 4.2 | **"示例含 `cwd` 后缀 / renderSnapshot 不接收 cwd 用于展示"** | ❌ **报告误判** | `render.ts:23` 签名 `renderSnapshot(snap, cfg, cwd)`；`:29` 用 cwd 选条目；**`:54` `put('workspace memory', w, cwd \|\| undefined)` 把 cwd 作为分组标签输出**。真值样本里 `(d:/code/x, 1 entry, …)` 明明白白是展示。报告把"CJK/长 cwd 的**位置**与示例不同"错读成"不展示" |
| 4.3 | 措辞 "k of m entries **shown**" | ✅ **属实**（措辞级） | `README.md:73` 与 `:76` 均含 `shown`；真值提示行实测为 `(19 entries omitted — call local_memory_search to retrieve them)`，无 `shown` |
| 4.4 | id 是"时间戳 + 随机后缀" | ✅ **属实** | `README.md:43` 原文 `entry id (timestamp + random suffix)`；真值 `store.ts:90` 为 `randomUUID().replace(/-/g,'').slice(0,12)`——**纯随机，无时间戳成分** |
| 4.5 | 安装片段 pin `^0.2.0`，实际 0.3.0 | ✅ **属实** | `README.md:22` 与 `README.zh.md:22` 均为 `"dsh-local-memory": "^0.2.0"`；`package.json:3` 为 `"version": "0.3.0"` |

> 4.2 是本轮核对中**唯一被推翻的发现**。这也提示：报告在大方向上严谨（181 字、宿主行号全对），但在"cwd 是否用于展示"这类需读完整函数体的问题上出了错。

---

## 五、报告未发现的缺陷：配置组合可让写入静默失明

这是本轮核对**新增**的发现，与发现 1 同源（都出在"内存权威副本 + 全量覆盖"），但**不需要多进程**即可触发——单实例、单进程就中招。

`validateConfig`（`config.ts:36-41`）允许 `entryMaxChars` 上限 **8000**，`maxInjectionChars` 上限 **20000**，两者**独立校验**，没有交叉约束。而 `render.ts:41` 的裁决是**整条放不下就跳过、条内不截断**：

```ts
if (used + row.length + 1 > budget) { omitted += 1; continue }
```

于是 `entryMaxChars` 接近或大于 `maxInjectionChars` 时，一条合法写入的条目**永远进不了注入快照**——而 `add` 照常返回 `completion: "committed"`。Agent 写了、拿到成功回执、下一轮却看不到自己刚写的东西。

判定：🔴 **值得修的健壮性缺陷**，优先级低于发现 1（它不丢数据、不崩溃，且需要用户手动调到边缘配置），但**单进程即可复现**，属于报告"单实例使用完全无碍"结论的例外，报告未覆盖。

> 记录在案的边界：此为**代码路径推导**（`entryMaxChars`→`validateEntryText`→行长度→`render.ts:41` 裁决），我未构造 JSONL 实机验证；与发现 1/3 的"已复现"级别不同，**如实标注为未实机验证**。

---

## 六、对报告其他主张的核对

| 报告主张 | 判定 | 证据 |
|---|---|---|
| 宿主 5 处行号引用全部属实 | ✅ **成立** | 直接打开本机宿主包逐行比对，见下表 |
| `npm test` 52/52 | ✅ **成立** | 我实跑：`tests 52 / pass 52 / fail 0`，`exit code 0` |
| 25 个提交，2026-09-16 ~ 09-17 | ✅ **成立** | `git rev-list --count HEAD` = 25；首 `2026-09-16`，末 `2026-09-17` |
| "源码约 2226 行（含测试）" | ⚠️ **偏差** | 我的口径：`src` = 1278 行，`src`+`test` = 1758 行（`scripts` 另 391）。2226 可能含 `.superpowers/` 简报等文件，**行数口径不明**，不影响其实质结论 |
| `tmp` 名派生自文件路径 | ✅ **成立** | `store.ts:144` |
| `load()` 后从不重读磁盘 | ✅ **成立** | 全仓仅 `index.ts:32` 一处 `load()` |
| 官方测试对并发零覆盖 | ✅ **成立** | `grep` 6 个关键词，0 命中 |

### 宿主行号引用逐条核对

| 报告引用 | 实际内容（我打开本机文件所见） | 判定 |
|---|---|---|
| `dsh-client-connection/lib/client.js:6206-6212` | `L6206: const response = await send(new URL(\`${channel}/${endpoint}\`, resolveBase()), {`<br>`L6212: if (!response.ok) throw new Error(\`transport failure for ${channel}/${endpoint}: HTTP ${response.status}\`);` | ✅ 逐字命中 |
| `dsh-host-frontend-static/lib/index.js:89` | `L89: res.writeHead(405);` | ✅ 命中 |
| `dsh-api-gateway/lib/index.js:455` | `L455: connectionCtx.connection.rpc.intercept("/api", (endpoint) => this.claimsEndpoint(endpoint), (endpoint, payload, signal) => this.dispatchRpc(endpoint, payload, signal));` | ✅ 命中 |
| `…/index.js:764-785` | `L764: resolveSrcDescriptor(namespace, method, endpoint) {` … `L785: const signalIndex = names.indexOf("signal");` | ✅ 命中 |
| `…/index.js:1010` + `:1040` | `L1010: function methodParameterNames(service, method, endpoint) {`<br>`L1040: function assertExactArguments(args, descriptor, endpoint) {` | ✅ 精确命中 |

**报告称"作者真的读过宿主实现"——我确认这个评价成立**，且这正是 `src/remote.ts` 头注的设计依据。

---

## 七、总判定

| 维度 | 报告的自评 | 我的核对后评价 |
|---|---|---|
| 核心指控（发现 1） | 高危、真实 | ✅ **维持原判，且比报告更严重**（我复现 10/80 存活、6/8 崩溃） |
| 发现 2 | 中 | ⚠️ **降级**：机制成立，但"默认 400"错误，实际影响被高估 |
| 发现 3 | 中 | ✅ **维持**（可读性问题，报告定"中"偏高，我认为是"轻"） |
| 发现 4 | 轻 | ⚠️ **4/5 属实**，4.2 是报告误判，应剔除 |
| 宿主集成研究 | ★★★★★ | ✅ **同意**，5/5 行号可验证 |
| 官方门禁与测试 | 52/52 全绿但有覆盖盲区 | ✅ **同意**，并确认并发为零覆盖 |
| 报告自身的严谨性 | 自曝 8 处自身错误 | ✅ 自曝行为值得肯定；但仍有 1 处误判（4.2）+ 1 处事实错误（默认 400）未被自检捕获 |

### 处理建议（按优先级）

1. **P0 — 修 `tmp` 唯一性**：`store.ts:144` 改为 `this.file + '.' + process.pid + '.' + (counter++) + '.tmp'`。消除崩溃与 tmp 互相覆盖。**必须配一个真实 `spawn` 的并发回归测试**（当前为零覆盖）。
2. **P0 — 消除"整体覆盖"**：`flush()` 前重读磁盘做合并，或引入文件锁；否则 B.2 的静默丢数据仍在。
3. **P1 — 对齐 README 与实现**：要么改实现（把 `HEADER` 计入预算、分组头报本组字数），要么改文档（说明预算口径、修正 `cwd`/id/`shown`/版本 pin 四处漂移）。
4. **P2 — 加配置交叉约束**：`entryMaxChars` 与 `maxInjectionChars` 之间补一条 `validateConfig` 校验，或让 `render.ts` 对单条超预算做截断而非纯跳过。

---

## 附：本轮核对产物

| 脚本 | 用途 | 结果 |
|---|---|---|
| `repro.mjs` | A 组跨进程并发 / B 组乐观锁跨进程可见性 | 10/80 存活、6/8 崩溃；revision 跨进程失明、外部条目被覆盖 |
| `probe_render.mjs` | 预算口径 + 分组头计数器 | 超支 +33.5%；`HEADER`=181；workspace 头报 225 实际 87 |
| `sample.mjs` | 生成注入格式真值样本 | 用于逐条对照 README 示例（含 4.2 的推翻证据） |

位置：`%TEMP%\lm-verify\`（临时目录，未纳入版本库；如需归档请另行指定路径）。

> **诚实标注**：发现 1、3 为**实机复现**级证据；发现 2、4 为**源码/真值样本**级证据；第五节新增发现 5 为**代码路径推导**级，未实机验证。三者置信度不同，已在正文分别标注。
