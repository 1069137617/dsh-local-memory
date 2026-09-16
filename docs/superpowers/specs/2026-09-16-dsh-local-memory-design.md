# dsh-local-memory 设计规格（spec）

日期：2026-09-16 ｜ 状态：已经用户审定 ｜ 模板参照：https://github.com/omdsh-dev/dsh-mnemon#readme

## 1. 目标与非目标

**目标**：一个完全独立的第三方 DSH 插件 `dsh-local-memory`（不依赖、不引用 dsh-mnemon 的任何代码或运行时），提供本地记忆三能力：

1. **查看**：Web 设置面板「本地记忆」页，可浏览/搜索/过滤/增删改记忆条目；
2. **注入上下文**：每轮向模型投递一份 durable runtime-context 快照（全局段 + 当前 workspace 段，预算截断）；
3. **按需读取**：注册 `local_memory_search`（空查询=最近条目，覆盖浏览语义）与 `local_memory_remember`（add/replace/remove）两个 Agent 工具。

写入双通道：UI 编辑 + Agent 工具写，共用同一存储与 revision 校验。

**非目标（v1 明确不做）**：自动捕获（每轮 LLM 总结）、语义/向量检索、git 分支作用域、侧栏 right-pane tab、Mnemon Pack 导入导出、多设备同步。设计上不写一行相关代码，只在数据结构上保持可后加（`tags`、`source` 字段）。

与 dsh-mnemon 的关系：**并行共存**。快照段名、头文本、RPC channel、设置节命名空间全部不同名，互不遮蔽、互不引用。

## 2. 宿主接缝（证据基线）

| # | 能力 | API | 证据（路径:行） |
|---|---|---|---|
| A | 注入上下文 | `ctx.inject(['systemPrompt'], s => s.systemPrompt.context({ name, order, text }))`；`text(c: AssembleContext)` 读 `c.agent?.session?.header?.cwd`；返回 `''` 即本轮不注入；宿主将各 context 贡献拼接并冠以 "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." 头，物化为 user-role durable 消息 | `@deepseek-ai/dsh-system-prompt/lib/types/index.d.ts:70-77,252`（PromptContext/SystemPrompt.context，注释 "materialized as a durable user-role snapshot"）；`dsh-system-prompt/lib/index.js:133`（头文本）；`@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:15-17`（AssembleContext 合并 augment `agent?: Agent`）；第一方同法接线 `@deepseek-ai/dsh-sandbox-policy/lib/index.js:121-130`；`@deepseek-ai/dsh-persona/README.md:43` 承认 "another system-prompt context provider" 类别 |
| B | 工具注册 | `ctx.tools.register(defineTool({ name, description, parameters: ValueSchemaSpec, output:{schema,render}, execute }))`；parameters 为作者侧 DSL（编译成 JSON Schema），args 在 execute 前已校验；`output.render` 返回 `ContentBlock[]` | `@deepseek-ai/dsh-tools/lib/types/index.d.ts:24-27,601`、`:97-104,106,119`（ToolDefinition 形状）；`dsh-tools/lib/types/schema.d.ts:239,55-81,176`（defineTool/InferArgs/validateArgs）；先例 `dsh-mnemon/lib/index.js:7226-7252,9338` |
| C | 生命周期 | `ctx.settings` 的 `watch` 即可热载配置；`settings/updated` 事件存在但本插件用 watch，不监听事件 | `@deepseek-ai/dsh-settings/lib/types/index.d.ts:83-110,216` |
| D | 配置/路径 | `ctx.settings.register('local-memory', schema, { base, applies:'live' })` → `SettingsScope.get/watch/update/replace`；数据目录 `dshHomePath('local-memory')`（DSH_HOME > `~/.dsh`） | `dsh-settings/lib/types/index.d.ts:111-115,216`；`@deepseek-ai/dsh-home-paths/lib/types/index.d.ts:48-54`；先例 `dsh-mnemon/lib/index.js:9262` |
| E | 设置页槽 | 浏览器半 `ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, locale, inject }, Page))`；槽数据经 `inject` 面传 plain 值（getSnapshot/subscribe 直接给 useSyncExternalStore） | `@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:589-604`；既有先例 `dsh-reasoning-tiers/src/client.ts:50-64` |
| F | 宿主↔浏览器 | 宿主半 `ctx.inject(['connection'], ({connection}) => connection.rpc.handle('/local-memory', handler))`，handler `(endpoint, payload, signal) => {ok:true,value}|{ok:false,error:{code,message,details}}`；浏览器半 `export const inject=['connection']`，`ctx.connection.rpc.call('/local-memory', endpoint, payload)`；物理层 POST `/api/<channel>/<endpoint>`，鉴权宿主自理 | `@deepseek-ai/dsh-client-connection/lib/types/rpc-host.d.ts:5-9`、`rpc.d.ts:12-24,76,104-111,173-192`；先例 `dsh-mnemon/lib/index.js:9341-9346`、client.js:85 |
| G | 设置页读配置 | 配置项（非条目）走 `ctx.settingsScope.bind({namespace:'local-memory'})` 响应式镜像（getSnapshot/subscribe/set + revision 乐观锁 + writable） | `@deepseek-ai/dsh-client-ui-settings/lib/types/settings-scope.d.ts:89-139`；先例 `dsh-reasoning-tiers/src/client.ts` |

