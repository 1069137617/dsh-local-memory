// src/MemoryPage.tsx — 设置页：记忆条目管理（查看/增改删）+ 注入与工具设置。
// 设置快照的真实形状是 {status, value, user, revision, writable}（先例：dsh-reasoning-tiers
// CapabilitiesPage.tsx:17-23）——节值在 .value、用户覆盖在 .user，逐键合并后才是生效配置。
// RPC/传输层的任何失败都落到显式错误横幅（含确切 message + 重试），页面永不静默失败。
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { bindScope, type RpcCall, type SettingsFace, type StoreSnapshotView } from './api.js'
import type { Config } from './config.js' // type-only：erased，不入 bundle
import { zh } from './locales.ts'

// 字典值全部是字符串（宿主 LocaleDictOf 只收 string；占位符模板由渲染处替换）。
type Translator = (key: keyof typeof zh) => string
interface Props { settings: SettingsFace; call: RpcCall; t: Translator }
type Draft = { id?: string; text: string; scope: string; importance: 'critical' | 'normal' | 'low'; tags: string }

/** 绑定后的设置快照形状（结构化最小面；与宿主 SettingsScopeController 对齐）。 */
interface SettingsSnapshotView {
  status?: 'loading' | 'ready' | 'unavailable'
  value?: unknown
  user?: unknown
  revision?: number
  writable?: boolean
}

const IMPORTANCES = ['critical', 'normal', 'low'] as const
type Importance = (typeof IMPORTANCES)[number]

const tmpl = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''))

const IMPORTANCE_KEYS = { critical: 'importanceCritical', normal: 'importanceNormal', low: 'importanceLow' } as const satisfies Record<Importance, keyof typeof zh>

const fmtTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const SETTING_KEYS = ['enabled', 'injectEnabled', 'injectWorkspace', 'allowAgentWrite'] as const
const NUMBER_KEYS = ['maxInjectionChars', 'entryMaxChars', 'searchLimit'] as const

