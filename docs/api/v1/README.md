# Kokoro Business API v1

## 目标

Kokoro BFF 是浏览器 Web 与业务 API 子仓库之间的业务适配层，负责：

- 业务资源聚合和投影
- Web 输入到业务服务输入的协议转换
- 服务端身份边界和 namespace 隔离
- 幂等、request id、错误归一
- Mock/Live upstream 切换

BFF 不负责：

- 浏览器 UI 和组件
- Chat/SSE、消息和 run control 的事实存储
- Agent Redis Worker 的内部实现
- 直接访问其他业务子仓库的 SQL

机器可读契约：[openapi.yaml](./openapi.yaml)。本阶段先冻结 Health、Projects 和项目级投影；其余业务资源按同一结构逐步补齐。

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
x-kokoro-user-id: <sealed-session user id>
x-kokoro-request-id: <optional request id>
```

`x-kokoro-namespace` 和 `x-kokoro-user-id` 必须来自 Web 服务端解封后的 session。浏览器自行携带的 tenant、site、`X-Domain` 或 `X-Forwarded-*` 不参与身份选择。

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
| 502 | 上游不可达或响应不符合契约 | `upstream_unreachable` |
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

## Live upstream

BFF 通过显式环境变量选择业务服务：

| 业务资源 | 环境变量 |
| --- | --- |
| Projects | `KOKORO_PROJECTS_BASE_URL` |
| Skills | `KOKORO_SKILLS_BASE_URL` |
| MCP/Connectors | `KOKORO_HUB_BASE_URL` |
| Scheduled | `KOKORO_SCHEDULED_BASE_URL` |
| Agents | `KOKORO_AGENT_BASE_URL` |
| Library | `KOKORO_LIBRARY_BASE_URL` |
| Billing | `KOKORO_BILLING_BASE_URL` |

缺少对应地址时返回 `503 upstream_not_configured`，不回退到 Gateway，也不在 live 模式静默使用 Mock。

BFF 调用上游时使用标准上下文：

```http
x-kokoro-service: kokoro-bff
Forwarded: host=<KOKORO_DOMAIN>
```

## 资源状态

| 资源 | v1 文档 | Mock | Live 替换 |
| --- | --- | --- | --- |
| Projects | 已完成 | 已完成 | 按 `KOKORO_PROJECTS_BASE_URL` |
| Skills | 下一阶段 | 已完成 | 按 `KOKORO_SKILLS_BASE_URL` |
| Scheduled | 下一阶段 | 已完成 | 按 `KOKORO_SCHEDULED_BASE_URL` |
| Agents setup | 下一阶段 | 已完成 | 按 `KOKORO_AGENT_BASE_URL` |
| Library/Billing | 下一阶段 | 已完成 | 按对应 upstream |
