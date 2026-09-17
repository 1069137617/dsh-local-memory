// src/protocol.ts
import type { Config } from './config.js'
import { MemoryStore, normalizeScope, RevisionConflictError, type Importance } from './store.js'

export const RPC_CHANNEL = '/local-memory'
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: Record<string, unknown> } }
const err = (code: string, message: string, details: Record<string, unknown> = {}): RpcResult => ({ ok: false, error: { code, message, details } })

export interface RpcDeps { store: MemoryStore; cfg: () => Config; workspaces: () => string[] }

export function createRpcHandler({ store, cfg, workspaces }: RpcDeps) {
  return async (endpoint: string, payload: unknown): Promise<RpcResult> => {
    try {
      const p = (payload ?? {}) as Record<string, unknown>
      const c = cfg()
      switch (endpoint) {
        case 'snapshot': return { ok: true, value: store.snapshot() }
        case 'workspace-list': return { ok: true, value: workspaces().map(normalizeScope) }
        case 'add': {
          const snap = store.add({
            text: String(p.text ?? ''), scope: String(p.scope ?? 'global'),
            ...(p.importance ? { importance: p.importance as Importance } : {}),
            ...(Array.isArray(p.tags) ? { tags: p.tags as string[] } : {}),
          }, 'ui', c.entryMaxChars)
          return { ok: true, value: snap }
        }
        case 'update': {
          const guard = checkExpected(p, store)
          if (guard) return guard
          const snap = store.update(String(p.id), {
            ...(p.text !== undefined ? { text: String(p.text) } : {}),
            ...(p.importance ? { importance: p.importance as Importance } : {}),
            ...(Array.isArray(p.tags) ? { tags: p.tags as string[] } : {}),
          }, undefined, c.entryMaxChars)
          return { ok: true, value: snap }
        }
        case 'remove': {
          const guard = checkExpected(p, store)
          if (guard) return guard
          return { ok: true, value: store.remove(String(p.id)) }
        }
        default: return err('unknown-endpoint', String(endpoint))
      }
    } catch (e) {
      if (e instanceof RevisionConflictError) return err('revision-conflict', e.message, { current: e.current })
      return err('store-error', e instanceof Error ? e.message : String(e))
    }
  }
}

function checkExpected(p: Record<string, unknown>, store: MemoryStore): RpcResult | undefined {
  if (typeof p.expectedRevision === 'string' && p.expectedRevision && p.expectedRevision !== store.revision()) {
    return err('revision-conflict', 'revision moved', { current: store.revision() })
  }
  return undefined
}
