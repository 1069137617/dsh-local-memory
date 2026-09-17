/**
 * `dsh-local-memory`, browser half — the 本地记忆 settings page.
 *
 * 1. The page rides the `settings.section` list slot: additive by contract,
 *    the official sections keep working.
 * 2. Data arrives by injection: the bound settings scope, the RPC caller and
 *    the translate function cross the inject face as plain values, so this
 *    bundle value-imports no other plugin or host package.
 * 3. `inject` below is cordis SERVICE names, unrelated to the
 *    `dsh.client.inject` package list in package.json.
 *
 * @module dsh-local-memory/client
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only, all load-bearing for the type checker rather than the bundle:
// each merges its face into cordis' `Context` or the slot table. All erased at
// build, so none reaches the bundle or the purity gate.
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

// 浏览器半的 `connection` 服务类型：宿主包只为 host 半声明了 Context.connection
// （rpc-host.d.ts 的 HostConnectionHandle），client 半的 ConnectionHandle
// （lib/types/client/index.d.ts:68，rpc: ClientConnectionRpc 在 :80）没有任何
// Context 增强声明。运行时服务名实证存在（dsh-web-app 产物 ctx.inject(["connection"])），
// 这里按其公开接口补上类型增强；若宿主未来自带同名声明且类型不同，tsc 会报重复合并。
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser Connection face supplied by the web shell. */
    connection: import('@deepseek-ai/dsh-client-connection/client').ConnectionHandle
  }
}

import { RPC_CHANNEL, bindScope, type RpcCall, type RpcResult } from './api.ts'
import { MemoryPage } from './MemoryPage.tsx'
import { NS, en, zh } from './locales.ts'
import { injectStyles } from './styles.ts'

/** Plugin instance id, matching this bundle's cordis.patch.yml entry. */
export const name = 'local-memory'

/** Cordis services needed before the body runs. */
export const inject = ['slots', 'locale', 'connection']

const SLOT = 'settings.section'
const ENTRY_ID = 'local-memory'
/** Nav position: after the official pages (they own the low numbers). */
const ORDER = 45

/** Mount the browser half. */
export function apply(ctx: Context): void {
  ctx.effect(() => injectStyles(), 'local-memory: styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'local-memory: dictionaries')
  // Nested, not top-level: a deployment without the settings domain keeps its
  // other registrations alive and simply loses this page.
  ctx.inject(['settingsScope'], (scope) => {
    const binder = scope.settingsScope
    const translate = scope.locale.bind(NS)
    const call: RpcCall = <T,>(endpoint: string, payload?: unknown, signal?: AbortSignal) =>
      scope.connection.rpc.call(RPC_CHANNEL, endpoint, payload ?? {}, signal) as Promise<RpcResult<T>>
    scope.slots.inject(SLOT, () =>
      scope.slots.register(
        {
          name: SLOT,
          id: ENTRY_ID,
          order: ORDER,
          label: () => translate('pageLabel'),
          locale: NS,
          // bindScope: the page hands getSnapshot/subscribe to React bare, and
          // the controller's methods are prototype slots that need `this`.
          inject: () => ({ settings: bindScope(binder.bind({ namespace: 'local-memory' })), call, t: translate }),
        },
        MemoryPage,
      ),
    )
  })
}
