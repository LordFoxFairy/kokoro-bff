## 2026-10-22 当前内部模型预算入口

Agent使用独立 `KOKORO_BFF_AGENT_MODEL_ADMISSION_CREDENTIAL_FILE` 调用内部POST；BFF从原提交Run来源派生租户／付款用户，再单次调用固定Billing d345025／exp8。无浏览器token回取、用户grant、额外服务或本地receipt；internal1.1新增一操作、public23／186不变。最小运行配置／边界见三设计首节，完整验收与尚待Agent消费者／实际结算见 `docs/CURRENT.md`。以下较早切片仅历史。

## 当前实现入口（2026-10-22）

当前公共契约 Public23.0.0／186 operations，计价费率必须绑定精确System模型修订ID／摘要；固定Billing exp6，旧无绑定rate拒绝。原管理／非现金充值不变，本地完整门与真实owner HTTP／PG已验，详细范围见 [docs/CURRENT.md](docs/CURRENT.md)。App/Admin新字段消费者及Agent实际用量结算后继，正常环境未因本片激活。下方日期段仅保留阶段历史。

## 2026-10-21 个人系列删除候选

当前机器契约 Public22.1.0 /177，新增个人系列 DELETE，保留 distinct withdraw；严格 CAS/publication、当前 IAM delete_series 和原 key 回执。Platform Native 固定883d771、IAM0.15固定4db7012。公开三身份矩阵及 App 页面尚待接线，正常环境未激活；边界与实际验证见 `docs/CURRENT.md`。下方版本段为阶段历史。

## 2026-10-21 Skills 发布确认快照候选

当前源码 Public22.0.0/176，个人与官方发布沿既有路由显式绑定确认的系列publication，旧缺字段请求拒绝；非发布audience编辑不变。原生owner固定e95aba2，Admin详情以meta.publication返回明确空或精确系列指针／版本、HTTP历史仍efe1ed1/6.3；无新服务、表或运行兼容层。App/Admin尚未配对、正常服务未切换，不能据此称恢复旅程闭环；实际验证及下一步见 `docs/CURRENT.md`。下面日期段保留各阶段事实。

## 2026-10-20 MC-02A System5 / Public21 消费者候选

当前源码唯一 Public21.0.0 /165 operations：业务模型保持稳定label name、owner显式provider与精确三ID/feature/request_model，显示名为有效alias或原模型名；管理员label别名nullable、共享revision无feature。System5固定来源/五操作窄生成见 `contract/dependencies/system-http.json`；SQL/其他pins不变。正常配对及完整门收据见 `docs/CURRENT.md`，Key保存/领取未在本片实施，模型/工具/扣费仍暂停。下方旧版本按历史读取。

## 2026-10-20 System4 管理消费者候选

当前源码唯一公开契约 Public20.0.0 /165 operations：管理员修订只读表示使用 System4 的 `request_model` 与 closed `connection`，旧 transport/gateway 字段退休。仍只消费标签、修订、路由列表和路由 PUT 四操作；固定来源/生成见 `contract/dependencies/system-http.json`。其他 owner pins、canonical SQL 与执行暂停保持。实际门禁与未激活边界见 `docs/CURRENT.md`，下方旧版本段按历史读取。

## 2026-10-19 MCP availability 消费者候选

修既有跨仓版本不配对，不新增功能模块。Platform固定已合入4a4e4c4/HTTP6.2，原HTTP/Connect生成链产物固定摘要；Connector/Server按owner五态独立投影当前可用性，不由status/enabled猜测，不兼容旧缺字段或跳过unknown。Public19/165、SQL、权限与独立错误profile保持。

当前原四套projector先33PASS/11FAIL，再44PASS；补原HTTP夹具的必需字段后相关九套108PASS/0SKIP。两方真实descriptor与实际构建decoder/projector证明五态接通、零值/未知enum/额外wire仍拒绝。此前BFF旧descriptor真实拒绝字段13的负控保留。最终747输入冻结无漂移，format/lint/typecheck/contract/architecture/default/build七门均exit0；contract847 PASS、architecture36 PASS、默认1492 PASS/3原资源SKIP。新增仅三条独有风险测试，重复fixture字段已删除并重跑全门。未另跑真实PG/Redis、owner业务HTTP或正常运行/App/Admin整链。正常原mixed不动，模型、实际工具与扣费不启用；隔离验收完成后沿既有授权集中PR交付，不等待CI但不冒称CI通过。

