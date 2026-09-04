# kokoro-bff

`kokoro-bff` 是 Kokoro 唯一 public HTTP owner，发布 Web-facing Product API，并承担 Conversation、Message、
Share、Project、ScheduledTask 与 durable AG-UI projection 的目标边界。Browser 不直连本服务；唯一调用方向是：

```text
Browser -> kokoro same-origin /api/* -> kokoro-bff /v1/* -> owner API / Agent / Scheduler
```

字段级事实源是 [`contract/openapi/v1/openapi.yaml`](./contract/openapi/v1/openapi.yaml)。当前实现与未完成缺口以
[`docs/CURRENT.md`](./docs/CURRENT.md) 为准；目标架构或历史验收不等于现状。

## 当前状态摘要

| 能力 | 当前事实 |
| --- | --- |
| Public contract | 63 个 operation，全部具备 owner/visibility/stability/idempotency/permission metadata |
| Project / ScheduledTask | Live 使用本仓 PostgreSQL；Redis 用于 readiness/cache coordination |
| Idempotency | business store 存在时有 PostgreSQL receipt；部分路径仍可能使用进程内 Map |
| Chat / AG-UI | BFF 从 Agent HTTP replay 即时投影 AG-UI SSE；cursor 仍是 Agent source sequence |
| Conversation / Message / Share | 公开契约由 BFF 拥有，但 Live 产品事实当前仍来自 Agent，BFF 表尚未落地 |
| Durable AG-UI ledger | 未实现 |
| Transactional outbox | 未实现 |
| Mock | 仍编入 `src/`，只作本地 fixture，不是生产完成证据 |

## Owner 边界

- BFF：public Product API、Project、ScheduledTask，以及待落地的 Chat 产品事实与 durable public projection。
- Agent：Run、checkpoint、lease、tool journal、执行事件、HITL、evidence；BFF 只调用 Agent HTTP ingress。
- Scheduler：通用 ScheduleJob、occurrence、lease、retry、misfire、dispatch；不拥有 ScheduledTask 业务定义。
- IAM/System/Model/Billing/Capability/Storage/Music：各自拥有领域事实和 internal contract；BFF 只做窄 projection。
- Root：拓扑、治理和 Developer API catalog；不保存本仓 OpenAPI 镜像。

AG-UI 是 Web 与 BFF 之间唯一 Agent 网络协议。Vercel AI SDK 只属于 Web 内部 UI adapter，不建立第二套网络 stream。

## 五分钟启动

要求：Node.js 22、pnpm 11.25.0。

```bash
cp .env.local.example .env.local
pnpm install --frozen-lockfile
pnpm dev
curl -fsS http://127.0.0.1:4300/healthz
```

本地默认 `KOKORO_BFF_MODE=mock`。Mock 不需要数据库，只用于确定性契约联调。业务请求必须由 Web server adapter
携带受信服务 envelope；浏览器不应持有内部 secret 或直接访问 4300。

Live BFF-owned facts 需要共享 PostgreSQL 与 Redis DB 8：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_BFF_MODE=live \
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL \
KOKORO_BFF_REDIS_URL=redis://127.0.0.1:6379/8 \
pnpm dev
```

只复用一个本地 PostgreSQL 和一个 Redis，不为 BFF 重复启动基础设施。`db:apply-schema` 面向空数据库安装 canonical
schema，不执行历史 migration。

## 服务调用 envelope

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: TOKEN
x-kokoro-namespace: TENANT
x-kokoro-principal-id: SUBJECT
x-kokoro-request-id: REQUEST_ID
```

Live 必须配置 shared secret。BFF 不采用浏览器的 Host、X-Domain、X-Forwarded-*、tenant 或 Authorization 作为 owner
身份。完整规则见 [`docs/SECURITY.md`](./docs/SECURITY.md)。

## 质量门禁

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
```

真实基础设施：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL=POSTGRES_URL \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:6379/8 \
pnpm test:integration
```

缺少 fixture 时 integration 是未执行，不是通过。完整矩阵见 [`docs/ACCEPTANCE.md`](./docs/ACCEPTANCE.md)。

## 文档

- [Repository map](./INDEX.md)
- [Documentation index](./docs/INDEX.md)
- [Current implementation and gaps](./docs/CURRENT.md)
- [Technical design](./docs/TECHNICAL_DESIGN.md)
- [API policy](./docs/API_CONTRACT.md)
- [Data model](./docs/DATA_MODEL.md)
- [Security](./docs/SECURITY.md)
- [Reliability](./docs/RELIABILITY.md)
- [SLO targets](./docs/SLO.md)
- [Runbook](./docs/RUNBOOK.md)
- [Acceptance](./docs/ACCEPTANCE.md)
- [ADR index](./docs/ADR/README.md)
- [Resource API docs](./docs/api/README.md)
- [Contract provenance](./contract/README.md)

## 发布

普通 push/PR 只执行质量检查；`v*.*.*` tag 才允许发布镜像。候选镜像、漏洞扫描、SBOM、provenance、签名、
health/ready smoke 尚未在当前治理阶段全部闭环，不应据此 README 宣称生产就绪。
