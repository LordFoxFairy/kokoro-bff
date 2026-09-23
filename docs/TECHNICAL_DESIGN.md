# kokoro-bff 技术设计

## 1. Owner 与系统位置

```text
Browser
  -> kokoro same-origin /api/* adapter
  -> kokoro-bff public /v1 Product API
  -> IAM / System（含 model-catalog）/ Billing / Capability / Storage owner APIs
  -> kokoro-agent run ingress, control and execution history
  -> kokoro-scheduler generic job and occurrence dispatch
```

BFF 是公开 Product API 的唯一 owner；其他仓库只发布自己的 internal-owner contract。BFF 不跨库 JOIN，
不读取 Agent 或 owner Redis，也不复制上游 Domain Model。

## W1C-1：Web 同源 IAM 协议 relay（本次源码切片；待组合验收）

**起始基线（BFF `6238599667110fbfbc2d5ef3a9d53731f2623cfe`）：** `src/bootstrap/server.ts` 在 `/v1` 之外只处理
health/readiness 和 Scheduler callback；`/iam/*` 返回 404。普通 `/v1` 已经由 `src/auth/` 在线请求 IAM session admission，
但这只验证现有 Bearer，不能建立浏览器登录会话。本次源码切片已实现 relay，仍待 Root gitlink 来源门与真实正向 OAuth 组合验收。

**owner/依赖：** IAM `c9a277213ade41b9225ab0f158b89092d1869a83` 唯一拥有 Better Auth 1.7.3 issuer、OAuth client、
User/Session/Tenant 与授权码、token；Web 唯一拥有 Auth.js RP、Product Session、浏览器同源 `/iam` adapter；BFF 只拥有从
Web 服务身份到固定 IAM origin 的窄协议 relay。调用方向 `Browser → Web /iam → BFF /iam → IAM /iam`，与普通
`Browser → Web /api → BFF /v1 → IAM admission` 分开。BFF 不签发 token、不缓存 session、不访问 IAM schema/Redis，
也不将 `/internal/v1` 接到 `/iam`。Web 直连 IAM 和 BFF 代理通用上游均不采用。

**放置比较：** 采用现有 `src/http/routes/` 下具名的 `iam-protocol-relay` 路由，将精确路径策略、原生 HTTP 转发与
`src/bootstrap/server.ts` 的服务例外接线分开；其中 `src/http/routes/iam-protocol-relay.policy.ts` 是 BFF
path/method/request-header/cookie/response-header/redirect 准入的**唯一手写事实源**。不放到 `src/auth/`，因为那里只处理 BFF `/v1` 的用户 admission；
不放到现有 `src/upstream.ts` 通用 Product proxy，因为后者会注入业务 envelope/身份并丢失 OAuth redirect/cookie 语义。
从该 TS policy 由确定性脚本生成只读 `contract/iam-relay-policy.json`，作为 Web 消费的 `browser-private`
policy artifact；它仅发布 BFF 自有准入元数据，不复制 IAM endpoint 字段 schema。选择现有 `contract/` 而非
另建仅有一个文件的 `contract/browser-private/` 目录；不让手写 JSON 与 TS policy 双轨。artifact 固定
policy version、IAM owner commit、allowlist/snapshot digest 与有序 path/method/header/cookie/response 规则；
`pnpm contract:check` 的 --check 模式重生 policy JSON 并逐字节比对，禁止手改。IAM 私有 allowlist/snapshot
不复制入 BFF；Root 的独立组合机器门读取固定 IAM/BFF gitlink commit blob，核对两份 IAM 来源 digest、BFF
relay path/method 子集与 BFF artifact，并有篡改负例。Web vendor 快照固定 BFF commit 与 artifact
blob/SHA-256 digest，consumer test 断言准入集合和响应/cookie 规则；BFF policy 改变时先发布 owner 再更新 Web。
预计 `src/config/runtime.ts` 增加已验证的公开 issuer/Web callback 目标配置，`test/` 增加纯策略、HTTP 和真实 IAM fixture；
没有新顶层目录、业务模块、进程或数据库表。BFF policy 由自己的文件维护，不把 IAM 全部 allowlist 复制成第二个 owner contract。

**准入顺序与边界：** `/iam` 路由在普通 `/v1` admission/body/idempotency/SQL 之前独立匹配；先验
`x-kokoro-service: web-bff` 与 server-only shared secret，再对原始 URL 做精确、一次性的 ASCII path+method 匹配。
百分号编码、大小写变体、反斜线、双斜线、点段、非法 query/fragment、user-info/host override 与未知方法均在出站 socket 前拒绝；
不使用现有 `pathOf` 的 decode/filter 结果做准入。只连接配置时校验过的 IAM origin，不能由 `Host`、`Forwarded`、
`X-Forwarded-*`、query 或 redirect 改变上游。Web adapter 必须在浏览器入口丢弃任意 `Authorization`；BFF 不能仅凭同一
Web service secret 判断 Basic 最初来自浏览器还是 Web，因此 Basic 只在 `/iam/oauth2/token` 和 `/iam/oauth2/revoke`
的受信 Web server 调用传递，且由 Web 为自身已注册 OAuth client 生成；`/iam/oauth2/userinfo` 的 Bearer 也仅允许
Web server 使用 server-only user-delegated token 发起。其余 `/iam` 请求拒绝 Authorization/Bearer。
浏览器 cookie mutation 的 Origin 必须是配置中的精确 Web origin，并由 Web adapter 自行校验 CSRF；token/revoke 等
Web server-only 调用使用独立分支，不能借浏览器 Origin 冒充。Issuer session 路由仍由 IAM 原生 Session/Origin/CSRF
与权限验证，BFF 不自行认证用户或根据 cookie 建 Product identity。

