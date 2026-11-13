# kokoro-bff

`kokoro-bff` 是 Kokoro 唯一 public HTTP owner，发布 Web-facing Product API，并承担 Conversation、Message、
Share、Project、ScheduledTask 与 durable AG-UI projection 的目标边界。Browser 不直连本服务、不持有内部服务 secret；唯一调用方向是：

```text
Browser -> kokoro-app same-origin /api/* -> kokoro-bff /v1/* -> owner API / Agent
```

字段级事实源是 [`contract/openapi/v1/openapi.yaml`](./contract/openapi/v1/openapi.yaml)。当前实现与未完成缺口以
[`docs/CURRENT.md`](./docs/CURRENT.md) 为准；目标架构或历史验收不等于现状。

## 当前状态摘要

| 能力                           | 当前事实                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Public contract                | Public29.0 候选 / 227 个 operation，全部具备 owner/visibility/stability/idempotency/permission metadata                                      |
| User admission                 | 受信Web/Admin envelope＋配置的原生issuer Session Cookie＋固定Origin；IAM鲜验Session与当前Product资格；普通内部业务走服务＋actor |
| Project / ScheduledTask        | Live 使用本仓 PostgreSQL；Redis 用于 readiness/cache coordination                                                         |
| Idempotency                    | 持久化 command receipt 与未知结果恢复；适用面以各 operation 的幂等声明为准                                                  |
| Chat / AG-UI                   | Live 先把 Agent source fact 与 AG-UI frame 原子投影到本仓 PostgreSQL，再从 ledger 输出 SSE                                |
| Conversation / Message / Share | Live 产品事实由本仓 PostgreSQL 的 `bff_conversation`、`bff_message`、`bff_share` canonical tables 提供                    |
| Durable AG-UI ledger           | PostgreSQL 后台 consumer 以 lease/fence 主动摄取；逐 frame opaque cursor、保留水位、GC 与 expired-cursor tombstone 已闭环 |
| ScheduledTask durable dispatch | 本仓到期执行复用 Chat 提交与 Agent dispatch；canonical ScheduledTask/Execution、恢复与日历见当前契约                                     |
| Test doubles                   | 只存在于 `test/doubles/`，不编入生产 `src/`                                                                               |

## Owner 边界

- BFF：public Product API、Project、ScheduledTask、Conversation/Message/Share 产品事实与 durable public projection。
- Agent：Run、checkpoint、lease、tool journal、执行事件、HITL、evidence；BFF 只调用 Agent HTTP ingress。
- Scheduler：通用 ScheduleJob、occurrence、lease、retry、misfire、dispatch；不拥有 ScheduledTask 业务定义。
- IAM/System/Billing/Capability/Storage/Music：各自拥有领域事实（System 内含模型目录与路由）和 internal contract；BFF 只做窄 projection。
- Root：拓扑、治理和 Developer API catalog；不保存本仓 OpenAPI 镜像。

AG-UI 是 Web 与 BFF 之间唯一 Agent 网络协议。Vercel AI SDK 只属于 Web 内部 UI adapter，不建立第二套网络 stream。
`Last-Event-ID` 必须原样回传 BFF 发出的 `agui_*` opaque cursor；Agent source sequence 只存在于内部 metadata，不能作为
公开 replay cursor。独立 projector 在无浏览器连接时也持续消费 Agent source；Redis 仅发布可丢失的投影更新提示，
不保存 replay 数据，删除 Redis 状态不影响 PostgreSQL replay。超过保留窗口的已知 cursor 返回 `410 event_cursor_expired`。
公开 ledger 等待参数与后台 source projector 参数分别使用 `KOKORO_AGUI_LEDGER_POLL_*` 和
`KOKORO_AGUI_PROJECTOR_*`，两套节奏互不复用；retention、GC batch/interval 与 cursor tombstone 窗口也由显式
环境变量控制。projector lease 必须长于单次 owner HTTP timeout 加 settlement reserve，source page 不得超过 Agent
contract 的 1000 条上限。单次 source read 有显式 attempt budget；跨 claim 失败次数持久化，用于 capped exponential
backoff + jitter，成功 poll 后清零，并在配置上限内尊重 `Retry-After`。401/403、410、非法 4xx、source gap 预算耗尽
与过大响应 fail closed，timeout/connection/404/409/423/429/5xx 可重试。

ScheduledTask 的 HTTP/JSON 时间字段在边界使用 RFC 3339 UTC；application/domain 使用带有效 instant 的 `Date`，PostgreSQL
使用 `TIMESTAMPTZ(3)`。`time` 与 IANA `timezone` 是本地周期规则，`next_run_at` 是其对应的 UTC occurrence 基准。

## 五分钟启动

要求：Node.js 24.20.0（见 `.node-version`）、pnpm 11.25.0。

```bash
cp .env.local.example .env.local
pnpm install --frozen-lockfile
pnpm dev
curl -fsS http://127.0.0.1:4300/healthz
```

