# kokoro-bff 文档索引

## 阅读顺序

1. [`CURRENT.md`](./CURRENT.md)：当前实现、证据和未完成缺口；完成度的唯一人工入口。
2. [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)：当前物理架构、目标边界和依赖方向。
3. [`API_CONTRACT.md`](./API_CONTRACT.md)：公开协议策略；字段事实源仍是 canonical OpenAPI。
4. [`DATA_MODEL.md`](./DATA_MODEL.md)：当前表、owner、不变量、索引和 retention 缺口。
5. [`SECURITY.md`](./SECURITY.md)：信任边界、身份、secret 与 abuse controls。
6. [`RELIABILITY.md`](./RELIABILITY.md)：timeout、幂等、replay、恢复与降级。
7. [`SLO.md`](./SLO.md)：目标 SLI/SLO；不把目标写成实测。
8. [`RUNBOOK.md`](./RUNBOOK.md)：诊断、处置、回滚和证据采集。
9. [`ACCEPTANCE.md`](./ACCEPTANCE.md)：可执行验收矩阵与当前开放项。
10. [`ADR/README.md`](./ADR/README.md)：仍有效的架构决策。

## 协议文档

- [`../contract/README.md`](../contract/README.md)：机器契约 owner、版本、生成、breaking、provenance。
- [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml)：唯一 canonical public OpenAPI。
- [`api/README.md`](./api/README.md)：资源级人类文档入口。
- [`api/v1/agui-chat.md`](./api/v1/agui-chat.md)：BFF-owned AG-UI transport projection 说明。

`docs/api/` 解释协议，不是第二份字段级事实源。历史摘要不得覆盖 `CURRENT.md` 或 canonical OpenAPI。

## 文档职责

| 文件 | 应回答 | 不应承担 |
| --- | --- | --- |
| `CURRENT.md` | 代码现在做什么、缺什么、证据是什么 | 愿景或历史流水账 |
| `TECHNICAL_DESIGN.md` | 边界、调用、状态、事务、失败恢复 | OpenAPI 字段复制 |
| `API_CONTRACT.md` | 可见性、版本、鉴权、错误、幂等策略 | 可编辑机器 schema |
| `DATA_MODEL.md` | 表 owner、不变量、查询、retention | migration 历史 |
| `ACCEPTANCE.md` | 可运行的 Given/When/Then 与命令 | 自报“生产级”结论 |
