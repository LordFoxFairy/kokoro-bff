# kokoro-bff 当前实现

状态：2026-09-03
适用范围：当前分支代码、`database/schema.sql` 与 `contract/openapi/v1/openapi.yaml`。历史报告不作当前证据。

## 已实现事实

### 契约治理

- `kokoro-bff` 是唯一 public HTTP Product API owner；canonical OpenAPI 位于
  `contract/openapi/v1/openapi.yaml`。
- 当前 OpenAPI 有 63 个 operation；每个 operation 都声明 owner、visibility、stability、idempotency 和
  permission 元数据。
- `pnpm contract:check` 执行 Redocly、metadata 检查和冻结 v1 path/method/operationId surface 检查。
- AG-UI 是 BFF 对 Web 暴露的 Agent 事件 wire protocol；BFF 使用 `@ag-ui/core` schema 校验输出帧。

### 当前运行时与持久化

- `/v1/*` 校验 `web-bff` 服务身份、共享 secret、namespace、principal 和 request id；浏览器不应直连 BFF。
- Live Project、instruction revision、project skill、project task、ScheduledTask 与 mutation receipt 使用本仓
  PostgreSQL repository。Redis 当前用于 readiness/ping 和 Project cache invalidation，不是事实源。
- Live mutation 仅在 BFF business store 已配置时使用 PostgreSQL receipt；没有 business store 的非 BFF owner
  mutation 仍使用进程内 Map。因此“所有 Live mutation 均持久幂等”不是当前事实。
- 当前 receipt scope 是 `namespace + method + canonical path + Idempotency-Key`；fingerprint 覆盖规范化 body，
  但尚未覆盖 query 与 selected headers。
- Chat Live 路径通过 Agent HTTP ingress 读取 session/message/event execution facts。BFF 将 Agent Chat event
  即时映射为 AG-UI SSE，并使用 Agent source sequence 作为 `Last-Event-ID`。
- Scheduler 变更当前采用同步注册/替换/删除，加启动时 best-effort reconciliation；dispatch receipt 使用稳定
  occurrence idempotency key。
- 缺失上游、非法响应和未接写操作会返回稳定错误，不静默降级到 Live 成功。

## 未完成缺口

### P0：运行时正确性

1. **Durable AG-UI projection 尚未实现。** `database/schema.sql` 没有 AG-UI event ledger、public cursor、
   retention 或 GC 水位。当前 SSE 是对 Agent replay 的即时投影，BFF 重启后依赖 Agent source history。
2. **Conversation / Message / Share 的 BFF 事实 ownership 尚未实现。** 当前 Live session/message/event 数据来自
   Agent；BFF 只拥有公开投影契约，尚未拥有这些产品事实表与 repository。
3. **事务型 outbox 尚未实现。** Project/ScheduledTask 写入、Scheduler 注册和 Agent dispatch 不在一个本地事务
   与 outbox 状态机中；同步失败依靠 `failed` 标记、重试或启动 reconciliation 收敛。
4. **幂等摘要与事务边界不完整。** query、selected headers 未进入 fingerprint；receipt 与业务事实/出站命令
   没有统一事务和 fencing。

### P1：架构与工程门禁

- `src/domain/`、`src/config/`、`src/bootstrap/` 尚未形成；`src/http/` 与 `src/contracts/` 仍是当前物理结构。
- `MockBffStore`、Mori mock 与 mock routes 仍位于生产 `src/` 并编入产物。
- TypeScript 已显式启用 `useUnknownInCatchVariables`；`exactOptionalPropertyTypes`、`noImplicitReturns`、
  `noUnusedLocals`、`noUnusedParameters` 仍因现有源码错误未启用。
- canonical schema 的 `TIMESTAMPTZ(3)`、constraint/index 命名、durable ledger/outbox 和更完整 retention 仍待运行时
  切片处理。
- `ProjectInstructionRevision` 当前仍暴露 `updatedAt`、`actorName` 和 Unix milliseconds；这是已知 wire-naming/
  UTC 违例，需与 runtime mapper、Web consumer 和 OpenAPI 同一切片删除，不能只改文档伪造 snake_case。
- CI 尚未提供真实 PostgreSQL/Redis service gate、fresh-schema 安装、固定 SHA actions 与完整供应链扫描。
- Docker base digest、HEALTHCHECK、SBOM/provenance/signature/vulnerability scan 尚未在本阶段处理。
- 独立 `.env.example` 尚未固定共享 Redis DB 8；现有 local/prod/test 模板需要后续收敛。

## 本阶段闭环边界

本阶段只闭环文档、canonical contract、operation metadata、provenance/breaking policy、
`useUnknownInCatchVariables` 与可执行 architecture/contract gate。它不修改 `src/`、`database/` 或 generated
代码，也不把上述 P0/P1 运行时缺口标记为完成。

## 当前证据命令

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
```

真实基础设施证据必须另外提供：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL=POSTGRES_URL \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:6379/8 \
pnpm test:integration
```

未提供 PostgreSQL/Redis fixture 时，后两项状态是“未执行”，不是“通过”。验收状态见
[`ACCEPTANCE.md`](./ACCEPTANCE.md)。
