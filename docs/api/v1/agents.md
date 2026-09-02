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

`kokoro-agent` 已提供独立的 v1 HTTP ingress 与 Redis worker。Agents setup 在 BFF `mock` 模式可用；
`live` 模式默认不启用 Agent，并对相关路由返回 `503 agent_not_configured`。设置
`KOKORO_AGENT_ENABLED=1` 并配置 Agent HTTP upstream 后才启用对应路由；Agent HTTP adapter
与 worker 仍由 `kokoro-agent` 独立部署和管理。
