# kokoro-bff 技术设计

## 1. Owner 与系统位置

```text
Browser
  -> kokoro same-origin /api/* adapter
  -> kokoro-bff public /v1 Product API
  -> IAM / System / Model / Billing / Capability / Storage owner APIs
  -> kokoro-agent run ingress, control and execution history
  -> kokoro-scheduler generic job and occurrence dispatch
```

BFF 是公开 Product API 的唯一 owner；其他仓库只发布自己的 internal-owner contract。BFF 不跨库 JOIN，
不读取 Agent 或 owner Redis，也不复制上游 Domain Model。

**AG-UI 是 Web ↔ BFF 唯一 Agent 网络协议。** Vercel AI SDK 的 `UIMessage` 属于 Web 内部 view adapter，
不得成为第二套网络 envelope 或 resumable stream。

## 2. 当前物理实现

| 区域 | 当前职责 | 已知偏差 |
| --- | --- | --- |
| `src/main.ts` | server composition、通用 auth/body/idempotency 管线、route dispatch | 仍直接装配生产 mock |
| `src/http/routes/` | resource route handlers | 尚未迁入标准 `interfaces/http/` |
| `src/application/` | project/scheduled use case、ports、projection/input mapper | 尚无明确 Domain aggregate 层 |
| `src/infrastructure/postgres/` | BFF-owned repository 与 Redis cache invalidation | receipt 与业务写未共享事务 |
| `src/infrastructure/clients/` | Agent、Scheduler、Mori 窄 adapter；其他 owner 仍集中于 owner route | client 目录尚未对每个 owner 全部分拆 |
| `src/interfaces/http/agui/` | Chat fact → AG-UI projection 与 SSE frame schema check | 投影是即时的，不是 durable ledger |
| `src/contracts/` | 当前手写 Web-facing types/envelope | 尚未由 canonical OpenAPI 生成且未与 Domain 类型彻底分离 |

目标依赖方向是 `interfaces -> application -> domain`，concrete infrastructure 实现 Domain/Application port，
bootstrap 只负责装配。缺少目录时视为待重构，不创建空目录冒充完成。

## 3. 请求与身份管线

1. Web server 解封 session，并向 BFF 发送 `x-kokoro-service: web-bff`、内部 secret、namespace、principal。
2. BFF 校验服务 envelope，生成或沿用 request id；常规业务身份只从受信 header 建立。
3. System runtime manifest 使用服务器配置的 `KOKORO_TENANT_ID` 与 `KOKORO_DOMAIN`；System 自己校验 Site/Host
   binding。
4. BFF 为 owner adapter 构造 allowlisted query/body 和服务身份；浏览器的 Authorization、Host、X-Domain、
   X-Forwarded-* 不作为 owner authority。
5. 响应在边界映射为 snake_case `{data, meta}` 或 `{error, meta}`。

当前 BFF 不执行完整 IAM admission；它信任持有共享 secret 的 Web adapter 提供 namespace/principal。将 IAM
admission 固定在 BFF 还是 Web 的职责需要后续 contract-first 决策与实现，当前文档不声称已经接入 IAM。

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
60 秒后可被回收。当前 digest 只规范化 body，scope 包含 namespace/method/path/key；query、selected headers、
业务写事务与 fencing 尚未覆盖。

## 5. Project 与 ScheduledTask

Project 与 ScheduledTask 是 BFF-owned facts。当前 repository 对每个查询显式携带 tenant id，关系完整性由
Application/Repository 管理，不使用数据库外键。

ScheduledTask 当前流程：

```text
validate input
  -> write/update BFF PostgreSQL fact
  -> synchronously register or replace Scheduler job
  -> on failure mark task failed
  -> startup best-effort reconciliation retries active facts
```

Delete 当前先删除 Scheduler job，再删除 BFF fact。这个流程不是原子跨服务事务；目标是本地事务写 fact + outbox，
由 dispatcher 重试，并以 receipt/event reconciliation 收敛。

## 6. Chat 与 AG-UI

当前 Live 流：

```text
POST message -> Agent /v1/runs admission -> stable BFF receipt
GET events   -> Agent replay(after_seq) -> ChatEvent mapper -> AG-UI schema -> SSE
Last-Event-ID                                            ^ source sequence
```

BFF 当前没有 durable public event table。一个 Agent fact 可展开成多个 AG-UI frame，frame 在内存 projection state
中维持 start/content/end 边界。目标 durable projection 必须在 PostgreSQL 中为每个 tenant/thread 保存单调 public
cursor、完整 AG-UI payload、source identity、retention/GC watermark，并使重连只读取 BFF ledger。

Conversation、Message、Share 的产品事实最终归 BFF；Agent 只拥有 Run、checkpoint、lease、tool journal、执行事件、
HITL 与 evidence。当前 Live session/message history 仍来自 Agent，是明确缺口。

## 7. 出站与失败归一

出站 HTTP 使用整体 timeout、响应大小上限、request id、Forwarded 与服务凭据。当前 transport 不自动重试；调用方
只在具备稳定幂等 identity 时重试。缺配置、不可达、HTTP error 与 schema mismatch 分别映射为稳定错误，且不返回
provider body、SQL 或 stack。

## 8. 启动与关闭

- Mock 是本地确定性 fixture，不需要 PostgreSQL/Redis；它不是生产完成证据。
- Live BFF-owned 路由要求 PostgreSQL + Redis；`/readyz` 检查可用性。
- 启动后异步 reconcile 持久化 ScheduledTask；该过程 best-effort，不阻塞 listen。
- 当前 graceful shutdown 关闭 repository，但尚无完整 in-flight drain、outbox dispatcher drain 或 termination budget。
