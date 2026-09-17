// src/styles.ts — 原生观感样式。全部颜色取自宿主主题令牌（dsh-client-ui-theme 暴露的
// --dsw-alias-* / --ds-* 体系，随亮暗主题自动切换），var() 第二参为令牌缺失时的兜底，
// 与官方设置页的行式布局（左标签/右控件 + 细分隔线）同构。
const CSS = `
.dshlm-page { font-size: var(--dsh-content-font-size, 14px); color: var(--dsw-alias-label-primary, inherit); max-width: 860px; }
.dshlm-title { margin: 4px 0 2px; font-weight: 600; }
.dshlm-hint { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; margin: 4px 0 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

/* 分区标题（对齐官方设置页的 title/desc 层级） */
.dshlm-sec-title { margin: 22px 0 2px; font-weight: 600; }
.dshlm-sec-hint { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; margin: 2px 0 6px; }

/* 设置行：左标签/右控件 + 细分隔线 */
.dshlm-settings { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.dshlm-setrow { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 48px; padding: 8px 2px; border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.18)); }
.dshlm-setrow-text { min-width: 0; }
.dshlm-setrow-label { color: var(--dsw-alias-label-primary, inherit); }
.dshlm-setrow-desc { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; margin-top: 2px; }
.dshlm-setrow-control { flex-shrink: 0; display: flex; align-items: center; gap: 6px; }
.dshlm-check { width: 16px; height: 16px; accent-color: var(--dsw-alias-brand-primary, #4c6ef5); cursor: pointer; }
.dshlm-num { width: 96px; box-sizing: border-box; text-align: right; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; font: inherit; }
.dshlm-num:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
.dshlm-num:disabled { opacity: .5; }
.dshlm-unit { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; min-width: 24px; }

/* 工具条：分段控件（仿外观三选）+ 过滤 + 主操作 */
.dshlm-toolbar { display: flex; gap: 8px; align-items: center; margin: 10px 0; flex-wrap: wrap; }
.dshlm-seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2, rgba(128,128,128,.12)); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); }
.dshlm-seg-btn { border: none; background: transparent; color: var(--dsw-alias-label-secondary, inherit); padding: 4px 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 13px; }
.dshlm-seg-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }
.dshlm-seg-on { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.22)); color: var(--dsw-alias-label-primary, inherit); box-shadow: 0 0 0 1px var(--dsw-alias-border-l2, rgba(128,128,128,.2)); }
.dshlm-seg-on:hover { background: var(--dsw-alias-bg-layer-3, rgba(128,128,128,.22)); }
.dshlm-count { opacity: .7; font-size: 12px; }
.dshlm-filter { flex: 0 1 200px; min-width: 120px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; font: inherit; }
.dshlm-filter:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
.dshlm-filter::placeholder { color: var(--dsw-alias-label-tertiary, #888); }

/* 按钮：ghost / primary / danger */
.dshlm-btn { font: inherit; font-size: 13px; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: var(--dsw-alias-label-primary, inherit); cursor: pointer; }
.dshlm-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); }
.dshlm-btn:disabled { opacity: .5; cursor: default; }
.dshlm-primary { background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4c6ef5)); border-color: transparent; color: #fff; font-weight: 600; }
.dshlm-primary:hover { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary, #4c6ef5)); }
.dshlm-danger { color: var(--dsw-alias-state-error-primary, #e05252); }

/* 条目卡片与元信息 */
.dshlm-list { display: flex; flex-direction: column; gap: 8px; margin: 10px 0 4px; }
.dshlm-card { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.2)); background: var(--dsw-alias-bg-layer-1, transparent); border-radius: 10px; padding: 10px 12px; }
.dshlm-text { white-space: pre-wrap; word-break: break-word; margin-bottom: 6px; }
.dshlm-row-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.dshlm-row-actions { margin-left: auto; display: inline-flex; gap: 6px; }
.dshlm-meta { color: var(--dsw-alias-label-tertiary, #888); font-size: 12px; }

/* 徽章 */
.dshlm-chip { display: inline-block; font-size: 12px; border-radius: 8px; padding: 1px 8px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.22)); color: var(--dsw-alias-label-secondary, inherit); }
.dshlm-chip-dim { color: var(--dsw-alias-label-tertiary, #888); }
.dshlm-chip-bad { background: var(--dsw-alias-state-error-secondary, rgba(224,82,82,.16)); border-color: var(--dsw-alias-state-error-primary, rgba(224,82,82,.4)); color: var(--dsw-alias-state-error-primary, #f8a); }
.dshlm-imp-critical { background: var(--dsw-alias-state-error-secondary, rgba(224,82,82,.16)); border-color: var(--dsw-alias-state-error-primary, rgba(224,82,82,.4)); color: var(--dsw-alias-state-error-primary, #f99); }
.dshlm-imp-normal { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.14)); border-color: var(--dsw-alias-border-l2, rgba(128,128,128,.22)); color: var(--dsw-alias-label-secondary, inherit); }
.dshlm-imp-low { background: transparent; border-color: var(--dsw-alias-border-l3, rgba(128,128,128,.18)); color: var(--dsw-alias-label-tertiary, #888); }

/* 横幅 */
.dshlm-banner { padding: 8px 12px; border-radius: 8px; margin: 8px 0; font-size: 13px; }
.dshlm-banner-warn { background: var(--dsw-alias-state-warn-secondary, rgba(255,160,0,.12)); border: 1px solid var(--dsw-alias-state-warn-primary, rgba(255,160,0,.4)); color: var(--dsw-alias-label-primary, inherit); }
.dshlm-banner-info { background: var(--dsw-alias-bg-layer-2, rgba(120,140,255,.1)); border: 1px solid var(--dsw-alias-border-l3, rgba(120,140,255,.3)); color: var(--dsw-alias-label-primary, inherit); }
.dshlm-banner-bad { background: var(--dsw-alias-state-error-secondary, rgba(224,82,82,.14)); border: 1px solid var(--dsw-alias-state-error-primary, rgba(224,82,82,.4)); color: var(--dsw-alias-label-primary, inherit); display: flex; gap: 10px; align-items: center; justify-content: space-between; word-break: break-all; }

/* 草稿编辑卡 */
.dshlm-add { border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, transparent); padding: 12px; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; }
.dshlm-add-title { font-weight: 600; }
.dshlm-textarea { width: 100%; min-height: 88px; resize: vertical; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; font: inherit; }
.dshlm-textarea:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
.dshlm-add-meta { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.dshlm-field { display: inline-flex; gap: 6px; align-items: center; }
.dshlm-select { font: inherit; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; }
.dshlm-select:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
.dshlm-tags { flex: 1 1 180px; min-width: 140px; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3)); background: var(--dsw-alias-bg-layer-2, transparent); color: inherit; font: inherit; }
.dshlm-tags:focus { outline: none; border-color: var(--dsw-alias-brand-primary, #4c6ef5); }
.dshlm-add-actions { display: flex; gap: 8px; align-items: center; }
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
