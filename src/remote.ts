// src/remote.ts — Typert Remote 服务：把既有 RPC 处理器接入 DSH API Gateway。
//
// 根因实证链（HTTP 405，均对已安装的宿主 0.1.5-rc.2 核实）：
// 1. 客户端 rpc.call 永远 POST `${origin}${channel}/${endpoint}`
//    （dsh-client-connection/lib/client.js:6206-6212，非 2xx 抛
//    "transport failure for <channel>/<endpoint>: HTTP <status>"——与设置页横幅一致）。
// 2. 环回网页服务器对非 GET/HEAD 一律 405（dsh-host-frontend-static/lib/index.js:89），
//    即插件自定义通道在 HTTP 面上根本不路由（对照：mnemon 的旧通道探针同样 405）。
// 3. 唯一进入宿主的口是 API Gateway：dsh-api-gateway/lib/index.js:455 把
//    '/api' 前缀的通道拦截为 2 段式端点 `<namespace>/<method>`，优先严格 typert
//    登记、无登记时走 SRC 回退（:764-785）——从活体 Service 的 `typertRemote`
//    绑定 + 原型 Remote 方法标记反射发现，参数按**编译后函数的形参名**从
//    `{args:{...}}` 里按名接线（methodParameterNames:1010-1038 + assertExactArguments:1040）。
// 4. 先例：mnemon src/host/remote-rpc.ts 的 MnemonRemoteService extends
//    TypertRemoteService，在 ctx.inject(['connection'], webContext => …) 里构造。
//
// 装饰器取舍：协议层的 @Remote 装饰器（typert-protocol/lib/index.js:89-108）只是往
// 原型挂版本化标记（mark():154-174）。为绕开构建链对 TC39 装饰器的支持风险
// （mnemon 为此专门用了 tsdown standard-decorators 插件），这里按 mark() 的产物
// 手动等价挂载；test/remote.test.mjs 用**真实的** remoteMethods() 读取验证可见性，
// 保证与网关的发现逻辑（collectSrcClaims/resolveSrcDescriptor）零漂移。
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { RpcResult } from './protocol.js'

/** cordis 服务键（同时是默认线命名空间，这里显式另给线命名空间）。 */
export const REMOTE_SERVICE_KEY = 'localMemoryRemote'
/** 线命名空间：客户端最终 POST `/api/dshLocalMemory/call`。 */
export const REMOTE_NAMESPACE = 'dshLocalMemory'
/** 唯一的 Remote 方法：透传既有 createRpcHandler 的端点分发。 */
export const REMOTE_METHOD = 'call'

/** 网关回退（src-json）要求：形参必须是普通标识符、不得解构/带默认值/rest。 */
type GatewayHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult>

export class LocalMemoryRemoteService extends TypertRemoteService {
  private readonly handler: GatewayHandler

  constructor(ctx: Context, handler: GatewayHandler) {
    super(ctx, REMOTE_SERVICE_KEY, { namespace: REMOTE_NAMESPACE })
    this.handler = handler
  }

  /** 形参名单 (endpoint, payload, signal) 被 SRC 按名接线；signal 必须排最后。 */
  call(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RpcResult> {
    return this.handler(endpoint, payload, signal)
  }
}

// 与 typert-protocol mark() 等价的免装饰器标记（REMOTE_METHOD_DESCRIPTOR 常量
// 未被导出，键字符串以 :56 的实现为准；test/remote.test.mjs 会用真实 remoteMethods()
// 校验，键若上游改名会在此处失败而不是静默失联）。
const REMOTE_METHOD_DESCRIPTOR_KEY = '@deepseek-ai/dsh-typert-protocol/remote-methods'
Object.defineProperty(LocalMemoryRemoteService.prototype, REMOTE_METHOD_DESCRIPTOR_KEY, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: [REMOTE_METHOD].map((method) =>
      Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }),
    ),
  }),
})
