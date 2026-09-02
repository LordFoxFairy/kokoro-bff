# Kokoro BFF

`kokoro-bff` 是 Kokoro 的独立业务适配子仓库。它承接 Web 的业务投影、聚合、幂等和上游切换，并以内置 Chat 模块承接会话、消息、SSE、run control 与分享投影；它不是 Gateway。

API 文档入口：[docs/api/README.md](./docs/api/README.md)。当前契约版本为 **Kokoro Business API v1**；文档结构参考 Manus API 的成熟资源和生命周期设计，但路径、字段和业务边界以本仓库契约为准。

## 边界

```text
浏览器 → kokoro-app 同源 /api/* → kokoro-bff /v1/* → 业务 API 子仓库
浏览器 → kokoro-app 同源 /api/session/* → kokoro-bff /v1/sessions/*（Chat/SSE）
kokoro-agent HTTP ingress → Redis run streams（HTTP admission 与执行 worker 分进程）
```

- Web、BFF、Agent 各自是独立仓库，不通过 workspace package、源码复制或 git submodule 复用实现。
- BFF 只通过版本化 HTTP 契约与业务服务对接；第一阶段的 `mock` 模式是本仓库内置的确定性 fixture，`live` 模式的 Project/Scheduled 事实由本仓 PostgreSQL 持有，Redis 仅作为租户隔离缓存和协调。Scheduled 的定义永远归 BFF，Scheduler 只持有通用 ScheduleJob 和 occurrence lease。
- BFF 不连接 Agent 的 Redis stream；Agent 的 HTTP ingress 是唯一业务调用面，生产环境通过 `KOKORO_AGENT_BASE_URL` 配置它，worker 仍由 Agent 自己管理。Agent 是可选执行 profile，由 `KOKORO_AGENT_ENABLED=1` 显式开启；未开启时 BFF 仍可就绪，Chat/调度执行路由返回稳定的 `agent_not_configured`。当前 Chat launch/control/replay/detail/session-list 已完成 live 组合；session list 由 Agent 持久化并按 identity 查询，rename/delete/share 与 Agent setup 仍由 live adapter 明确报告未接线能力。
- Chat、消息、SSE、artifact 和 run control 的 Web-facing projection 统一由本仓 Chat 业务模块边界承接；不再新增独立 `kokoro-session` 或 `kokoro-chat` 子仓库。HTTP 组合根在 `src/main.ts`，通用请求/响应与幂等服务位于 `src/http/`、`src/application/`，业务 repository port 位于 `src/modules/`，具体 PostgreSQL/Mock adapter 位于 `src/infrastructure/`，契约位于 `src/contracts/`。
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
x-kokoro-principal-id: <sealed-session user id>
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
| GET/POST | `/v1/mori/projects[/:projectRef]/generations` | Mori 音乐项目与生成 receipt（Mock） |
| GET/POST | `/v1/mori/generations/:generationRef[/events\|/cancel]` | Mori Generation 快照、SSE 和取消（Mock） |
| GET | `/v1/projects/:projectId/tasks`, `/v1/projects/:projectId/instruction-revisions` | 专案任务与 instruction 历史 |
| POST/PATCH | `/v1/projects/:projectId/resources`, `/v1/projects/:projectId/scheduled-tasks`, `/v1/projects/:projectId/skills/:skill` | 专案资源、排程与技能投影 |
| GET | `/v1/skills`, `/v1/skills/pool`, `/v1/skills/catalog` | 技能目录/池 |
| GET | `/v1/skills/quota` | 当前 namespace 技能包配额 |
| GET | `/v1/skills/:name/revisions[?scope=...]` | 技能版本历史 |
| POST | `/v1/skills/:name/enable[?scope=...]`, `/v1/skills/:name/disable[?scope=...]` | 技能启用/停用 |
| POST | `/v1/skills/github/preview` | GitHub skill 预览（`repository` 请求字段，Idempotency-Key 可选） |
| POST | `/v1/skills/github/import` | 幂等导入 GitHub skill |
| GET | `/v1/models` | Model owner catalog 的 Web 投影 |
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

- `KOKORO_BFF_MODE=mock`：只使用 `src/infrastructure/mock/bff-store.ts` 的本地 fixture，适合 Web/BFF 联调。
- `KOKORO_BFF_MODE=live`：按 owner-based `KOKORO_*_BASE_URL` 选择已接线的业务 upstream；Chat 只有在 `KOKORO_AGENT_ENABLED=1` 且配置 `KOKORO_AGENT_BASE_URL` 时才指向 Agent HTTP ingress。BFF-owned Project/Scheduled 使用本仓 PostgreSQL/Redis，启动前执行 `pnpm db:setup`；Skills/MCP、Library、Model、Billing、System manifest 已有明确 owner projection，未注册的写操作仍返回明确的未接线错误，不把 worker 当作 HTTP 服务，也不静默回退到 mock。
- 出站请求统一注入 `x-kokoro-request-id`、标准 `X-Request-Id`、标准 `Forwarded`、服务 `Authorization: Bearer` 和内部上下文；通用 compatibility proxy 使用 `x-kokoro-service: kokoro-bff`，已注册 HTTP owner adapter 使用 `x-kokoro-service: web-bff`，以匹配各自 v1 owner contract。浏览器的 Authorization、`X-Domain` 和 Host 不会透传为 owner 身份。
- Scheduled live adapter 需要 `KOKORO_SCHEDULER_BASE_URL`、`KOKORO_SCHEDULER_SERVICE_TOKEN` 和 `KOKORO_SCHEDULER_TARGET_URL`。任务变更先写 BFF 事实，再同步 Scheduler；Scheduler dispatch 回调 `/internal/bff/scheduled-tasks/dispatch`，BFF 校验服务 token 后以保存的 owner 身份向 Agent admission 发起幂等 Run。
- Agent HTTP ingress 已在 `LordFoxFairy/kokoro-agent` 的 v1 contract 中提供；BFF 已完成 launch/control/replay/detail/session-list 的 Chat adapter。rename/delete/share 在 Agent ingress 增加前返回明确的 `503 chat_projection_not_configured`；`/readyz` 默认只检查 BFF 自身的 live business store，启用 Agent profile 时才额外要求 Agent upstream 已配置。

## 检查与发布

```bash
pnpm check
docker build -t kokoro-bff:local .
```

普通 push 只运行 CI；只有 `v*.*.*` tag 才发布 `ghcr.io/<owner>/kokoro-bff:<tag>` 和 `latest`。本地开发直接 `pnpm dev`，Dockerfile 只使用生产编译产物。
