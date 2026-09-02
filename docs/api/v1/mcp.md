# MCP API v1

MCP 仅负责 server 投影与启停删除，不承载 Agent Redis 或 Chat 事实。

## 资源模型

```json
{
  "scope": "ns_demo",
  "name": "phase-one-mcp",
  "revision": 1,
  "transport": "streamable_http",
  "url": "https://mcp.example.test/stream",
  "allowed_tools": ["search", "fetch"],
  "secret_ref": "handle:srt_fixture",
  "enabled": true
}
```

## GET `/v1/mcp/servers`

返回当前 namespace 可见 server 列表。

## POST `/v1/mcp/servers`

注册 server，必须携带 `Idempotency-Key`。

### Request

```json
{
  "name": "phase-one-mcp",
  "transport": "streamable_http",
  "url": "https://mcp.example.test/stream",
  "allowed_tools": ["search", "fetch"],
  "secret_ref": "handle:srt_fixture"
}
```

### Response `200`

```json
{ "data": { "server": {} }, "meta": { "request_id": "req_mcp_register_1" } }
```

## POST `/v1/mcp/servers/:name/enable`
## POST `/v1/mcp/servers/:name/disable`
## DELETE `/v1/mcp/servers/:name`

都必须携带 `Idempotency-Key`。

### Response `200`

```json
{ "data": { "ok": true }, "meta": { "request_id": "req_mcp_toggle_1" } }
```

## Errors

- `invalid_mcp_server`
- `mcp_server_exists`
- `mcp_server_not_found`
- `idempotency_key_required`
- `idempotency_conflict`
- `idempotency_in_progress`

## Live upstream

MCP live 模式走 Capability owner 的 `KOKORO_CAPABILITY_BASE_URL`，scope 由 BFF 从可信 namespace 派生。
