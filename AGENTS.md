# kokoro-bff Agent 工程规则

## 权威与阅读顺序

在 Kokoro Root 工作区中，本文件服从 `../AGENTS.md`。修改前依次阅读：

1. `README.md` 与 `INDEX.md`；
2. `docs/CURRENT.md`；
3. `docs/TECHNICAL_DESIGN.md`、`docs/API_CONTRACT.md`、`docs/DATA_MODEL.md`；
4. `contract/README.md` 与 `contract/openapi/v1/openapi.yaml`；
5. 与变更相关的测试、运行时源码和 `database/schema.sql`。

历史报告和目标设计不能覆盖当前代码、canonical contract 与 canonical schema 的可验证事实。

## Owner 与依赖边界

- `kokoro-bff` 是 Kokoro 唯一 public HTTP Product API owner，拥有 Conversation、Message、Share、Project、
  ScheduledTask 与 durable AG-UI public projection 的目标边界。
- 当前已经持久化的事实与缺口以 `docs/CURRENT.md` 为准；不得把已接受但尚未实现的 durable AG-UI ledger、
  outbox 或 Chat PostgreSQL ownership 写成现状。
- Browser 只访问 `kokoro` 的同源 adapter；调用方向固定为 Browser → Web adapter → BFF → owner API / Agent /
  Scheduler。
- BFF 不读取其他仓库的数据库、Redis 或源码；跨仓字段只通过 owner 的固定版本 contract 进入窄 client。
- AG-UI 是 Web 与 BFF 之间唯一 Agent 网络事件协议。Vercel AI SDK 类型只属于 Web 内部视图适配层。

## 变更规则

- 公开协议先改 `contract/openapi/v1/openapi.yaml`、contract tests 与文档，再改实现；禁止在 Root 或 `docs/`
  复制第二份机器 schema。
- OpenAPI 每个 operation 必须声明 `x-kokoro-owner`、`x-kokoro-visibility`、`x-kokoro-stability`、
  `x-kokoro-idempotency`、`x-kokoro-permission`。
- `database/schema.sql` 是唯一 canonical schema；V1 不保留 migration 链，不使用外键。
- PostgreSQL 保存事实；Redis 只用于 cache、stream、queue、lease、限流或协调。本地 BFF 使用 Redis DB 8。
- Domain/Application/Infrastructure/Interfaces 边界、DTO/Domain/Row/Wire 类型必须分离；禁止新增万能 service、
  repository、common 或 utils。
- 生产 `src/` 不新增 Mock/Fake/InMemory；测试替身放 `test/fixtures/` 或 `test/doubles/`。
- 不覆盖协作者未提交文件；只暂存当前任务拥有的路径。

## 完成门禁

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
KOKORO_BFF_POSTGRES_URL=... pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL=... KOKORO_TEST_REDIS_URL=redis://127.0.0.1:6379/8 pnpm test:integration
```

缺少真实 PostgreSQL/Redis fixture 时，integration 是未执行，不得记为通过。完成报告必须列出 commit、实际命令、
结果、未通过项和剩余 owner。