**上游原语义：** OAuth/form/JSON 请求只转发经白名单校验的 Content-Type、Accept、Origin、必要请求 body 与 issuer cookies，
body 原始字节有界；不转发 Web service secret、Product Session/其他 cookie、任意浏览器 Authorization、客户端 `Host`、
forwarded/hop-by-hop headers。issuer cookie 准入与 `Set-Cookie` 回传由当前 IAM cookie 配置和 Better Auth 固定版本
锁定精确名称：`kokoro-issuer.session_token`、`kokoro-issuer.session_data`、`kokoro-issuer.dont_remember`、
`kokoro-issuer.session_token.oauth_logout_confirmation`，生产各名称加 `__Secure-`；仅在真实 owner fixture 证明
当前版本确需清理 chunk 时准入 `session_data.<非负十进制整数>`，不是开放 `kokoro-issuer.*` 前缀通配。保留每个合法
独立 `Set-Cookie`，不合并或改写成 BFF cookie。普通 issuer cookie 要求 `HttpOnly; SameSite=Lax; Path=/iam`，
生产另要求 `Secure`；唯一 logout confirmation cookie 的原生 Path 必须是 `/iam/oauth2/end-session/confirm`。
所有 issuer cookie 均为 host-only，拒绝 `Domain` 属性。原生 status、必要
`Content-Type`、`Cache-Control`、合法 `Retry-After`、`Location` 与 body 保留；logout HTML 的
`Content-Security-Policy`、`X-Content-Type-Options`、`Pragma` 经严格值校验后保留，hop-by-hop 等继续剔除，
不套 Product `{data|error}`。IAM 原生 429 的有界合法 `Retry-After` 也原样保留，不改写错误 body。
禁用自动 redirect、重试和缓存。`Location` 只接受精确公开 issuer origin 下已批准的 `/iam` GET 路径、
Web `/auth/sign-in|select-tenant|consent` 和配置中精确注册的 Auth.js callback/post-logout URI。
IAM OAuth Provider 的三种 Web 交互页会带动态**已签名 authorize query**（含 `sig`、`ba_iat`、重复
`ba_param` 等）；BFF 对这些页及注册 callback 的 raw query 只做 ≤8 KiB/合法结构/控制字符约束，按原始字节原样
转交，不解析后重排、不消费或伪造 IAM 签名，也不将 query 内嵌的 `redirect_uri` 当作新的 HTTP `Location`。
Web 续接时保留签名参数，由 IAM 原生 `/oauth2/continue|consent` 验证。BFF 只裁决实际 `Location` 的固定
origin/path，拒绝外域、任意 Web path、未注册 client redirect、CRLF、fragment、userinfo 或 scheme-relative URL，
且合法原生 Location 不重写。
整个入站 body 读取与上游 headers+body 共用从 body 读取前启动的单一截止时间，取现有 upstream 预算和固定 5 秒硬上限较小值；
上游响应 ≤1 MiB、请求 body ≤64 KiB、headers ≤16 KiB。请求超限在出站 socket 前拒绝；请求/响应提前关闭、
上游 header/body 超限立即 abort/cancel 真实 socket/reader，清理 timer/listener，不落业务副作用。IAM 不可用、超时、body/headers 超限、非法上游状态或
不可信响应头均 fail closed 为脱敏 502/503；只在收到上游响应后才能识别的恶意 Location/Set-Cookie 可有一次 IAM I/O，
但不得向 Web 输出恶意值。本地准入拒绝必须零 IAM socket，所有 relay 请求均零 BFF SQL/Redis/receipt/outbox。

