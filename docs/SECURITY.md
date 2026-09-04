# kokoro-bff security

## 信任边界

```text
Untrusted browser
  -> trusted kokoro same-origin server adapter
  -> kokoro-bff service envelope
  -> owner-specific service credentials and typed projections
```

浏览器不能直接获得 BFF shared secret、owner token、tenant id 或 service identity。BFF 不接受浏览器 Host、X-Domain、
X-Forwarded-*、tenant 或 actor header 作为 authority，也不把浏览器 Authorization 透传给 owner。

## 当前 admission

- `/healthz`、`/readyz` 是 anonymous probes。
- 常规 `/v1/*` 要求 `x-kokoro-service: web-bff`、namespace 和 principal；Live 还要求匹配 shared secret。
- runtime manifest 的 tenant/domain 来自 BFF server config，由 System owner 校验 Site/Host binding。
- Scheduler dispatch 要求 configured bearer 或 internal secret，并校验 job name、UTC occurrence、task id、owner id 与
  稳定 idempotency key。
- 共享快照仍要求 server-only service auth；share id 只选择资源。
- AG-UI cursor 只是不可解释的定位 token，不是 capability。解析与 replay SQL 同时要求受信 namespace、session id 和
  cursor；foreign tenant session 与普通缺失资源一致，当前 session 的 unknown token 返回 `invalid_event_cursor`，已回收
  token 只在同 scope tombstone 命中时返回 `event_cursor_expired`。

当前 BFF 信任 Web adapter 提供的 namespace/principal，尚未在本进程完成 IAM admission/permission lookup。OpenAPI
`x-kokoro-permission` 已冻结权限意图，但运行时逐 operation permission enforcement 尚未闭环；这是安全缺口，不是
已完成能力。

## 出站控制

- owner base URL 来自 server config，协议限制为 HTTP/HTTPS。
- query、path 与 body 在各 adapter allowlist/mapper 中构造；不允许用户选择 owner base URL。
- 出站携带 request id、标准 Forwarded、受信 tenant/subject 与 owner service credential。
- timeout 与 response-size limit 阻止无限等待和无界响应。
- owner 非 JSON、错误 envelope 或 schema mismatch fail closed；响应不返回 SQL、stack、secret 或 provider 原文。

## 数据与 secret

- secret 只来自环境变量，不写入日志、receipt 或 contract 示例。
- `response_body` receipt 可能包含业务响应；当前没有字段级敏感数据分类、加密或 TTL，需在扩大 payload 前补齐。
- `bff_agui_event.event_payload` 保存公开 AG-UI frame，可能含用户文本、tool result 或 delivery metadata；frame retention
  与 tombstone GC 已实现，但尚无字段级加密，数据库角色、备份和诊断查询必须按用户内容处理，禁止把 payload 写入普通日志。
- 日志当前主要是进程/reconciliation 文本，尚未形成带 service/operation/request_id/trace_id/result/duration 的完整
  结构化审计面。
- PostgreSQL、Redis 与 owner token 应使用最小权限独立凭据；BFF 不访问其他 owner 数据库。

## Abuse controls 与当前缺口

| 控制 | 当前状态 |
| --- | --- |
| 请求体上限 | 已有 1 MiB 硬上限 |
| owner 响应上限/timeout | 已配置 |
| 幂等重复副作用保护 | 条件性持久化；digest 与事务仍不完整 |
| rate limit/quota | BFF 统一门禁尚未实现 |
| CSRF/CSP/cookie | 属于 Web same-origin adapter；需跨仓验收 |
| schema validation | 部分手写 mapper + AG-UI schema；全 OpenAPI runtime validation 未闭环 |
| dependency/source/secret scan | CI 尚未闭环 |
| tenant negative tests | AG-UI repository 与 HTTP foreign-cursor 已有真实 PG negative test；完整 public surface 矩阵仍待补齐 |

## 安全变更门禁

涉及身份 header、permission、share、tenant predicate、receipt payload 或 owner credential 的变更必须同时修改
canonical contract、threat assumptions、negative tests 和本文件；不得以兼容 fallback 保留旧信任路径。
