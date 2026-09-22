# Library API v1

Library path 由 BFF 保留；Storage 继续拥有资源、产物、文件与对象生命周期事实。当前尚未接入批准的 Storage v2
contract，因此该入口不发布假成功投影。

## GET `/v1/library`

### Response `503`

```json
{
  "error": {
    "code": "storage_integration_unavailable",
    "message": "Storage integration is unavailable"
  },
  "meta": { "request_id": "req_library_1" }
}
```

未经 service-envelope admission 的请求仍返回 `403 service_auth_failed`。认证通过后的 503 由 BFF 本地生成，不建立
Storage 连接，不创建 PostgreSQL 事务、Redis cache、receipt 或 outbox。

## Future Storage v2 contract

未来成功响应只通过 Storage Proto v2 over ConnectRPC 接入，并在 caller × operation × scope、Capability scope mapping、
trusted Run/ExecutionIdentity、W1 IAM admission 与 per-kind 或 BFF composite pagination 完成后重新设计和发布。旧
`/internal/bff/library` HTTP path 与环境变量已删除，不提供 fallback。
