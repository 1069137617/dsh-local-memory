import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CONTEXT_NAME, CONTEXT_ORDER } from '../lib/index.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('package shape', () => {
  assert.equal(pkg.name, 'dsh-local-memory')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.exports['.'].default, './lib/index.js')
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.deepEqual(pkg.dsh.client, {
    platform: 'web',
    inject: ['@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-locale'],
  })
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
})

test('no mnemon anywhere in manifests', () => {
  const blob = JSON.stringify(pkg)
  assert.ok(!blob.includes('dsh-mnemon'), 'package.json must not reference dsh-mnemon')
})

test('peer floors', () => {
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-tools'], '>=0.1.5-rc.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-system-prompt'], '>=0.1.5-rc.1')
  assert.equal(pkg.peerDependencies['@deepseek-ai/cordis'], '^4.0.2')
})

test('snapshot injection wiring: frozen constants + registration call present', () => {
  assert.equal(CONTEXT_NAME, 'local-memory:snapshot')
  assert.equal(CONTEXT_ORDER, 200)
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(src.includes('systemPrompt.context('), 'src/index.ts must register the snapshot injection via systemPrompt.context(')
})

test('client half injects exactly slots+locale+connection', () => {
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  assert.match(client, /export const inject = \['slots', 'locale', 'connection'\]/)
  assert.match(client, /settings\.section/)
})
test('host half wires named seams', () => {
  const host = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(host, /local-memory:snapshot/)
  assert.match(host, /'\/local-memory'|RPC_CHANNEL/)
  assert.match(host, /CONTEXT_ORDER = 200/)
})
