// src/styles.ts — 注入结构与 dsh-reasoning-tiers/src/styles.ts 同构，样式体为本插件专用。
// 配色全部走半透明叠加，不假设明暗主题。
const CSS = `
.dshlm-page { font-size: 14px; max-width: 860px; }
.dshlm-page h3 { margin: 4px 0 2px; }
.dshlm-page h4 { margin: 18px 0 4px; }
.dshlm-hint { color: #888; font-size: 12px; margin: 4px 0 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dshlm-toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.dshlm-tab { border: 1px solid transparent; background: transparent; color: inherit; padding: 3px 10px; border-radius: 12px; cursor: pointer; opacity: .55; }
.dshlm-tab-on { opacity: 1; border-color: rgba(128,128,128,.45); background: rgba(128,128,128,.12); }
.dshlm-count { opacity: .7; font-size: 12px; }
.dshlm-filter { flex: 0 1 200px; min-width: 120px; }
.dshlm-primary { font-weight: 600; }
.dshlm-danger { color: #e66; }
.dshlm-row { border-bottom: 1px solid rgba(128,128,128,.2); padding: 8px 2px; }
.dshlm-text { white-space: pre-wrap; word-break: break-word; margin-bottom: 4px; }
.dshlm-row-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dshlm-row-actions { margin-left: auto; display: inline-flex; gap: 6px; }
.dshlm-meta { color: #999; font-size: 12px; margin-right: 4px; }
.dshlm-chip { display: inline-block; font-size: 12px; border-radius: 8px; padding: 0 8px; background: rgba(120,140,255,.18); border: 1px solid rgba(120,140,255,.25); }
.dshlm-chip-dim { background: rgba(128,128,128,.14); border-color: rgba(128,128,128,.22); color: #999; }
.dshlm-chip-bad { background: rgba(187,51,85,.25); border-color: rgba(187,51,85,.4); color: #f8a; }
.dshlm-imp-critical { background: rgba(230,80,80,.2); border-color: rgba(230,80,80,.4); color: #f99; }
.dshlm-imp-normal { background: rgba(128,128,128,.14); border-color: rgba(128,128,128,.22); color: inherit; }
.dshlm-imp-low { opacity: .65; background: rgba(128,128,128,.1); border-color: rgba(128,128,128,.18); color: #999; }
.dshlm-banner { padding: 6px 10px; border-radius: 6px; margin: 6px 0; font-size: 13px; }
.dshlm-banner-warn { background: rgba(255,160,0,.14); border: 1px solid rgba(255,160,0,.35); }
.dshlm-banner-info { background: rgba(120,140,255,.12); border: 1px solid rgba(120,140,255,.3); }
.dshlm-banner-bad { background: rgba(230,80,80,.14); border: 1px solid rgba(230,80,80,.4); display: flex; gap: 10px; align-items: center; justify-content: space-between; word-break: break-all; }
.dshlm-add { border: 1px solid rgba(128,128,128,.3); border-radius: 8px; padding: 10px; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; }
.dshlm-add-title { font-weight: 600; }
.dshlm-add textarea { width: 100%; min-height: 88px; resize: vertical; }
.dshlm-add-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.dshlm-add-meta label { display: inline-flex; gap: 6px; align-items: center; }
.dshlm-tags { flex: 1 1 180px; min-width: 140px; }
.dshlm-add-actions { display: flex; gap: 8px; align-items: center; }
.dshlm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px 18px; margin-top: 8px; }
.dshlm-cell { display: grid; grid-template-columns: auto 1fr; grid-template-areas: "box label" "box desc"; column-gap: 8px; align-items: center; border-bottom: 1px solid rgba(128,128,128,.15); padding: 6px 2px; }
.dshlm-cell input[type="checkbox"] { grid-area: box; }
.dshlm-cell input[type="number"] { grid-area: box; width: 100px; }
.dshlm-cell-label { grid-area: label; }
.dshlm-cell-desc { grid-area: desc; color: #888; font-size: 12px; }
`
/** Append the stylesheet once; returns a disposer for ctx.effect (先例：reasoning-tiers styles.ts). */
export function injectStyles(): () => void {
  const ID = 'dsh-local-memory-styles'
  if (typeof document === 'undefined' || document.getElementById(ID)) return () => {}
  const el = document.createElement('style')
  el.id = ID
  el.textContent = CSS
  document.head.appendChild(el)
  return () => {
    el.remove()
  }
}
