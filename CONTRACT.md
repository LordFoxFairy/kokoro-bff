# Kokoro BFF v1 契约摘要

完整 API 文档入口：[docs/api/README.md](./docs/api/README.md)。本文是快速摘要，资源级字段、示例、幂等和 Mock 验收以 `docs/api/v1/` 为准。

## 服务调用约定

所有 `/v1/*` 请求是 Web server → BFF 的 server-to-server 调用：

- `x-kokoro-service` 必须为 `web-bff`。
- 配置了 `KOKORO_BFF_SHARED_SECRET` 时，`x-kokoro-internal-secret` 必须匹配。
- `x-kokoro-namespace` 和 `x-kokoro-principal-id` 必须来自 Web 已解封的 sealed session，不接受浏览器自带身份头。
- `x-kokoro-request-id` 可选；缺失时 BFF 生成 UUID，并在 `meta.request_id` 返回。
- `X-Domain`、`Host`、`X-Forwarded-*` 不参与业务路由；BFF 到业务服务的上下文固定为 `Forwarded: host=<KOKORO_DOMAIN>`。

## 错误

```json
{
  "error": { "code": "project_not_found", "message": "Project was not found" },
  "meta": { "request_id": "..." }
}
```

错误码稳定、消息可读；Web 负责把错误码映射为界面文案。上游未配置、不可达、响应无法解析均 fail-closed。

## API v1

成功响应统一为：

```json
{
  "data": {},
  "meta": { "request_id": "..." }
}
```

| 方法 | 路径 | 责任 |
| --- | --- | --- |
| GET/POST | `/v1/projects` | 专案列表与创建 |
| GET/PATCH | `/v1/projects/:projectId` | 专案投影与 instruction 更新 |
| GET/POST | `/v1/mori/projects[/:projectRef]/generations` | Mori 音乐项目与生成 receipt（Mock） |
| GET/POST | `/v1/mori/generations/:generationRef[/events\|/cancel]` | Mori Generation 快照、SSE 和取消（Mock） |
| GET | `/v1/projects/:projectId/tasks`, `/v1/projects/:projectId/instruction-revisions` | 专案任务与 instruction 历史 |
| POST/PATCH | `/v1/projects/:projectId/resources`, `/v1/projects/:projectId/scheduled-tasks`, `/v1/projects/:projectId/skills/:skill` | 专案资源、排程与技能投影 |
| GET | `/v1/skills`, `/v1/skills/pool`, `/v1/skills/catalog` | 技能目录/池 |
| GET | `/v1/skills/quota` | 当前 namespace 技能包配额 |
| GET | `/v1/skills/:name/revisions[?scope=...]` | 技能版本历史 |
| POST | `/v1/skills/:name/enable[?scope=...]`, `/v1/skills/:name/disable[?scope=...]` | 技能启用/停用 |
| POST | `/v1/skills/github/preview` | GitHub skill 预览 |
| POST | `/v1/skills/github/import` | 幂等导入 GitHub skill |
| GET | `/v1/models` | Model owner catalog 的 Web 投影 |
| GET/POST | `/v1/mcp/servers` | MCP server 列表与注册 |
| POST | `/v1/mcp/servers/:name/enable`, `/v1/mcp/servers/:name/disable` | MCP server 启用/停用 |
| DELETE | `/v1/mcp/servers/:name` | MCP server 删除 |
| GET/POST/PATCH/DELETE | `/v1/scheduled-tasks[/:id]` | 定时任务投影与变更 |
| POST | `/v1/scheduled-tasks/:id/retry` | 重试定时任务 |
| GET | `/v1/agents/connections/setup?platform=telegram\|line\|slack` | Agent 连接设置投影（Mock；live adapter 尚未注册） |
| GET | `/v1/library` | 产物/资料库投影 |
| GET | `/v1/billing/plans`, `/v1/billing/summary` | 套餐与余额/用量摘要 |
| POST | `/v1/billing/checkout` | 通过 plan_id 创建业务 checkout 投影 |

除 GitHub skill 预览外，所有变更请求必须携带 `Idempotency-Key`。服务端以 namespace、方法、路径和 key 组成幂等范围；Web HubClient 的所有 mutation 请求都应转发该 header。

技能配额、版本历史与 MCP server 成功响应必须符合 Web schemas 的 data 结构。MCP 注册体为
`{ "name": "...", "transport": "http|streamable_http", "url": "...", "allowed_tools": [], "secret_ref": null }`；`scope` 由 BFF 从 namespace 派生，启停/删除成功返回 `data: { "ok": true }`。

## 上游选择

Live 模式按业务 owner 选择独立的显式 HTTP/RPC adapter：System → `KOKORO_SYSTEM_BASE_URL`，Model →
`KOKORO_MODEL_BASE_URL`，Capability → `KOKORO_CAPABILITY_BASE_URL`，Storage →
`KOKORO_STORAGE_BASE_URL`，Scheduler → `KOKORO_SCHEDULER_BASE_URL`，Billing →
`KOKORO_BILLING_BASE_URL`，Chat/Run → `KOKORO_AGENT_BASE_URL`。IAM 认证由 Web 的
server adapter 完成后把已验证的内部身份上下文交给 BFF；BFF 不再保留 IAM URL/token 配置，也不由浏览器直接调用 IAM。Model catalog、Billing catalog/checkout
和 Agent Chat 已有显式 adapter；Capability/Storage Connect bridge、BFF Project/Scheduled
持久化以及 Agent setup 仍必须保持明确的未接线状态，不能回退到 Gateway 或 Mock。

## 责任分层

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Kokoro Web | 同源路由、sealed session、浏览器展示 | 业务编排、内部服务凭据下发给浏览器 |
| Kokoro BFF | 业务投影、聚合、幂等、mock/live、owner adapter 路由；Chat 公共投影 | Chat/SSE 执行事实、Agent Redis、前端组件 |
| Kokoro Agent | Redis run worker、执行身份和能力调用、Chat facts HTTP ingress | 浏览器 session、BFF 路由 |
| Kokoro Chat（BFF 内置模块） | Chat session、消息、SSE、run control、分享投影 | Agent worker 的执行内核、业务目录和专案编排 |
