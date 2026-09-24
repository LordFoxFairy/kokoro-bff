# kokoro-bff data model

## W1C-FIXED-TENANT-BFF-A：固定部署租户不落库

当前 BFF 所有用户事实仍按 IAM admission 的 tenant 与 subject predicate 存取，但入口原先未把受信 tenant 限定到 `KOKORO_TENANT_ID`。本切片在普通 `/v1` 用户 `RequestContext` 建立前比较受信 IAM tenant 与固定部署配置；缺配置或异租户请求均不进入业务 route、body 处理、receipt、SQL、Redis 或 owner I/O。同租户既有个人私有 predicate、事务、outbox 与 AG-UI ledger 不变。IAM 继续唯一拥有 Tenant/Membership/Session，BFF 不持久化固定租户目录或 Team 事实；`database/schema.sql`、索引、缓存 key、retention 和跨 owner 数据边界均零变化。service-only、Scheduler callback 与 browser-private IAM relay 的已有身份/数据路径不经普通用户闸，本片不赋予其新权限。

## W1C-Team-R2：零 Team 持久化边界（实现中，真实组合待验）

Tenant/Membership/Invitation/Role 的 canonical schema、权限与分页快照仅由 IAM owner `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 维护。BFF 的三个只读 Product 投影不修改本仓 `database/schema.sql`，不创建 Team 表、Redis cache、receipt、outbox、共享 ORM 或跨 owner SQL。每次请求在线 admission 后由同一 User Bearer 调用 IAM；BFF 只保留请求生命周期内的验证结果和响应投影。IAM 故障、取消、无权、cursor 不合法或响应超限时不写 BFF 数据；验证使用零写入/零跨 owner SQL 的架构测试与真实 HTTP 负例。旧 Team 直连的删除属于 Web 消费切片，不能通过在 BFF 复制 IAM 数据来完成。

## Owner 与 canonical schema

[`../database/schema.sql`](../database/schema.sql) 是本仓唯一 canonical PostgreSQL schema。BFF 不保存 migration 链，
不使用外键，不允许其他仓库直接读取这些表。关系由 tenant + owner scoped Repository/Application predicate、事务锁和 reconciliation
维护。

## W1C-DB-BFF 固定 owner schema（源码已实现；待 Root 验收）

**当前态（`cd1c2600ea2a6e0716b07628822a49653964675a`）：** canonical SQL 未限定 schema；安装器
要求 `public` 无表，runtime PostgreSQL Pool 默认 search_path。下文“空数据库安装”是此旧当前事实，不能作为
单库多 owner 可运行的证据。

**目标态：** 唯一 canonical DDL 仍为 `database/schema.sql`，所有 BFF 表、索引和约束仅安装于固定
`kokoro_bff`；`KOKORO_BFF_POSTGRES_URL` 显式 `schema=kokoro_bff`，代码对 runtime/installer 连接均固定
`search_path=kokoro_bff`。安装前在事务中取得 BFF owner advisory lock、创建不存在的目标 schema，并只检查
本 schema 的 catalog 对象；其非空即拒绝，其他 schema（包括 `public`）已有表不影响 BFF fresh install。
安装结束只校验目标 schema 与最小 BFF 表/索引存在，失败整体回滚。完整列/类型/默认值/约束/索引的 persisted
catalog drift 尚待独立实现；现有 `schema:check` 是静态 canonical 门，不冒称已覆盖该缺口。重复安装不是 no-op，
旧 public URL 不兼容。BFF repository 继续使用未限定表名但 search_path 不含其他 owner schema；
tenant/subject predicate、BFF 本地事务、retention、Redis DB 8 与跨 owner opaque reference 均不变。
测试 fixture 可用独立临时数据库或自有临时 schema 隔离，不表示应用部署需要多个数据库或角色。
本片不新增表、migration、外键、第二份 DDL 或跨 owner SQL。

## 当前表

| 表                                 | Owner fact                                        | 关键键/查询                                                                                                  | 当前备注                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bff_project`                      | Project fact                                      | `project_id`; tenant + owner + slug 唯一；owner list 排序索引                                                 | `owner_id` 来自可信 subject；list/detail/slug/mutation 均为 tenant + owner scope                                                                                                                                                                  |
| `bff_project_instruction_revision` | instruction revision                              | tenant + project + updated_at                                                                                | `current` 由应用维护                                                                                                                                                                                                                             |
| `bff_project_skill`                | project skill state                               | tenant + project + skill PK                                                                                  | 布尔 enabled 投影                                                                                                                                                                                                                                |
| `bff_project_task`                 | project task projection                           | task id；tenant + project 排序                                                                               | status 有有限 CHECK                                                                                                                                                                                                                              |
| `bff_scheduled_task`               | ScheduledTask definition                          | task id；tenant + owner 用户查询索引；revision                                                               | 用户 list/find/update/delete/retry 均带 owner predicate；内部 Scheduler callback 按 tenant + task 读取 stored owner，是独立服务语义                                                                                                               |
| `bff_scheduled_task_outbox`        | ScheduledTask → Scheduler command                 | outbox id；`tenant_id + task_id + command_type + idempotency_key` 唯一；ready/task index                     | bounded register/replace/delete queue；保存版本化 payload、lineage、lease/fence、attempt/error/terminal state                                                                                                                                    |
| `bff_idempotency_receipt`          | mutation receipt                                  | scope PK                                                                                                     | pending/terminal status 与 JSON response                                                                                                                                                                                                         |
| `bff_conversation`                 | Conversation 产品事实                             | `conversation_id`；tenant + owner + updated_at 稳定列表排序                                                          | active/deleted tombstone；删除不物理清除，保留至 retention cleanup                                                                                                                                                                               |
| `bff_message`                      | Message 产品事实                                  | `message_id`；tenant + conversation + message_seq 唯一                                                       | role/status CHECK；`run_id` 是 Agent opaque reference，不做跨仓关系约束                                                                                                                                                                          |
| `bff_agent_dispatch_outbox`        | Chat → Agent launch command                       | outbox id；`tenant_id + conversation_id + idempotency_key` 唯一；run id 唯一；ready/lease/conversation index | 与两条 Message、expected-run registration 原子提交；保存版本化 payload、lineage、lease/fence、attempt/error/terminal state                                                                                                                       |
| `bff_share`                        | Share 产品事实                                    | `share_id`；tenant + conversation active partial unique                                                      | revoked/expired rows retained；public lookup 只接受未撤销且未过期记录                                                                                                                                                                            |
| `bff_agui_stream`                  | tenant/session public projection + consumer state | `(tenant_id, session_id)` PK                                                                                 | projection version/source watermark；`expected_run_id` 是最新接纳的 run fence，`latest_run_id` 是最近投影的 source run；latest run start retention boundary；subject、due time、lease token/fence、persistent failure count、blocked/error state |
| `bff_agui_source_event`            | 已摄取 Agent source identity                      | tenant/session/owner/event PK；source sequence 唯一                                                          | 保存 SHA-256 digest；包括零 public frame 的未知 source kind                                                                                                                                                                                      |
| `bff_agui_event`                   | append-only public AG-UI frame                    | tenant/session/public sequence PK；cursor 全局唯一；source frame 唯一                                        | 完整 JSON payload 与 opaque cursor                                                                                                                                                                                                               |
| `bff_agui_cursor_tombstone`        | 已回收 public cursor 的有界诊断事实               | tenant/session/cursor PK；expiry index                                                                       | 在 tombstone 窗口内区分 expired 与未知/foreign cursor                                                                                                                                                                                            |

