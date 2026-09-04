# kokoro-bff acceptance

## 1. 本阶段：文档与契约治理

| ID | Given / When / Then | Evidence |
| --- | --- | --- |
| GOV-01 | Given 本仓 checkout，When 检查文档矩阵，Then README/INDEX/CURRENT/设计/API/数据/安全/可靠性/SLO/Runbook/ADR 均存在 | `pnpm test:architecture` |
| GOV-02 | Given canonical OpenAPI，When 运行 contract gate，Then 全 operation 有五项 metadata 且 Redocly 通过 | `pnpm contract:check` |
| GOV-03 | Given 冻结 v1 surface，When 删除 path/method 或改 operationId，Then breaking baseline 失败 | `node --test test/contract-governance.test.mjs` |
| GOV-04 | Given Root audit，When 检查 BFF slice，Then public-contract、contract-provenance、toolchain 与 useUnknown 门禁不再报错 | Root audit JSON filter |
| GOV-05 | Given 协作者脏文件，When 本阶段提交，Then该文件既未被修改也未进入 commit | `git diff --cached --name-only` + hash |

本阶段通过不表示 runtime、schema、container、CI supply chain 或 production SLO 已完成。

## 2. 当前 Product API 验收矩阵

| Area | Scenario | 当前状态/期望 |
| --- | --- | --- |
| Auth | Browser 直接携带业务身份调用 | 拒绝；只接受 Web service envelope |
| Project | create/update/list + same-key replay | 当前有 unit/mock 与真实 store integration 用例 |
| Idempotency | 同 digest replay / different digest conflict / pending duplicate | 当前已覆盖；query/header/transaction gap 开放 |
| Owner reads | System/Model/Capability/Storage/Billing | 显式 projection；缺失/坏响应 fail closed |
| Chat admission | BFF → Agent HTTP run receipt | 当前覆盖 |
| AG-UI | Agent fact → schema-valid SSE + source cursor replay | 即时投影已覆盖；durable BFF ledger 未完成 |
| Chat facts | Conversation/Message/Share BFF PostgreSQL ownership | 未完成 |
| Scheduled | fact + Scheduler registration/dispatch replay | 当前同步流程有测试；outbox/crash atomicity 未完成 |
| Tenant isolation | 每个 public route 的跨 tenant negative matrix | 部分覆盖，完整矩阵未完成 |
| Recovery | PG/Redis/Agent/Scheduler crash、trim、restart、duplicate effect | 未形成完整 fault suite |

## 3. 必跑命令

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
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:6379/8 \
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

## 4. 提交验收

- 每个 commit 只 stage 本任务拥有的文件；
- 提交前运行 `git diff --cached --check` 并审阅 `git diff --cached --name-status`；
- 完成报告列出 commit、命令、exit code、integration fixture、Root BFF residual 和协作者文件 hash；
- 只有 P0 runtime、真实基础设施、candidate image 与安全发布门禁都闭环后，才讨论生产就绪。
