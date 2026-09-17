// src/api.ts — structural types only; zero value imports of host packages.
// 传输走 API Gateway（唯一真实路由到插件的通道，实证链见 remote.ts 头注）：
// 客户端 POST `/api/<namespace>/call`，业务负载装进 `{args:{endpoint,payload}}`
// （网关按服务方法的形参名精确接线，多余键会被 assertExactArguments 拒绝）。
export const GATEWAY_CHANNEL = '/api'
export const REMOTE_NAMESPACE = 'dshLocalMemory'
export const REMOTE_METHOD = 'call'

export type PathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] }

export interface SettingsFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
  mutate(ops: readonly PathOp[], expectedRevision?: number): Promise<void>
  readonly writable?: boolean
}

/** Re-home prototype methods onto own properties (useSyncExternalStore detaches `this`).
 *  Same fix as dsh-reasoning-tiers/src/capabilities.ts:190-217. */
export function bindScope(scope: SettingsFace): SettingsFace {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: (l) => scope.subscribe(l),
    mutate: (ops, rev) => scope.mutate(ops, rev),
    // exactOptionalPropertyTypes：不得把 boolean | undefined 显式赋给可选属性，条件展开
    ...(scope.writable !== undefined ? { writable: scope.writable } : {}),
  }
}

export interface StoreSnapshotView {
  entries: Array<{ id: string; text: string; scope: string; importance: string; tags?: string[]; updatedAt: string }>
  revision: string
  corruptLines: number
}
export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
export type RpcCall = <T>(endpoint: string, payload?: unknown, signal?: AbortSignal) => Promise<RpcResult<T>>