所有当前 repository 查询都显式携带 tenant id；用户资源还携带可信 owner scope。Project、ScheduledTask 与 Conversation 已关闭
同 tenant 跨 subject 的已知访问缺口。跨 owner reference 是 opaque id，不做跨数据库 JOIN。

## W1C-1 浏览器 IAM relay 数据边界（工作树已实现；待 Root 验收）

起始 BFF `6238599667110fbfbc2d5ef3a9d53731f2623cfe` 尚无 `/iam` relay；当前待验工作树只是在 Web 服务身份
校验后传输 IAM 原生协议，不拥有用户、OAuth client、授权码、access/refresh token、issuer Session、consent、
Product Session 或 tenant membership 事实。IAM `6bc9b190c359b8109238626ff689ce9839e858b5` 拥有前六类与
tenant membership；Web 独自拥有 Auth.js Product Session 与其 Redis 协调状态。BFF 继续只拥有本页当前表列出的
Product/AG-UI/Outbox 事实，普通 `/v1` 的 `tenant_id + user_id` 仍来自 IAM 0.2.0 在线 admission。

W1C-1 不修改 `database/schema.sql`、任何 BFF Repository、Redis namespace、receipt/outbox 表、索引或事务。
由 BFF TS 准入策略派生的只读 `contract/iam-relay-policy.json` 是版本化传输 policy artifact，不是持久化模型、
SQL schema 或 IAM session/token 副本；Web 固定消费其 BFF commit/blob digest 不会获得 BFF 数据库读写权。
relay 不为登录、refresh、logout 建 BFF idempotency receipt/cache/session/token 表；不以 `get-session` 响应或浏览器 cookie
创建 BFF `RequestContext`，也不从 query/body/header 自报 tenant/actor。准入拒绝、IAM 错误、timeout、断连与非法
`Location`/`Set-Cookie` 均不写 BFF SQL/Redis、不领取 BFF lease、不创建 Product fact。IAM mutation 成败由 IAM
自身事务/审计负责；跨 IAM/Web Product Session 的 revoke/logout 不是 BFF 分布式事务，BFF 不伪造原子性承诺。

