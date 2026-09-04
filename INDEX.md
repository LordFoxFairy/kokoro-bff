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
├── contracts/                     # 当前手写 transport DTO；尚未由 OpenAPI 生成
├── application/                   # use case service、输入解析、port、projection mapper
├── infrastructure/
│   ├── clients/                   # Agent、Scheduler、Mori 等出站边界
│   ├── postgres/                  # BFF-owned Project/ScheduledTask/receipt repository
│   └── mock/                      # 当前仍编入生产源码的 fixture；目标是移到 test
├── interfaces/http/agui/          # Agent fact → AG-UI 与 SSE 编码
├── http/routes/                   # 当前 HTTP route handlers
├── config.ts                      # 当前配置解析；目标目录 `src/config/` 尚未形成
└── main.ts                        # composition root
```

Root 标准要求的 `src/domain/`、`src/config/`、`src/bootstrap/` 尚未落地；这属于运行时重构缺口，不能通过
文档目录伪造完成。

## 本仓事实

当前 PostgreSQL 只保存 Project、instruction revision、project skill、project task、ScheduledTask 和
idempotency receipt。Conversation、Message、Share、durable AG-UI ledger 与 outbox 尚无 BFF 表。
完整表清单见 [`docs/DATA_MODEL.md`](./docs/DATA_MODEL.md)。

## Public API 与 owner adapter

- Public API：[`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md)
- 资源说明：[`docs/api/README.md`](./docs/api/README.md)
- AG-UI：[`docs/api/v1/agui-chat.md`](./docs/api/v1/agui-chat.md)
- System / Model / Billing / Capability / Storage：当前由 `src/http/routes/owner.ts` 投影
- Agent Chat：当前由 `src/http/routes/agent.ts` 调用 Agent HTTP ingress 并即时投影 AG-UI
- Scheduler：当前由 `src/http/routes/scheduler.ts` 注册、对账和处理 dispatch
- Mori：当前由 `src/infrastructure/clients/mori/owner-route.ts` 投影独立 Music owner

## 测试与治理

| 路径 | 覆盖 |
| --- | --- |
| [`test/architecture.test.ts`](./test/architecture.test.ts) | 目录、依赖和文档事实门禁 |
| [`test/contract-governance.test.mjs`](./test/contract-governance.test.mjs) | OpenAPI metadata 与冻结 operation surface |
| [`test/business-store.integration.mjs`](./test/business-store.integration.mjs) | 真实 PostgreSQL/Redis business store |
| [`scripts/check-contract.mjs`](./scripts/check-contract.mjs) | 本仓 contract gate |
| [`scripts/lint-source.mjs`](./scripts/lint-source.mjs) | 当前静态源码规则 |
