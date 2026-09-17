# dsh-local-memory —— 独立本地记忆插件

一个 **DSH** 插件：把一份持久、可编辑的本地记忆挂在每个会话的运行时上下文里。与 `dsh-mnemon` 完全独立、零依赖，可与之并行共存。

## 能力

1. **每轮上下文注入** —— 以用户角色快照（context 名 `local-memory:snapshot`，order 200）把记忆摘要注入每个回合；随会话工作区自动区分全局/工作区条目。
2. **Agent 工具** —— `local_memory_search`（按 query/scope/limit 检索）与 `local_memory_remember`（add / replace / remove，Edit 式字面替换语义）。
3. **设置面板管理页** —— 「本地记忆」页：查看、过滤、按作用域分页签浏览，增改删条目（带 revision 冲突保护），并直接编辑注入与工具设置。

## 安装（web profile）

1. 在 profile 的 `package.json` 的 dependencies 加：
   ```json
   "dsh-local-memory": "link:<本仓库路径>"
   ```
2. 在 `dsh.profile.bundles` 追加 `"dsh-local-memory"`（宿主会读取其 `dsh.bundle.patch` 生成 bundle 注入清单）。
3. 重启 `dsh web` —— bundles 只在启动时读取。

## 数据位置与格式

- 文件：`~/.dsh/local-memory/entries.jsonl`（即 `<DSH_HOME>/local-memory/entries.jsonl`）。
- 格式：每行一个 JSON 对象；损坏行被跳过并在界面以「N 行损坏」徽标提示，不会拖垮整个文件。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 条目 id（时间戳 + 随机后缀） |
| `text` | string | 记忆内容 |
| `scope` | string | `"global"` 或归一化工作区路径（反斜杠→正斜杠、盘符小写、去尾斜杠） |
| `importance` | string | `critical` / `normal` / `low` |
| `tags` | string[] | 可选标签 |
| `createdAt` / `updatedAt` | string | ISO 时间戳 |
| `source` | string | `"agent"`（模型写入）或 `"ui"`（管理页写入） |

- 文件顶层校验和（revision）= 全部条目按 id 排序后指纹的 sha256 前 12 位；并发/异动通过 `expectedRevision` 乐观锁拒绝（错误码 `revision-conflict`）。

## 设置节（命名空间 `local-memory`）

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关；关闭后工具返回禁用提示、不注入 |
| `injectEnabled` | `true` | 每轮快照注入开关 |
| `injectWorkspace` | `true` | 关闭后注入只含全局条目 |
| `allowAgentWrite` | `true` | 关闭后 `local_memory_remember` 拒绝写入 |
| `maxInjectionChars` | `4000`（200–20000） | 注入快照的字符预算 |
| `entryMaxChars` | `2000`（50–8000） | 单条记忆的最大字符数 |
| `searchLimit` | `8`（1–32） | 工具检索默认条数 |

## 注入格式示例

```
## LOCAL MEMORY SNAPSHOT (3 entries, 512/4000 chars, cwd d:/code/x)

- [global|critical] 发布要隔 45 秒重跑 #ftp
- [d:/code/x|normal] 本仓库测试基线 29/29
- [d:/code/y|low] 旧项目备忘 (2 of 7 entries shown — call local_memory_search)
```

空间不足时给出「k of m entries shown — call local_memory_search」提示行；无可注入内容时本回合注入空串（宿主跳过）。

## 故障排查

- **「N 行损坏」徽标**：`entries.jsonl` 有坏行（半截写入/手工编辑）；坏行被跳过，修复可手工删行，合法行不受影响。
- **「外部已变更，数据已刷新」**：管理页提交时 revision 已被别处推进（另一窗口/Agent 写入），页面已自动重拉，重试提交即可。
- **工具返回 disabled**：设置节 `enabled` 或 `allowAgentWrite` 被关闭。
- **页面/工具都不见了**：bundle 只在启动时装载，确认 bundles 条目后重启 `dsh web`。
- **与 dsh-mnemon 共存**：互不读写对方数据；两者同时启用时各自注入各自的快照。

## 开发

```powershell
npm install        # link: 安装时切勿 npm prune / npm ci --omit=dev
npm test           # node --test（pretest 先构建 lib/）
npm run typecheck  # host + client 双 tsconfig
npm run verify:install web   # 从 web profile 重放宿主解析做装前自检
```

License: MIT
