# kokoro-bff repository index

本仓是 Web-facing Product API owner。本文只作当前代码导航；完成度与验收边界见
[当前事实](./docs/CURRENT.md)，历史候选不作为启动、认证或数据清理指引。

## 入口与唯一事实源

| 路径 | 职责 |
| --- | --- |
| [README](./README.md) | 本地启动、服务边界与验证入口 |
| [文档索引](./docs/INDEX.md) | 专项文档阅读顺序 |
| [技术设计](./docs/TECHNICAL_DESIGN.md) | 当前模块、认证边界与有效设计决定 |
| [API 说明](./docs/API_CONTRACT.md) | 人读契约与例外边界 |
| [Public OpenAPI](./contract/openapi/v1/openapi.yaml) | 唯一 canonical public contract，当前 Public 29.0 / 227 operations |
| [契约发行说明](./contract/README.md) | owner、visibility、生成、固定来源及 breaking 规则 |
| [数据模型](./docs/DATA_MODEL.md) | 本 owner 的事实与事务边界 |
| [canonical schema](./database/schema.sql) | 本 owner 唯一可编辑 PostgreSQL schema |
| [组合根](./src/app.module.ts) / [进程入口](./src/main.ts) | Nest 模块装配、启动与退出生命周期 |
| [命令](./package.json) | 本仓真实质量门禁 |

## 当前源码地图

Public29 协作核心正式基线为 `38d47c9`；源码发行不表示正常运行已切换，未完入口及验收边界见 CURRENT。
`ProjectAccessModule`／`project-grants`、Chat 安全投影／冻结 shared context 与 AG-UI 每 subject source cursor 是现有业务模块内的能力；
Agent 固定 HTTP8.18，已有消费者需正规升级29，不能用未知字段容忍替代。
具名数据演进仅见 [`scripts/apply-schema.mjs`](./scripts/apply-schema.mjs) 的 `--evolve-project-collaboration` 与
[`scripts/project-collaboration-schema.mjs`](./scripts/project-collaboration-schema.mjs)；canonical 仍只有 `database/schema.sql`。
该入口已由主控真实隔离 PG 验证固定父演进／拒绝未知及混态／来源矛盾回滚／current noop，测试库已回收；旧正常数据未演进。不恢复通用 migration 链或第二运行框架。


- [`src/modules/`](./src/modules/)：按业务能力装配的 Nest 模块；认证归
  [`src/modules/authentication/`](./src/modules/authentication/)，不存在旧 `src/bootstrap/` 入口。
- [`src/auth/`](./src/auth/)：受信 Web/Admin 服务 envelope、原生 IAM Session Cookie 和 exact Origin 准入。
  普通内部业务使用服务身份＋可信 actor，不转发用户 Cookie、Origin、Session-ref 或人类 Bearer。
  [`public-skill-list-admission.ts`](./src/auth/public-skill-list-admission.ts) 是独立 User API Key/OpenApp 入口，
  不替代网站 Session。本人 Session 生命周期、匿名、服务-only、provider webhook 保持各自具名规则。
- [`src/http/routes/`](./src/http/routes/)：Product 与独立原生认证 relay 传输；
  [`src/contracts/`](./src/contracts/) 是本仓 transport 类型，不共享 sibling 业务 DTO。
- [`src/application/`](./src/application/) 与 [`src/domain/`](./src/domain/)：本 owner 用例与业务规则。
- [`src/infrastructure/postgres/`](./src/infrastructure/postgres/)：Project、ScheduledTask/Execution、
  Conversation/Message/Share、command receipt 与 durable AG-UI ledger 的本 owner 数据访问。
- [`src/infrastructure/clients/`](./src/infrastructure/clients/)：固定 owner API/Connect 出站边界；
  [`src/generated/`](./src/generated/) 为现正规生成入口派生的只读 client，不手改生成物。
- [`src/interfaces/http/agui/`](./src/interfaces/http/agui/)：从持久化 public frame 编码唯一网络 AG-UI stream；
  Vercel AI SDK UIMessage 适配仍归 App，不在 BFF 新建第二套网络事件协议。

## 契约与验证导航

- [`contract/dependencies/`](./contract/dependencies/) 与 [`contract/vendor/`](./contract/vendor/)：消费的固定 owner 版本与原件。
- [`contract/iam-relay-policy.json`](./contract/iam-relay-policy.json)：独立 browser-private relay profile，不混入 Public OpenAPI。
- [`scripts/library-file-deletion-public-contract.mjs`](./scripts/library-file-deletion-public-contract.mjs)：
  含当前 28.37 → 完整 28.36 → 完整 28.35 原字节的 build/test-only 逆证；不是生产 fallback。
- [`scripts/check-contract.mjs`](./scripts/check-contract.mjs)、[`scripts/verify-openapi.ts`](./scripts/verify-openapi.ts)
  与 [`test/contract/openapi-contract.test.mjs`](./test/contract/openapi-contract.test.mjs)：operation inventory、语义与历史原件证明。
- 实际验证按 [README 质量门禁](./README.md#质量门禁) 和本次影响面选择；真实资源集成不以 mock 或跳过代替。

28.36 对齐既有认证 metadata；28.37 增加本人 Session Share metadata GET，复用当前 Chat read 与 bff_share，
不建表或额外服务、不改POST/DELETE。新消费者在正式发行后固定commit/version/digest，再用自身正规生成入口消费。
历史说明不授予清卷、删库、重建或部署权限。
