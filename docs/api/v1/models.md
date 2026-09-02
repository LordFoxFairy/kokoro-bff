# Models API v1

Model 是独立 owner。BFF 只负责把 Web-facing `/v1/models` 投影到 Model 的
`/bff/model-catalog`，并注入由 Web sealed session 派生的租户和主体上下文。
BFF 不保存模型目录，也不接受浏览器提交的 tenant/model policy。

## GET `/v1/models`

可选查询参数：

- `feature_key`：转为 owner 的 `featureKey`；
- `limit`：1–100；
- `cursor`：不透明游标。

### Response `200`

```json
{
  "data": {
    "models": [
      {
        "provider": "kokoro",
        "name": "claude-sonnet",
        "is_default": false,
        "display_name": "Claude Sonnet"
      }
    ]
  },
  "meta": { "request_id": "req_model_1" }
}
```

## Live adapter

`KOKORO_MODEL_BASE_URL` 缺失时返回 `503 upstream_not_configured`。owner 请求使用：

```http
x-kokoro-service: web-bff
x-kokoro-tenant-id: TENANT_ID
x-kokoro-subject: SUBJECT_ID
x-kokoro-request-id: REQUEST_ID
Forwarded: host=KOKORO_DOMAIN
```

owner 返回的 `items`、camelCase 字段和额外内部字段不会直接泄漏给 Web；BFF 仅投影上述稳定
`models` 字段，并保留同一个 request id。
