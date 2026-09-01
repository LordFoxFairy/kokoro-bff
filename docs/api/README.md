# Kokoro API Docs

Kokoro 的 API 文档以 **API-first** 为准：先冻结可观察的 HTTP 契约，再由各业务子仓库实现持久化和领域逻辑。

当前版本是 **Kokoro Business API v1**。文档的章节组织、资源描述、生命周期和示例风格参考 Manus API 的公开文档，但路径、字段、错误码和身份边界属于 Kokoro 自己的契约。不要把 Manus 的 v2 路径直接当成 Kokoro 的接口版本。

## 文档入口

- [v1 总览](./v1/README.md)
- [Projects v1](./v1/projects.md)
- [完整契约摘要](../../CONTRACT.md)

## 文档分层

```text
docs/api/
└── v1/
    ├── README.md       # 版本、鉴权、包络、通用约定
    ├── projects.md     # Projects 与项目级投影
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
- Chat/SSE 仍属于 `kokoro-session`，不在本目录伪造 BFF 的 Chat API。