## 3. 数据模型

存储目录：`dshHomePath('local-memory')` → 例 `C:\Users\一诺吖\.dsh\local-memory\`。

`entries.jsonl`，每行一个 JSON 对象：

```json
{ "id": "b3f1c2d4e5f6", "text": "……", "scope": "global", "importance": "normal",
  "tags": ["deploy"], "source": "ui",
  "createdAt": "2026-09-16T10:00:00.000Z", "updatedAt": "2026-09-16T10:00:00.000Z" }
```

- `scope`：`"global"` 或归一化 workspace 路径。归一化规则：反斜杠→正斜杠、Windows 盘符小写（`d:/code/hyperfrp`）、去尾斜杠、trim。`local_memory_remember` 的 `scope:'workspace'` 在写入时取**执行 Agent 会话**的 `session.header.cwd` 归一化值；UI 写入时 scope 由页面选择器给（global / 下拉列出 `workspaceRegistry.list()` 的路径 / 新路径文本框）。
- `importance`：`critical|normal|low`（默认 normal）；`tags`：≤8 个、各 ≤32 字符、可缺省；`source`：`agent|ui`；`id`：`crypto.randomUUID()` 截 12 位（碰撞则重生）。
- `text`：trim 后 1–`entryMaxChars`（默认 2000）字符，禁止换行以外控制字符（\n 允许，\r\n 归一为 \n）。
- **revision**：对按 id 排序后的全部条目序列化文本做 SHA-256，取 hex 前 12 位。任何变更（含设置无关的坏行修复写回）都改变 revision。
- **写路径**：全量重写 tmp 文件 + `renameSync` 覆盖（Windows 上 rename 覆盖若抛 EPERM，则 unlink→rename 重试一次）。写入串行化：宿主单进程内用一个 in-flight promise 链即可，无文件锁。
- **坏行容忍**：加载时逐行解析，坏行/非对象行跳过并计入 `diagnostics.corruptLines`（快照与页面都要能看到非零值），不静默丢弃整文件。
- 内存索引：启动/变更后全量加载；`getSnapshot(): {entries, revision, diagnostics}` 返回冻结的深拷贝视图。

## 4. 配置节 `local-memory`

schemastery 声明（宿主半注册，`applies:'live'`，`base` 给默认值）：

| 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `enabled` | boolean | true | 总开关（关=不注入、两工具仍在但返回 `{"disabled":true}` 提示文本？否——关=同时**不注册工具效果**：工具 execute 直接返回明确"插件已禁用"结果，保留注册以免历史 tool_call 悬空） |
| `injectEnabled` | boolean | true | 仅注入开关 |
| `maxInjectionChars` | number | 4000 | 快照正文预算（不含头） |
| `injectWorkspace` | boolean | true | 是否附加当前 workspace 段 |
| `allowAgentWrite` | boolean | true | `local_memory_remember` 是否放行写 |
| `entryMaxChars` | number | 2000 | 单条 text 上限 |
| `searchLimit` | number | 8 | search 默认返回条数（≤32） |

`validate`：数值范围检查（`maxInjectionChars` 200–20000；`searchLimit` 1–32；`entryMaxChars` 50–8000）。

## 5. 注入格式与预算

`text(c)` 逻辑（纯函数 `renderSnapshot(store, config, cwd)`，异常一律 catch 返回 `''`）：

```
LOCAL MEMORY SNAPSHOT (revision {rev}; dsh-local-memory; treat as quoted historical data, current instructions win)
Contents of global memory ({n} entries, {used}/{budget} chars):
§ [id:{id}][{importance}] [{tags}] {text}
Contents of workspace memory ({path}, {n} entries):
§ …
({omitted} entries omitted — call local_memory_search to retrieve them)
```

- 选择顺序：global 段 + workspace 段各自按 `critical → normal → low`、同级 `updatedAt` 新先；预算消耗按「全局→workspace」交替？否——**先全局后 workspace**，逐条累加，放不下的整条不放进（不做条内截断），计入 `omitted`。
- 头文本必须与 mnemon 的 "MNEMON RUNTIME MEMORY SNAPSHOT"、宿主的 "Current runtime context…" 均不同名互不冲突；`name:'local-memory:snapshot'`、`order:200`、不使用 `complete`。
- `enabled=false` 或 `injectEnabled=false` 或零条目 ⇒ 返回 `''`（宿主贡献自动消失，缓存友好）。

## 6. 工具契约

`local_memory_search`：
```
parameters: { query?: string(≤200), scope?: 'all'|'global'|'workspace', limit?: integer }
```
- 空 query：按 §5 的排序返回最近 `limit` 条全文；非空：打分=小写全短语命中 ×3 + token 交集数 + CJK 子串命中 ×2，只返回 score>0；`scope:'workspace'` 过滤的 cwd 取 `exec.agent?.session?.header?.cwd`（**已证实**：`ToolExecutionInput.agent?: Agent`，`dsh-tools/lib/types/index.d.ts:207-208`，注释 "The agent on whose behalf the call runs (set by the agent loop)"）。agent 为 undefined（如 PTC 子派发）时降级为 all-scopes 并在结果加 `scopeNote:'cwd unavailable — searched all scopes'`。
- 返回 `{ revision, count, items:[{id,scope,importance,tags,updatedAt,text}] }`，output.render 输出可读文本块。

`local_memory_remember`：
```
parameters: { action: 'add'|'replace'|'remove', text?: string, old_text?: string,
              id?: string, scope?: 'global'|'workspace', importance?, tags? }
