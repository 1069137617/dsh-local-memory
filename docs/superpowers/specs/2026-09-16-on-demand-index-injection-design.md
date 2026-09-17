# 按需索引注入（injectMode）设计

日期：2026-09-16 ｜ 状态：已获用户批准 ｜ 前置版本：0.2.0

## 问题

当前每轮注入 `LOCAL MEMORY SNAPSHOT` 为全量文本（预算 `maxInjectionChars`，默认 4000）。条目增多后常驻上下文被记忆全文占满（19 条实测约 4000 字符触顶）。用户需要：压缩常驻注入，让 AI 按需检索展开细节。

## 决策记录（用户拍板）

1. **分层混合**：critical 条目保留全文；normal/low 降为索引行（id + 标签 + 摘要）。
2. **默认保持全文**：新设置 `injectMode` 默认 `'full'`，索引模式手动开启。
3. **方案 A**：展开通道走现有 `local_memory_search` 加 `ids` 参数（不新建工具——工具定义本身也常驻上下文）。

## 设计

### 1. 配置（src/config.ts）

- 新键 `injectMode: 'full' | 'index'`，默认 `'full'`。
- `Config` 类型 Pick 白名单追加 `'injectMode'`。
- schemastery 3.18.2 枚举写法以 .d.ts 为准（候选 `z.const`/union of literals；实现时核实，语义要求：只接受这两个字面量，非法值 schema 层拒绝）。
- `validateConfig` 不新增数值范围校验（枚举由 schema 保证）。

### 2. 渲染（src/render.ts）

`renderSnapshot` 按 `cfg.injectMode` 分支：

- **`'full'`（默认）**：现状逐字节不变（既有冻结测试继续钉死）。
- **`'index'`**：
  - critical 条目 → 全文行，格式与现状一致：`§ [id:<id>][critical][<tags>] <text>`
  - normal/low 条目 → 索引行：`§ [id:<id>][<importance>][<tags>] <text 前 80 字符>…`
    - 摘要 = 原文换行折空格后取前 80 字符；原文 ≤80 字符时不加省略号（此时索引行即全文，无展开损失）
    - 80 为固定常量，不设配置（YAGNI）
  - 全局/工作区分节、节内 critical→normal→low 排序（`rankEntries` 现状）不变；critical 全文行排在各节最前
  - 尾部指引行（仅当本次渲染至少出现一条索引行时）：
    `(normal/low entries are index-only — call local_memory_search with ids=["..."] or query to expand full text)`
  - 预算：同一 `maxInjectionChars`；索引行与全文行同样参与"放不下→计入 omitted"裁决

### 3. 检索工具（src/tools.ts）

`local_memory_search` 新增参数：

```
ids: { type: 'json', description: 'string array of entry ids from the snapshot index; exact fetch, bypasses ranking and scope filter. Max 32.' }
```

execute 语义：

- `ids` 非空数组 → **优先于 query**：在全量快照上按 id 精确取条目，按传入顺序返回；作用域过滤不适用（id 是权威定位）。空数组按未提供处理（走 query/默认路径）。
- 查不到的 id → 结果对象加 `missing: [<id>...]`，如实报告，不算错误。
- `limit` 对 ids 结果同样钳制（1–32，复用 `clipLimit`）。
- `ids` 非数组/含非字符串 → `{completion:'failed', error:...}`，不静默。
- 工具 description 更新，提及 ids 用法。

### 4. 设置页 UI（src/MemoryPage.tsx + src/locales.ts）

- 「注入与工具设置」区新增行「注入模式 / Injection mode」，控件用现成分段样式（`dshlm-seg`）：**全文 / 按需索引**。
- 提交走既有 `field('injectMode', v)`（改动即时提交，与其他布尔项同语义）。
- 中英词条：`injectMode.label`、`injectMode.desc`、`injectMode.full`、`injectMode.index`。

### 5. 明确不动

RPC 协议与端点、entries.jsonl 格式、`local_memory_remember`、迁移脚本——零数据迁移；`injectMode` 切回 `'full'` 即完全恢复旧行为。

## 测试

- **render.test**：index 模式 critical 全文保留；normal 截 80 字 + 省略号；≤80 字条目无省略号；指引行仅在出现索引行时存在；预算 omitted 计数含索引行；full 模式输出与旧快照逐字节一致（回归）。
- **tools.test**：ids 精确取回全文并按传入顺序；missing 报告；ids 优先于 query；空数组按未提供处理；limit 钳制 ids 结果；非法 ids 形态 failed。
- **config 测试**：默认 `injectMode==='full'`；非法枚举值被 schema 拒。
- 发布门禁不变：`npm test` 全绿才可 publish。

## 效果预估

以当前 19 条（critical 3 条）计：索引模式下常驻注入预计降至原体积约 1/4～1/3；细节经 `local_memory_search(ids=[...])` 一轮展开，确定性命中。

## 版本与发布

实现合入后按 minor 发 `0.3.0`（新向后兼容功能），README 双语补「按需索引」小节与 `injectMode` 设置表行。