本地运行使用 `KOKORO_BFF_MODE=live`，并连接本地 PostgreSQL/Redis。确定性契约联调通过显式 test composition
装配 fixture；业务请求必须由 Web server adapter 携带受信服务 envelope，浏览器不应持有内部 secret 或直接访问 4300。

Live BFF-owned facts 需要共享 PostgreSQL 与 Redis DB 8：

```bash
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
KOKORO_BFF_MODE=live \
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' \
KOKORO_BFF_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm dev
```

只复用一个本地 PostgreSQL 和一个 Redis，不为 BFF 重复启动基础设施。`db:apply-schema` 仅在同一应用数据库的
空 `kokoro_bff` schema 安装 canonical schema，不要求其他 owner schema 或 `public` 为空，也不执行历史 migration。

## 服务调用 envelope 与用户准入

以下是受信 Web/Admin **服务端 adapter → BFF** 的传输示意，不是浏览器调用模板。
浏览器仅调用本应用同源 adapter；Cookie／Origin 仅通过具名认证边界，内部 secret 不进入浏览器代码。
Public 28.36 只纠正旧 Bearer metadata，不改变现有运行认证。部署模式选择普通或 `__Secure-` Session Cookie，
不以两个名字互相 fallback。`/v1/skill.list` 独立保留 IAM User API Key/OpenApp Bearer，
health、Share／manifest 与 provider webhook 各用 canonical 中的显式 security override。

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: TOKEN
x-kokoro-request-id: REQUEST_ID
Cookie: kokoro-issuer.session_token=SESSION_COOKIE
Origin: CONFIGURED_WEB_ORIGIN
```

Live 必须配置 shared secret、`KOKORO_IAM_BASE_URL`、PostgreSQL 与 Redis。普通用户身份只采用 IAM 返回的
`tenant_id`/`user_id`；legacy `x-kokoro-namespace`/`x-kokoro-principal-id`、Host、X-Domain 与 X-Forwarded-* 都不是身份
authority。Cookie只进入IAM窄认证client及独立账户认证生命周期，不进入普通业务owner；普通IAM业务使用purpose固定的服务Bearer与受信actor。Share与runtime manifest不要求用户Cookie；调用方额外携带
无关 Authorization header 不改变其 service-only 语义。完整规则见 [`docs/SECURITY.md`](./docs/SECURITY.md)。

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
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

B10 Project collaboration 的具名真实 PG 入口为 `test/project-collaboration.integration.mjs`，不加入无 fixture 的默认测试。
资源主控复用受管 PostgreSQL，创建本轮独占 loopback 临时库 `kokoro_bff_project_collab_<32位hex>`；两 URL 均显式
`?schema=kokoro_bff`，先以 `KOKORO_BFF_POSTGRES_URL` 执行现 `pnpm db:apply-schema`，再 `pnpm build`，
以 `KOKORO_TEST_POSTGRES_URL` 执行 `node --test --test-concurrency=1 test/project-collaboration.integration.mjs`。
阶段复验可用原 Node `--test-name-pattern` 选择具名用例；测试缺少/不符隔离 URL 会失败，不跳过、不建库或删库。
结束由同一资源主控 DROP 本轮自有库并核实不存在，保留失败证据；不得指向正常应用库或清理他人数据。

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

### Single project file upload

Configure `KOKORO_STORAGE_RPC_BASE_URL`, independent `KOKORO_BFF_STORAGE_SECRET`, and exact `KOKORO_STORAGE_OBJECT_ORIGIN` together. The existing project resources POST accepts one `files` multipart part and at most 1 MiB for the entire body. It returns only CLEAN Storage asset metadata. Infected files receive terminal 422; pending/unknown scans receive retryable 503 without a usable resource. Reuse the same key/file after an uncertain response; an aborted upload requires a new key. `GET /v1/library?kind=file` now lists only the admitted subject's personal CLEAN ASSET files through Storage Connect; the current personal upload/download and Artifact operations are specified separately in the canonical contract. Storage provenance/generation: `pnpm contract:check:storage`.

Project resources can be reloaded with `GET /v1/projects/{projectId}/resources?limit=50&cursor=...` using the same Storage configuration. The response contains clean asset metadata in `data.items` and opaque `data.next_cursor` (null at the end); no download URL or upload ID is fabricated. Current project ownership is rechecked on every page.

## 既有数据与版本配对

历史 public4／Agent7.3 等候选说明不再是当前启动指引；版本、固定 owner 来源和验证边界分别以
canonical contract、`contract/dependencies/` 和 [`docs/CURRENT.md`](./docs/CURRENT.md) 为准。
本次 metadata 纠偏不授权迁移、清卷或重建任何既有数据。非空 schema 不得交给 fresh-only installer；
若当前 schema 与代码不匹配，保留数据并由数据 owner 在明确备份、迁移和恢复方案后处理，不以清空数据消除差异。