export function MemoryPage({ settings, call, t }: Props): ReactNode {
  const face = useMemo(() => bindScope(settings), [settings])
  const snapshot = useSyncExternalStore(face.subscribe, face.getSnapshot) as SettingsSnapshotView
  const cfgReady = snapshot?.status === 'ready'
  const writable = snapshot?.writable !== false
  // 生效配置 = base(value) 与 user 覆盖层逐键合并（user 层是补丁语义，只含被改过的键）
  const cfg = useMemo<Partial<Config>>(() => {
    const base = (snapshot?.value ?? {}) as Record<string, unknown>
    const user = (snapshot?.user ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of [...SETTING_KEYS, ...NUMBER_KEYS]) {
      out[k] = user[k] !== undefined ? user[k] : base[k]
    }
    return out as Partial<Config>
  }, [snapshot])

  const [data, setData] = useState<StoreSnapshotView | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('')
  const [scopeTab, setScopeTab] = useState<'all' | 'global' | 'workspace'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const [workspaces, setWorkspaces] = useState<string[]>([])

  const refresh = useCallback(async (): Promise<StoreSnapshotView | null> => {
    try {
      const r = await call<StoreSnapshotView>('snapshot')
      if (r.ok) { setData(r.value); setError(''); return r.value }
      setError(`${r.error.code}: ${r.error.message}`)
      return null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [call])

  useEffect(() => {
    void refresh()
    void call<string[]>('workspace-list').then((r) => { if (r.ok) setWorkspaces(r.value) }).catch(() => {})
  }, [refresh, call])

  const rows = useMemo(() => {
    if (!data) return []
    const wsKeys = new Set(workspaces)
    return data.entries
      .filter((e) => (scopeTab === 'all' ? true : scopeTab === 'global' ? e.scope === 'global' : e.scope !== 'global' && (wsKeys.size === 0 || wsKeys.has(e.scope))))
      .filter((e) => !filter.trim() || e.text.toLowerCase().includes(filter.trim().toLowerCase()))
  }, [data, scopeTab, filter, workspaces])

  const send = useCallback(async (endpoint: string, input: Record<string, unknown>): Promise<boolean> => {
    try {
      const r = await call(endpoint, { ...input, expectedRevision: data?.revision })
      if (r.ok) { setData(r.value as StoreSnapshotView); setNotice(''); return true }
      if (r.error.code === 'revision-conflict') { setNotice(t('conflictNotice')); await refresh() }
      else setNotice(`${r.error.code}: ${r.error.message}`)
      return false
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [call, data, refresh, t])

  const field = (path: string, value: unknown) => void face.mutate([{ op: 'set', path: [path], value }]).catch((e: Error) => setNotice(String(e)))

  const entryMax = Number(cfg.entryMaxChars ?? 0) || undefined
  const overLimit = entryMax !== undefined && draft !== null && draft.text.length > entryMax
  const counts = useMemo(() => {
    const all = data?.entries ?? []
    const g = all.filter((e) => e.scope === 'global').length
    return { all: all.length, global: g, workspace: all.length - g }
  }, [data])

  const scopeTabs = [
    { key: 'all' as const, label: t('scopeAll'), count: counts.all },
    { key: 'global' as const, label: t('scopeGlobal'), count: counts.global },
    { key: 'workspace' as const, label: t('scopeWorkspace'), count: counts.workspace },
  ]

  return (
    <div className="dshlm-page">
      <h3>{t('pageLabel')}</h3>
      <p className="dshlm-hint">
        {t('hint')}
        {data && <span className="dshlm-chip dshlm-chip-dim">{t('revisionLabel')} {data.revision}</span>}
        {data && data.corruptLines > 0 && <span className="dshlm-chip dshlm-chip-bad">{tmpl(t('corruptBadge'), { n: data.corruptLines })}</span>}
      </p>

      {cfgReady && cfg.enabled === false && <div className="dshlm-banner dshlm-banner-warn">{t('disabledBanner')}</div>}
      {notice && <div className="dshlm-banner dshlm-banner-info">{notice}</div>}

      {error !== '' ? (
        <div className="dshlm-banner dshlm-banner-bad">
          <div>{t('loadFailed')}：{error}</div>
          <button onClick={() => void refresh()}>{t('retry')}</button>
        </div>
      ) : !data ? (
        <p className="dshlm-hint">{t('loading')}</p>
      ) : (
        <>
          <div className="dshlm-toolbar">
            {scopeTabs.map((s) => (
              <button key={s.key} className={scopeTab === s.key ? 'dshlm-tab dshlm-tab-on' : 'dshlm-tab'} onClick={() => setScopeTab(s.key)}>
                {s.label} <span className="dshlm-count">{s.count}</span>
              </button>
            ))}
            <input className="dshlm-filter" placeholder={t('filterPlaceholder')} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="dshlm-primary" onClick={() => setDraft({ text: '', scope: 'global', importance: 'normal', tags: '' })}>{t('add')}</button>
          </div>

          {draft && (
            <div className="dshlm-add">
              <div className="dshlm-add-title">{draft.id ? t('editTitle') : t('addTitle')}</div>
              <textarea
                placeholder={t('textPlaceholder')}
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
              <div className="dshlm-add-meta">
                <label>
                  <span className="dshlm-meta">{t('scopeLabel')}</span>
                  <select value={draft.scope} onChange={(e) => setDraft({ ...draft, scope: e.target.value })}>
                    <option value="global">{t('scopeGlobal')}</option>
                    {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </label>
                <label>
                  <span className="dshlm-meta">{t('importanceLabel')}</span>
                  <select value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: e.target.value as Importance })}>
                    {IMPORTANCES.map((i) => <option key={i} value={i}>{t(IMPORTANCE_KEYS[i])}</option>)}
                  </select>
                </label>
                <input className="dshlm-tags" placeholder={t('tagsPlaceholder')} value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
              </div>
              <div className="dshlm-add-actions">
                {entryMax !== undefined && (
                  <span className={overLimit ? 'dshlm-chip dshlm-chip-bad' : 'dshlm-chip dshlm-chip-dim'}>
                    {tmpl(t('charCount'), { used: draft.text.length, max: entryMax })}
                  </span>
                )}
                <button
                  className="dshlm-primary"
                  disabled={!draft.text.trim() || overLimit || draftBusy}
                  onClick={async () => {
                    setDraftBusy(true)
                    try {
                      const tags = draft.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
                      const ok = draft.id
                        ? await send('update', { id: draft.id, text: draft.text, importance: draft.importance, tags })
                        : await send('add', { text: draft.text, scope: draft.scope, importance: draft.importance, tags })
                      if (ok) setDraft(null)
                    } finally {
                      setDraftBusy(false)
                    }
                  }}
                >{draftBusy ? t('saving') : t('save')}</button>
                <button onClick={() => setDraft(null)}>{t('cancel')}</button>
              </div>
            </div>
          )}

          {rows.length === 0 && (
            <p className="dshlm-hint">
              {data.entries.length === 0 ? t('empty') : tmpl(t('noMatch'), { q: filter.trim() })}
            </p>
          )}
          {rows.map((e) => (
            <div key={e.id} className="dshlm-row">
              <div className="dshlm-text">{e.text}</div>
              <div className="dshlm-row-meta">
                <span className={e.scope === 'global' ? 'dshlm-chip dshlm-chip-dim' : 'dshlm-chip'}>{e.scope === 'global' ? t('scopeGlobal') : e.scope}</span>
                <span className={`dshlm-chip dshlm-imp-${e.importance}`}>{t(IMPORTANCE_KEYS[e.importance as Importance] ?? 'importanceNormal')}</span>
                {e.tags?.map((tg) => <span key={tg} className="dshlm-chip dshlm-chip-dim">#{tg}</span>)}
                <span className="dshlm-meta">{t('updatedAtLabel')} {fmtTime(e.updatedAt)}</span>
                <span className="dshlm-row-actions">
                  <button onClick={() => setDraft({ id: e.id, text: e.text, scope: e.scope, importance: e.importance as Importance, tags: (e.tags ?? []).join(',') })}>{t('edit')}</button>
                  <button className="dshlm-danger" onClick={() => { if (window.confirm(t('confirmRemove'))) void send('remove', { id: e.id }) }}>{t('remove')}</button>
                </span>
              </div>
            </div>
          ))}
        </>
      )}

      <h4>{t('settingsTitle')}</h4>
      <p className="dshlm-hint">{t('settingsHint')}</p>
      <div className="dshlm-grid">
        {SETTING_KEYS.map((k) => (
          <label key={k} className="dshlm-cell">
            <input
              type="checkbox"
              checked={Boolean(cfg[k])}
              disabled={!cfgReady || !writable}
              onChange={(ev) => field(k, ev.target.checked)}
            />
            <span className="dshlm-cell-label">{t(`${k}.label` as keyof typeof zh)}</span>
            <span className="dshlm-cell-desc">{t(`${k}.desc` as keyof typeof zh)}</span>
          </label>
        ))}
        {NUMBER_KEYS.map((k) => (
          <label key={k} className="dshlm-cell">
            <span className="dshlm-cell-label">{t(`${k}.label` as keyof typeof zh)}</span>
            <input
              type="number"
              key={String(snapshot?.revision ?? 'n')}
              defaultValue={Number(cfg[k] ?? 0)}
              disabled={!cfgReady || !writable}
              onBlur={(ev) => {
                const n = Number(ev.target.value)
                if (Number.isFinite(n) && n !== Number(cfg[k] ?? 0)) field(k, n)
              }}
            />
            <span className="dshlm-cell-desc">{t(`${k}.desc` as keyof typeof zh)}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
