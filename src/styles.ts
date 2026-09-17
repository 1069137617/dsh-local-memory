// src/styles.ts — 注入结构与 dsh-reasoning-tiers/src/styles.ts 同构，样式体为本插件专用。
const CSS = `
.dshlm-page { font-size: 14px; }
.dshlm-toolbar { display: flex; gap: 8px; align-items: center; margin: 8px 0; flex-wrap: wrap; }
.dshlm-row { border-bottom: 1px solid rgba(128,128,128,.2); padding: 8px 2px; }
.dshlm-meta { color: #999; font-size: 12px; margin-right: 6px; }
.dshlm-text { white-space: pre-wrap; }
.dshlm-badge { background: #b35; color: #fff; border-radius: 8px; padding: 0 8px; font-size: 12px; }
.dshlm-notice { background: rgba(255,160,0,.15); padding: 4px 8px; border-radius: 4px; margin: 4px 0; }
.dshlm-edit textarea, .dshlm-add textarea { width: 100%; min-height: 60px; }
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
