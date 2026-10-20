# Models API v1 — Public21 / System5

System `model-catalog` 是共享模型配置、业务 label/routing 与租户有效选择的唯一 owner。BFF 只将既有
`GET /v1/models` 投影到 `GET /v1/system/model-catalog/catalog`；不保存目录、不接受浏览器自报 tenant/权限，
不转发模型调用或取得 Key。

## GET `/v1/models`

可选 `feature_key`、`limit`（1–100）和不透明 `cursor` 原名转发。System 只返回当前受信租户显式策略及其有效
覆盖／默认修订；未绑定、未发布、退休或无有效 provider 的项不出现，不从 default_revision_id 猜可执行项。

### Response `200`

```json
{
  "data": {
    "models": [
      {
        "provider": "real-provider",
        "name": "chat/fast",
        "is_default": true,
        "display_name": "Fast chat",
        "model_id": "11111111-1111-4111-8111-111111111111",
        "revision_id": "22222222-2222-4222-8222-222222222222",
        "provider_id": "33333333-3333-4333-8333-333333333333",
        "feature_key": "chat",
        "request_model": "vendor/model-fast"
      }
    ],
    "next_cursor": null
  },
  "meta": { "request_id": "REQUEST_ID" }
}
```

全部字段必需，success/data/item 都是 closed object；next_cursor 必需且为 string/null。`name` 是稳定业务 label key，
不是展示别名或上游模型ID；`provider` 直接使用 owner 的明确值，不从 slash、name 或 display_name 推断。
`display_name` 是 owner 提供的有效别名，未设别名时为原 request_model，最长255；精确ID与 feature/request_model
保持 owner 原值。不包含 base_url、secret_handle_ref 或 Key。

## Live adapter

`KOKORO_SYSTEM_BASE_URL` 缺失返回 `503 upstream_not_configured`。BFF 从当前已准入会话注入
`x-kokoro-tenant-id`、`x-kokoro-subject` 与 actor；只用服务身份访问 owner，不转发用户 Bearer或浏览器权限，
也不伪造 `system:read`。保留既有有界 HTTP timeout/响应大小预算。

System5 成功必须且仅为 `{ "data": ... }`；第5个窄操作 `getModelCatalog` 的固定 generated schema 严格解析字段、
UUID、类型及额外字段，投影补公开名称界。旧catalog、缺字段和未知字段闭锁为 `502 upstream_response_invalid`，
错误不附带原模型连接内容。原严格 System 错误 envelope 与本仓公开错误规则保持。

共享配置配对不代表正常激活或模型许可；模型、工具及扣费仍暂停，Key 保存/领取为独立候选范围。