## 2026-10-19 当前 Public19 集成交付

当前唯一契约为 Public19.0.0 / 165 operations。保留本地Skills、项目选择冻结、知识、调度日历、Library与MCP包管理，并合入main账号会话/姓名、共享/归档及完整Team权限；不恢复旧名称关联或旧anchor字段。双父精确证明在 `scripts/verify-closure-integration-contract.mjs`；真实验证和正常配对边界见 `docs/CURRENT.md`。以下日期段是历史切片，不替代当前机器契约。

### 2026-10-18 MCP 管理HTTP接线（未正常加载）

Public18.1 新增受管包 Begin/Complete/Abort/Status/Publish 五操作；沿现 mcpProviderAdmin 配置与正式 SDK、当前人类平台管理员及 mcp_catalog.manage 准入。只有元数据与短时 PUT 引用经 BFF，字节仍直接传 Storage；无新表、配置、自动重试或模型/工具执行。Admin 上传/发布恢复页面待后继，完整验证与未验边界见 docs/CURRENT.md。

### 2026-10-18 MCP 受管包内部消费者

Platform 固定发行物统一至 fa5c5e53151b3c72145b680a3ee4a45d92c17ec7，新增 MCP 包管理五方法窄 client；沿现 mcp_admin direct 服务凭据、固定摘要与总预算，不执行对象上传/工具，不新增公开路由或正常配置。人类管理员 HTTP 准入及 Admin 上传页面仍待接线；发布回执不是运行授权。实际验证与剩余项见 docs/CURRENT.md。

## R356 普通 Skills 生命周期 Public11 预激活纠正（2026-10-09）

唯一当前契约为 Public11.0.0，同 `/v1`、132 operations。普通 CreateVersion 只接 strict metadata，不接收或转发 expected_state_version；Platform 在事务内核当前主体/owner与 active/disabled base，分配新 revision 并创建独立 draft/stateVersion=1，不改 base。普通 Withdraw 实际修改原 Skill，严格要求当前 expected_state_version；原 key/body、digest、receipt、current IAM、取消与绝对预算保持。Admin version、Publish 及其他真实 CAS 不变。

Root 将未正常激活的 beta 以唯一 corrective major 修正；首次公开激活后的 breaking 策略保持。当前机器只改这两个普通输入与 version，先精确逆回完整 Public10.0.0 SHA2f98f529bda413912b5c15e6de45db7cdadf0e0bc51fd5de44818db9727efbb8，再运行全部原 Public9.0.1/8.10 历史门。无 owner 契约、表、Schema、依赖或新框架；DATA_MODEL/canonical schema 原字节保持。消费者等待 Root 正式提交再固定生成；源码验证不代表真实组合、正常激活或 Skills 页面完成。

<!-- R356-LIFECYCLE-PUBLIC11-END -->

## R356 当前 Public10 预激活修正（2026-10-09）

唯一机器契约现为 Public10.0.0 / 132 operations，同 `/v1`；本前缀更新下文历史 Public9 摘要。Publish required closed JSON audience/expected_state_version，同 key/CAS/digest 重放，无空body fallback。首次正常公开激活前 beta clean-slate裁决不改变以后 breaking-major策略；契约/工程候选不代表正常配对或浏览器完成，消费者等Root正式commit后固定生成。现数据库/owner生成/依赖原字节保持。

<!-- R356-PUBLISH-PUBLIC10-ENTRY-END -->

# kokoro-bff

`kokoro-bff` 是 Kokoro 唯一 public HTTP owner，发布 Web-facing Product API，并承担 Conversation、Message、
Share、Project、ScheduledTask 与 durable AG-UI projection 的目标边界。Browser 不直连本服务；唯一调用方向是：

```text
Browser -> kokoro same-origin /api/* -> kokoro-bff /v1/* -> owner API / Agent / Scheduler
```

字段级事实源是 [`contract/openapi/v1/openapi.yaml`](./contract/openapi/v1/openapi.yaml)。当前实现与未完成缺口以
[`docs/CURRENT.md`](./docs/CURRENT.md) 为准；目标架构或历史验收不等于现状。

## 当前状态摘要

