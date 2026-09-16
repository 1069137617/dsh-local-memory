// test/config.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULTS, validateConfig, ConfigSchema } from '../lib/config.js'

test('defaults', () => {
  assert.equal(DEFAULTS.enabled, true)
  assert.equal(DEFAULTS.maxInjectionChars, 4000)
  assert.equal(DEFAULTS.searchLimit, 8)
})
test('validateConfig ranges', () => {
  assert.doesNotThrow(() => validateConfig({ ...DEFAULTS }))
  assert.throws(() => validateConfig({ ...DEFAULTS, maxInjectionChars: 10 }))
  assert.throws(() => validateConfig({ ...DEFAULTS, searchLimit: 33 }))
  assert.throws(() => validateConfig({ ...DEFAULTS, entryMaxChars: 10_000 }))
})
test('schema parses booleans/numbers', () => {
  assert.equal(ConfigSchema.parse(DEFAULTS).injectWorkspace, true)
})
