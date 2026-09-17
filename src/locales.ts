// src/locales.ts
// 命名空间合并进 LocaleNamespaceMap（先例：dsh-reasoning-tiers/src/locales.ts）——
// 让 slot 的 locale 字段与 ctx.locale.register 的 NS 校验成为编译期错误而非运行时回显。
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The local-memory settings page's own copy. */
    'local-memory': keyof typeof zh | keyof typeof en
  }
}

export const NS = 'local-memory'
export const zh = {
  pageLabel: '本地记忆', hint: '本插件与 Mnemon 无关；条目存于 ~/.dsh/local-memory/entries.jsonl。',
  add: '添加条目', edit: '编辑', save: '保存', cancel: '取消', remove: '删除',
  filterPlaceholder: '过滤文本…', scopeAll: '全部', scopeGlobal: '全局',
  revisionLabel: 'revision', corruptBadge: '{n} 行损坏',
  conflictNotice: '外部已变更，数据已刷新。', confirmRemove: '删除这条记忆？',
  textPlaceholder: '记忆内容（≤设置的上限）', tagsPlaceholder: '逗号分隔标签（可选）',
  scopeLabel: '作用域', importanceLabel: '重要度', updatedAtLabel: '更新于',
  empty: '还没有记忆条目。', settingsTitle: '注入与工具设置',
  disabled: '已禁用', refresh: '刷新',
}
export const en = {
  pageLabel: 'Local Memory', hint: 'Independent of Mnemon; entries live in ~/.dsh/local-memory/entries.jsonl.',
  add: 'Add entry', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete',
  filterPlaceholder: 'Filter text…', scopeAll: 'All', scopeGlobal: 'Global',
  revisionLabel: 'revision', corruptBadge: '{n} corrupt lines',
  conflictNotice: 'Changed elsewhere — view refreshed.', confirmRemove: 'Delete this memory?',
  textPlaceholder: 'Memory text', tagsPlaceholder: 'comma,separated,tags',
  scopeLabel: 'Scope', importanceLabel: 'Importance', updatedAtLabel: 'Updated',
  empty: 'No entries yet.', settingsTitle: 'Injection & tools settings',
  disabled: 'Disabled', refresh: 'Refresh',
}