| 能力                           | 当前事实                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Public contract                | Public9 / 132 个 operation，全部具备 owner/visibility/stability/idempotency/permission metadata                                      |
| User admission                 | 普通 `/v1/*` 使用 service envelope + 唯一 Bearer，并在线验证固定 IAM `0.10.0` contract；legacy identity headers 被忽略     |
| Project / ScheduledTask        | Live 使用本仓 PostgreSQL；Redis 用于 readiness/cache coordination                                                         |
| Idempotency                    | business store 存在时有 PostgreSQL receipt；部分路径仍可能使用进程内 Map                                                  |
| Chat / AG-UI                   | Live 先把 Agent source fact 与 AG-UI frame 原子投影到本仓 PostgreSQL，再从 ledger 输出 SSE                                |
| Conversation / Message / Share | Live 产品事实由本仓 PostgreSQL 的 `bff_conversation`、`bff_message`、`bff_share` canonical tables 提供                    |
| Durable AG-UI ledger           | PostgreSQL 后台 consumer 以 lease/fence 主动摄取；逐 frame opaque cursor、保留水位、GC 与 expired-cursor tombstone 已闭环 |
| ScheduledTask durable dispatch | 已实现本仓 bounded outbox、租约/fence、重试/终态；mutation receipt 仍未与事实事务合并                                     |
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

要求：Node.js 22、pnpm 11.25.0。

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

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: TOKEN
x-kokoro-request-id: REQUEST_ID
Authorization: Bearer SESSION_TOKEN
```

Live 必须配置 shared secret、`KOKORO_IAM_BASE_URL`、PostgreSQL 与 Redis。普通用户身份只采用 IAM 返回的
`tenant_id`/`user_id`；legacy `x-kokoro-namespace`/`x-kokoro-principal-id`、Host、X-Domain 与 X-Forwarded-* 都不是身份
authority。Bearer 只发送给 IAM，不转发给业务 owner。Share 与 runtime manifest 不要求或使用用户 Bearer；调用方额外携带
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

Configure `KOKORO_STORAGE_RPC_BASE_URL`, independent `KOKORO_BFF_STORAGE_SECRET`, and exact `KOKORO_STORAGE_OBJECT_ORIGIN` together. The existing project resources POST accepts one `files` multipart part and at most 1 MiB for the entire body. It returns only CLEAN Storage asset metadata. Infected files receive terminal 422; pending/unknown scans receive retryable 503 without a usable resource. Reuse the same key/file after an uncertain response; an aborted upload requires a new key. `GET /v1/library?kind=file` now lists only the admitted subject's personal CLEAN ASSET files through Storage Connect; personal upload/download and Agent Artifacts remain separate slices. Storage provenance/generation: `pnpm contract:check:storage`.

Project resources can be reloaded with `GET /v1/projects/{projectId}/resources?limit=50&cursor=...` using the same Storage configuration. The response contains clean asset metadata in `data.items` and opaque `data.next_cursor` (null at the end); no download URL or upload ID is fabricated. Current project ownership is rechecked on every page.

## R59 public4 实现候选（未发布）

- 唯一公开事实源为 `contract/openapi/v1/openapi.yaml` public4；Agent HTTP4 固定 e977923ea9992cbddaf0cdbc6c8f8d23b3af120e，生成来源见 `contract/dependencies/agent-http.json`。
- `src/infrastructure/clients/agent/interaction-state.ts` 严格解码固定 owner schema；`src/application/agui/interaction-state.ts` 校验完整 revision/no-op；`src/application/chat-run-control.ts` 校验当前 pause 的完整 decision 集合。
- `bff_agui_run_interaction` 是最新 run read projection；source/CUSTOM/cursor 与它同事务。`chat-repository.ts` 在授权 RR 中校验 head、完整 state 与 ledger provenance；ACK 不清除 pause。
- 本轮静态/纯测试证据与未决 fixture 见 `docs/CURRENT.md`。真实 PG/Redis/HTTP、发布及 Web 消费归 Root 后续验收，不能以源码候选代替。

### Agent 7.3 待核对失败码的既有库配对

Public23.1只追加 `model_settlement_pending`（不可自动重试），不改变真实结算规则。新库继续用原fresh-only installer；非空旧owner须在备份及恢复演练后显式运行 `KOKORO_BFF_POSTGRES_URL=... pnpm db:evolve-agent-failure check` / `apply`，仅接纳精确旧或目标CHECK，绝不清库。此入口不随服务启动自动执行。正常激活须与固定Agent7.3和App消费者配对，具体当前状态见 `docs/CURRENT.md`；组件测试通过不代表正常整链已验收。
