## I6 RSS 安全 HTTPS reader（2026-10-23，源码候选待独审）

`readRssFeed({url,signal})`仅返回完整有界bytes；显式内部factory供受控测试，生产固定node DNS/HTTPS和公网地址策略。新增`rss-feed-address.ts`拥有URL/BlockList策略，`rss-feed-reader.ts`拥有单pin、TLS、10秒总期限/5秒idle、16KiB头/1MiB正文及取消释放。没有配置覆盖、外网feed访问、公开接口、SQL、poll或Web激活。后继唯一编排调用点仍为计划中的`application/rss-poll-service.ts`，成功后再交现parser/conditions与持久事务。

根外CDATA窄修同时检查sax `onopencdata`和`oncdata`：空CDATA不产生后一个事件，只有前一个检查可拒空输入；原92内核断言正文保持，根内CDATA仍正常。可执行stub定向RED为29项1PASS/28FAIL；首轮实现184项182PASS/2空CDATA FAIL后按Root裁决修复。首次全组stub因accepted等待未到而终止，保留原日志，不冒完成RED。

自有loopback TLS factory仅映射已验证public pin，保Host/SNI/证书校验；该证据不代表公网可达。实际5秒idle与10秒drip总期限、错SAN、取消socket、启动时环境代理trap及响应边界纳入专项。准确终态计数、命令和全输入保护见A/测试验收/i6-rss-reader-worker-v1.json。未执行build/default/full/contract聚合、DB/Redis或正常Browser；新sax锁的旧生成provenance仍待Root后续聚合门，不在此片重生成。没有hix-code-review通过结论。

## I6 内核 XML 语义窄修（2026-10-23，待独审）

已修复独审P2：实体前literal CRLF/CR归一LF、实体CR保真；声明仅XML S、固定关键字和standalone值严格小写，仅UTF-8 encoding值可大小写折叠。所有解码属性（包括namespace/未知/字符引用）含TAB/LF/CR即整份拒绝，这是明确的支持子集，不声称完整XML属性归一。guid/id保留XML解码后精确值已由Root裁决；64KiB指投影文本字段和全属性，不限制未知扩展单字段，仍受1MiB/深度/节点总界。

原58内核和37架构测试断言保持；新增行为RED为92项61PASS/31FAIL，修后92PASS。终态命令、哈希与保护见A/测试验收/i6-rss-kernel-worker-v2.json；v1日志/manifest原样保留。未开启reader/网络/资源/poll/Web。

## I6 RSS 解析与条件内核（2026-10-23，候选）

新增RSS2/Atom严格解析和闭合文本条件，尚未注册RSS接口或接入网络、Scheduler poll、持久去重、执行队列及Web。`src/infrastructure/clients/rss-feed-parser.ts`拥有sax解析/稳定摘要；`src/domain/scheduled-task/rss-feed.ts`仅只读条目类型，`rss-conditions.ts`拥有纯条件验证与匹配。后继唯一消费点为计划中的`application/rss-poll-service.ts`，本片不创建空入口或伪订阅。

固定sax1.6.1/@types/sax1.2.7，安装禁scripts；官方registry integrity与lock一致。受控纯门和失败记录见CURRENT；不将内核通过称为完整RSS可用。公开契约19.3/168、SQL、生成物、owner pins和其它业务保持原字节。

## I5 本人积分账户初始化

当前实现候选与验证边界见三设计顶部；受控 source HTTP、canonical/正规生成属于本片纯门，真实PG、正常服务与Web消费尚由主控后继验收。当前入口仍Node HTTP既定例外，未声称Nest迁移。

## SET47 当前归档候选入口

本人归档的状态、权限、幂等、Project锁序、canonical fresh-install与未验运行边界见三设计SET47前缀；实现/实际纯门/Root后继真实PG验收见[CURRENT.md](./CURRENT.md)。唯一公开机器事实是public15.4候选，未发行不得提前消费者激活；以下记录是历史。

本人姓名PATCH及登录设备的当前入口与真实验证见 [CURRENT.md](./CURRENT.md) 顶部；public当前canonical15.2.0/145，下面历史候选记录不覆盖当前事实。

## R277 当前机器候选入口

Project 删除目标当前只在 canonical [`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 候选中增加两条具名operation，版本目标 `8.6.0 / 105`；设计边界见本目录三D0顶部。候选未发行且无runtime/schema/consumer实现，Root后继机器门与真实owner/浏览器验收前不得标记T-C05通过。

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

Phase 2 durable AG-UI 的具体裁决见 [`ADR/ADR-002-durable-agui-ledger.md`](./ADR/ADR-002-durable-agui-ledger.md)。
当前用户准入实现、固定 IAM contract provenance 与独立 service-only 例外分别记录在 `CURRENT.md`、
`TECHNICAL_DESIGN.md`、`API_CONTRACT.md` 与 [`../contract/README.md`](../contract/README.md)。

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

- Project single-file upload: `src/http/routes/project-resource.ts` → `src/application/project-resource-upload.ts` → `src/infrastructure/clients/storage/`; source provenance `contract/dependencies/storage-connect.json`, deterministic generator `scripts/generate-storage-connect-client.mjs`, focused tests `test/project-resource-upload.test.mjs` / `test/storage-connect-contract.test.mjs`.

- Project durable resource GET: `src/http/routes/project-resource-list.ts`, `src/http/project-resource-list-input.ts`, `src/application/project-resource-list.types.ts`; owner mapping remains in the Storage client, with `test/project-resource-list.test.mjs` as focused contract/HTTP coverage.

## R59 public4 实现候选（未发布）

- 唯一公开事实源为 `contract/openapi/v1/openapi.yaml` public4；Agent HTTP4 固定 e977923ea9992cbddaf0cdbc6c8f8d23b3af120e，生成来源见 `contract/dependencies/agent-http.json`。
- `src/infrastructure/clients/agent/interaction-state.ts` 严格解码固定 owner schema；`src/application/agui/interaction-state.ts` 校验完整 revision/no-op；`src/application/chat-run-control.ts` 校验当前 pause 的完整 decision 集合。
- `bff_agui_run_interaction` 是最新 run read projection；source/CUSTOM/cursor 与它同事务。`chat-repository.ts` 在授权 RR 中校验 head、完整 state 与 ledger provenance；ACK 不清除 pause。
- 本轮静态/纯测试证据与未决 fixture 见 `docs/CURRENT.md`。真实 PG/Redis/HTTP、发布及 Web 消费归 Root 后续验收，不能以源码候选代替。
