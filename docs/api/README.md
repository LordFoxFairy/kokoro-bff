# Kokoro API Docs

Kokoro 的 API 文档以 **API-first** 为准：先冻结可观察的 HTTP 契约，再由各业务子仓库实现持久化和领域逻辑。
阶段 1 仅采用 **PostgreSQL + Redis**；BFF 不引入 MySQL 或 Mongo 依赖，Mock/Live 只通过 HTTP upstream 与 Redis/PG adapter 契约协作，不新增旧存储依赖。

当前版本是 **Kokoro Business API v1**。文档的章节组织、资源描述、生命周期和示例风格参考 Manus API 的公开文档，但路径、字段、错误码和身份边界属于 Kokoro 自己的契约。不要把 Manus 的 v2 路径直接当成 Kokoro 的接口版本。

## 文档入口

- [v1 总览](./v1/README.md)
- [Projects v1](./v1/projects.md)
- [Mori Music v1](./v1/mori.md)
- [Chat v1](./v1/sessions.md)
- [Skills v1](./v1/skills.md)
- [MCP v1](./v1/mcp.md)
- [Scheduled v1](./v1/scheduled.md)
- [Agents v1](./v1/agents.md)
- [Library v1](./v1/library.md)
- [Billing v1](./v1/billing.md)
- [完整契约摘要](../../CONTRACT.md)

## 文档分层

```text
docs/api/
└── v1/
    ├── README.md       # 版本、鉴权、包络、通用约定
    ├── projects.md     # Projects 与项目级投影
    ├── mori.md         # Mori 音乐生成与 SSE projection
    ├── sessions.md     # Chat / shared snapshot 投影
    ├── skills.md       # Skills、GitHub skill、quota/revisions
    ├── mcp.md          # MCP servers 与连接投影
    ├── scheduled.md    # Scheduled tasks
    ├── agents.md       # Agent setup 投影
    ├── library.md      # Library 投影
    ├── billing.md      # Billing plans/summary/checkout
    └── ...             # 后续按业务资源拆分
```

每个资源文档必须包含：

1. 资源目标和所有者
2. endpoint、HTTP 方法和鉴权要求
3. 请求参数、请求体和字段约束
4. 成功响应、错误响应和状态码
5. 幂等性、并发和重试行为
6. Mock 验证样例
7. Live upstream 替换要求

## 版本规则

- `/v1/*` 是 BFF 面向 Web 的业务契约。
- 破坏性字段或语义变更必须新建 `/v2/*`，不能静默改变 v1。
- 新增可选字段属于向后兼容变更，但必须更新 schema、示例和测试。
- Web 的 `/api/*` 是同源适配层路径；它不是业务服务的公开版本号。
- Chat/SSE 属于本仓 Chat 业务模块边界的 BFF v1 projection；`src/main.ts` 仅负责 HTTP 组合根和通用请求管线，资源路由位于 `src/http/routes/`；通用请求/响应与幂等服务位于 `src/http/`、`src/application/`，持久化端口/模块位于 `src/modules/`，具体 PostgreSQL/Mock adapter 位于 `src/infrastructure/`，契约位于 `src/contracts/`。不再创建独立 `kokoro-session` 或 `kokoro-chat` 子仓库。
