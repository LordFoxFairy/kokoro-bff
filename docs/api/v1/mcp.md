# MCP API v1：当前读投影

`GET /v1/mcp/servers` 由 BFF 当前 IAM Product admission 后，以独立 `platform:projection.read` workload 身份读取 Platform，返回严格 `{data:{servers:[...],next_cursor?}}`。每个 server 仅有 owner-native `server_id`、`provider_key`、`server_identity`、`transport`、`declaration_digest`、`status`；不合成旧 URL、密钥引用、revision 或工具列表。成功/错误均有 `x-request-id` 与 `Cache-Control: no-store`。

旧 register/enable/disable/delete 路由尚无当前生产 owner 实现，返回 503，不应作为 Web 正式控件。唯一机器事实源为 `contract/openapi/v1/openapi.yaml`；Web 读契约与真组合仍待验。