验证用 BFF 数据库表计数/Redis namespace 快照和 owned-process/socket 断言证明上述零写入；真 IAM 登录可改变 IAM 自己
的 fixture Session/consent/token 数据，测试清理只清理本次创建的 IAM fixture，不清空共享资源。API/path/错误策略详见
[API_CONTRACT](API_CONTRACT.md#w1c-1-browser-private-iam-relay-目标尚未实现)；运行时放置与请求生命周期详见
[TECHNICAL_DESIGN](TECHNICAL_DESIGN.md#w1c-1-设计门web-同源-iam-协议-relay目标尚未实现)。

### R2e-IAM-VERIFY-RELAY 数据边界（本仓已实现，待 Root 验收）

IAM `093b76513a9aa71611c65d4f210e279d3227e002` 已发布 `GET /verify-email`，并独占 Better Auth 1.7.3
有期签名 JWT 的签发/校验、用户邮箱已验证幂等事实与审计。起始 BFF `eb1eb2926d08b8a3779898b2c31e604a8585ec8b`
尚未准入 `/iam/verify-email`；本次只把该 GET 加入既有 browser-private relay policy。BFF 不持有 token、
不建立身份或 Product Session，不查询/写入 IAM 数据库，不把 IAM 验证结果投影为本地表或 Redis key。
`callbackURL` raw query 不是 BFF 的业务字段或出站路由，真实 302 `Location` 只按现有受限 Web/issuer 目标校验；
原始 query、token、原生响应 body/Location 均不写日志、receipt、outbox、缓存或业务事实。

本切片对 `database/schema.sql`、所有 BFF 表/索引、事务、Redis namespace、retention/GC 和 fresh install **零变更**。
仅重钉 IAM test-fixture 来源后的 browser-private artifact SHA-256 为
`731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；无新增持久化事实。
准入拒绝、IAM 成功/失败/过期/重复验证、302、超时/取消和恶意 `Location` 均零 BFF SQL/Redis 写入；
IAM 对邮箱已验证事实的幂等更新与审计是 IAM 自己的事务，不能误称为 BFF 的零副作用或跨服务原子事务。
正式首个账号/固定 tenant 的受控 bootstrap 与 Product Session/OIDC client 开通各有 owner，邮件验证只是一环，
不因 relay 增加而推定开通完成。本仓无 SQL/Redis 代码路径；跨仓验收的零写入证据仍应比较 BFF 表与
Redis namespace 前后快照，并由真实 IAM HTTP 证明 JWT 有期及邮箱状态幂等语义；本片不修改 canonical schema。

## W1B 数据边界

### Task 1 本变更：IAM admission 不落库

IAM Session、Membership、Tenant、client 与 bearer credential 都是 IAM owner fact。Task 1 不修改 `database/schema.sql`，
不新增 IAM/session/token/cache/receipt 表，不把 generated wire response 或 Bearer 保存到 PostgreSQL/Redis。每次普通用户请求在线
admit 后只在请求生命周期中保留 `{namespace: tenant_id, userId: user_id}`；取消、拒绝与 IAM 不可用都不得产生业务 row、receipt、
outbox 或 cache entry。Share、runtime manifest 与 Scheduler callback 的独立服务身份同样不写成伪用户事实。

### Task 2 当前实现：Project 与 ScheduledTask 个人 scope

Task 2 只对 fresh-install canonical schema 做 clean-slate 修改，不建立 migration、default owner 或旧数据回填：

| 对象 | 当前 schema / query | 保护的不变量 |
| --- | --- | --- |
| `bff_project` | 新增 `owner_id TEXT NOT NULL`；唯一索引改为 `(tenant_id, owner_id, slug)`；真实 list 排序索引覆盖 `(tenant_id, owner_id, created_at ASC, project_id ASC)` | owner 来自可信 subject，body 不可指定；同 tenant 不同 owner 可复用 slug，且 list/detail/slug/mutation 不互见 |
| Project child facts | revision/skill/task 不机械复制 owner 列 | 每次 read/write 先以 `(tenant_id, owner_id, project_id/id-or-slug)` 锁定或验证父 Project；同一事务维护无 FK 关系完整性 |
| `bff_scheduled_task` | 复用现有 `owner_id`；用户索引/查询 scope 为 `(tenant_id, owner_id, ...)` | list/detail/update/delete/retry 只能命中 owner；create 引用 Project 时在 task + outbox 事务中验证并锁定同 scope Project |
| Chat `project_ref` | 不新增 owner 副本 | 非空 reference 在 Conversation create/message/control/read 路径上解析为同 tenant/owner Project；外部字符串本身不是 authority |

Project Redis list cache `kokoro:bff:projects:${tenant}` 及其 invalidate 分支已删除，不迁移为 owner cache，也不双读旧 key；
PostgreSQL 是唯一 Project truth。Redis 的 readiness、AG-UI publish 与其他既有职责不变。

ScheduledTask 用户 create 的稳定 `task_id` 以无歧义 JSON 数组包含 `tenant + trusted subject + canonical path + Idempotency-Key`；
同 key replay 和 outbox lookup 不得跨 owner 命中。`bff_scheduled_task_outbox.actor_id` 继续保存首次可信 actor lineage，payload owner
必须和 task row 一致。Scheduler callback 所需 `findRecord(tenant, task)` 是明确的内部查询：它只从已存 row 恢复 owner，不能作为
用户 repository API。它与 `scheduler-dispatch:v1` 的 tenant + opaque key receipt scope、occurrence digest 和 snapshot/CAS 不混用。

Conversation/Message/Share 使用既有 owner facts，本片未新增 ACL 表。Task 2 已在通用 mutation receipt replay 和 Agent I/O 之前做
Conversation owner gate，因此其他用户的 cancel/resume/steer 不会命中旧 receipt 或创建 owner call。Share row 只授权其现有只读
Conversation projection；撤销、过期或 tombstone 后拒绝，且不授权 Run control、event stream、Project 或未分享文件。

### AG-UI 不变量

W1D-Chat-B2 目标态不增加表、列或跨 owner SQL。`bff_agent_dispatch_outbox` 持有
`(tenant_id, conversation_id, run_id, subject_id, assistant_message_id)` 的本地绑定，
`bff_agui_stream.expected_run_id` 持有当前 run fence；在同一 stream row lock/version/lease
事务内才可把已验证 Agent source 的 delta、completed、failed/cancel 意图写回对应
`bff_message`。只按 source 自报 `chat_message_id`、`segment_id` 或 `run_id` 不授予更新权。
update 必须同时匹配 BFF Message 的 tenant、conversation、assistant ID、run、role、可变状态，
以及 active Conversation owner；旧 run 和永久投递失败 row 不覆写。source identity/frames、
assistant body/status、projection state/high-watermark 同提交；重复 source 不重复追加 delta。
当前 run 的 active Conversation 若 UPDATE 影响 0 行，必须检查 outbox、subject、assistant ID 与
Message row；缺损则回滚整个 source commit，不允许只推进 ledger。deleted Conversation、failed
outbox、已终态 Message，以及无产品 Conversation 的历史 AG-UI scope 可合法跳过。
Message 仍是一 run 一条业务 row，多段 assistant 以最后一段正文为快照，工具和未知 source
不写 Message；仅对 Agent 实际发布的 source 保证，Agent owner main
`520ec181a101298b4f336aad273ce003b2735955` 已发布空 completed source。
Snapshot 以倒序截取最新 100 条 Message，再稳定升序呈现；读取以单连接
只读 repeatable-read 同时观察 Conversation、Message、
AG-UI cursor，不接受已更新正文与旧 watermark 的混合视图。

1. `(tenant_id, session_id)` 是 sequence allocator、projection state 与查询的最小 scope；只凭 session id 或 cursor 不读取。
2. `public_sequence` 从 1 单调递增，事务持有 stream row lock 并校验 `version`；它只在服务端排序，不进入 public wire。
3. 每个 frame 的 `cursor` 是持久化随机 `agui_*` token。全局唯一约束防碰撞，tenant/session predicate 防止 token 成为
   authority。
4. 同一 source event 的全部 frames、source identity、projection state 和 high-watermark 在一个 PostgreSQL 事务提交。
5. `(source_owner, source_event_id)` 与 `(source_owner, source_sequence)` 在 tenant/session scope 内分别唯一；identity
   重用或 digest 冲突 fail closed，不覆盖历史 payload。
6. 一个 source event 可以产生 0、1 或多个 public frame。0 frame 仍登记并推进 source watermark；多个 frame 各有
   cursor，保证中间断线后的 strictly-after replay 无损。
7. 表之间不设外键；同一事务与 repository 不变量维护映射完整性。
8. consumer 使用 `FOR UPDATE SKIP LOCKED` 领取 scope，claim 递增 `consumer_fence`；projection commit 与 settlement
   同时匹配 owner/token/fence/未过期 lease，旧 worker 不得推进 watermark。`consumer_failure_count` 在 retryable/blocked
   settlement 时递增、成功 poll 时清零，为跨 worker 的 capped exponential backoff 提供持久依据。lease 到期与 deadline
   由 PostgreSQL 时钟判断；claim 返回数据库计算的剩余 lease budget，进程内只用 monotonic clock 消耗该预算，worker
   wall clock 不参与 lease 有效性判断。注册不同 `expected_run_id` 会递增 version/fence、撤销旧 lease并清除旧
   terminal；`latest_run_id` 仅记录最近投影的 source run，只有 expected run 的终态可以关闭 public stream。持久化
   message/tool projection key 带 run identity，终态只清理所属 run。
9. GC 保留从最新 `RUN_STARTED` 到当前 head 的完整 run slice，只删除 `latest_run_start_sequence` 之前且超过
   retention 的旧 run frame；没有可靠 run boundary，或 suffix 中存在找不到同 run `RUN_STARTED` 的交错 frame 时跳过
   该 stream。旧 frame 删除前先写 cursor tombstone，再推进
   `retention_floor_sequence`。已知被回收 cursor 在 tombstone retention 内返回 `410 event_cursor_expired`，tombstone
   到期后不泄漏历史 scope。

### ScheduledTask 与 bounded outbox 不变量

1. `bff_scheduled_task` 的 `tenant_id` 是每个 public read/write 的必需范围；当前普通用户路径还带
   `owner_id = trusted subject`，只有显式 Scheduler callback 内部查询可以按 tenant + task 恢复已存 owner。`time` 是本地
   wall-clock rule，`timezone` 必须是 IANA 名称，`next_run_at`/`expires_at` 是 UTC instant，数据库精度固定为
   `TIMESTAMPTZ(3)`。
2. 每次 create/update/delete/retry 在一个本地 PostgreSQL 事务内同时写 task fact（含递增 `revision`）和一个明确的
   Scheduler command；删除先写 delete command，再删除 fact。没有跨仓 FK/数据库 JOIN。
3. outbox 只属于 ScheduledTask，不是万能队列。`command_type` 仅允许 `scheduler.register|replace|delete`；同一
   `(tenant_id, task_id, command_type, idempotency_key)` 只允许一个业务 command，payload 的 command、task、revision
   和 lineage 必须与列一致。
4. payload 在 JSONB 中使用 `snake_case` RFC 3339 UTC 字符串；进入 domain/application/adapter 后转换为 UTC `Date`。
   Agent 自有 event 的 epoch-millisecond 编码属于另一个 wire boundary，本切片不重定义它。
5. dispatcher 只在 `pending`、到期 `retryable` 或 lease 已过期时 claim；`FOR UPDATE SKIP LOCKED` 分配
   `lease_owner`、`lease_token` 和递增 `fence`。settlement 必须匹配三者，防止旧 worker 覆盖新 lease。
6. `2xx -> succeeded`；明确瞬时错误进入 `retryable` 并指数退避；永久错误或超过 attempt budget 进入 `failed`。外部
   Scheduler 投递是 at-least-once，使用稳定 command idempotency key。

## 当前不存在的目标事实

Project side effect、mutation receipt claim 与 aggregate/outbox 的统一事务、outbox retention 和后台业务
reconciliation 尚未完成；这些不属于本切片。ScheduledTask → Scheduler、Chat → Agent bounded outbox 与 AG-UI source
consumer/GC 已是当前 schema 事实。

当前没有独立 Chat assistant reconciliation worker、durable command receipt resource、version/ETag 或 delivery
projection 表。Conversation、Message、Share 已由 BFF PostgreSQL 拥有；Agent HTTP ingress 负责 launch/control，独立
projector 的窄 source reader 只读取 execution events，不直接充当 Chat 产品事实读取源。

### Chat 产品事实不变量

W1D-Chat-B1 目标态在现有 canonical 表上实现隐式首次创建，不新增 schema。仅首发 POST 且
`conversation_id` 为合法 `conv_<UUID>` 时，`bff_conversation` 的缺失主键可在 Chat turn 本地事务
插入，`tenant_id`/`owner_id` 来自可信 admission，`project_ref` 必须在同事务先由本仓 Project 的
tenant + owner 行验证。标题由首条消息内容确定性截取至最多 24 个 Unicode code point
（截断加省略号）；空内容在入口拒绝。全局主键冲突时 `ON CONFLICT DO NOTHING`，随后
tenant + owner + active 条件锁定；foreign/deleted row 不覆盖、不复活，也不插入消息或 outbox。
新 Conversation、user/pending assistant Message、Agent outbox、AG-UI expected-run registration
在同一 PG 事务提交或回滚；同 ID 并发等待主键并在行锁内执行原有 digest/key 去重。

1. 所有 Conversation/Message/Share repository 查询都带 `tenant_id`；用户 Conversation/Message 还带 `owner_id`。跨 tenant
   或跨 owner 的 id/cursor 不返回有效事实。起始 `c5e9b3c` 的 `project_ref` 只被当作 Conversation filter；当前非空值必须先
   通过同 tenant/owner Project predicate，不能仅凭字符串匹配获得关联访问。
2. Chat admission 与 Conversation lock 在同一事务中执行，锁顺序固定为 Conversation → idempotency lookup → message
   sequence allocation → user/assistant Message insert → Agent outbox insert → expected-run registration → Conversation
   updated_at；没有数据库级跨仓关系约束。
3. Conversation delete 先更新 active row 为 deleted tombstone，再在同一事务撤销 active shares；Message rows 保留用于
   retention/audit cleanup，公开列表与详情只看 active conversation。
4. Share 的 partial unique index 只限制 `revoked_at IS NULL`。创建 share 时在持有 Conversation lock 的事务中先将已过期且
   未撤销的 share 标记 revoked，再创建 replacement，因此过期 share 不会阻塞新 share；retention job 后续清理历史 rows。
5. Conversation 与 Message 列表使用 `(updated_at, id)` / `(created_at, message_seq, message_id)` 稳定排序，cursor 是带前缀的
   base64url opaque token；时间在 application/domain 使用 UTC `Date`，数据库使用 `TIMESTAMPTZ(3)`。
6. Agent outbox 只在 `pending`、到期 `retryable` 或 lease 已过期时 claim；同一 conversation 按创建顺序投递。
   settlement 必须匹配 tenant、owner、token、fence 和未过期 lease；永久失败会原子标记对应 assistant Message failed。

## 时间、约束与命名

所有数据库瞬时点统一使用 `TIMESTAMPTZ(3)` + `CURRENT_TIMESTAMP(3)`，API 为 RFC 3339 UTC。AG-UI 与 ScheduledTask/outbox
表使用毫秒精度和 `pk_`/`uq_`/`ck_` constraint 名；部分既有 index/CHECK 尚未按 Root 规范命名。这是剩余 schema 治理
缺口，不把时间精度合规扩大为其它命名重构。

`NULL` 当前用于可选 instruction/project/expiry 等语义。Event/ledger 一旦落地应 append-only，不机械添加
`updated_at`；同一毫秒顺序使用 public sequence 作为第二排序键。

## Redis

BFF 本地逻辑库固定为 Redis DB 8。当前代码执行 readiness `PING` 与 AG-UI projection
更新 `PUBLISH`。AG-UI 不写 Redis key/stream；publish 是可丢失提示，失败不回滚 PostgreSQL。Redis 不保存 canonical
Project/ScheduledTask/receipt/outbox，也不是公开 AG-UI replay 事实源；丢失后 Scheduler/Agent dispatcher 从 PostgreSQL
继续 claim，AG-UI replay 仍从 PostgreSQL 恢复。

## 安装与 drift

安装器只在空 `kokoro_bff` owner schema 安装当前 canonical SQL；同库其他 schema 可已有对象：

```bash
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
```

`CREATE TABLE IF NOT EXISTS` 属于 canonical SQL，但安装器在 owner schema 非空时先拒绝重复安装，不能用它修复 drift。
发布验收仍需要 schema naming /
无外键/UTC 检查和真实 repository integration；生产升级策略在 V1 clean-slate 阶段尚未定义为历史 migration 链。

## Retention 状态与缺口

AG-UI frame retention、最新 run boundary 保护、retention floor 与 cursor tombstone 已由后台 GC 实现，并有真实
PostgreSQL integration 覆盖。source identity rows 当前作为投影审计事实长期保留，不与 frame 同步删除。仍未声明 receipt TTL/归档、
Project 删除清理、ScheduledTask tombstone、ScheduledTask outbox 归档和 source identity 的最终保留周期；这些策略必须先
进入 contract/SLO/runbook 与恢复测试，不能用临时 SQL 直接清表。

## System projection data boundary

System runtime manifest 和 model catalog 均为只读 owner projection，不写入 BFF PostgreSQL，也不新增
表、缓存事实或 schema。BFF 只在请求生命周期内验证并转换 System wire data；System 仍是这些事实的唯一 writer。

## Storage projection data boundary

BFF 当前不保存 Library、Asset 或 Artifact 表，也不保存 Storage cursor、缓存、receipt 或 outbox；Storage 仍是对象与
文件生命周期事实的唯一 writer。当前 `GET /v1/library` 的 503 degraded response 不访问 PostgreSQL、Redis、Object
Store 或 Storage network endpoint，不形成可恢复的业务事实。

本切片不修改 `database/schema.sql`，不新增 migration、索引、Redis namespace 或跨 owner foreign key。未来 W2 若需
durable BFF projection，必须先重新通过 owner、API、事务、retention 与 canonical schema 设计门。

## Capability projection data boundary

Capability Skill、Skill Pool、Skill Catalog 与 MCP server 是 Capability owner fact，不是 BFF 持久化事实。该 consumer
不新增 Capability 表、缓存事实或 schema，不读取 Capability 数据库/Redis，不建立跨仓 foreign key，也不把 owner
cursor、响应或 generated wire type 写入 BFF PostgreSQL。列表 GET 在单次请求生命周期内完成校验、owner HTTP read 与
public projection，没有 BFF 数据库事务、outbox、幂等 receipt、retention 或 GC。
本设计切片不修改 [`../database/schema.sql`](../database/schema.sql)；其基线 SHA-256 为
`8dcb1b3194ed4d4c50c42cdb9a199fec5e253793dd3ca062e92094ab68436da1`。fresh install、现有查询/index、tenant predicate
与删除策略均保持不变。若 Capability projection 后续需要本地 durable fact，必须重新通过 owner、API 与 canonical
schema 设计门，不能把 client cache 升格为事实源。

## Scheduler receiver receipt design

**W0B-9 已实现专用 repository 与下述 CAS。** 无 schema 变更：复用现有
`bff_idempotency_receipt(scope TEXT PRIMARY KEY, fingerprint TEXT, status INTEGER, response_body JSONB, created_at TIMESTAMPTZ(3))`。
本切片不改 canonical schema，SHA-256 仍为 `8dcb1b3194ed4d4c50c42cdb9a199fec5e253793dd3ca062e92094ab68436da1`。
不新增 Schedule/Occurrence/Agent Run 表、不跨 owner SQL、不把 Redis 变成 receipt 真相源。

当前通用 `claimReceipt` 在 pending 60 秒后允许不同 fingerprint 覆盖原值；通用 `commitReceipt` 遇 5xx 或落盘失败会
release/delete pending。scope 还包含 actor。因此直接复用通用 mutation 流程不能满足本 receiver 的永久 digest 绑定与恢复。
选择专用 Scheduler receipt port/repository，保留其他 public mutation 行为；通过 BffBusinessStore 暴露 `schedulerDispatchReceipts`，
在 `src/infrastructure/postgres/repositories.ts` 复用同一个 pool 装配，不另建数据库连接或后台进程。

### 存储与状态机

- scope 是 API_CONTRACT 定义的三元 JSON tuple；tenant 在每个操作的 scope 中强制提供，不能由 body actor 拼出新 scope。
  scope PK 提供同 key 并发唯一性；fingerprint 保存完整 semantic SHA-256，接纳后永不改写。
  opaque key 以 JSON 字符串无损保存；canonical nano occurrence 保存在 JSONB snapshot 字符串，不放入毫秒 timestamp 列。
- status=102 仅作内部未终态标记。response_body 是版本化本地存储 envelope，不是 owner wire schema：
  `schema_version=1`、`state=pending|retryable|terminal`、`claim_token`、`lease_until`、`retry_at`、`snapshot`、
  `last_error_code` 与 terminal `response`。snapshot 在 admission 前可为空；首次通过存储任务鉴权后、任何 Agent I/O 前，
  原子保存 trusted tenant/schedule/occurrence/opaque key、actor、完整 Agent launch 参数和确定性 Run/message/assertion IDs。
  snapshot 一经保存不可改写。终态 status 为实际 HTTP status，response 只保存可重放 status/body，不把内部 token/snapshot 返回 caller。
- 首次 claim 插入固定 digest；冲突先读并比较 digest，不因 age/state 改变规则。匹配且 terminal 则 replay；活跃 pending 返回 425。
  retryable 到期或 pending lease 过期时，只在同 digest 上原子更新随机 `claim_token` 与 lease，保留 snapshot 和所有身份。
  lease 固定 60 秒；row lock 获取后以 `clock_timestamp()` 计算新 lease/判断 deadline，禁止使用事务开始时冻结的
  `CURRENT_TIMESTAMP` 发出已过期 claim。claim/prepare 返回数据库当时的剩余毫秒，单次 Agent I/O 从该预算扣除 monotonic elapsed
  与固定 settlement reserve；worker 不延长旧 token，普通全局 upstream timeout 不能越过专用预算。
- prepare snapshot、finalize、release-to-retryable 均匹配 scope + fingerprint + claim_token + 未终态 + 未过期 lease；检查受影响行数。
  旧 worker 零行更新即失去 claim，不返回自认成功，不覆盖新 token。release 只清 lease/设 retryable 与 retry_at，不删除 receipt。
  普通瞬时失败设有限退避；进程在 release 前崩溃仍可在 lease 到期后 reclaim。created_at 保留首次接纳时刻，lease 使用 JSONB 内的
  UTC 毫秒字段，由 SQL 参数化表达式/数据库时间计算；不依赖 created_at 重置模拟 fencing。
- 单次本地事务只覆盖 claim 或 snapshot/settlement；远端 Agent 调用不持数据库锁，不承诺 BFF/Agent 原子提交。
  首次 snapshot 验证必须保留 tenant/task/owner 检查；同一 snapshot 的恢复重发原 launch（包括原 Agent request ID），
  不能随当前 task revision、actor 或 request ID 改写已经可能接纳的 Run。prepare/CAS 失败时禁止开始 Agent I/O。
  snapshot 只保存该命令必需信息，不保存 bearer token；日志不输出 payload、凭据或整份 snapshot。
- Agent 成功但 BFF finalize 失败时保留原 key/digest/snapshot，BFF 重启后以相同 Run identity 重试。端到端 Run 事实唯一依赖
  Agent durable admission；真实 Agent 的保证待 Agent-owner closure（W4）验证，本波只验证 BFF receipt 与稳定输出。
  暂时依赖失败返回可重试状态；明确业务失败写 terminal response。活跃 pending、retryable、terminal 均拒绝不同 digest。
  非 JSONB envelope 版本、损坏 snapshot 或冲突 Agent receipt 均 fail closed 并记录，不静默清空重建。

### 查询、保留与验证边界

只有按完整 scope PK 的 claim/replay/CAS 查询，不做全表扫描，因此不新增索引。既有 schema 的 JSONB/status 容纳专用存储 envelope，
不改变表 owner/列类型/约束/fresh install；该存储格式由专用 repository 验证。scope 的协议 namespace 与通用 public mutation
五元 scope 不相交，通用 release 不触及本 receiver 的行。无物理删除、软删或 TTL：在另行批准 retention/replay 上限与恢复策略前，
Scheduler receipt 持续保留，不用 cache TTL 或 Scheduler 重试预算到期清除 digest。失败/重试状态亦保留供同身份恢复和审计。

W0B-9 已增加真实 PostgreSQL repository 测试：并发同 key、不同 digest、过期 reclaim、短 row-lock 等待后新 lease 的剩余期限，
等待中到期的 prepare/finalize/release 拒绝、stale token、retryable、tenant 隔离及稳定 snapshot。另有真实 PostgreSQL + BFF HTTP
以及 Agent stub 测试：Agent 接纳后 finalize 失败，关闭/重建 BFF 后在数据库 task 与 transport request ID 已变化时，同 key 仍重发
首次完整 snapshot 与同一 Run identity；并通过真实 stale prepare CAS 证明零 Agent I/O。这里的 stub 只证明 BFF HTTP/PG 恢复，
不证明真实 Agent durable admission 或唯一 Run 事实。
W0B-10 使用真实 Scheduler + BFF 进程及 Agent receipt stub：响应丢失后，仅 BFF 重启恢复并接收保持运行的 Scheduler 重试；
不重启 Scheduler。分别记录 HTTP attempts、
稳定 Run ID 与 stub receipt 数量，不把 stub 计数写成真实 Agent Run facts。真实 Agent admission、同 Run 参数冲突、Agent 重启后
唯一 Run 事实归 Agent-owner closure（W4），`EDGE-BFF-AGENT` 保持 broken，不增加到本波验收范围。
不能将 memory double、文档正则检查或 build 成功称作真实 PostgreSQL 或 Agent 的持久恢复证据。
本实现切片使用任务独占 PostgreSQL 完成 fresh install、非空拒绝与真实 receipt integration；Redis 仅复用 DB 8 且不作为 receipt 真相源。
