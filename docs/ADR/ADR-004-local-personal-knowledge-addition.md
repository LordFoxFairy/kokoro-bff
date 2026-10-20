# ADR-004：本地已有数据实例的知识与释放队列表定向新增

- 状态：Accepted，限当前用户已要求补齐并验收的本地开发实例；执行/验证状态见 CURRENT
- 日期：2026-10-18
- Owner：kokoro-bff；canonical 基线 56c262cd8426e51c6c6f0acb30be7e40e4a8d3be，当前源码 1dbfd82636bc1ff518a30ce55feeeb21a350260e；本次 SQL 字节相同

## 决定

本人知识两表/一个列表索引与既有项目资源释放 outbox/一个 claim 索引均已在唯一 `database/schema.sql` 固定。用户于2026-10-18明确同意在知识表之外一并补齐缺失 release 队列表，再重载验收。本次只提取五条确定 CREATE：`bff_personal_knowledge`、`bff_personal_knowledge_usage`、`bff_project_scope_release_outbox`及两个 canonical 显式索引；不改变旧表、列、数据或任何其他 owner。

这是对缺失且将为空的队列表做定向新增，不是项目删除旧模型迁移；旧 deletion 字段差异继续记录，两个旧辅助表保留且执行前再次核零行，不复制/推断旧 command。若出现旧命令或目标部分状态，停止，不据本裁决迁移或删除。GET/CRUD知识验收不冒称项目删除能力已修复。

采用一次具名操作而非再建通用 migration runner、ledger、维护升级链或运行时自动修表。操作程序和含用户数据的备份只在 Root ignored 私有运行目录；canonical SQL 继续是唯一可编辑 schema，脚本固定源码/DDL摘要、拒绝部分状态或漂移。同 owner advisory transaction lock下执行五条DDL与后置catalog核验；事务提交不确定仅用新连接核实，不伪回滚或自动重发。原 fresh installer 的非空保护不改。

## 执行前提和验证

1. 核当前BFF进程与暂停标志，短暂停止这一个源码服务；模型、Agent执行、扣费、定时任务不启用，不改登录/角色/积分/其他服务。
2. 使用 `pg_dump` 仅备份 `kokoro_bff` schema，备份权限0600；恢复到本次自有隔离临时库，并核全部已有BFF表的数据摘要。
3. 在 fresh canonical 隔离库提取三表目标catalog指纹；对备份恢复库实际演练：三表都缺失→事务新增→目标指纹一致，原表catalog与数据摘要不变，再执行识别为已完成。部分/漂移/DDL hook停止，不尝试修正。
4. 正常实例重复同前置和同一操作，核目标指纹、原表catalog和数据摘要，再重载已核配置的BFF，readiness及正式登录后的知识读写另验。
5. 两个演练库只清理本次创建的资源；备份保留。没有自动down或删除新表回滚；失败未提交由事务撤销，提交后的恢复仅另行明确操作。

这项决定不授权远端发布、收费/模型执行或整库重建。数据库新增成功不等于功能手册、浏览器CRUD、记忆导入及自动化余项已经完成。

## 执行结果（2026-10-18）

本次已执行：正常schema备份可真实恢复，五条DDL同事务提交；目标catalog匹配fresh，原29表catalog与数据摘要不变。BFF与配对App已从源码重载；Scheduler连接修复重载由用户另行明确确认，未借本ADR扩大授权。正式登录浏览器知识CRUD与独立usage偏好读写通过，验收样本已获确认删除、正文清空，最终usage关闭。两个登记/任务仍暂停、未出现调度派发；无模型、工具执行或扣费。运行证据私有保存，CURRENT承接未完成项。

## 历史激活前核查（2026-10-18，已由上节结果替代）

两知识表原隔离演练已通过，按新授权增加 release 空队列表后的完整五DDL亦已在隔离恢复库重新演练：目标catalog匹配fresh、原29表catalog/数据摘要不变、再次执行识别已完成、漂移拒绝，自有两库已清理；正常实例尚未执行。当前 BFF 进程、runtime parser 与操作目标已只读配对，数据库键重复即停止。重载前还须核 Scheduler 实际登记和派发状态，不以 BFF outbox 已终态代替；当前 Scheduler 活进程连接失效、ready503，现配置所指库的两条暂停登记另有只读证据，两者不混称，按现有配置重载Scheduler另待确认。

既有项目deletion旧字段不在本次修改范围，不据新增空队列推断项目链已修复。正常操作保留全部旧表/数据，不绕过 fresh installer 非空保护。
