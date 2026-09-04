# kokoro-bff acceptance

## 1. 本阶段：文档与契约治理

| ID | Given / When / Then | Evidence |
| --- | --- | --- |
| GOV-01 | Given 本仓 checkout，When 检查文档矩阵，Then README/INDEX/CURRENT/设计/API/数据/安全/可靠性/SLO/Runbook/ADR 均存在 | `pnpm test:architecture` |
| GOV-02 | Given canonical OpenAPI，When 运行 contract gate，Then 全 operation 有五项 metadata 且 Redocly 通过 | `pnpm contract:check` |
| GOV-03 | Given 冻结 v1 surface，When 删除 path/method 或改 operationId，Then breaking baseline 失败 | `node --test test/contract-governance.test.mjs` |
| GOV-04 | Given Root audit，When 检查 BFF slice，Then public-contract、contract-provenance、toolchain 与 useUnknown 门禁不再报错 | Root audit JSON filter |
| GOV-05 | Given 协作者脏文件，When 本阶段提交，Then该文件既未被修改也未进入 commit | `git diff --cached --name-only` + hash |

GOV-01～05 通过本身不表示 runtime、schema、container、CI supply chain 或 production SLO 已完成。

## 2. Phase 2：durable AG-UI projection

| ID | Given / When / Then | Evidence |
| --- | --- | --- |
| AGUI-01 | Given 一个 Agent source fact 展开 START+CONTENT，When 从 START cursor 重连，Then 只重放 CONTENT 且 cursor 不重复 | `test/agui-projection.integration.mjs` |
| AGUI-02 | Given 相同 source identity 被并发/重复摄取，When transaction 竞争，Then 只有一组 source/frame rows 且 public sequence 连续 | `test/agui-projection.integration.mjs` |
| AGUI-03 | Given foreign tenant/session，When 请求 stream 或复用 cursor，Then按缺失 session/invalid cursor fail closed 且不泄漏 frame | projection + HTTP integration |
| AGUI-04 | Given projection state 与终态已提交，When BFF 重启且 Agent disabled，Then opaque cursor 仍从 PostgreSQL strictly-after replay | `test/agui-http.integration.mjs` |
| AGUI-05 | Given Redis DB 8，When 投影提交，Then无 AG-UI 持久 key；Redis 只接收可丢失 publish，PG rows 不受影响 | `test/agui-projection.integration.mjs` + architecture gate |
| AGUI-06 | Given canonical OpenAPI，When contract gate 执行，Then EventCursor 是 opaque string、SSE example 是 AG-UI、400/410/502/503 已声明 | `pnpm contract:check` |
| AGUI-07 | Given fresh database，When apply canonical schema，Then一次建立 stream/source/event/tombstone tables，无 FK | `pnpm db:apply-schema` + schema test |
| AGUI-08 | Given 多 BFF worker，When 同时领取一个 source scope，Then `SKIP LOCKED` + token/fence 只允许当前 lease 提交 | `test/agui-projector.test.mjs` + PG integration |
| AGUI-09 | Given 无浏览器连接，When Agent source 增长，Then独立 projector 仍摄取；HTTP 只读取 ledger | HTTP integration + architecture gate |
| AGUI-10 | Given cursor frame 超过 retention，When GC 与重连，Then只回收最新 `RUN_STARTED` 之前的旧 run、保留最新 run slice、推进 floor，并返回 `410 event_cursor_expired`；没有可靠 run boundary 或 run 交错时跳过回收 | PG integration |
| AGUI-11 | Given source timeout/429/5xx 或永久 4xx，When projector 重试，Then单次 attempt/lease budget 有界、失败计数跨 claim 持久、capped exponential backoff + jitter、成功清零，永久错误 blocked | unit + PG integration |
| AGUI-12 | Given 旧 projector 已读 stream 或新 lease 正在补投旧 run，When 新 `expected_run_id` 注册，Then version/fence 原子递增、旧 lease 失效且任何旧 run 都不能提交 terminal | PG integration |
| AGUI-13 | Given worker wall clock 存在偏移且多个 run 事件交错，When claim/read/settle/release 与 terminal projection，Then PostgreSQL 时钟和 monotonic lease budget 保护有效 lease，且终态只清理所属 run state | unit + PG integration |

Phase 2 不验收跨版本 re-projection、PG backup restore、长时间 fault injection、Agent launch outbox 或 assistant
message reconciliation；这些不能由上述绿测推导为完成。

## 3. 当前 Product API 验收矩阵

| Area | Scenario | 当前状态/期望 |
| --- | --- | --- |
| Auth | Browser 直接携带业务身份调用 | 拒绝；只接受 Web service envelope |
| Project | create/update/list + same-key replay | 当前有 unit/mock 与真实 store integration 用例 |
| Idempotency | 同 digest replay / different digest conflict / pending duplicate | 当前已覆盖；query/header/transaction gap 开放 |
| Owner reads | System/Model/Capability/Storage/Billing | 显式 projection；缺失/坏响应 fail closed |
| Chat admission | BFF → Agent HTTP run receipt | 当前覆盖 |
| AG-UI | Agent fact → fenced background projector → transactional PG ledger → schema-valid SSE + opaque replay | 主动摄取、retention/GC 与 expired cursor 已覆盖 |
| Chat facts | Conversation/Message/Share BFF PostgreSQL ownership | 已实现；Agent launch outbox 与 assistant reconciliation 开放 |
| Scheduled | fact + Scheduler registration/dispatch replay | bounded transactional outbox、lease/fence 与 crash recovery 已覆盖 |
| Tenant isolation | 每个 public route 的跨 tenant negative matrix | 部分覆盖，完整矩阵未完成 |
| Recovery | AG-UI restart/Agent-disabled replay、duplicate ingest、consumer fencing、GC/expired cursor 与 Scheduler outbox recovery 已覆盖；PG restore 仍开放 |

## 4. 必跑命令

无外部 fixture：

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
git diff --check
```

真实基础设施：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL=POSTGRES_URL \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

`POSTGRES_URL` 必须指向本次测试的独立空 database；Redis 复用共享实例的 DB 8。fixture 缺失、连接失败或测试 skip 都不
计为通过。

Root 本仓切片：

```bash
python3 ../scripts/verify-ten-repository-standard.py --format json > /tmp/ten-repository-audit.json || true
python3 - <<'PY'
import json
for item in json.load(open('/tmp/ten-repository-audit.json'))['violations']:
    if item['repository'] == 'kokoro-bff':
        print(f"{item['rule']}: {item['detail']}")
PY
```

Root audit 仍可因本阶段明确不修改的 runtime/schema/delivery 项返回非零；报告必须逐项列出，不能改成假绿。

## 5. 提交验收

- 每个 commit 只 stage 本任务拥有的文件；
- 提交前运行 `git diff --cached --check` 并审阅 `git diff --cached --name-status`；
- 完成报告列出 commit、命令、exit code、integration fixture、Root BFF residual 和协作者文件 hash；
- 只有 P0 runtime、真实基础设施、candidate image 与安全发布门禁都闭环后，才讨论生产就绪。
