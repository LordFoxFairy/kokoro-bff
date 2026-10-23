## I6 RSS 安全 HTTPS reader（2026-10-23，源码候选待独审）

`readRssFeed({url,signal})`仅返回完整有界bytes；显式内部factory供受控测试，生产固定node DNS/HTTPS和公网地址策略。新增`rss-feed-address.ts`拥有URL/BlockList策略，`rss-feed-reader.ts`拥有单pin、TLS、10秒总期限/5秒idle、16KiB头/1MiB正文及取消释放。没有配置覆盖、外网feed访问、公开接口、SQL、poll或Web激活。后继唯一编排调用点仍为计划中的`application/rss-poll-service.ts`，成功后再交现parser/conditions与持久事务。

根外CDATA窄修同时检查sax `onopencdata`和`oncdata`：空CDATA不产生后一个事件，只有前一个检查可拒空输入；原92内核断言正文保持，根内CDATA仍正常。可执行stub定向RED为29项1PASS/28FAIL；首轮实现184项182PASS/2空CDATA FAIL后按Root裁决修复。首次全组stub因accepted等待未到而终止，保留原日志，不冒完成RED。

自有loopback TLS factory仅映射已验证public pin，保Host/SNI/证书校验；该证据不代表公网可达。实际5秒idle与10秒drip总期限、错SAN、取消socket、启动时环境代理trap及响应边界纳入专项。准确终态计数、命令和全输入保护见A/测试验收/i6-rss-reader-worker-v1.json。未执行build/default/full/contract聚合、DB/Redis或正常Browser；新sax锁的旧生成provenance仍待Root后续聚合门，不在此片重生成。没有hix-code-review通过结论。

## I6 内核 XML 语义窄修（2026-10-23，待独审）

已修复独审P2：实体前literal CRLF/CR归一LF、实体CR保真；声明仅XML S、固定关键字和standalone值严格小写，仅UTF-8 encoding值可大小写折叠。所有解码属性（包括namespace/未知/字符引用）含TAB/LF/CR即整份拒绝，这是明确的支持子集，不声称完整XML属性归一。guid/id保留XML解码后精确值已由Root裁决；64KiB指投影文本字段和全属性，不限制未知扩展单字段，仍受1MiB/深度/节点总界。

原58内核和37架构测试断言保持；新增行为RED为92项61PASS/31FAIL，修后92PASS。终态命令、哈希与保护见A/测试验收/i6-rss-kernel-worker-v2.json；v1日志/manifest原样保留。未开启reader/网络/资源/poll/Web。

## I6 RSS 解析与条件内核（2026-10-23，候选）

新增RSS2/Atom严格解析和闭合文本条件，尚未注册RSS接口或接入网络、Scheduler poll、持久去重、执行队列及Web。`src/infrastructure/clients/rss-feed-parser.ts`拥有sax解析/稳定摘要；`src/domain/scheduled-task/rss-feed.ts`仅只读条目类型，`rss-conditions.ts`拥有纯条件验证与匹配。后继唯一消费点为计划中的`application/rss-poll-service.ts`，本片不创建空入口或伪订阅。

固定sax1.6.1/@types/sax1.2.7，安装禁scripts；官方registry integrity与lock一致。受控纯门和失败记录见CURRENT；不将内核通过称为完整RSS可用。公开契约19.3/168、SQL、生成物、owner pins和其它业务保持原字节。

## I5 本人积分账户初始化（候选，未正常激活）

Public19.3 新增 `PUT /v1/billing/credit-account`，仅当前受信本人、严格空 JSON、自然幂等。固定 Billing158579f8 正式 v1 四操作 SDK；一次 PUT，未知结果最多一次 GET 核实，成功前复验当前 IAM；总预算最多10秒。读取仍只读，返回实际账户，不 grant/充值/重置余额，不使用旧 v2。受控HTTP验收不替代 Root 后继真实 Billing/PG 与 Web 隐藏初始化验收。

## 2026-10-21 当前候选 Public19.2 / 167 operations

新增本人运行metadata列表及可选task过滤，读取持久dispatch与严格终态事实，不触发执行。源码已实现两次当前资格快照、首次/最终IAM、单一5秒总预算与有界分页；摘要/输出、Web正式消费和正常激活仍待后继。机器事实源仍为原OpenAPI；`scripts/scheduled-task-runs-public-contract.mjs`先完整逆回19.1，再执行所有历史证明。准确门禁与资源边界见`docs/CURRENT.md`。以下日期段是历史快照。

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
