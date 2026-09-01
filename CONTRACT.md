# Kokoro BFF v1 契约摘要

## 服务调用约定

所有 `/v1/*` 请求是 Web server → BFF 的 server-to-server 调用：

- `x-kokoro-service` 必须为 `web-bff`。
- 配置了 `KOKORO_BFF_SHARED_SECRET` 时，`x-kokoro-internal-secret` 必须匹配。
- `x-kokoro-namespace` 和 `x-kokoro-user-id` 必须来自 Web 已解封的 sealed session，不接受浏览器自带身份头。
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

## 责任分层

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| Kokoro Web | 同源路由、sealed session、浏览器展示 | 业务编排、内部服务凭据下发给浏览器 |
| Kokoro BFF | 业务投影、聚合、幂等、mock/live、上游路由 | Chat/SSE 事实、Agent Redis、前端组件 |
| Kokoro Agent | Redis run worker、执行身份和能力调用 | HTTP 业务 ingress、浏览器 session、BFF 路由 |
| Kokoro Session | Chat session、消息、SSE、run control、artifact | 业务目录和专案编排 |