**验证门：** `test/iam-protocol-relay-policy.test.ts` 证明 path/method/Origin/Authorization/cookie/Location 准入和零
上游 socket；`test/iam-protocol-relay-transport.test.ts` 证明多值 `Set-Cookie`、body/status/header、timeout/cancel/大小上限与
Product Session 不泄露；单独真实 IAM HTTP fixture 验证 discovery→authorize→sign-in→tenant→consent→token/userinfo
和 end-session/confirm 原生重定向与 cookie Path；正向断言三种 Web 交互页动态签名 query 原样保留并能续接，
以及原生 429 `Retry-After`、logout HTML `Content-Security-Policy`/`X-Content-Type-Options`/`Pragma` 被严格校验后保留。
响应必须先完成可信 header/body 校验再写 Web socket，不能先流出
半截 token/恶意 Location。合并门包含 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm contract:check`、
`pnpm test`、`pnpm build` 与 BFF owner 独立真实 HTTP；`pnpm contract:check` 必须包含
`contract/iam-relay-policy.json` 的确定性生成漂移门。本次源码切片已运行 BFF 本地门，但 Root 跨仓来源机器门与
正向 OAuth 成功链尚未闭环，不声称源码实现已验收。

**固定来源：** IAM `src/modules/auth/ingress/auth-routes.constants.ts` 在上述 IAM commit 的 SHA-256 是
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`；Better Auth snapshot
`contract/vendor/better-auth.v1.7.3.json` SHA-256 为
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`。BFF 暴露的更窄路径矩阵和
精确错误策略在 [API_CONTRACT](API_CONTRACT.md#w1c-1-browser-private-iam-relay-目标尚未实现)，新增路径前要比较 owner
固定 commit/snapshot、执行真实协议测试，不把 IAM vendor snapshot 直接发布成 BFF public OpenAPI。

**AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议。** Vercel AI SDK 的 `UIMessage` 属于 Web 内部 view adapter，
不得成为第二套网络 envelope 或 resumable stream。

## 2. 当前物理实现（基线 `c5e9b3c`）

| 区域                           | 当前职责                                                                                                  | W1B 边界                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                  | 进程入口                                                                                                  | 不承载身份或业务规则                                                                                       |
| `src/bootstrap/`               | server composition、请求管线、route dispatch、worker 生命周期                                            | Task 1 只装配 IAM admission 与显式服务例外；Task 2 在 receipt/owner I/O 之前接线资源授权                   |
| `src/config/runtime.ts`        | 运行配置与 URL/预算校验                                                                                   | Task 1 新增严格 `KOKORO_IAM_BASE_URL` origin；不增加环境变量测试旁路                                      |
| `src/http/routes/`             | Product route、System/owner projection、Scheduler callback                                                | Task 1 抽出 runtime-manifest 服务路由；Task 2 新增 `chat-authorization.ts`，不把业务授权塞进 `src/auth/`   |
| `src/application/`             | Project、ScheduledTask、Chat 与 AG-UI use case，必要的 repository/delivery port                           | 延续现有业务能力聚合，不为 W1B 创建 Command bus、通用 ACL 或空层                                          |
| `src/domain/`                  | 当前确有独立不变量的 Chat、ScheduledTask、Project value 与 request context                                | 是否拆分类型按语义/生命周期决定，不机械复制 DTO/Domain/Row/Wire                                           |
| `src/infrastructure/postgres/` | BFF-owned repository、durable ledger/outbox/receipt；Redis cache/notification 协调                        | Task 2 修改现有 Project/ScheduledTask/Chat 数据访问；不创建数据库品牌目录的第二套实现                      |
| `src/infrastructure/clients/`  | Agent、Scheduler、Capability、Mori 等窄 owner adapter                                                     | Task 1 IAM admission 不放在这里，因为它共同负责 HTTP 入口身份建立，而不是普通业务 owner projection        |
| `src/generated/`               | Capability/Scheduler 固定契约生成物                                                                       | Task 1 增加 `iam-http`；生成物只由固定脚本产生，业务代码不得直接依赖其 wire 类型                           |
| `src/contracts/`               | 当前手写 BFF public transport types/envelope                                                              | W1B 不借身份切片批量重构；字段事实仍以 public OpenAPI 为准                                                 |

当前目录是已运行职责的事实，不是强制四层模板。新文件按单一变化原因放置；既有 `application/ports`、
`infrastructure/postgres` 或 `interfaces/http/agui` 不构成所有新业务必须复制的目录结构。

## 3. W1B 请求、身份与授权设计

### 3.1 `c5e9b3c` 起始基线

普通 `/v1/*` 当前由 `src/http/request.ts::authorize` 校验 `web-bff` 与 shared secret，再直接把
`x-kokoro-namespace`、`x-kokoro-principal-id` 组装为 `RequestContext`。这是待删除的自报身份入口；当前没有在线 IAM
session admission。`src/bootstrap/server.ts` 还会为 runtime manifest 制造 `userId: "runtime-manifest"`，这不是用户身份事实。
公开 Share 使用 service secret + share capability，Scheduler callback 使用独立 Scheduler bearer；它们当前和普通用户管线分支。
本段只描述起始 commit；3.2～3.4 是 Task 1 实现，3.5 是 Task 2 已实现的个人私有边界。

### 3.2 Task 1 本变更：单一用户 admission 链

```text
request id
  -> verify web-bff service + shared secret
  -> parse exactly one Bearer credential
  -> POST IAM /internal/v1/session-authorizations/verify (no body/query, no redirect/retry/cache)
  -> strict generated response validation
  -> RequestContext { namespace: tenant_id, userId: user_id }
  -> resource authorization
  -> body parsing / receipt / SQL / outbox / SSE / owner I/O
```

IAM 是 Tenant、Membership、Session 与身份唯一 owner；BFF 拥有入口准入和自己的业务资源授权。Task 1 固定消费 IAM commit
`259a66e6a569889c030734f380e99685d8b9e21c`、OpenAPI `0.2.0`、SHA-256
`f7a3ea2e5ae7ade82ae1a6756a2f560d3129ca1b2977c6b0905633a284bd3aab`。Node `22.22.2`、pnpm `11.25.0`、
`@hey-api/openapi-ts` `0.99.0` 与当前 lockfile 固定；生成入口只保留 `verifySessionAuthorization` 及其引用 schema，完整
vendor artifact 仍是可重复派生的来源。`src/generated/iam-http/` 只由脚本写入，manifest 记录精确文件清单和 digest；两次生成
必须 byte-identical。Node 22 / exact-optional compatibility 修正只允许存在于生成脚本，以固定模式和固定命中数 fail closed，
不得手改生成物或复制手写 IAM wire DTO。

`src/auth/` 采用四个职责清晰的文件：`session-admission.types.ts` 定义不含 generated 类型的窄 port；
`session-admission.transport.ts` 负责单次有界 HTTP、取消和 body cap；`session-admission.client.ts` 终止 generated schema 并归一失败；
`user-admission.ts` 依次执行 service、Bearer 和 IAM 验证后建立 context。对比把这些文件放进历史
`infrastructure/clients/iam`，这里采用 `src/auth/`，因为它们共同变化于入口身份建立，并且不能被业务 owner adapter 当作通用 IAM SDK。
production composition 默认构造真实 client；`sessionAdmission?: SessionAdmission` 仅是显式测试 seam。Bearer 只发送给 IAM，
不写入 context、数据库、日志、receipt 或其他 owner 请求。

`KOKORO_IAM_BASE_URL` 解析为 `iamBaseUrl: string | null`，只接受无 userinfo、query、hash 的 HTTP(S) origin。
缺失配置时普通用户请求返回 `503 iam_admission_unavailable`，production readiness 不宣称就绪；不得以 header identity、环境变量
测试开关或缓存决定降级。一次请求或一次 SSE 建连/重连都重新 admission；已经建立的 SSE 仍由现有 connection duration 有界，
Task 1 不宣称跨连接即时撤销。

### 3.3 IAM 失败、取消与响应约束

- IAM 只收到唯一 `Authorization: Bearer ...`、`Accept: application/json` 与受控 `x-request-id`；无 body/query、redirect、自动重试。
- 整个 headers + body 读取预算取现有 upstream 配置与硬上限 5 秒/1 MiB 的较小值；超限、timeout、transport、非法 status/
  envelope/header 都归一为 `503 iam_admission_unavailable`。
- 只有 `allowed: true` 且 `tenant_id`、`user_id`、`session_id`、`client_id` 全部非空的 strict 200 才建立 context。
  IAM 401 → `401 session_invalid`；403/404/409 → `403 session_forbidden`；429 → `429 session_rate_limited`，仅转发
  1..86400 秒的合法 `Retry-After`。
- IAM 响应必须有合法 `x-request-id` 和 `Cache-Control: no-store`；BFF 自己的 admission 响应也保持 canonical error envelope、
  `x-request-id` 和 `no-store`，不复制 IAM message/body。
- `request.aborted` 或 response 在完成前关闭时取消 IAM I/O；正常 request body end 不触发误取消。所有 listener、timer 与 reader
  都在完成或失败后清理；取消后不得继续 body 解析、receipt、SQL、outbox、SSE 或 owner I/O。

### 3.4 三个互不授权的服务例外

1. `GET /v1/shared/{shareId}`：service secret + active/unexpired Share capability，只读 Conversation 投影；不要求或使用用户
   Bearer，多带无关 Authorization header 不改变有效请求，也不授予 Run control、HITL、事件流或未分享文件。
2. `GET /v1/system/runtime-manifest`：service secret + server-side `KOKORO_TENANT_ID`/`KOKORO_DOMAIN`；显式 handler 只向 System
   发送 tenant/service 身份，删除 fake principal，不成为通用 service proxy。
3. `POST /internal/bff/scheduled-tasks/dispatch`：独立 Scheduler token、trusted event tenant 与 durable receipt/CAS；不接受 Web
   service secret 或用户 Bearer，也不由 IAM 故障改变其语义。

`GET /healthz` 与 `GET /readyz` 继续是 probe。上述边界都不是 IAM 不可用时的用户 fallback，彼此凭据不可互换。

### 3.5 Task 2 已实现：默认个人私有

用户业务 scope 统一以具名 `{ tenantId, subjectId }` 传递。Project、ScheduledTask、Conversation/Message、AG-UI events 和
Run control 对同 tenant 其他用户及跨 tenant 用户均 fail closed；资源存在性敏感的 detail/mutation/control/events 返回与缺失一致的
404。IAM admission 只证明身份，不替代 BFF owner predicate，也不根据 `x-kokoro-permission` 合成 63 项业务权限。

Project 新增不可由 body 指定的 `owner_id`，slug 域变为 `tenant + owner + slug`；Project revisions/skills/tasks 通过父 Project
predicate/lock 授权，不复制 owner 列。ScheduledTask 复用既有 `owner_id`；所有用户 list/detail/update/delete/retry 已增加 owner
predicate，create 在 task/outbox 同一事务中锁定并验证引用 Project 属于同一 scope。内部 Scheduler `findRecord(tenant, task)`
保留为具名服务语义，只供 callback 恢复已存 owner，不能被用户 route 复用。

Chat Conversation repository 的 `tenant + owner` predicate 现已同时验证非空 `project_ref` 指向同一 scope 的
Project；body/query 同时给出不同 `project_ref` 返回 400。query `scope` 只允许省略、空或 `direct`，其他值返回 400，绝不作为
tenant/授权来源。cancel/resume/steer 在通用 mutation receipt replay 与 Agent I/O 之前验证同 scope Conversation；Share 不进入该路径。
公开 Share 与 Scheduler callback 按 3.4 的独立边界保持可用，不新建团队共享、Project ACL 或通用授权表。

## 4. 幂等状态机

```text
missing key -> 400 idempotency_key_required
new scope   -> pending receipt -> execute -> terminal receipt
same digest + pending -> 409 idempotency_in_progress
same digest + terminal -> replay status/body
different digest -> 409 idempotency_conflict
5xx -> release pending claim so caller may retry
```

Live 且 business store 已配置时 receipt 位于 `bff_idempotency_receipt`；否则当前实现使用进程内 Map。pending claim
60 秒后可被回收。`c5e9b3c` 的 mutation fingerprint 已覆盖 method、canonical path、排序 query、canonical body、
content-type 与 `if-match`；scope 包含 namespace/actor/method/path/key。receipt 与普通业务写事务、通用 fencing 仍未统一。
资源 owner gate 现位于 replay/claim 之前，避免同 tenant 其他用户命中旧结果或制造副作用；repository/事务仍再次校验，避免 TOCTOU。

## 5. Project 与 ScheduledTask

Project 与 ScheduledTask 是 BFF-owned facts。`c5e9b3c` 的 repository 查询都携带 tenant id，但这只实现租户隔离：
Project 没有 owner 列，list/detail/slug/child mutation 和 Redis list cache 都是 tenant scope；ScheduledTask 虽已有 `owner_id`，
用户 list/detail/update/delete 仍只按 tenant 查询。当前实现已按 3.5 把用户路径收敛为 tenant + owner，并保留 Scheduler callback
所需的显式内部查询；Project Redis 列表 cache 与 invalidate 分支已经删除。关系完整性由同一事务内的 Application/Repository predicate 与锁维护，不使用数据库外键。

ScheduledTask 当前流程：

```text
validate input
  -> derive trusted tenant/actor/request/idempotency lineage
  -> BEGIN
  -> tenant + owner scoped project/task lock and task revision write
  -> write versioned Scheduler command to bff_scheduled_task_outbox
  -> COMMIT (fact and command are one local transaction)
  -> dispatcher claims with SKIP LOCKED + lease_token + fence
  -> call Scheduler outside the database transaction
  -> conditional succeeded/retryable/failed settlement
```

Outbox 不是通用跨域队列；每行只表示一个 `scheduler.register|replace|delete` command，payload 带 schema version、
task revision 和完整 tenant/actor/request/idempotency lineage。相同 `(tenant_id, task_id, command_type,
idempotency_key)` 只产生一个业务 command；同一 task 的较新 command 要等较早 pending/retryable/leased command
结束后再 claim。删除先在同一事务写 delete command，再删除 BFF fact，因此 Scheduler job 的外部删除可在进程崩溃后恢复。

Dispatcher 的 HTTP 投递是 at-least-once：lease 过期可被其他 worker 重新 claim，settlement 必须匹配 owner、token 和
fence；2xx 终结为 `succeeded`，明确的瞬时错误进入指数退避 `retryable`，超过 attempt budget 或永久 4xx 进入 `failed`。
Scheduler 注册的 409/404 只按稳定 job identity 做 register/replace reconciliation。mutation receipt 目前仍由外层
idempotency repository 单独 claim/commit，尚未与 task/outbox 合并为一个 receipt 事务。Task 2 已将 create 的稳定
`scheduledTaskId` 材料从分隔符拼接收紧为无歧义 JSON 数组 `[tenant, trusted subject, path, key]`；create replay、用户查询和
outbox lookup 不得跨 owner 命中。该修改不改变 Scheduler callback 的 opaque occurrence/key receipt scope。

## 6. Chat 与 AG-UI

当前 Live event 流分成后台投影与公开读取两条单向路径：

```text
AgUiProjectorRunner (process lifecycle)
  -> seed/register eligible BFF Conversation scope
  -> claim (tenant, session) with SKIP LOCKED + lease token + monotonic fence
  -> fetch Agent source events after bff_agui_stream.source_high_watermark
  -> validate owner contract, tenant/session identity, sequence and snapshot watermark
  -> BEGIN + lock stream row + verify version and consumer fence
  -> register source identity/digest + project all AG-UI frames + advance state/high-watermark
  -> COMMIT
  -> settle progress/retry/blocked + best-effort Redis PUBLISH

GET events
  -> verify BFF-owned Conversation in trusted tenant + subject scope
  -> resolve Last-Event-ID against (tenant, session) in PostgreSQL
  -> read committed rows strictly after public_sequence
  -> @ag-ui/core validation -> SSE
```

`bff_agui_stream` 以 `(tenant_id, session_id)` 为 scope，保存 source high-watermark、下一内部 public sequence、持久化
projection state 与乐观 version；事务同时持有 row lock。`bff_agui_source_event` 以 source event id 为主键，并对
source sequence 建第二个唯一约束；相同 identity 的不同 digest/sequence 触发稳定失败。`bff_agui_event` 为每个 AG-UI
frame 保存完整 JSON payload、source mapping、frame index、单调内部 sequence 与独立随机 `agui_*` cursor。

客户端只把 SSE `id` 原样作为 `Last-Event-ID`；cursor 不编码 authority。Repository 先用 tenant + session + cursor
解析内部位置，再按 tenant + session + public sequence 查询。跨 tenant 或同 tenant 跨 subject 请求先按 Conversation owner 边界返回与普通缺失
一致的 `404 session_not_found`；当前 session 内格式错误或未知 cursor 返回 `400 invalid_event_cursor`。一个 source fact
的多 frame 在同一事务提交，但每帧有独立 cursor；连接
恰好在 START 后断开时会从 CONTENT 继续，不会把 source sequence 当作已完成整个 projection。

PostgreSQL 是 public replay 的唯一 durable truth。Redis 只 `PUBLISH` hash-scoped 更新提示，不存 event、cursor 或
high-watermark；通知失败不回滚事实。后台 runner 与 HTTP 生命周期独立，公开连接只以 bounded ledger polling 等待新
commit，不会变成第二个 Agent consumer。终态 ledger 在 Agent unavailable/disabled 和 BFF 重启后仍可独立 replay；
非终态且 projector 未配置时 fail closed。

consumer 状态与 stream 同 row：subject、next poll、lease owner/token/until、递增 fence、连续失败计数、最后错误和最后
完成时间均持久化。`expected_run_id` 表示最新接纳的 run，`latest_run_id` 只表示最近投影的 source run；旧 run 可以补投
历史 frame，但只有 expected run 的终态可以关闭 public stream。claim 的到期判断和 deadline 由 PostgreSQL 时钟计算，
并把剩余 lease budget 返回给 worker；runner 与 source client 在进程内使用 monotonic clock 消耗该预算，wall clock 只用于
日志/协议时间。注册不同 expected run 时，同一事务递增 stream version/fence、撤销旧 lease并清除旧 terminal；旧 worker
即使晚到也无法通过 commit/settlement 条件。projection state 以 run identity 隔离，某个 run 的终态只清理该 run 的
message/tool 状态。每次 source read 受 attempt budget 和 lease
deadline 共同限制，并为事务 settlement 预留时间；瞬时失败跨 claim 使用持久计数驱动 capped exponential backoff +
jitter，并在配置上限内尊重 `Retry-After`，成功 poll 清零。source gap 耗尽内部连续性预算、不符合 contract、重复
identity、永久 HTTP/容量错误把 scope 置为 blocked，避免静默跳过。
stream 持久化最新 `RUN_STARTED` 的 public sequence；GC 仅删除该边界
之前且早于 retention cutoff 的旧 run frame，并完整保留从边界到当前 head 的 run slice。没有可靠边界，或保留 suffix
中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过回收。
删除前写入有界 cursor tombstone，并推进 retention floor。tombstone 存续时返回 `410 event_cursor_expired`。

Agent 自有 event wire 的时间编码由 Agent contract 决定（当前 client boundary 保留其 epoch-millisecond 形状）；BFF
在 projection adapter 边界解析为 UTC instant，BFF domain/application/数据库事实不把 epoch 数字当作时间。该约定不
改动 Agent Run 或 Agent outbox。

Conversation、Message、Share 的产品事实由 BFF PostgreSQL canonical tables 与 ChatApplicationService 持有；Agent 只
拥有 Run、checkpoint、lease、tool journal、执行事件、HITL 与 evidence。Live session list/detail/message history/title/
delete/share routes 只读取 BFF facts。Message create 由 `ChatTurnApplicationService` 在一个本地事务内追加 completed user
message、pending assistant message、Agent dispatch outbox command，并注册同一 expected run 的 AG-UI consumer；HTTP
提交后即返回 `202`。后台 `AgentDispatchOutboxDispatcher` 在事务外以稳定 run identity、`SKIP LOCKED`、lease token/fence
和有界退避调用 Agent。AG-UI ledger 仍独立保存 Agent execution projection；source event 到 assistant Message fact 的
durable reconciliation 属于后续切片。

## 7. 出站与失败归一

出站 HTTP 使用整体 timeout、响应大小上限、request id、Forwarded 与服务凭据。当前 transport 不自动重试；调用方
只在具备稳定幂等 identity 时重试。缺配置、不可达、HTTP error 与 schema mismatch 分别映射为稳定错误，且不返回
provider body、SQL 或 stack。

## Storage v2 handoff and interim unavailable contract

Storage 继续唯一拥有 Asset、Artifact、Blob、Upload 与对象生命周期事实；BFF 只拥有 public Product API 的 Library
入口。唯一未来协议是 Storage Proto v2 over ConnectRPC，当前切片不保留旧的 `/internal/bff/library` HTTP transport，
也不建立临时 adapter、fallback 或双读。

在 W2 前，IAM admission 通过后的 `GET /v1/library` 固定返回 `503 storage_integration_unavailable`；准入前按 Task 1
规则返回 401/403/429/503，其中 IAM 不可用为 `503 iam_admission_unavailable`。该响应完全在
BFF 本地构造，不打开任何 Storage socket 或连接，不创建 PostgreSQL 事务、Redis cache、receipt 或 outbox。未来成功态
只有在 Storage default-deny caller × operation × scope、Capability scope mapping 与拒绝规则、Agent trusted
Run/ExecutionIdentity scope，以及 Library per-kind 或 BFF composite pagination 同时闭环后，
才按真实 owner contract 重新设计并发布。

## Capability consumer cutover

Capability 是 Skill 与 MCP server 只读事实的唯一 owner；BFF 只拥有 public Product API projection 和消费适配。
本切片冻结 accepted owner commit
`7f89a267d745cbb9870f52d6edb23dec1a3c469b` 的 `2.0.0` HTTP OpenAPI，consumer 只消费
Capability HTTP OpenAPI，不消费现有 Capability Proto，也不直连 Capability PostgreSQL/数据库或 Redis。固定 owner
surface 只有四个 GET：`/v1/skills`、`/v1/skills/pool`、`/v1/skills/catalog`、`/v1/mcp/servers`。

当前 generated Capability HTTP consumer 已从 vendored commit blob 生成到 `src/generated/capability-http/`，
`src/infrastructure/clients/capability/` 是唯一 facade。generated wire 类型在 facade 终止，application 与 HTTP route
只接触 BFF projection 类型；runtime 已原子切到四个 canonical `/v1/*` owner GET，旧路径、fallback 和 alias 已删除，
不存在双轨。`contract:check:capability` 在临时目录重新生成并校验 exact file allow-list、bytes 与所有 provenance digest。
固定的 `@hey-api/openapi-ts@0.99.0` transport 模板会为 optional property 显式赋 `undefined`，与本仓
`exactOptionalPropertyTypes` 冲突；生成流水线因此在 Prettier 前执行固定模式、固定命中数的 compatibility normalization，
任一模板命中数漂移即失败。该步骤不手改 generated output、不使用 TypeScript suppression，drift gate 会连续生成两次并验证
byte-identical，再与 checked-in 16 files 比较。升级到原生生成 exact-optional-compatible output 的固定 generator 版本并通过
regeneration、drift、typecheck 与 build 后，删除该 normalization。
同一固定计数流水线把 owner contract 中所有 `additionalProperties:false` 对应的 generated Zod object validator 收紧为
`strict()`；top-level response、nested data/item 与 error envelope 出现未声明字段时一律 fail closed。

请求管线只接受每个 operation 的 query allow-list。Skills 三个列表仅允许 `query`、重复 `tags`、`scope_kind`、
`limit`、`cursor`；MCP 列表仅允许 `provider_key`、`limit`、`cursor`。BFF 从受信 Web envelope 构造
`x-kokoro-service: web-bff`、owner token、tenant、subject 和 request id，不透传浏览器 Authorization、Host、
X-Forwarded-*、body identity 或任意 header。调用总预算固定 5 秒，响应 body 上限固定 1 MiB；read-only GET 不自动
重试，也没有本地数据库事务或 outbox。owner 400/401/503 与 transport/schema failure 在 facade 归一为 BFF 稳定错误，
不返回 owner payload、token 或 stack。Skills cursor scope 固定为 `tenant + subject + operation + normalized filters`。
MCP cursor scope 固定为 `tenant + operation + provider_key filters`；Capability MCP owner 不提供 subject binding，BFF 不自造该 binding。
两类 opaque cursor 都只原样回传；BFF 不解析、不持久化也不把 cursor 当作 authority。

Wave 3 由 BFF consumer owner 在 Platform `kokoro.platform.v1` ConnectRPC consumer 激活的同一切片删除 Capability HTTP
facade、generated client、vendor 与 dependency manifest；Platform owner 负责发布替代 contract。切换不得保留 HTTP
fallback、双读或 alias。

## 8. 启动与关闭

- Mock 是本地确定性 fixture，不需要 PostgreSQL/Redis；它不是生产完成证据。
- Live BFF-owned 路由要求 PostgreSQL + Redis；`/readyz` 检查可用性。AG-UI committed replay 只读取 PostgreSQL，
  但 Redis 不可用仍会使整体 readiness 失败。
- 监听后启动 AG-UI projector、ScheduledTask dispatcher 与 Agent dispatch dispatcher；它们只 claim
  due/eligible/expired-lease rows。
- graceful shutdown 先停止 projector 与两个 dispatcher、等待当前 bounded cycle 并释放仍持有的 lease，再关闭 repository；
  尚无完整 HTTP request drain 或 termination budget。

## System consumer cutover

BFF 的窄 owner adapter 位于 `src/http/routes/owner.ts`，解析与公开投影位于
`src/application/projections.ts`。runtime manifest 与 model catalog 共用唯一
`KOKORO_SYSTEM_BASE_URL`；前者调用 `/v1/system/runtime-manifest`，后者调用
`/v1/system/model-catalog/catalog`。本切片不增加持久化事实、运行层、fallback 或第二套 owner client。

## Scheduler control and receiver cutover

**W0B-9 BFF runtime 已实现。** Scheduler 唯一维护 control `internal-owner` 与 dispatch `event-protocol`；
BFF 拥有 ScheduledTask、consumer 验证与本仓 receipt。固定 producer commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e`、version `1.0.0`，来源是
`contract/openapi/v1/openapi.yaml`，SHA-256 `6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`。
原始 commit blob 只读保存到 `contract/vendor/kokoro-scheduler/<commit>/openapi.yaml`；
`contract/dependencies/scheduler.json` 状态为 `generated`，记录 provenance/config/lockfile 与 16 个生成产物 digest。
`openapi-ts.scheduler.config.ts` 固定本仓既有 hey-api 0.99.0、TS 5.9.3、Zod 4.5.4、Node 22.22.2、pnpm 11.25.0，
目标为 `src/generated/scheduler`。采用 bundled fetch、flat SDK、grouped params、fields response、Zod response validation、
clean output 与 `.js` import；不新增 fetch package。正式生成、固定命中数 exact-optional compatibility normalization 与双生成 byte-identical drift 门已接入 `contract:check:scheduler`。

### 两个窄边界与放置决定

| 边界                     | 目标位置与职责                                                                                                                                 | 依赖与删除项                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Control client           | `src/infrastructure/clients/scheduler/control-client.ts` 终止 generated SDK/Zod，把 ScheduledTask outbox command 映射为 owner Schedule command | delivery 只调用该 client；删除旧资源路由、旧稳定错误码和手写 Scheduler wire type                                                   |
| Webhook contract         | `src/infrastructure/clients/scheduler/webhook-contract.ts` 终止 generated producer webhook schema，输出本地已验证 dispatch input               | `src/http/routes/scheduler.ts` 只做认证/解码/协调；删除旧 job header、compact occurrence 和自行拼接幂等 key                        |
| Durable receiver receipt | 专用 application port 与 `src/infrastructure/postgres/scheduler-dispatch-receipt-repository.ts`                                                | 复用本仓 receipt 表而非通用 mutation claim/release；经 `BffBusinessStore` 与 `repositories.ts` 装配；不直接访问 Scheduler/Agent DB |

复用现有 owner client、postgres、port 目录优于新增一级 Scheduler 模块；尚未做 feature-first 全仓重组，不借本切片搬目录。
vendor/manifest 优于 Root 可编辑 contract 中心；producer webhook 不复制进 BFF public OpenAPI。generated 类型只在上表前两个
边界内部使用，禁止 application/domain import，也不从 sibling 源码 import。BFF-specific payload 是 BFF 的业务映射，
不是第二份 producer event schema。hey-api 的 webhook TypeScript request type 当前未覆盖 headers；receiver 使用
`zDispatchScheduleOccurrencePostWebhookRequest` 的生成 Zod schema（类型由 Zod 推导），不手写替代 owner headers。
隔离临时目录生成已核实 opaque body 为 `z.record(z.string(), z.unknown())`；该生成 validator 用于 acceptance，但 Zod transform
可能删除顶层特殊键，因此 receiver 在 acceptance 后保留原始 parsed JSON 作为 digest/本地映射事实，并递归验证 finite JSON。
receiver 继续单独验证 BFF payload，不把 opaque body 当成已通过业务授权。该可生成性检查不是正式 runtime/drift 验收。

Control client 从受信 command tenant 构造身份，消费 `createSchedule` / `replaceSchedule` / `deleteSchedule`；
register 的 `409 schedule_already_exists` 才转 replace，replace 的 `404 schedule_not_found` 才转 create，
delete 的同码 404 视为已删除。每次 method/path/body 重放沿用稳定 command key；不按 message 或任意 409/404 推断成功。
每次网络尝试有 timeout/响应大小限制；response stream 逐块计数，超过 hard cap 立即 cancel reader 并 abort 请求，
不在 `arrayBuffer()` 完成后才判断。retry 由现有 bounded outbox 管理，不在 generated client 隐式无限重试。
日/周规则使用 ScheduledTask 本地 `time` + IANA `timezone`；周日由 `nextRunAt` 在该 timezone 下的日期确定，
交给 Scheduler 处理后续时区/DST 触发，不继续把当前 UTC hour 固化为全年周期。稳定 schedule name 保持 BFF task 映射；
旧 `buildSchedulerJob` 的 UTC cron 与无顶层 timezone 的输出是待替换现状，不是目标契约。

### Receiver 执行与故障恢复

精确身份、digest、状态码见 [API_CONTRACT](./API_CONTRACT.md#scheduler-control-and-event-dependency)，数据/CAS 见
[DATA_MODEL](./DATA_MODEL.md#scheduler-receiver-receipt-design)。流程为：

```text
authenticate Scheduler -> generated webhook + local payload validation -> tenant integrity check
  -> semantic digest + deterministic occurrence identity
  -> durable key/digest claim (or conflict / terminal replay / retryable busy)
  -> first admission: validate tenant-scoped stored task + owner, persist immutable launch snapshot
  -> Agent call outside DB transaction, replay same snapshot after response-unknown
  -> fenced durable terminal receipt -> HTTP acknowledgement
```

Run identity 固定为 `run_bff_` + SHA-256(UTF-8 JSON.stringify([trustedTenant, scheduleName, canonicalOccurrence]))；
数组编码避免分隔符歧义，不依赖 actor、request ID、body 或 opaque key。Agent launch adapter 接受此稳定 occurrence identity，
message/assertion identity 同步派生；鉴权仍核对 stored task owner，不能用稳定 ID 替代权限校验。首次 admission 的 actor、
内容、project、session、Run/message IDs 与 Agent request body 保存在 durable snapshot；恢复使用原 snapshot，
不按后来修改的 task 或新 request ID 重造 launch。新 receipt 的 admission 仍校验任务 active/expiry/owner；
已提交 terminal 重放不重新执行，已经授权并冻结的 response-unknown 操作继续解析原结果，不变成一次新的任务执行。

外部 HTTP 请求允许重复，Agent Run 事实不得重复；网络调用次数不等于 Run 数量。Agent 接纳后、BFF receipt 落盘前崩溃，
下一次 reclaim 重发同一 Run identity 和 snapshot；禁止创建替代 Run ID。端到端唯一 Run 依赖 Agent durable admission
幂等返回原 Run，这是待后续 Agent-owner closure（W4）验证的依赖，不是本波已证明的事实，也不是跨服务原子事务或 memory Map 的保证。
W0B-9 证明 BFF 真实 PostgreSQL receipt/CAS、BFF 重启恢复与稳定输出；W0B-10 使用真实 Scheduler + BFF + Agent receipt stub，
证明响应丢失后，仅 BFF 重启恢复并接收保持运行的 Scheduler 重试；不重启 Scheduler。
真实 Agent admission、同 Run 参数冲突和 Agent 重启后的唯一 Run 事实属于 W4，
`EDGE-BFF-AGENT` 保持 broken；stub receipt/HTTP 调用计数不证明真实 Agent 的持久幂等，不据此扩大本波范围。
Agent 返回与期望 Run 不同、响应非法或结果未知时保留原 receipt，返回可重试
网关错误；不要把网络断开当作“Agent 未执行”。5xx 不删除 key/digest；stale worker finalize/release 被 token 拒绝。

receipt CAS 先 `FOR UPDATE` 锁定 row，再读取 PostgreSQL `clock_timestamp()`；事务开始时冻结的 `CURRENT_TIMESTAMP` 不参与
锁等待后的 eligibility/deadline。claim 与 prepare 返回数据库观察到的剩余 lease，route 用 monotonic elapsed 消耗它，
并在 Agent I/O 前扣除固定 settlement reserve；即使普通 upstream timeout 配置超过 60 秒，也只把专用剩余预算传给 transport。
预算已过期/耗尽或 stale prepare 零行时不开始 Agent 网络请求，普通 Chat adapter 不走此分支。

Scheduler 采用有界重试；receiver 活跃 lease 返回 425，不返回会被 producer 当永久失败的 409。超时 receipt 可有界 reclaim，
失败持久化 retryable 状态而不是永远 in-progress。若 producer 重试预算耗尽，需要运维按同一原始 occurrence/key 重投并审计，
本切片不声称已有自动 reconciliation worker。缺少 durable store fail closed，绝不退回进程内 receipt。
