// src/config.ts
import z from '@deepseek-ai/schemastery'

// 与 brief 的两处最小适配（以 @deepseek-ai/schemastery 3.18.2 的 .d.ts 为准，测试语义不变）：
// 1. schemastery 没有 zod 的 `z.infer`；输出类型的等价物是全局 `Schemastery.TypeT<typeof schema>`。
// 2. schemastery 的 schema 是可调用的校验器（`schema(value)` 返回归一化输出），没有 `.parse`；
//    冻结测试调用 `ConfigSchema.parse(DEFAULTS)`，故在 schema 对象上挂一个 `parse` 薄别名。
const BaseConfig = z.object({
  enabled: z.boolean(),
  injectEnabled: z.boolean(),
  injectWorkspace: z.boolean(),
  allowAgentWrite: z.boolean(),
  maxInjectionChars: z.number(),
  entryMaxChars: z.number(),
  searchLimit: z.number(),
})

// Pick 白名单是真硬化：schemastery 的 TypeT 输出面带 `{[k:string]:any}` 交叉（Dict 索引签名），
// mapped type `{[K in keyof T]: T[K]}` 会保留该索引签名（Task 4 评审 tsc 探针实证），Pick 精确剔除。
export type Config = Pick<Schemastery.TypeT<typeof BaseConfig>, 'enabled' | 'injectEnabled' | 'injectWorkspace' | 'allowAgentWrite' | 'maxInjectionChars' | 'entryMaxChars' | 'searchLimit'>

export const ConfigSchema = Object.assign(BaseConfig, {
  parse(value: Config): Config {
    return BaseConfig(value)
  },
})

export const DEFAULTS: Config = {
  enabled: true, injectEnabled: true, injectWorkspace: true, allowAgentWrite: true,
  maxInjectionChars: 4000, entryMaxChars: 2000, searchLimit: 8,
}

export function validateConfig(v: Config): void {
  const int = (n: number) => Number.isInteger(n)
  if (!int(v.maxInjectionChars) || v.maxInjectionChars < 200 || v.maxInjectionChars > 20_000) throw new Error('maxInjectionChars out of range 200-20000')
  if (!int(v.entryMaxChars) || v.entryMaxChars < 50 || v.entryMaxChars > 8000) throw new Error('entryMaxChars out of range 50-8000')
  if (!int(v.searchLimit) || v.searchLimit < 1 || v.searchLimit > 32) throw new Error('searchLimit out of range 1-32')
}
