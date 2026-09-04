# kokoro-bff ADR index

ADR 记录仍有效、难以从代码局部推导的架构决策。实现状态必须链接 `../CURRENT.md`，不得因 ADR 为 Accepted 就把未
落地工作写成现状。

| ADR | 状态 | 决策 |
| --- | --- | --- |
| [ADR-001](./ADR-001-public-product-api-and-ag-ui.md) | Accepted | BFF 是唯一 public Product API owner；AG-UI 是 Web↔BFF 唯一 Agent wire protocol；公开 replay 最终由 BFF durable projection 拥有 |
