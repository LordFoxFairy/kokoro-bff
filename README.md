# Kokoro BFF

`kokoro-bff` 是 Kokoro 的独立业务适配子仓库。它承接 Web 的业务投影、聚合、幂等和上游切换；它不是 Gateway，也不承载 Chat 的会话事实。

API 文档入口：[docs/api/README.md](./docs/api/README.md)。当前契约版本为 **Kokoro Business API v1**；文档结构参考 Manus API 的成熟资源和生命周期设计，但路径、字段和业务边界以本仓库契约为准。

## 边界

```text
浏览器 → kokoro-app 同源 /api/* → kokoro-bff /v1/* → 业务 API 子仓库
浏览器 → kokoro-app 同源 /api/session/* → kokoro-session（Chat/SSE 事实面）
kokoro-agent → Redis run streams（执行 worker，无 HTTP ingress）
```

- Web、BFF、Agent 各自是独立仓库，不通过 workspace package、源码复制或 git submodule 复用实现。
- BFF 只通过版本化 HTTP 契约与业务服务对接；第一阶段的 `mock` 模式是本仓库内置的确定性 upstream fixture。
- BFF 不连接 Agent 的 Redis stream；当前 Agent 仍是 worker。Agent HTTP ingress 如需增加，必须另立版本化契约。
- Chat、消息、SSE、artifact 和 run control 仍由 `kokoro-session` 所有，不迁移到业务 BFF。
- 部署域名只通过 `KOKORO_DOMAIN` 产生标准 RFC 7239 `Forwarded: host=...`。不读取或转发 `X-Domain`、浏览器 Host 作为业务选择依据。

## 本地运行

```bash
cp .env.local.example .env.local
pnpm install --ignore-workspace
pnpm dev
curl http://127.0.0.1:4300/healthz
```

本地默认是 `KOKORO_BFF_MODE=mock`。业务请求是 server-only 契约，需要 Web 侧代理传入：

```text
x-kokoro-service: web-bff
x-kokoro-internal-secret: <KOKORO_BFF_SHARED_SECRET>
x-kokoro-namespace: <sealed-session namespace>
x-kokoro-user-id: <sealed-session user id>
```

浏览器不应直接调用 4300 端口，也不应持有任何内部 secret。

## API 版本 v1

成功响应统一为：

```json
{
  "data": {},
  "meta": { "request_id": "..." }
}
```

业务入口：

| 方法 | 路径 | 责任 |
| --- | --- | --- |
| GET | `/healthz`, `/readyz` | 进程/配置探针，不需要业务身份 |
| GET/POST | `/v1/projects` | 专案列表与创建 |
| GET/PATCH | `/v1/projects/:projectId` | 专案投影与 instruction 更新 |
| GET | `/v1/projects/:projectId/tasks`, `/v1/projects/:projectId/instruction-revisions` | 专案任务与 instruction 历史 |
| POST/PATCH | `/v1/projects/:projectId/resources`, `/v1/projects/:projectId/scheduled-tasks`, `/v1/projects/:projectId/skills/:skill` | 专案资源、排程与技能投影 |
| GET | `/v1/skills`, `/v1/skills/pool`, `/v1/skills/catalog` | 技能目录/池 |
| GET | `/v1/skills/quota` | 当前 namespace 技能包配额 |
| GET | `/v1/skills/:name/revisions[?scope=...]` | 技能版本历史 |
| POST | `/v1/skills/:name/enable[?scope=...]`, `/v1/skills/:name/disable[?scope=...]` | 技能启用/停用 |
| POST | `/v1/skills/github/preview` | GitHub skill 预览（`repository` 请求字段，Idempotency-Key 可选） |
| POST | `/v1/skills/github/import` | 幂等导入 GitHub skill |
| GET/POST | `/v1/mcp/servers` | MCP server 列表与注册 |
| POST | `/v1/mcp/servers/:name/enable`, `/v1/mcp/servers/:name/disable` | MCP server 启用/停用 |
| DELETE | `/v1/mcp/servers/:name` | MCP server 删除 |
| GET/POST/PATCH/DELETE | `/v1/scheduled-tasks[/:id]` | 定时任务投影与变更 |
| POST | `/v1/scheduled-tasks/:id/retry` | 重试定时任务 |
| GET | `/v1/agents/connections/setup?platform=telegram\|line\|slack` | Agent 连接设置投影 |
| GET | `/v1/library` | 产物/资料库投影 |
| GET | `/v1/billing/plans`, `/v1/billing/summary` | 套餐与余额/用量摘要 |
| POST | `/v1/billing/checkout` | 通过 plan_id 创建业务 checkout 投影 |

除 GitHub skill 预览外，所有变更请求必须携带 `Idempotency-Key`。服务端以 namespace、方法、路径和 key 组成幂等范围；Web HubClient 的所有 mutation 请求都应转发该 header。

技能配额、版本历史与 MCP server 成功响应均使用 `{ data, meta: { request_id } }`。MCP 注册体为
`{ "name": "...", "transport": "http|streamable_http", "url": "...", "allowed_tools": [], "secret_ref": null }`，其中 `scope` 由 BFF 从 namespace 派生；启停/删除成功返回 `data: { "ok": true }`。

GitHub skill 预览和导入使用相同的请求/响应数据形状：请求体为
`{ "repository": "https://github.com/OWNER/REPO" }`，成功响应的 `data` 为
`{ "repository": "...", "default_branch": "main", "skill": { "name": "...", "description": "..." } }`。

## Mock → Live

- `KOKORO_BFF_MODE=mock`：只使用 `src/store.ts` 的本地 fixture，适合 Web/BFF 联调。
- `KOKORO_BFF_MODE=live`：按 `KOKORO_*_BASE_URL` 选择上游；Skills 使用独立的 `KOKORO_SKILLS_BASE_URL`，MCP/connectors 使用 `KOKORO_HUB_BASE_URL`；缺少对应地址直接返回 `503 upstream_not_configured`，不会静默回退到 mock。
- 出站请求统一注入 `x-kokoro-service: kokoro-bff`、`x-kokoro-request-id`、标准 `Forwarded` 和可选内部 secret。
- Agent 目前没有 HTTP server，因此 live 模式不会假装调用它；部署 Agent HTTP adapter 后再启用 `KOKORO_AGENT_BASE_URL`。

## 检查与发布

```bash
pnpm check
docker build -t kokoro-bff:local .
```

普通 push 只运行 CI；只有 `v*.*.*` tag 才发布 `ghcr.io/<owner>/kokoro-bff:<tag>` 和 `latest`。本地开发直接 `pnpm dev`，Dockerfile 只使用生产编译产物。
