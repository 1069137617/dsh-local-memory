// src/MemoryPage.tsx — 设置页：记忆条目管理（查看/增改删）+ 注入与工具设置。
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { bindScope, type RpcCall, type SettingsFace, type StoreSnapshotView } from './api.js'
import type { Config } from './config.js' // type-only：erased，不入 bundle
import { zh } from './locales.ts'

// 字典值全部是字符串（宿主 LocaleDictOf 只收 string；corruptBadge 用 {n} 占位由渲染处替换）。
type Translator = (key: keyof typeof zh) => string
interface Props { settings: SettingsFace; call: RpcCall; t: Translator }
type Draft = { id?: string; text: string; scope: string; importance: 'critical' | 'normal' | 'low'; tags: string }

export function MemoryPage({ settings, call, t }: Props): ReactNode {
  const face = useMemo(() => bindScope(settings), [settings])
  const cfg = useSyncExternalStore(face.subscribe, face.getSnapshot) as Config
  const [data, setData] = useState<StoreSnapshotView | null>(null)
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('')
  const [scopeTab, setScopeTab] = useState<'all' | 'global' | 'workspace'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const r = await call<StoreSnapshotView>('snapshot')
    if (r.ok) { setData(r.value); return r.value }
    setNotice(`${r.error.code}: ${r.error.message}`); return null
  }, [call])

  useEffect(() => {
    void refresh()
    void call<string[]>('workspace-list').then((r) => { if (r.ok) setWorkspaces(r.value) })
  }, [refresh])

  const rows = useMemo(() => {
    if (!data) return []
    const wsKeys = new Set(workspaces)
    return data.entries.filter((e) => (scopeTab === 'all' ? true : scopeTab === 'global' ? e.scope === 'global' : wsKeys.has(e.scope)))
      .filter((e) => !filter.trim() || e.text.toLowerCase().includes(filter.trim().toLowerCase()))
  }, [data, scopeTab, filter, workspaces])

  const send = useCallback(async (endpoint: string, input: Record<string, unknown>) => {
    const r = await call(endpoint, { ...input, expectedRevision: data?.revision })
    if (r.ok) { setData(r.value as StoreSnapshotView); setNotice(''); return true }
    if (r.error.code === 'revision-conflict') { setNotice(t('conflictNotice')); await refresh() }
    else setNotice(`${r.error.code}: ${r.error.message}`)
    return false
  }, [call, data, refresh, t])

  const field = (path: string, value: unknown) => void face.mutate([{ op: 'set', path: [path], value }]).catch((e: Error) => setNotice(String(e)))

  return (
    <div className="dshlm-page">
      <h3>{t('pageLabel')}</h3>
      <p className="dshlm-meta">{t('hint')}{data ? ` — ${t('revisionLabel')}: ${data.revision}` : ''}</p>
      {data && data.corruptLines > 0 && <span className="dshlm-badge">{t('corruptBadge').replace('{n}', String(data.corruptLines))}</span>}
      {notice && <div className="dshlm-notice">{notice} </div>}
      <div className="dshlm-toolbar">
        <button onClick={() => void refresh()}>{t('refresh')}</button>
        <input placeholder={t('filterPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        {(['all', 'global', 'workspace'] as const).map((s) => (
          <button key={s} onClick={() => setScopeTab(s)} style={{ opacity: scopeTab === s ? 1 : 0.5 }}>
            {s === 'all' ? t('scopeAll') : s === 'global' ? t('scopeGlobal') : 'workspace'}
          </button>
        ))}
        <button onClick={() => setDraft({ text: '', scope: 'global', importance: 'normal', tags: '' })}>{t('add')}</button>
      </div>
      {draft && (
        <div className="dshlm-add">
          <textarea placeholder={t('textPlaceholder')} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
            <option value="global">{t('scopeGlobal')}</option>
            {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: e.target.value as Draft['importance'] })}>
            {['critical', 'normal', 'low'].map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <input placeholder={t('tagsPlaceholder')} value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
          <button disabled={!draft.text.trim()} onClick={async () => {
            const tags = draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
            const ok = draft.id
              ? await send('update', { id: draft.id, text: draft.text, importance: draft.importance, tags })
              : await send('add', { text: draft.text, scope: draft.scope, importance: draft.importance, tags })
            if (ok) setDraft(null)
          }}>{t('save')}</button>
          <button onClick={() => setDraft(null)}>{t('cancel')}</button>
        </div>
      )}
      {rows.length === 0 && <p className="dshlm-meta">{t('empty')}</p>}
      {rows.map((e) => (
        <div key={e.id} className="dshlm-row">
          <div className="dshlm-text">{e.text}</div>
          <div>
            <span className="dshlm-meta">{e.scope === 'global' ? t('scopeGlobal') : e.scope}</span>
            <span className="dshlm-meta">{e.importance}</span>
            {e.tags?.map((tg) => <span key={tg} className="dshlm-meta">#{tg}</span>)}
            <span className="dshlm-meta">{t('updatedAtLabel')} {e.updatedAt.slice(0, 16)}</span>
            <button onClick={() => setDraft({ id: e.id, text: e.text, scope: e.scope, importance: e.importance as Draft['importance'], tags: (e.tags ?? []).join(',') })}>{t('edit')}</button>{' '}
            <button onClick={() => { if (window.confirm(t('confirmRemove'))) void send('remove', { id: e.id }) }}>{t('remove')}</button>
          </div>
        </div>
      ))}
      <h4>{t('settingsTitle')}</h4>
      {(['enabled', 'injectEnabled', 'injectWorkspace', 'allowAgentWrite'] as const).map((k) => (
        <label key={k} className="dshlm-row">
          <input type="checkbox" checked={Boolean((cfg as unknown as Record<string, unknown>)[k])} disabled={face.writable === false} onChange={(ev) => field(k, ev.target.checked)} /> {k}
        </label>
      ))}
      {(['maxInjectionChars', 'entryMaxChars', 'searchLimit'] as const).map((k) => (
        <label key={k} className="dshlm-row">{k}{' '}
          <input type="number" defaultValue={Number((cfg as unknown as Record<string, unknown>)[k] ?? 0)} disabled={face.writable === false}
            onBlur={(ev) => field(k, Number(ev.target.value))} />
        </label>
      ))}
    </div>
  )
}
