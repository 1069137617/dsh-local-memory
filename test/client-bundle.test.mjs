// test/client-bundle.test.mjs
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('client bundle obeys loader contract', () => {
  execSync('node scripts/build.mjs', { stdio: 'pipe', cwd: new URL('..', import.meta.url) })
  const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(code.startsWith('window.__ModuleLoader__.load({'))
  assert.ok(code.includes('"dsh-local-memory"'))
  assert.ok(!code.includes('dsh-mnemon'))
  assert.ok(!/require\("node:/.test(code), 'bundle must not require node builtins')
})
