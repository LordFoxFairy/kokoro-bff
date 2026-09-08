# Models API v1

System 的 `model-catalog` 模块是模型目录与路由配置的唯一 owner。BFF 只把 Web-facing
`GET /v1/models` 投影到 System 的 `GET /v1/system/model-catalog/catalog`，不保存模型目录，
也不接受浏览器提交 tenant、权限或 model policy。

## GET `/v1/models`

可选查询参数 `feature_key`、`limit`（1–100）和不透明 `cursor` 原名转发；BFF 不创建 camelCase alias。

### Response `200`

```json
{
  "data": {
    "models": [
      {
        "provider": "kokoro",
        "name": "claude-sonnet",
        "is_default": true,
        "display_name": "Claude Sonnet"
      }
    ],
    "next_cursor": "CURSOR"
  },
  "meta": { "request_id": "REQUEST_ID" }
}
```

## Live adapter

`KOKORO_SYSTEM_BASE_URL` 缺失时返回 `503 upstream_not_configured`。BFF 从可信 sealed session 注入
`x-kokoro-tenant-id`、`x-kokoro-subject`，并发送 `x-kokoro-service`、`x-kokoro-request-id` 和标准
`Forwarded`；不透传浏览器权限，也不伪造 `system:read`。

System owner 响应必须为且仅为 `{ "data": ... }`，不接受裸 body 或旧 `meta`。每个 item 的 `key`、`display_name` 和布尔型
`is_default` 都是必需字段；缺失或类型错误 fail closed 为 `502 upstream_response_invalid`。BFF 保留
必填的 string/null `next_cursor`，并把 owner 的真实 `is_default` 投影到公开响应。System 错误 envelope
必须包含 string `code`、string `message` 与 boolean `retryable`。BFF 的公开成功/错误 envelope 仍由本仓 v1 契约定义。
