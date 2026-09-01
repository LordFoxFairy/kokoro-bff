# Agents API v1

Agents 这里只提供连接设置投影，不承载 Chat/SSE 或 Redis run control。

## GET `/v1/agents/connections/setup?platform=telegram|line|slack`

### Response `200`

```json
{
  "data": {
    "platform": "telegram",
    "status": "disconnected",
    "qr_value": "kokoro://connect/telegram/fixture",
    "continue_url": "https://dev.kokoro.localhost/app/agents?platform=telegram",
    "expires_at": "2026-01-01T00:15:00.000Z"
  },
  "meta": { "request_id": "req_agent_setup_1" }
}
```

### Errors

- `invalid_agent_platform`

## Live 状态

当前 `kokoro-agent` 只有 Redis worker，没有 HTTP ingress。Agents setup 在 BFF `mock` 模式可用；
`live` 模式不配置 Agent upstream，并对相关路由返回 `503 upstream_not_configured`。待版本化
Agent HTTP adapter v1 完成契约、测试和部署后，再新增并启用对应 upstream。