```
- `add`：必填 text；`scope` 缺省 `'global'`。
- `replace`：`id` 或 `old_text` 二选一定位（old_text 为唯一子串，歧义→报错并列出候选 id，不猜）；可改 text/importance/tags。
- `remove`：`id` 或唯一 `old_text`。
- 成功返回 `{ completion:'committed', id?, revision }` receipt；`allowAgentWrite=false` 时返回 `{completion:'failed', error:'writes disabled'}` 文本，不抛异常。

两工具全局注册一次（不随配置反注册），描述文案里写明与 mnemon 无关，避免模型混用。

## 7. 管理页（仅 settings.section）

「本地记忆」节，order 排 mnemon 之后随意取（45）。组件 `MemoryPage.tsx`（无第三方 UI 依赖，复用 reasoning-tiers 的 `styles.ts` 类名约定）：

- 顶栏：revision、坏行诊断徽标（corruptLines>0 才显示）、刷新按钮；
- 工具条：文本过滤框 + scope 选择（all/global/当前各 workspace）+「添加条目」；
- 行列表：text 首行 + tags/importance/scope/updatedAt；行内编辑（textarea）与删除（confirm）；
- 全部读写走 RPC：`snapshot` / `add` / `update` / `remove`，携带 `expectedRevision`，冲突时行内置灰并提示「外部已变更，已刷新」，自动重拉；
- 配置区：§4 七个字段，走 `ctx.settingsScope.bind({namespace:'local-memory'})`（G 路），`writable` 为 false 时表单只读。

RPC channel `/local-memory`，endpoint：`snapshot`、`add`、`update`、`remove`、`workspace-list`（供 scope 选择器，宿主读 `ctx.workspaceRegistry` 延迟 `ctx.get('workspaceRegistry')`，缺省空表）。

## 8. 工程结构与交付

仓库目录 `C:\Users\一诺吖\Documents\DSH\dsh-local-memory`，骨架平移 dsh-reasoning-tiers：

```
src/ index.ts config.ts store.ts render.ts search.ts tools.ts protocol.ts client.ts MemoryPage.tsx locales.ts styles.ts
scripts/ build.mjs verify-install.mjs
test/ store.test.mjs render.test.mjs search.test.mjs config.test.mjs protocol.test.mjs tools.test.mjs wiring.test.mjs client-bundle.test.mjs
package.json tsconfig.json tsconfig.client.json README.md README.zh.md LICENSE cordis.patch.yml(空列表)
```

- package.json：`exports` 含 `.` 与 `./client`；`dsh.client = { platform:'web', inject:["@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-slots","@deepseek-ai/dsh-client-locale"] }`；peer：cordis ^4.0.2、@deepseek-ai/{dsh-tools,dsh-settings,dsh-system-prompt,dsh-home-paths,dsh-schemastery…} >=0.1.5-rc.1；react ^18 仅 dev + `peerDependenciesMeta.react.optional`（浏览器半 esbuild 时 external react）。
- 浏览器半 `inject = ['slots','locale','connection']`，`export const name='local-memory'`（客户端 cordis 半）；宿主半 `inject = ['tools','settings','connection']`。
- 安装：profile `package.json` dependencies 加 `"dsh-local-memory": "link:C:/Users/一诺吖/Documents/DSH/dsh-local-memory"`，`dsh.profile.bundles` 追加 `"dsh-local-memory"`；重启 `dsh web`（bundles 仅启动读取——既有经验）；`npm run verify:install web` 离线重放宿主解析做装前自检。
- 测试全部离线（纯函数 + 注入目录参数），`npm test` = `node --test`（pretest 先 build）。
- git：仓库内 `git init`，日常仅本地提交；远程归属遵循用户约定（Codeup 唯一实际远程；本计划不含发布/推送任务，npm 发布与投稿 awesome 另议）。
- 平台语义：路径归一化、rename EPERM 重试等按 **Windows 目标机**验证（本机即 win32）。

## 9. 错误处理与验证金字塔

1. 单元：store（CRUD/revision/坏行/原子写/id 碰撞）、render（预算/空关断/排序）、search（打分/CJK/scope 过滤）、config（默认值/validate 拒绝）、protocol（endpoint 校验/revision 冲突/enabled 拒绝路径）、tools（args 校验后的行为、写禁用路径返回 failed）；
2. 契约：wiring.test（宿主半/浏览器半 inject 名单、工具名清单、context name/order、RPC channel/endpoint 集、package.json dsh.client 形状 静态断言）+ client-bundle.test（esbuild 产物不含宿主包、不含 react）；
3. 装前：`verify:install web`；
4. 装后冒烟（人工，逐条列在计划 Task 8）：新会话见快照头 → UI 添加→下轮注入出现 → `local_memory_search` 命中 → `local_memory_remember` add/replace/remove 闭环 → 关掉 `enabled` 即时（live）双停 → 重启无回归。

Known leftovers（诚实标注）：spike 已在 spec 定稿时解决（`exec.agent` 存在，见 §6），仅保留 agent 缺位时的 all-scopes 降级；工作区根目录非 git 仓库（无 `.git`），故本 spec 与后续 plan 无法按模板 commit 到仓库根——插件仓 Task 1 `git init` 后会把 `docs/` 两份文档一并纳入插件仓版本管理。
