# ADR-003：本人资料表的具名已有数据演进

- 状态：Accepted；Root 已批准具名实现与隔离演练，normal 尚未放行
- 日期：2026-10-06
- Owner：kokoro-bff；任务 R256-PAGES-01
- 源码基线：399e70dfd97004c4c75cfb1e83c571a38c749437

## Context

本人四字段 public8.1 与 canonical 表已验收；正常实例仍旧版本，有帐号与历史数据。
SQL 手册 §3 要求有数据演进先具名 ADR。fresh installer 拒绝非空 owner 是有效保护，
不是需要绕开的失败；正常完整 catalog 尚未核实，不能用含原 mixed 的 canonical 修整旧表。

## Decision

1. 仅新增 bff_personalization 的 strict check/apply，复用唯一 canonical 的目标 CREATE；
   不执行整份 schema，不改 fresh installer，不建 migration 链/ledger/运行时自动 DDL。
2. 三个普通 scripts 分离 CLI、这一次操作生命周期、目标 catalog；新独立真实 PG integration。
   精确放置和下一阶段授权集见 [TECH](../TECHNICAL_DESIGN.md) 顶部 §8，不新目录/服务/依赖。
3. 已有 owner/批准旧部署、目标 legacy/current/invalid 按 [DATA](../DATA_MODEL.md) 精确语义核验；
   current 只校验，不修复漂移、不删资料。未知旧结构与可能影响 CREATE 的 DDL hook 停止另审。
4. 自有有界连接、同 owner advisory transaction lock；观察/唯一 CREATE/后置验证同事务。
   COMMIT 后未知不伪回滚/重试，新连接同锁 check；公开操作结果见 [API](../API_CONTRACT.md)。
5. Root 停写/drain、owner 一致备份与自有库实际恢复验证后才 normal apply；保全部旧事实。
   IAM/schema/BFF/Web required 契约配对，不因 schema 成功宣告用户保存完成。

## Alternatives and consequences

- 扩展 fresh installer：入口虽少，但模糊空 owner 契约，拒绝。
- 通用 migration runner/历史升级表：本次单一 additive 事实不需要，拒绝。
- 具名三个普通脚本：限定一次变化原因，保持 canonical 唯一；后续新演进另审，不长成通用引擎。
- 无 down/自动 restore；应用失败保新表，按匹配版本回退。确有损坏由 Root 决定维护恢复，
  不影响同库其他 owner。未完成的 normal catalog/备份恢复/TCP 演练/浏览器保存仍是停止线。

## Evidence gate

旧 shape 有数据 → check legacy → apply → check current；旧事实/已存资料保全、并发、漂移零写、
锁/取消/真实 TCP COMMIT ACK 未知恢复与 fresh 非空拒绝全保。纯门及方法 hook 不替代真实资源。
当前实施状态与证据由 [CURRENT](../CURRENT.md) 和 Root 原任务卡登记；本 ADR 不授正常执行权。
