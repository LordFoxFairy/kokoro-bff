# Kokoro Business API v1

## 目标

Kokoro BFF 是浏览器 Web 与业务 API 子仓库之间的业务适配层，负责：

- 业务资源聚合和投影
- Web 输入到业务服务输入的协议转换
- 服务端身份边界和 namespace 隔离
- 幂等、request id、错误归一
- Mock/Live upstream 切换

阶段 1 只依赖 PostgreSQL + Redis；BFF 不引入 MySQL 或 Mongo 连接，也不把旧存储模型带回本仓。Mock/Live 只通过 HTTP upstream 与 Redis/PG adapter 契约协作。

BFF 不负责：

- 浏览器 UI 和组件
- Agent 执行内核；Chat 的 Web-facing v1 会话/消息/SSE/control/share 由 BFF 的 Chat 业务模块边界承接，Agent 只负责执行事实与恢复
- Agent Redis Worker 的内部实现
- 直接访问其他业务子仓库的 SQL

机器可读契约：[openapi.yaml](./openapi.yaml)。本阶段覆盖 Health、System runtime manifest、Projects、Mori Music、Chat、Models、Skills、MCP、Scheduled、Agents setup、Library 与 Billing 的现有 v1 业务面。

## Base URL 和调用方

本地 Mock：

```text
http://127.0.0.1:4300
```

