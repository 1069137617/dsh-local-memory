// test/remote.test.mjs
// src/remote.ts 两处注释都声称"test/remote.test.mjs 会用真实的 remoteMethods() 读取
// 验证可见性，保证与网关的发现逻辑零漂移"—— 该文件此前并不存在（核对报告第七节）。
// 本文件兑现这个承诺：用宿主真实的 remoteMethods() 读取，而非复述键名。
//
// 注意 remoteMethods() 的入参是**实例**（内部取 Object.getPrototypeOf(service)）。
// 传类原型会读到原型的上一层，返回 [] —— 那是探针用错 API，不是挂载点错误。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import {
  LocalMemoryRemoteService, REMOTE_METHOD, REMOTE_NAMESPACE, REMOTE_SERVICE_KEY,
} from '../lib/remote.js'

// 不 new（构造需要真实 cordis Context 与宿主 service 容器）：按原型的形态造一个实例，
// remoteMethods 只走原型链，对这个实例与真实实例的判定完全一致。
const instance = Object.create(LocalMemoryRemoteService.prototype)

test('gateway discovery: the host reader finds exactly the call method', () => {
  const found = remoteMethods(instance)
  assert.deepEqual(
    found.map((m) => m.method),
    [REMOTE_METHOD],
    `the gateway would not discover ${REMOTE_METHOD} — settings page RPC would fail silently`,
  )
  assert.equal(found[0].invocation.kind, 'direct')
})

test('descriptor key matches the host constant verbatim', () => {
  // 上游若改名，此处失败而不是线上静默失联
  const host = readFileSync(
    new URL('../node_modules/@deepseek-ai/dsh-typert-protocol/lib/index.js', import.meta.url), 'utf8',
  )
  const hostKey = /REMOTE_METHOD_DESCRIPTOR\s*=\s*"([^"]+)"/.exec(host)?.[1]
  assert.ok(hostKey, 'could not read REMOTE_METHOD_DESCRIPTOR from the host package')
  const own = Object.getOwnPropertyNames(LocalMemoryRemoteService.prototype)
  assert.ok(own.includes(hostKey), `descriptor is not mounted under the host key ${hostKey}; mounted: ${own.join(', ')}`)
})

test('descriptor is mounted one level above the prototype the reader inspects', () => {
  // 这是行为的锚点：remoteMethods(实例) 读的是 Object.getPrototypeOf(实例)，
  // 也就是类原型本身。若将来有人把它挂到 TypertRemoteService.prototype（上一层），
  // 第一条测试仍会通过，但网关的真实发现路径不一定 —— 这里钉死相对位置。
  const proto = Object.getPrototypeOf(instance)
  assert.equal(proto, LocalMemoryRemoteService.prototype)
  assert.ok(Object.getOwnPropertyDescriptor(proto, '@deepseek-ai/dsh-typert-protocol/remote-methods'))
})

test('wire constants: client and host halves agree', () => {
  assert.equal(REMOTE_NAMESPACE, 'dshLocalMemory')
  assert.equal(REMOTE_SERVICE_KEY, 'localMemoryRemote')
  assert.equal(REMOTE_METHOD, 'call')
  const api = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8')
  assert.match(api, /GATEWAY_CHANNEL = '\/api'/)
  assert.match(api, new RegExp(`REMOTE_NAMESPACE = '${REMOTE_NAMESPACE}'`))
  assert.match(api, new RegExp(`REMOTE_METHOD = '${REMOTE_METHOD}'`))
})

test('gateway payload shape: client double-envelope matches the handler signature', () => {
  const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')
  // 网关按编译后形参名接线（assertExactArguments），参数名必须与 remote.ts 的 call 一致
  assert.match(client, /\{\s*args:\s*\{\s*endpoint,\s*payload:\s*payload \?\? \{\}\s*\}\s*\}/)
  const source = readFileSync(new URL('../src/remote.ts', import.meta.url), 'utf8')
  assert.match(source, /call\(endpoint: string, payload: unknown, signal: AbortSignal\)/)
})

test('handler signature keeps signal last (SRC wiring requirement)', () => {
  const source = readFileSync(new URL('../src/remote.ts', import.meta.url), 'utf8')
  const params = /call\(([^)]*)\)/.exec(source)?.[1] ?? ''
  assert.ok(params.trim().endsWith('signal: AbortSignal'), `signal must be the last parameter, got: ${params}`)
})
