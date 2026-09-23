# kokoro-bff repository index

`kokoro-bff` 是 Kokoro 唯一 public HTTP Product API owner。本文是代码与边界地图；当前完成度只看
[`docs/CURRENT.md`](./docs/CURRENT.md)。

## 入口

| 路径 | 职责 |
| --- | --- |
| [`README.md`](./README.md) | 五分钟启动、边界与验证入口 |
| [`docs/INDEX.md`](./docs/INDEX.md) | 当前文档阅读顺序 |
| [`contract/openapi/v1/openapi.yaml`](./contract/openapi/v1/openapi.yaml) | 唯一 canonical public OpenAPI |
| [`contract/README.md`](./contract/README.md) | owner、visibility、version、breaking 与 provenance |
| [`database/schema.sql`](./database/schema.sql) | 本仓唯一 canonical PostgreSQL schema |
| [`src/main.ts`](./src/main.ts) | 当前 HTTP 组合根与请求管线 |
| [`package.json`](./package.json) | 本仓可执行质量门禁 |

## 当前源码地图

```text
src/
├── auth/                          # service + Bearer + pinned IAM session admission；只产出可信 RequestContext
├── bootstrap/                     # production/test composition、HTTP admission 顺序与 worker 生命周期
├── config/                        # 严格 runtime configuration（含 IAM origin）
├── contracts/                     # BFF public transport envelope/projection types
├── domain/                        # BFF-owned policy 与 identity/value objects
├── application/
│   ├── agui/                      # durable projection use case、纯映射与 repository port
│   └── ...                        # Project/ScheduledTask use case、输入解析与 ports
├── infrastructure/
│   ├── clients/                   # Agent、Scheduler、Mori 等出站边界
│   ├── postgres/                  # BFF facts、receipt、AG-UI ledger 与 consumer/GC repositories
├── interfaces/http/agui/          # schema-valid SSE 编码；只输出已持久化 frame
├── http/routes/                   # Product routes；runtime-manifest 是独立 service-only handler
├── generated/iam-http/            # 从完整固定 IAM vendor 过滤单 operation 的只读生成物
└── main.ts                        # composition root
```

## 本仓事实

当前 PostgreSQL 保存 Project、instruction revision、project skill、project task、ScheduledTask、idempotency receipt、
Conversation/Message/Share canonical facts，以及 durable AG-UI stream/source-event/public-frame ledger。
完整表清单见 [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md)。

## Public API 与 owner adapter

- Public API：[`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md)
- IAM admission：`src/auth/`；完整 vendor、生成配置、manifest 与 drift gate 分别位于 `contract/vendor/kokoro-iam/`、
  `openapi-ts.iam.config.ts`、`contract/dependencies/iam-http.json` 与 `scripts/generate-iam-http-client.mjs`
- 资源说明：[`docs/api/README.md`](./docs/api/README.md)
- AG-UI：[`docs/api/v1/agui-chat.md`](./docs/api/v1/agui-chat.md)
- System / Model / Billing / Capability：当前由 `src/http/routes/owner.ts` 投影
- Library：IAM admission 不可用时返回 `503 iam_admission_unavailable`；admission 成功后仍固定返回
  `503 storage_integration_unavailable`，不调用 Storage
- Chat facts：`src/http/routes/chat.ts` 读取/写入 BFF PostgreSQL；`src/infrastructure/postgres/chat-repository.ts` 维护 tenant、锁和 cursor；`chat-turn-service.ts` 与 `agent-dispatch-outbox-repository.ts` 原子提交 Message/Agent command；
- Agent Chat：`src/http/routes/agent.ts` 只承接 durable AG-UI 读取和 run control；Agent launch 由后台 outbox dispatcher 投递；`src/application/agui/` 投影；
  `src/application/agui/projector.ts` 独立消费 Agent source；`agui-projection-repository.ts` 在公开发送前持久化并分配 cursor，
  `agui-consumer-repository.ts` 维护 lease/fence、重试、保留水位与 tombstone GC
- Scheduler：当前由 `src/http/routes/scheduler.ts` 注册、对账和处理 dispatch
- Mori：当前由 `src/infrastructure/clients/mori/owner-route.ts` 投影独立 Music owner

## 测试与治理

| 路径 | 覆盖 |
| --- | --- |
| [`test/architecture.test.ts`](./test/architecture.test.ts) | 目录、依赖和文档事实门禁 |
| [`test/contract-governance.test.mjs`](./test/contract-governance.test.mjs) | OpenAPI metadata 与冻结 operation surface |
| [`test/business-store.integration.mjs`](./test/business-store.integration.mjs) | 真实 PostgreSQL/Redis business store |
| [`test/agui-projection.integration.mjs`](./test/agui-projection.integration.mjs) | ledger、并发幂等、consumer fencing、GC/expired cursor、tenant 隔离、Redis 非事实源 |
| [`test/agui-http.integration.mjs`](./test/agui-http.integration.mjs) | 后台主动摄取、opaque cursor、重启 replay 与 contract error |
| [`scripts/check-contract.mjs`](./scripts/check-contract.mjs) | 本仓 contract gate |
| [`scripts/lint-source.mjs`](./scripts/lint-source.mjs) | 当前静态源码规则 |
