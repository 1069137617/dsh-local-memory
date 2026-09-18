// src/index.ts
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
// 类型侧副作用导入：加载 dsh-client-connection 的 Context augmentation，
// 使下方 `ctx.inject(['connection'], ...)` 的 `connection` 服务有类型。
// 运行时经 cordis.patch.yml 的 client.inject 注入宿主，非本插件运行时依赖。
import type {} from '@deepseek-ai/dsh-client-connection'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { ConfigSchema, DEFAULTS, validateConfig, type Config } from './config.js'
import { safeRenderSnapshot } from './render.js'
import { makeRememberTool, makeSearchTool } from './tools.js'
import { createRpcHandler, RPC_CHANNEL } from './protocol.js'
import { LocalMemoryRemoteService } from './remote.js'
import { MemoryStore, normalizeScope } from './store.js'

export const name = 'local-memory'
export const inject = ['tools', 'settings'] as const
export const CONTEXT_NAME = 'local-memory:snapshot'
export const CONTEXT_ORDER = 200

type AgentLike = { agent?: { session?: { header?: { cwd?: string } } } }

export function apply(ctx: Context): void {
  // 结构门交给 register 的 schema + validate（Task 3 评审①：get() 值已 schema 校验，
  // 宿主侧不再用 ConfigSchema.parse/展开做二次结构校验）；缺失键由下游 renderSnapshot 兜底 DEFAULTS。
  const scope = ctx.settings.register('local-memory', ConfigSchema, { base: DEFAULTS, applies: 'live', validate: validateConfig })
  const cfgRef = (): Config => scope.get()

  const store = new MemoryStore(dshHomePath('local-memory'))
  store.load()

  // 配置热更新经 scope.get() 现读，watch 只做失效占位（回调异步派发，落在 owning scope 内）。
  ctx.effect(() => scope.watch(() => {}), 'local-memory: settings watch')
  ctx.effect(() => ctx.tools.register(makeSearchTool(store, cfgRef)), 'local-memory: search tool')
  ctx.effect(() => ctx.tools.register(makeRememberTool(store, cfgRef)), 'local-memory: remember tool')

  // systemPrompt 不在静态 inject 名单（brief 冻结），用 ctx.inject 延迟到服务可用。
  // I-3 收窄：只有 disposed-scope 类错误（消息匹配 /disposed/i）才静默跳过——开发期
  // 宿主日志里实际出现过一次 "Runtime scope 5081 is already disposed"（inject 回调在
  // 已 dispose 的 runtime scope 上重放 mix-into），死 scope 上跳过即正确行为；这是
  // 据一次实际报错做的防御，不是宿主文档承诺的行为。其余错误必须 warn 记录后原样
  // 重抛，不得静默吞掉。
  const isDisposedScope = (e: unknown): boolean => e instanceof Error && /disposed/i.test(e.message)
  ctx.inject(['systemPrompt'], ({ systemPrompt }) => {
    try {
      ctx.effect(() => {
        try {
          return systemPrompt.context({
            name: CONTEXT_NAME,
            order: CONTEXT_ORDER,
            text: (c) => {
              // 渲染失败降级为"本回合不注入"，但必须报出去：此前是裸 catch { return '' }，
              // 任何渲染故障都表现为"本轮没有记忆"且无日志，用户与 agent 都无从察觉。
              const cwdRaw = (c as AgentLike).agent?.session?.header?.cwd
              return safeRenderSnapshot(
                store.snapshot(), cfgRef(), cwdRaw ? normalizeScope(cwdRaw) : '',
                (e) => ctx.logger('local-memory').warn(`local-memory: snapshot render failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`),
              )
            },
          })
        } catch (e) {
          // disposed → 死 scope 上重放，返回 no-op disposer 跳过；其余上抛交外层统一处置
          if (isDisposedScope(e)) return () => {}
          throw e
        }
      }, 'local-memory: snapshot')
    } catch (e) {
      if (isDisposedScope(e)) return
      ctx.logger('local-memory').warn(`local-memory: snapshot registration failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
      throw e
    }
  })

  // 管理页 RPC（设置面板管理端）。两条传输并存：
  //
  // (a) 网关半（首选）：客户端经 POST /api/dshLocalMemory/call 进 API Gateway
  //     ——这是宿主 0.1.5-rc.2 上唯一真正路由到插件的通道（插件自定义通道在
  //     HTTP 面被静态服务器 405，实证链见 remote.ts 头注）。先例与接法：
  //     mnemon plugin.ts 的 ctx.inject(['connection'], webContext => … new
  //     MnemonRemoteService(webContext, …))。SRC 回退按活体 Service 发现，无需
  //     严格 typert 登记；按 mnemon 同款不额外包裹 effect——Service 生命周期
  //     由其构造所在的 cordis 上下文接管。
  // (b) 旧通道半（保留）：connection.rpc.handle('/local-memory', …)。在会把
  //     插件通道路由到宿主连接服务的宿主代次上继续可用；本代次上无害。
  //
  // workspaces 数据源是 store 数据派生（spec 偏差，详见 task-5-report）而非
  // ctx.get('workspaceRegistry')——宿主 0.1.5-rc.2 公开包实证不存在该服务。
  ctx.inject(['connection'], (webContext) => {
    const workspaces = (): string[] => {
      const seen = new Set<string>()
      for (const e of store.snapshot().entries) {
        if (e.scope !== 'global') seen.add(e.scope)
      }
      return [...seen]
    }
    const handler = createRpcHandler({ store, cfg: cfgRef, workspaces })
    ctx.effect(async () => webContext.connection.rpc.handle(RPC_CHANNEL, (endpoint, payload) => handler(endpoint, payload)), 'local-memory: rpc')
    // mnemon 的 HostContextShape 同款防御：inject 回调拿到的对象理应是 Context，
    // 但若宿主形态变化（非 Context 实例）则跳过网关半，保留旧通道兜底。
    if (!Context.is(webContext)) {
      ctx.logger('local-memory').warn('local-memory: connection fiber did not deliver a Context instance; gateway transport skipped')
      return
    }
    new LocalMemoryRemoteService(webContext, async (endpoint, payload) => handler(endpoint, payload))
  })
}