所有业务请求必须由 Web server 发起，不能由浏览器直接调用：

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: <KOKORO_BFF_SHARED_SECRET>
x-kokoro-namespace: <sealed-session namespace>
x-kokoro-principal-id: <trusted principal id>
x-kokoro-request-id: <optional request id>
```

`x-kokoro-namespace` 和 `x-kokoro-principal-id` 必须来自 Web 服务端解封后的 session。浏览器自行携带的 tenant、site、`X-Domain` 或 `X-Forwarded-*` 不参与身份选择。
`/v1/shared/:shareId` 只允许 Web server-only adapter 用 `x-kokoro-service + x-kokoro-internal-secret` 读取公开快照，不需要用户 namespace。

## 成功响应

所有成功的业务响应都使用统一包络：

```json
{
  "data": {
    "project": {
      "id": "project_kokoro"
    }
  },
  "meta": {
    "request_id": "req_01J..."
  }
}
```

约定：

- `data` 的内部结构由资源文档定义。
- `meta.request_id` 始终存在，并可用于日志关联。
- 时间字段使用 ISO 8601 UTC 字符串；历史兼容字段如果使用 Unix milliseconds，必须在资源文档标明。
- 未声明的字段不应被 Web 当作稳定契约使用。

## 错误响应

```json
{
  "error": {
    "code": "project_not_found",
    "message": "Project was not found"
  },
  "meta": {
    "request_id": "req_01J..."
  }
}
```

通用状态码：

| HTTP | 含义 | 示例 code |
| --- | --- | --- |
| 400 | 请求格式或字段无效 | `invalid_project`, `invalid_json` |
| 401/403 | 身份或服务调用认证失败 | `service_auth_failed` |
| 404 | 资源或路由不存在 | `project_not_found` |
| 409 | 当前状态冲突或重复资源 | `mcp_server_exists` |
| 413 | 请求体超过限制 | `request_body_too_large` |
| 429 | 上游限流 | `rate_limited` |
| 502 | 上游不可达、HTTP 错误或响应不符合契约 | `upstream_unreachable`, `upstream_http_error`, `upstream_response_invalid` |
| 503 | 对应业务上游未配置 | `upstream_not_configured` |

`message` 面向日志和调试，Web 的用户文案应按稳定 `code` 映射。生产环境不得把上游凭据、堆栈或 SQL 错误返回给客户端。

## 幂等

除纯读取和明确标记为 preview 的接口外，所有 mutation 必须带：

```http
Idempotency-Key: <client-generated-key>
```

幂等范围为：

```text
namespace + HTTP method + canonical path + Idempotency-Key
```

相同范围的重复请求必须返回第一次请求的 HTTP 状态和业务响应。相同 key 但请求语义不同，不得复用旧结果，应由实现记录请求指纹并返回冲突。
Mock/Live 两种模式都必须遵守同一幂等判定入口。

实现细节：请求开始处理前先登记 pending receipt。若另一个请求使用相同 namespace、路径和
`Idempotency-Key`，且原请求仍在处理，返回 `409 idempotency_in_progress`，不得并行触发第二次
业务副作用。原请求成功后，后续请求重放已保存的状态和响应；传输或上游 `5xx` 不保存为终态，
可安全重试。PostgreSQL receipt 的 pending claim 在 60 秒后允许回收，用于处理进程崩溃遗留的
未完成 claim。

## Live upstream

BFF 通过显式环境变量选择业务服务：

| 业务资源 | 环境变量 |
| --- | --- |
| System / Site / Workspace / Policy | `KOKORO_SYSTEM_BASE_URL` |
| Capability / Skills / MCP | `KOKORO_CAPABILITY_BASE_URL` |
| Scheduler / Scheduled | `KOKORO_SCHEDULER_BASE_URL` |
| Storage / Library | `KOKORO_STORAGE_BASE_URL` |
| Billing | `KOKORO_BILLING_BASE_URL` |
| Model | `KOKORO_MODEL_BASE_URL` |
| Chat / Agent ingress | `KOKORO_AGENT_BASE_URL` |
| Mori Music owner | `KOKORO_MUSIC_BASE_URL` |

缺少对应地址时返回 `503 upstream_not_configured`，不回退到 Gateway，也不在 live 模式静默使用 Mock。

BFF 调用上游时使用标准上下文：

```http
x-kokoro-service: kokoro-bff
Forwarded: host=<KOKORO_DOMAIN>
```

Model/Billing 的 owner HTTP 面明确注册为 `web-bff` caller；Agent ingress 继续使用
`kokoro-bff` caller，以匹配 Agent 自己的服务身份契约。BFF 不把浏览器的 `X-Domain`、
`Host` 或 `X-Forwarded-*` 透传为业务上下文。

## 资源状态

| 资源 | v1 文档 | Mock | Live 替换 |
| --- | --- | --- | --- |
| Projects | 已完成 | 已完成 | BFF-owned PostgreSQL fact store；System 仅承接 Site/Workspace/Policy |
| Mori Music | v1 projection | 已完成（Mock） | 已接入 `KOKORO_MUSIC_BASE_URL`；缺失时 `503 music_owner_not_configured`，不回退到 Mock |
| Chat | 已完成 | 已完成 | BFF Chat adapter → `KOKORO_AGENT_BASE_URL` Agent HTTP ingress；session list 由 Agent 持久化查询，rename/delete/share 仍显式标注能力边界 |
| Model | v1 owner adapter | 已完成 | `/bff/model-catalog` → `{ data: { models } }`，由 BFF 注入 tenant/subject 上下文 |
| Skills | Connect owner adapter | 已完成（Mock） | live 使用 Capability 专用 projection；未接入的写操作显式返回 503 |
| Scheduled | BFF fact store + Scheduler command adapter | 已完成（Mock） | live 使用 BFF PostgreSQL/Redis fact store；创建/更新/删除/retry 会同步 Scheduler，dispatch 回到 BFF 再进入 Agent |
| Agents setup | 下一阶段 | 已完成 | Mock 可用；live 仍需 Agent setup adapter |
| Billing | v1 owner adapter | 已完成 | `/v1/commerce/catalog`、`/v1/billing/checkout` → Web 兼容的 plans/checkout 投影 |
| Library | Storage Connect adapter | 已完成（Mock） | live 使用 Storage 专用内部 projection；未接入的写操作显式返回 503 |

### Live adapter boundary

`KOKORO_*_BASE_URL` 只选择 owner 服务，不表示 BFF 已经拥有该 owner 的领域事实。BFF 的 live
实现必须在 `src/adapters/<owner>/` 中完成请求/响应、权限、错误、超时和幂等映射；通用
`proxyUpstream` 只允许作为尚未接入的显式 transport fixture，不能被验收报告当成业务闭环。

当前 owner 事实归属固定为：

| Web-facing surface | BFF boundary | Fact owner |
| --- | --- | --- |
| Chat/session/run/SSE | `src/adapters/agent.ts` + BFF Chat | Agent execution facts; BFF owns public projection |
| Project/workspace projection | BFF business adapter | BFF projection; System owns Site/Workspace/Policy |
| Skills/MCP | Capability Connect adapter | Capability |
| Model selection | `liveOwnerBusiness` Model projection | Model |
| Billing/credit | `liveOwnerBusiness` Billing projection | Billing |
| Library/assets/artifacts | Storage Connect adapter | Storage |
| Scheduled task definition | BFF business module | BFF definition; Scheduler only dispatches generic jobs |
