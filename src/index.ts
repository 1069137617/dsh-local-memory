// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { ConfigSchema, DEFAULTS, validateConfig, type Config } from './config.js'
import { renderSnapshot } from './render.js'
import { makeRememberTool, makeSearchTool } from './tools.js'
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
              try {
                const cwdRaw = (c as AgentLike).agent?.session?.header?.cwd
                return renderSnapshot(store.snapshot(), cfgRef(), cwdRaw ? normalizeScope(cwdRaw) : '')
              } catch { return '' }
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
}
