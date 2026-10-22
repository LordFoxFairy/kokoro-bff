## I5 BFF 初始化切片验收（2026-10-21；尚未正常激活）

Public19.3/168 固定 Billing158579f8 的正规v1四操作SDK。独立只读审查未发现确定P1/P2；原167操作与19.2全文、旧GET行为及历史断言均保留。格式/lint/types/direct build/架构均通过，原默认清单1697PASS/0FAIL/3资源SKIP，原contract:test完整清单1042PASS/0FAIL；聚合契约前置检查全部通过，Redocly保留44warnings。构建使用fresh dist移Trash后原tsc，测试包装仅把自有临时目录/当前PID套接字清理改为Trash，不改断言、时限或网络行为；原包装失败记录保留。

真实 Node22 BFF→Node24 Billing src/main→自有fresh PostgreSQL 的9组场景全部通过，含并发重放、非零余额/generation/timestamps保持、disabled、已提交写丢ACK后只读恢复及最终撤权。原数据库catalog与仓库输入精确保持。IAM仍是受控admission，此验收不代表正常JWT、Web消费者或浏览器完成；完整资源integration未全部运行。无正常schema/账户/积分、支付/grant/Agent效果。本切片尚未提交或激活，消费者须固定后续已提交契约再接入。

## 2026-10-21 I5 积分初始化消费者设计（尚未实现）

已确认 Billing main158579f8 具备正规v1零余额初始化，自此不再以旧3f5缺接口为当前结论。本仓当前仍ef2ddca/Public19.2三GET consumer；新片目标Public19.3/168及隐藏初始化的显式PUT边界，三设计已写，先RED后实现。支付/grant/Skills/MCP不动，不修改正常服务/数据库；未获新Git动作授权。当前无本片测试/工程或真实PG通过声明，后继结果覆盖本段实施状态。

## 2026-10-21 I4 运行更新 metadata 读取（源码候选，正常服务与Web未切换）

BFF 拥有 ScheduledTask、dispatch 及已核验复制事件；Agent 仍是执行事件唯一生产方。先交付全局运行列表及可选 task_id 过滤，不虚构运行摘要、输出详情或会话链接。HTTP7 固定 artifact 的 payload_json 没有 run.completed / assistant.completed 机器 schema；摘要/输出及立即测试不在本切片完成范围。

当前Public19.2/167候选已实现metadata读取及exact terminal partial索引：当前owner/parent资格在LIMIT前，原9位顺序keyset、L+1与最多两终态，源identity/digest/time/generated校验与PG/HTTP字节界；两次IAM和完整页快照共享单一5秒绝对预算。ArchiveSqlLease原行为保持，晚checkout精确回收、在途自有lease退休。没有新增执行/审批能力、摘要或输出详情。

本片先在真实HTTP观察到4FAIL/1PASS（未实现入口；旧通用IAM10秒），同例转绿。前轮具名新行为与架构99PASS，最终完整门再含合法Unicode maxLength边界；原调度/归档/项目与个人下载具名回归143PASS。自有fresh PG安装及六子项计7PASS/0SKIP，覆盖资格/纳秒分页、终态冲突/字节界、双快照变化、饱和late checkout零SQL、准确blocked backend退休与池恢复；未访问Redis或正常schema，精确回收自有夹具，原数据库OID保留。完整default/contract第一轮各有历史schema oracle遇获准新增index的一项FAIL，原日志保留；初始化精确剥唯一新增block后原全文assert保持。最终固定Node22.22.2直接tsc、format/lint/typecheck、11依赖contract check、公开lint/semantic/governance均通过；公开lint有44条warnings，不归称全部旧问题。完整default为1602PASS/0FAIL/3原SKIP（55.254秒），contract为947PASS/0FAIL/0SKIP（54.909秒）。两个完整命令仅去掉会永久删除dist的build前缀，已先直接tsc，原文件列表保留并追加本片用例；未重复执行原14文件真实PG/Redis完整套件。当前无Git动作，不宣称已可提交。旧I3验收只绑定已保留739输入快照，不能当作本片独审通过；正常服务/Schema与Web正式pin未切换。

## 2026-10-21 项目资源下载：实现及 owner 验证通过，Web 整链待接入

当前源码为 Public19.1.0/166 候选，仅新增项目资源下载 GET；原 Public19 的165个操作继续通过完整逆证验证。项目入口已实现当前 IAM 准入、两次本人 active Project 检查、canonical scope、ASSET/CLEAN、单一20秒截止点、1MiB上限、完整 EOF/长度/SHA 与私有附件响应。个人下载复用普通 ASSET 实现并保留原 wire 与错误隐藏；Artifact 实现保持。

固定 Node22.22.2 的 build、format:check、lint、typecheck 均 exit0；完整 contract 为875PASS/0FAIL/0SKIP，完整 default 为1530PASS/0FAIL/3SKIP。原14文件串行 PostgreSQL/Redis 集成清单最终为371PASS/0FAIL/0SKIP（115.636秒），其中含24项受控 DatabaseError unit，不能把371项全部称为真实数据库测试。两测试命令只移除已单独完成的 build 前缀，原完整文件清单不变。最终生产与测试源码绑定冻结 b7e553590727786cb4165719fe1a58d8c82d7a011162aad5e9a239683710667f；后续仅更新文档。

历史失败保留：v1为341PASS/6FAIL，v2为346PASS/1FAIL，v3为346PASS/1FAIL，均0SKIP。五项共享 Pool 旧回归通过撤销本片新增的全局1000ms连接期限修正，不改变其他调用者的等待语义；旧5ms租约准备改为可验证的未过期租约和精确过期夹具，原回收/fence/sticky断言保留。v3暴露的R285 SQL取消分类已在私有 query 修正：仅真实 DatabaseError 57014归受界取消并销毁准确checkout，COMMIT仍保留UNKNOWN及原cause，其他错误不吞。新增unit真实RED为11PASS/13FAIL，修后24PASS/0FAIL；原R285和旧租约用例也在最终完整清单通过。原始失败日志与收据保留在仓库外验收记录中。

具名 Project 读取的 caller 绝对预算、晚 checkout一次归还及零SQL已验证；公开 Pool.connect不支持单次取消，因此不保证不合作持有者下的pending物理退队时刻。项目发送前重验不是跨服务原子撤权，Storage签名引用仍有其原有失效窗口。受控HTTP/Connect与unit证据不代替真实Storage和浏览器完整下载。

最终源码已完成独立只读审查，未发现确定P1/P2；审查与上述工程/资源验证是不同证据。正常BFF进程尚未切入本候选，Web尚未实现项目文件下载按钮/传输；完整首页目标仍未完成。消费者须先固定已审owner commit与artifact digest再接入，不能以本地候选文件或手改generated代替不可变来源。

## 2026-10-19 已合 owner 发布物的固定配对（集成收尾）

IAM internal/SDK 0.14.0 固定到 7cbe988d8f3868f293a15120135e1885de8516ff；Billing 4.0.0-experimental.2 固定到 3f5e0dacc25c1e24d87cbe0c59337d3b909466de 的唯一 `/v1` artifact。原 allowlist 不扩张，IAM 生成输出全部原字节、Billing 仅三 GET URL 随 owner 正规生成；Public19/SQL/历史双父逆证及独立浏览器 relay policy 均不变。未纳入正常工作树的 availability WIP。

728 输入停写冻结后，Node22.22.2 官方 format:check、lint、typecheck、contract:check、test:architecture、test、build 均 0；默认 1489 PASS/3 原资源 SKIP。单独将同一 built BFF 窄 client 在私有 owner Node24 测试宿主中连接已合 IAM/Billing 源码的真实 PostgreSQL/Redis/HTTP：两 suite 2 PASS/0 SKIP，覆盖新 Product grant/session admission、Session 列表、Profile 原值 CAS 和 stale409、当前 Session 撤销409、invalid401，以及 Catalog 精确大整数、账户/流水、错主体404、错服务凭据503。Billing 35 表读取前后全部事实核等；测试数据库 catalog94→94精确恢复，自有 iam:test prefix0→0。仅隔离 fixture 写入，不对正常环境充值/扣费或调用模型/工具，不改配置/进程/Schema。

工程冻结与日志仅保留 Root ignored `var/dev/merge-inventory-20261019/bff-owner-pairing`；这证明 consumer 配对切片，不追认为正常运行/页面/全产品已激活。现有混合工作树 687 输入逐字保留。CI 按用户要求不等待，App/Admin 和 Root 组合仍须独立收尾。

## 2026-10-19 既有分支集成：唯一 Public19.0.0（候选）

本次只合并本地 d8634f0 与 main 16e5c711 已批准能力，不新增功能。唯一当前 /v1 契约165操作：保本地 Skills取得来源、项目精确选择/消息默认冻结、知识、完整日历与Library筛选、五项MCP包管理；承接main八项账号会话/姓名、共享/归档操作与Team完整platform/skill权限。旧名称关联PATCH及recurrence_anchor_at请求字段保持退休，不建alias或runtime fallback。两父原文/有序inventory通过本次明确增量的精确逆证保留，既有历史hash与断言不重签；全部后端入口、owner准入/取消/事务/幂等和历史回执保持。

Schema只在原BFF canonical叠加main既有归档列/索引；项目/日历/知识结构与旧表删除保持。正常库不自动演进，未重启服务、启用模型/实际工具/扣费。停写后的728输入完整格式/lint/types/契约845项/架构/默认1489 PASS与3原SKIP/fresh build已通过；13文件真实PostgreSQL＋Redis 346 PASS/0 SKIP，fresh canonical安装与自有测试库回收已验证，独立审查无遗留确定P0–P2。首次资源7个失败已定位并修正既有fixture的owner search_path、HTTP7显式project_ref和ObjectStore VersionId ACK；原503、未知提交、重启与撤权恢复断言保持，未以放宽断言消除失败。新availability消费者WIP和正常mixed均未夹入；代码交付不代表正常Schema/运行服务或完整页面已配对。

## Agent HTTP7 消费配对（2026-10-18，本地候选，正常环境未激活）

沿既有已存dispatch v2，Chat/Scheduled窄delivery共用strict投影：只从BFF冻结的trace scope产生required nullable project_ref，不查询当前项目、不修改历史payload/key/digest。固定Agent7104f3d原始HTTP7/provenance，唯一生成器仍仅三operation；旧vendor已移除，usage读取未接入。无SQL、公开API、持久模型、依赖或配置变化。

真实RED证明旧consumer缺显式scope且未拒坏正文；本片相关HTTP14 PASS。隔离真实Agent HTTP鉴权/Ingress/PG验收四组合（Chat/Scheduled×direct/project）各重复一次，八次接纳只有四条dispatch，scope与原保存正文均保持。队列为受控FakeBus，不启动共享Redis/Worker、模型或扣费；自有schema已清理、前后schema目录完全一致。首fixture漏必填lease TTL，改用原config.run_repository后通过，没有改业务规则。

完整owner工程/contract/默认门的停写证据见Root有效计划；正常dist/服务/数据库未更新。正常切换前仍须核旧Agent已有/未知接纳，公开人类旅程、页面Manus对照与MCP全部能力仍未因此完成；远端Git/PR/CI及Root index/gitlink保持暂停。

## 2026-10-18 Public18.1 MCP 受管包管理接线（未正常加载）

沿feb42f4窄SDK/Platform fa5c5e5，唯一canonical Public18.1新增五个管理员包操作，157 operations；其余152 operation及完整Public18原字节经逆证保留。feature-local HTTP input/body与route、现server/runtime/Nest协议adapter接线及Admin浏览服务精确allowlist已实现；复用现mcpProviderAdmin配置/原direct凭据，无新Schema、身份、scope、依赖或上传/receipt/cache事实。当前session＋platformAdmin＋mcp_catalog.manage、可信tenant/subject与原命令key，正文前共同20秒/32KiB、严格重复/未知JSON/路径/查询/头、取消/关闭和公开安全错误保持。

主方650工程输入停写无漂移，独占源码候选完整format/lint/typecheck/build/contract/architecture/原默认manifest均exit0；contract699 PASS、architecture35 PASS、default1301 PASS/3既有资源SKIP。原契约新增1例和四HTTP独有风险案例，未加UI测试；新公开case真实版本RED→GREEN，HTTP4FAIL→4PASS。首次root运行tsx解析失败属设置问题，随后正确owner入口真实RED；首TS字段联合收窄失败改显式四kind/map及switch投影，无放宽类型规则。首逆证夹具误用非行首anchor已校正到实际唯一块边界，完整Public18 SHA beaf5441...及旧152精确保留，未改旧原始事实来凑绿。

私有源码实测公开HTTP→真实BFF配置装配/SDK→真实Platform fa5 Native Nest＋正式服务准入＋自有fresh PG：Begin/实际对象PUT/Complete/Status、Pending拒发布、CLEAN发布、原命令回放和独立Pending取消，1 PASS/2未选，版本/receipt各1。人类IAM准入与Storage为受控peer、对象真实loopback PUT/GET；不是实际IAM/Storage/正常账号/Admin UI整链。自有库回收/catalog92→92 exact、Platform副本回收。最终静态独审无确定剩余P0–P2；原始日志与验证器仅Root ignored var/dev/bff-mcp-package-http-20261018。

后继仍需Admin同源包上传/扫描/发布恢复页面、Runtime stdio不可变材料/Agent受控链及产品对照/手册；不以HTTP完成冒整体闭环。正常dist/服务/库/配置/账号/权限/积分/任务未动，模型/实际工具/扣费/CI/远端继续暂停。原mixed知识文档/ADR、资料库Unicode断言保留不夹入提交，Root index/gitlink不动。

## 2026-10-18 MCP 受管包固定内部消费者（未正常装配）

本地源码固定 Platform fa5c5e53151b3c72145b680a3ee4a45d92c17ec7 的独立五方法 Proto/descriptor/profile/摘要向量，沿唯一生成链升级现 Connect 与 HTTP bundle，原20个 generated 文件逐字保持。新增三职责窄 client：严格输入/固定摘要、安全结果投影、Native Connect 与原 mcp_admin direct 服务凭据鲜读；继承 caller 绝对预算且最多20秒/32KiB，取消与 close 贯穿。不新增公开路由、Schema、配置、上传实体、服务身份或正常装配；Storage 上传事实与 Platform 发布回执仍各归原 owner。

主方最终646工程输入停写无漂移，格式/lint/typecheck/build/contract/architecture/原默认manifest全exit0：contract694 PASS、architecture35 PASS、default1296 PASS/3既有资源SKIP；四个新风险案例覆盖五操作/严格拒绝/凭据与未知命令恢复/取消。独审发现 package_limit_exceeded 合法 FailedPrecondition 被剥除，原Native案例真实3PASS1FAIL→4PASS，保原 ResourceExhausted 并仅加已发布组合，最终静态审查无确定剩余P0–P2。未增加UI测试或放宽原断言。

私有源码副本中真实BFF Node22 SDK→Platform fa5 Node24 Native Nest＋正式本地服务准入＋自有fresh PG实测：Begin→实际对象PUT→Complete→Pending拒发布→CLEAN后发布→同命令回放→另一Pending取消，1 PASS/2未选，不把未选当通过。不可变版本与发布receipt各1；Storage为受控Native peer、Redis为受控资源，尚非真实Storage/人类HTTP/Admin产品整链。首私有夹具误把8次调用写成至少9次，纠正为精确8后重跑；原失败留证，生产实现未为该夹具改动。自有库清理/catalog92→92 exact、Platform私有副本回收。

工程门在独占候选运行，不覆盖正常dist；其他mixed知识文档/ADR、资料库Unicode断言保持不纳入本片提交。原始材料只在Root ignored var/dev/bff-mcp-package-20261018。后继仍须公开五操作/当前人类管理员准入、同源Admin页面、Runtime stdio不可变材料与Agent受控整链及产品手册；完整goal仍OPEN。正常服务/库/账号/权限/积分/任务开关、模型/实际工具/扣费/CI/远端及Root index/gitlink未动。

## 2026-10-18 Public18 Artifact 服务端筛选候选（未加载正常环境）

沿 a577625 同需求分支，新增 artifact-only q/type：在既有 BFF 授权关系候选窗口内，通过 Storage 固定 v3 FINAL 读取后的 title/filename/MIME 匹配，不用未验证 source claims、不新建 metadata 副本/索引/worker。原 min(500,limit*5)/30秒预算保持，游标记录最后扫描而非最后命中位置；空items+next可继续，只有next=null是穷尽，不宣称索引/相关性搜索。file严格拒绝新参数。单一art2将规范化查询、type、kind、tenant、subject、limit和keyset一并绑定；Public18明确退休旧Artifact游标，无旧版本fallback或路径alias。

原query/真实HTTP-Connect案例3 FAIL后实现8 PASS；同一新增案例补owner迟到返回的取消，先实际误200 RED，await后再核signal后GREEN。Unicode200码点/控制字符、八类、FINAL filename而非旧source、跨窗口后页命中、query/type/limit/actor/tenant互换零owner读、旧cursor拒绝、503不假空均覆盖；原HTTP入口真实走正式准入/最终解码，Storage与对象网络为controlled peers，不称真实Provider/工具执行。另独占PG原R237 Artifact关系权限案例1 PASS/0SKIP，临时库已清理；它证明Postgres身份/项目关系边界，不冒充整个新筛选HTTP与真实Storage完整组合。

Public18完整逆变精确还原Public17 SHA ffc655e893b6ac90ee553acd368abbd68c7a3e77ed3a33a872643bf0d5a2a21f，原period等历史门继续保留。首次完整contract门遗漏原Skills current版本断言（17→18），已精确更新唯一版本值，不削弱Skills字段/权限/路由断言；原失败日志保留。独立只读审未发现确定P0–P2。最终641个工程输入停写一致：format/lint/typecheck/contract/architecture/build及默认原manifest均0，contract694 PASS、architecture35 PASS、默认1292 PASS/3原资源SKIP；源码验证范围与原始收据只留Root ignored var/dev/library-filter-20261018。此为后端候选交付，不代替前端或正常环境验收。

当前App仍对已加载页做本地过滤，尚未固定此候选或展示稀疏页继续状态；后继必须接服务端query/reset/abort/cursor与UI实测后再称资料库筛选完成。正常BFF/App/Scheduler未为本片重载，正常Schema/账号/登录/权限/积分/任务不动；模型、实际工具、扣费、CI及远端PR继续暂停。原知识/正常配对文档余diff保留，不夹入本候选写区。

## 2026-10-18 Public17／Scheduler3 正常本地配对已验收（覆盖下文未激活记录）

用户明确授权备份恢复演练后更新正常环境。本轮先导出 BFF/Scheduler 两 owner schema，在独占临时库恢复并精确比较全部行及列；再演进 BFF 显式日历字段、退役 anchor/重复 next 列，Scheduler 增加 once/current 所需列与约束。演进目标与各 owner canonical 指定表的列和约束精确一致；两条原任务的内容、revision、暂停状态及历史 outbox/receipt 保留。演练失败尝试保留，只有最终成功证据用于切换；自有临时库均清理。

停止并确认旧进程终止后，正常环境按同一受检操作演进、加载 BFF a577625 与 Scheduler 3bb7ff6。另定位一条历史 daily 登记缺 task_revision：通过正式 Scheduler replace 管理接口以当前 BFF 完整定义/当前 revision/paused=true 配对，追加一个新 receipt；相同 key/body 实际重放 ACK 相同，原 receipt 逐行精确保留。不直接 SQL 修 Scheduler payload，不重写历史 BFF 命令。

最终复用正式 SchedulerTaskStateReader 核完整 trigger/body/tenant/subject/revision/target/policy，两个当前状态均 paused、next=null；BFF 全部事实与演练后的摘要精确一致，Scheduler occurrence/dispatch 仍零。正常 Web 同源页面真实回读两条任务，周三保留；多选菜单保持展开、Escape 返回触发器、取消草稿不落库，刷新后侧栏及任务正常。此次不是新建/启用任务、Agent/MCP 执行或模型验收。

本轮实际 BFF build 通过；本次生产源码与已完成本地 producer a577625 精确一致，沿用其完整门禁证据。正常配对原始收据仅 Root ignored var/dev/scheduled-normal17-20261018；无账号、权限、登录、积分、模型配置变化，无其他服务重启。模型/工具/扣费、CI及远端 PR 继续暂停，Agent 定时 MCP 管理及其他开放项不因此完成。

## 2026-10-18 Scheduler 3.0 配对与同一次触发管理（未正常激活）

基于d31455e同需求工作树固定Scheduler `3bb7ff61b0d72418aa048ca35b8c3f144a33f13e`／3.0.0，canonical SHA256 `d349eae8bba207074b1edf91acd9f08e94f39a27363441f45186c1799159c999`；唯一vendor/生成SDK配对，不双读。Public17／152 operations候选保持，当前3.0增量不再改SQL。锁内比较同一冻结once instant，允许到期后普通/完整规则编辑及启停，新建或改变instant仍须未来；不复制Scheduler耗尽事实或旧revision来源链。

ACK仅updated＋once/null next/paused=false承接耗尽，完整trigger、正文/revision、目标与策略仍核验；当前GET只有已证exhausted的once允许耗尽盖过产品paused，next为null。历史receipt不改写，当前读不从旧ACK恢复next。原定向规则与真实PG/HTTP先RED后GREEN，暂停/重新启用不复活同一次触发。

最终639非文档/README工程输入停写逐项一致：Node22 format/lint/typecheck/contract/architecture/build及默认原manifest全清单通过，contract692 PASS、architecture35 PASS、默认1290 PASS／3原资源SKIP；另独占fresh PG四个完整相关资源文件231 PASS／0 FAIL／0 SKIP，自有库清理。首contract门遗漏固定owner新增409目录的消费断言，已精确配对schedule_changed；首资源门230 PASS/1 FAIL定位为当前读fixture抢取R73保留的其他tenant pending command，两个原案例联跑实际RED复现tenant身份后，以独立事务锁住其他fixture行供真实SKIP LOCKED隔离，原权限/回执/耗尽断言保持，finally回滚释放。最终完整门全部重跑，原失败证据保留；独立只读审未发现确定P0–P2。

真实源码Scheduler3＋固定SDK/正式Delivery隔离HTTP已验同触发源past与consumed replace、当前读取/tenant404/错误凭据401和原ACK重放；实际等待planner以skip耗尽一次，4定义/7receipt/1 skipped occurrence/0dispatch，自有进程退出0、库清理。不是实际Agent/MCP执行或全产品浏览器验收。原始收据仅Root ignored `var/dev/bff-scheduler3-20261018/`。

正常库、进程与任务未加载候选；App17及Manus页面对照、旧非终态命令/未知ACK的正式收敛、Agent定时MCP管理与生产resolver仍OPEN。不得单独重载新owner或称自动化/MCP全链完成；模型/实际工具、扣费、CI和远端PR继续暂停，原正常知识演进文档/ADR及其他工作保留。

## 2026-10-18 调度 next 重复事实退休与取消观察修正（未正常激活）

沿同一 `d31455e568ca80f9d332bc9d3ab69a48409d7de9` 基线未提交周期候选，从 canonical fresh SQL、Fact/row/全部 task SQL 删除私有 next_run_at；不新增替代缓存、alias 或可选旧参数。Scheduler ACK 仍核完整定义/trigger/精度，但成功只用原 outbox ID＋owner/token/fence 原子结算 command，不写 task；失败同事务 task.status/revision 围栏保持。新 mutation ACK 的 next 为 null，历史 receipt JSON 不改；Details 继续读 Scheduler current。仅保原围栏语义，不冒称仅 lease_until 到时但未被接管也拒绝结算。

R280 已定位为测试观察竞态，而非改写 Project 生产取消流程：原客户端 abort 后，服务端可能尚未收到断线，先派出 ROLLBACK，再在 ACK 仍被 gate 阻挡时收到取消并销毁连接。私有两次时序记录分别复现通过与原断言失败；正式原案例改为同步真实服务端 signal，分别覆盖取消先于 ROLLBACK、ROLLBACK ACK 已在途两个窗口，两者均保未释放 gate 时恰好一次 destroy 及随后 GET200。没有删除断言、放宽 timeout 或改 Project 生产代码。12 个独立真实 PG/HTTP 定向子进程均通过双窗口；最终四资源文件完整 229 PASS/0 FAIL/0 SKIP，含本片六个替换缓存风险的原案例及原失败/revision/rollback保障。隔离 fresh installer 成功，自有库已清理；旧失败日志保留，不能以旧一次独立重跑替代本次定位。

直接固定 Scheduler8a 源码 smoke 再验 weekly/monthly/once ACK 和 current：4 definitions/4 receipts/0 occurrences/0 dispatches；无 next projection，严格 paused/null 读取，原 receipt 到点后重放与401/跨tenant404保持。自有子进程正常 exit0、测试库清理。只读复核未见本片新增确定 P0–P2，不替代主方验证。

主方最终冻结639个非文档输入，Node22按原配置串行执行 format:check、lint、typecheck、contract:check、test:architecture、build 及默认 test 原文件清单（只限制并发2）全部 exit0；contract692 PASS、architecture35 PASS、默认1290 PASS/0 FAIL/3原资源SKIP，验证前后输入无漂移。BFF git diff --check通过；Root有效计划原557–558两处历史尾空格保留，未因本片顺手整理。未把默认资源SKIP或229项相关PG组合冒全部集成套件通过。

正常库/源码进程、App Public16.2、正常任务均未变；未做本片浏览器对照，Public17仍未发行。过去 once 的普通编辑/暂停/重新排期、消费者和 Agent 定时 MCP 的可信管理/生产 resolver 仍待闭合。未提交、未更 Root index/gitlink；模型、实际 MCP 工具执行、扣费、CI 和远端 PR 继续暂停。原正常知识文档及其他未交接工作保留。证据仅 Root ignored `var/dev/bff-next-retirement-20261018/` 及 `var/dev/bff-periods-20261018/next-*`。

## 2026-10-18 ScheduledTask 权威当前读取（本地候选，正常环境未切换）

在 `d31455e568ca80f9d332bc9d3ab69a48409d7de9` 及原多周期未提交候选上接通正式列表/详情 GET：同 owner 单 SQL 读取任务及精确 revision 的登记状态；pending 不读 Scheduler，失败独立表示，成功才读固定 Scheduler2 current 并核完整冻结定义。4 路并发、当前读取阶段共享5s monotonic deadline、断线/超时取消贯穿；owner 返回后先重新准入，再核本地事实及项目可用性。本人删除后已暂停任务保留读取语义，active 且项目失效拒绝。Public17 未发行候选 Details 新增必需 `scheduling_state`，与业务 status 和 Agent 结果分开；旧 mutation ACK 原样，GET 不写 receipt/outbox，也不取旧 next 缓存。

主方冻结639个非文档输入，实际 format/lint/typecheck/contract/architecture/build/default manifest 全过且无输入漂移：contract 692 PASS，architecture 35 PASS，默认1290 PASS/3原资源SKIP。新 current 行为有真实 owner PG/HTTP 证据：next 推进、原 ACK 重放、错误主体/在途身份变化、任务改动、deadline/断线、SQL锁等待取消和耗尽连接池晚到归还。受控 SessionAdmission 与 Scheduler HTTP fixture 不冒真实 IAM；另直接对固定 Scheduler `8a26c91aa24d1f48a760b6234ab1ed5855d20936` 源码验 paused weekly/monthly/once，4 schedules/4 receipts、0 occurrences/0 dispatches，子进程正常退出且自有测试库均清理。

保留实际失败而不以重跑抹去：首轮完整 contract 690 PASS/2 FAIL 源于 runtime 过早解析无关测试 store 的 scheduled service，改为窄闭包延迟解析后原18 focused通过。下一轮 architecture 暴露 reader 越过唯一 generated 边界；decoder归回 control-client，未放宽 allowlist，72 focused通过。只依赖 timer 的预算路径有真实1项 RED，补同一 monotonic deadline 后4相关用例通过。四文件真实 PG/HTTP 曾229 PASS；最终源码重跑为228 PASS/1 FAIL：原 R280 post-SELECT-ACK cancellation 的 ROLLBACK 观察断言失败。该用例独立再跑1 PASS，不能据此称修复或确定为既存问题；原 Project 生产路径和该用例断言未改，取消时序仍待具名定位。R278 fixture仅将孤立 task UPDATE改为真实同事务暂停 helper，承接 task revision 与 command，原历史读取/回执断言保留。

本片未提交，正常库/运行进程未加载候选，Web仍待固定 Public17 和页面配对；未做本片浏览器验收或宣称 Manus 布局已对齐。旧 BFF next 列/ACK成功投影退休、once 到期后的编辑/暂停/重新排期、Agent 定时 MCP 可信管理入口与完整执行链均未完成，沿原需求继续。模型、实际工具调用、扣费、CI与远端 PR 暂停；Root index/gitlink未改，既有无关修改保留。

## 2026-10-18 多周期规则、存储和调度命令候选（未正常激活）

沿d31455e工作树继续，未提交/发布。Public17.0.0／152 operations，canonical SHA256 `927061352ba9a257b59b86a2be1a744a013bbc3d5758137fe6e53a162654a18a`，局部旧block完整逆回16.2再串原历史链。新增独立calendar边界：weekly多星期、monthly多日期、once本地日期/IANA→冻结UTC；完整规则PATCH清旧选择，不再推断或接受anchor。canonical arrays/date/run_at、repo事务、outbox4及cron/run_at映射同步，锁序和revision/lease/fence保持。Temporal0.5.1及jsbi4.3.2固定；八份依赖manifest只由既有generator更新lock摘要，generated源码无差异。

新输入6项、映射/冻结2项及契约先实际RED后实现；fresh真实PG从23514约束失败到规则切换、时区无关DATE、once未来检查/回放通过；原outbox资源文件已配对23 PASS。新增真实HTTP/PG验证周/月选择、跨subject404、服务重启后once原ACK回放；只控制Date时钟，不把它冒实际等待到点。退休请求在claim前400/零写，仍有效请求保持原终态；旧unknown ACK必须在正常切换前收敛。

两次完整相关格式/lint/type/contract/architecture/build与默认原manifest通过，最后一次完整门为contract692 PASS、default1285 PASS/3原资源SKIP，635非文档输入停写一致。随后发现owner一次性timestamp去零序列化差异：loopback正控RED，改为完整instant身份比较，并保纳秒不同due拒绝；outbox4另拒绝会被Date归一化/截断的非canonical instant。最后两文件增量后，fresh build、正式格式/lint/type与151 focused PASS/0SKIP，636非文档/README输入停写一致；未把此前完整默认门冒增量后的再次全量门。

真实源码Scheduler 8a26c91＋固定SDK/正式Delivery接通三类规则与原回执验证：4个paused定义、4receipt、0occurrence/dispatch，进程退出0且自有库清理。四个真实PG/HTTP相关资源文件首轮226 PASS/1 FAIL（R280 Project取消ACK时序）；未修改该生产逻辑或断言，基线d31455e同组合225 PASS，当前完整重跑227 PASS/0SKIP，不宣称已修复这项间歇问题。最后timestamp两文件修复单独通过上述151及真实Scheduler，不冒所有资源的最终停写全量重跑。完整资源证据仅Root ignored var/dev/bff-periods-20261018，自有基线归档/库/进程已回收。

未改正常数据库、进程、任务开关或App消费者；SQL/API候选与正常16.2/旧anchor仍须正式配对。持续权威next投影、once耗尽后的暂停/普通编辑/重启用语义、App/Manus对照和Agent定时MCP可信管理/实际resolver仍OPEN，不因基础规则通过称完整自动化完成。模型/实际工具执行、扣费、CI及远端PR仍暂停；原正常知识文档dirty与ADR保留。

## 2026-10-18 Scheduler 2.0 固定消费前置已验（未正常激活）

沿基线1dbfd826固定Scheduler producer 8a26c91aa24d1f48a760b6234ab1ed5855d20936／2.0.0及完整digest，替换旧vendor并正规生成。当前GET与不可变写ACK分离；生成流程从唯一固定owner文档派生互斥trigger、required/closed与耗尽条件，不手改generated。current client保可信tenant/request ID、专用service token、no-store及资源绑定；caller取消贯穿Request/stream，完整纳秒instant比较不截断。

原条件缺口与独审两项P2均实际RED→GREEN：两个trigger/缺trigger、非法current；请求发出后的取消及亚毫秒不等值。最终633非文档输入停写hash一致；Node22 format/lint/typecheck/contract/architecture/build均通过，contract691 PASS/0SKIP、默认原manifest仅限2workers为1276 PASS/3既有资源SKIP。首全门失败来自私有runner的umask077将测试0644文件收紧为0600，已实测077→600、022→644，恢复子进程正常mask后原18例及完整门通过；未改该测试或产品鉴权。

固定SDK→独占fresh PG/源码Scheduler真实HTTP通过：current读取、tenant404隔离、错误服务凭据401、暂停once跨due后原ACK精确重放；1定义/1receipt/0occurrence/0dispatch。自有进程退出0且临时库已删除，不冒实际MCP/模型执行。独审P2关闭；完整BFF资源integration未运行，此前组合缺口不变。

本片Public16.2/SQL/任务模型/outbox3不变，未在30s lease链盲加GET，未改正常库/重载正常服务或启任务。多星期/月内多日期/一次性本地日期、持续next投影、App配对与Agent定时MCP管理/可信执行仍待后继；模型、工具执行、扣费、CI及远端PR继续暂停。

## 2026-10-18 自动化权威锚点当前读取（本地候选，未正常激活）

沿56c262c补当前GET列表/详情的ScheduledTaskDetails，返回已存UTC recurrence_anchor_at，与nullable next_run_at独立；原写快照/schema/mapper完整保持，历史终态原样重放，不改通用幂等、数据库或回执。Public16.2／152 operations，SHA-256 `e4c1b3b1d327994dd5e903bfb3b3a075ded24446c0173a0f1c15a75cab92ae80`，新增读表示完整逆回16.1；Web固定消费/星期编辑尚未接，不冒正常页面完成。

初版共用响应required字段虽测试通过，复核确认旧终态绕过mapper的P2；正常库仅只读计数15条成功旧ACK均缺anchor，未读出正文或修改。先改三面裁决，再用原weekly case及当前契约case复现RED2→GREEN2，收敛当前读/不可变ACK两个真实生命周期。独审13个停写非文档SHA匹配、复核P2关闭且无新增确定P0–P2。只新增一个契约case，原weekly/PG用例扩断言，没有新suite。

最终Node22配置format/lint/type/build、contract691 PASS、architecture35 PASS、focused62 PASS均通过；默认原manifest全清单仅限2workers，1272 PASS／0 FAIL／3原资源SKIP。独占fresh canonical PG/HTTP原用例1 PASS／0 SKIP，覆盖原格式写ACK、当前列表/详情anchor、重启读及原样创建重放；Scheduler/Agent仅受控loopback，不冒正常调度或模型执行，自有库已清理。首完整contract一项旧版本字面已精确16.1→16.2；首默认与contract内部清dist/build重叠导致模块缺失，未改断言或缩范围，最终全部串行复验。13源码输入停写前后保持；原始收据仅Root ignored运行目录。

没有改正常数据库/配置/登录/权限/积分或重载正常进程；模型/实际工具执行、扣费、CI、远端PR与Root gitlink均未操作。完整真实integration本片未跑，此前组合两失败仍OPEN；知识正常激活、记忆导入、其他周期及全产品/正常浏览器验收继续待办，不以本局部候选满足合并条件。

## 2026-10-18 本人知识后端（候选已验；Web/正常库未激活）

沿基线24dcf7d与前轮调度mixed继续，主方唯一writer，未提交/发布。本人知识与独立usage新增六正式候选operation：Public16.1.0/152，完整剥离新增块后逐字节恢复原Public16.0 SHA e15758fa…；旧Skills/MCP/个人资料wire、外部owner pin/generated、角色/凭据/依赖不变。正文500/500/2000，最多100有效项、全量字面查询；固定UUID＋CAS，删除清正文留tombstone防ABA，关闭不删知识，未知COMMIT只读核实。

三设计面、canonical两表与readiness/原服务装配同步；input/HTTP/port/PG按职责拆分，无新服务/转发service/receipt/cursor/向量或模型。新功能初始真实HTTP404与预期列表不符RED后实现。独审发现并实测修复三项：chunked mutation被误拒、已退休请求仍有I/O、新operation未绑定正确wire schema；对应RED→GREEN和正式semantic变异复核关闭，无剩余确定P0/P1/P2反馈。不以静态审查替代测试。

最终607源码/测试/契约/配置输入停写hash一致：正式format:check、lint、typecheck、contract:check、architecture、build均exit0；contract690 PASS/0SKIP（保原3warnings），architecture35 PASS，原default全清单仅限并发2：1271 PASS/0FAIL/3原资源SKIP。首完整门的新CHECK未具名和active版本断言仍16.0两类失败已分别改为具名约束、明确16.1 current断言，82项定向80PASS/2原SKIP后重跑完整门通过；旧版本及完整父逆未放宽。

final fresh canonical PG/HTTP知识整文件6 PASS/0SKIP：可信主体隔离/输入拒绝零写、原文/字面查询、CAS竞争、删除不可复活、独立开关、99项时并发限额、真实chunkedPUT/DELETE及413、实际COMMIT后Proxy抛错的unknown恢复、INSERT ACK后abort回滚、真实advisory锁等待取消。unknown不是TCP ACK丢失；未冒正常IAM或进程重启矩阵。另以独立fresh库回归原Scheduler receipt/outbox两文件37 PASS/0SKIP。自有库均删除、残留0；无正常业务库、服务主动重载、模型/Agent/Tool/Billing、CI、远端或Rootgitlink操作。精确证据只在Root ignored var/dev/knowledge-20261018。

后继：具名正常库additive演进/备份恢复、固定producer提交后Web正规消费及真实用户界面验收、可信Agent消费与记忆导入仍OPEN；不把后端候选称已应用到所有任务。完整真实integration没有重跑/宣称通过，前轮广组合两项时序/fixture失败仍保留，不以本次43个定向PASS抹掉。调度旧v2处置与monthly/once/持续next继续推进，聊天/项目后置；模型/扣费/CI继续暂停，PR等本轮功能收尾后再推进。

## 2026-10-18 调度 callback 版本围栏（源码候选；正常激活未验）

基线 `24dcf7d99a85ae620d279c2a6147e9237377c2e6`，主方唯一 writer，未提交。沿原 BFF ScheduledTask→Scheduler opaque callback→receipt→锁内 accept 接线：outgoing 带 frozen task_revision，缺失/非法 revision 在 receipt claim 前拒绝，首次及恢复 snapshot 均核原版本；现 accept 行锁/CAS继续承接读取后竞态。outbox schema_version2→3，不复用旧 key 改造 payload；无 public16/SQL/vendor/generated/依赖变化，无新服务/模型/扣费或正常进程主动重载。

原回归真实 RED 四项（旧回调错误接纳、非法值进入claim、outbound缺版本、旧outbox版本）→focused23 PASS；恢复snapshot错版本追加实际 RED→GREEN。独立只读审查抓到业务集成暂停fixture错用旧revision，主方独占 fresh PG 复现1 FAIL后更新为当前revision暂停正控，并保旧revision拒绝断言，最终1 PASS。不为过旧fixture调换生产校验顺序。

停写生产后完整 format:check/lint/typecheck/contract:check/test:architecture/build exit0，contract687 PASS、architecture35 PASS；原默认清单 concurrency2：1268 PASS/0 FAIL/3既有资源 SKIP，598 tracked验证输入hash稳定。之后唯一测试变动是 business-store.integration.mjs，该文件不在默认test/contract清单；补做其格式检查与真实PG新旧revision主路径1 PASS。最终真实PG按独占库再验原 Scheduler receipt/outbox两文件37 PASS/0 SKIP，未启动真实Agent/模型；自有库全部删除、余量0。证据仅Root ignored var/dev/schedule-revision-20261018。

扩大到业务集成整文件的组合尝试为210 PASS/2 FAIL，**不称完整 integration 通过**：R280 Project status取消清理用例在组合中失败；在原HEAD独立候选与当前源码各自fresh隔离均1 PASS，尚未定位组合/时序原因，不定性为历史产品缺陷。另一receiver Agent调用计数2!=1，按文件fresh隔离重跑37 PASS；跨文件共享fixture的干扰原因仍须核实，不能以重跑抹掉失败。项目业务按用户顺序后置，完整owner/PR验收仍OPEN。

激活停止线：未核正常库旧v2 command/已登记schedule。旧未终态v2 claim后解析失败可阻挡同task后继并影响同批投递，仅正式mutation产生新revision不足以迁移；先具名owner处置到终态再重新登记/核回执，未完成不激活本候选、不改共享行、不清receipt。monthly/once、anchor回投/持续next、知识CRUD/记忆导入及完整功能页仍未完成。本片不冒整链或正常调度闭环；模型/扣费/CI持续暂停，现PR仅在本轮完整收尾后推进。

## Provider 示例内容校验（2026-10-17，局部源码修复）

基线 a804b0f。`mcp-provider-admin-input.ts` 原将示例套入 trim-equality 标识校验，拒绝 owner/canonical 已允许的首尾空白；仅改 example_prompts 的专用校验，保持非空白、1000 codepoints、合法 Unicode 和最多10项，保原字符串及顺序/重复。其他身份、URL、scope、CAS/权限/命令恢复不变；无 wire、pin、SQL 或依赖变化。

现 HTTP suite 的合法更新真实 RED400→GREEN200，回包/owner入参保 LF/CRLF/首尾空白/重复和1000😀；非法空白、孤立 surrogate、1001😀、11项均400且零 owner 调用。focused7通过；Node22 lint/typecheck/build/format:check/contract:check/architecture/default均0，contract687 PASS、architecture35 PASS、default1266 PASS/3既有资源SKIP（原 manifest 全文件，仅限2workers）。未跑真实 PG/Redis集成，未涉及事务或 Schema。

正常后台沿旧 BFF 已验 LF/重复创建/改名/回读/停用；新首尾空白 parser 尚未重启正常 BFF，不冒正常已激活。Skills F/6仅草稿，E/5与已安装版本未修改；无模型/Tool/Billing调用、配置/角色/积分或远端/Root gitlink变化。完整Skills/MCP、来源caller、真实执行/资金与PR聚合仍 OPEN。

## 项目 Skills 安装 API 已接线（2026-10-17，本地源码）

BFF 固定 Platform `5ec8538`，Public15.1.0／145 operations 接入项目安装、显式更新、启停、移除、详情与列表。复用现安装 route/client/digest/mapper（统一命名 skill-installation-*），无新表、依赖或兼容入口。项目身份取当前 BFF 项目资格，调用前后复核；owner 回包绑定项目、请求资源与操作状态，错资源/错操作/未知 wire 不作为成功或可重试依赖故障。public skill.list 的项目读取已切正式 Project RPC。

原 HTTP 旅程内补回归，错资源实测 RED→GREEN；Node22 完整 lint/typecheck/contract:check/test:architecture/test/build/format:check 通过，contract686 PASS、default1263 PASS／3 原资源 SKIP、architecture35 PASS，测试仅限2 workers但未缩文件列表。首次旧 HTTP pin fixture 两失败已更新当前 commit 字面，原摘要/断言保留；最终源61/61冻结一致，独立只读复核无确定P0–P2。未跑真实PG/Redis或正常浏览器，此片无SQL变化；正常服务/配置/权限/积分及模型/Tool/Billing未动。

下一步配对退休 Platform Personal 项目读取，再替换项目名称开关和会话缺省／显式[]选择，接App/Agent精确版本冻结。本次只交API接线，不代表项目功能、正常组合或整体目标完成；远端CI/push/PR/merge及Root index/gitlink继续暂停。

## S2 来源事实消费（源码候选，2026-10-17）

沿 a7dd8e7 精确固定 Platform e172838 的 acquisition/RPC/HTTP6.1.0/profile，当前公开 artifact15.0.0（仍/v1/139 operations）仅将 skill.list 的 owner_type 扩为八类；网站与分享维持真实归属五类。hub/unknown/direct 据正式安装事实投影，坏 enum/绑定拒绝；没有 Device 发现或 OpenApp 身份 producer。只替换原 current RPC/HTTP vendor，其他仍用政策 pin 保留；acquisition 不进入全部个人 ACK/详情字段。

固定 hey-api 0.99 将 owner if/then 生成 unknown intersection并遗漏条件，实际 RED 后由原生成流程精确补齐 installed=true 必须带 acquisition_kind；没有手改 generated 或放宽 owner 条件。随后独审 P2 指出 generated 会先剥离嵌套未知 product 字段，原 HTTP 负控复现；改为 preprocess 原始严格 product，再走 generated acquisition/顶层 strict，实际 RED→GREEN。原 R345 源码字符串断言随重构退役，其风险由同一既有真实 HTTP shape/UTC/examples/额外字段矩阵承接，不为了消除失败删行为负控。86 相关测试、typecheck/build 通过。首完整 contract 为678 PASS/4 FAIL，均回溯到 local-import 成功 fixture 缺新 acquisition 字段；显式补 DIRECT 后该文件与原 HTTP 矩阵46 PASS，不改业务或删拒绝断言。publisher 负控细化为合法 personal/first_party/iam 正向基线，仅加嵌套未知字段，避免同时依赖配对错误。最终48/48非文档冻结匹配，增量只读复核确认 P2 闭环、无新增确定 P0–P2。

停写后主方 Node22 完整 format:check/lint/typecheck、contract:check 全链、默认 test、test:architecture 和 build 均 exit0。contract **682 PASS / 0 SKIP / 55.33s**，默认 **1259 PASS / 0 FAIL / 3 既有资源 SKIP / 57.45s**，architecture **35 PASS / 0 SKIP**；contract/default 使用原 manifest 全部文件，仅显式限2workers，没有省略文件或永久改 package脚本。两生成器 --check 包含两轮 byte-identical，公开139 operations、14.8完整inverse保持；原3项lint warnings仍在。不新建suite，不重复3k项Web测试。canonical SQL、lockfile与六文档原基线suffix逐字保留；未运行真实PG/Redis完整组合，无Schema变化不冒真实事务证明。

本片无 SQL/Schema/lockfile、配置/登录/权限/积分、正常进程或模型/Tool/Billing 变化；HTTP/Connect 为真实 loopback、owner/IAM 受控，不冒正常应用数据库配对或完整用户验收。App/Admin 固定消费与项目选择/exact installation/Agent Run冻结仍未交，正常 BFF 行为仍 b4292b6，正常 Platform 仍行为0581429。远端 CI/push/PR/merge 与 Root index/gitlink继续暂停，完整目标保持进行中。

## 2026-10-16 skill.list 核心能力复核（文档纠正）

沿b4292b6重新核官方v2文档/机器源与当前公开canonical及聚合/路由；没有更改生产源码。七个字段及双方均未声明item required已相等；来源词表尚缺hub/device/unknown，不能用旧五类记录宣称完整对齐。包含停用安装且GET不启用、项目资格返回前重核、真实creator/时间与stable series ID已有现实现和受控证据；任务选择/项目默认与Agent pin端到端仍未闭环。

重点区分官方caller矩阵与现有Kokoro fresh human admission：原APIKey/OAuth资格OPEN并未因网页可登录而关闭，后继应由IAM可信caller事实与owner资格正式承接，禁止body/header自报或服务凭据替代人类。网站RPC与公开skill.list是不同现行契约，不按名称任意删别名。详见API_CONTRACT本日前缀；它修正参考/current/target的边界，不发行新的枚举或临时认证入口。

现有 `node --import tsx --test --test-concurrency=2 test/contract/skill-specification-http.test.mjs`：**64 PASS / 0 FAIL / 0 SKIP / 1.710s**，无新增测试；HTTP为真实loopback但owner/IAM受控，不冒真实资源/普通账号完整验收。第一次本地元数据比较未解析官方items.$ref而停止，未收集产品测试/改源码；改为显式解析官方Skill组件后字段比较完成，不把脚本启动错误当产品缺陷。此为文档任务，仅diff及新增链接检查，不重复构建/完整业务门。无新服务、数据库/权限/资金/模型/远端/Rootgitlink变动，完整目标保持未完成。

## 2026-10-16 Skill Share 创建/Resolve 活动版本资格（本地交付）

基线c6bb5d3。正常产品已证明本人withdrawn revision2仍Inspect200，原Create201/Resolve200却Summary404；不是Web需停认证或允许撤回摘要。创建是BFF-owned locator，不新增资源ACL，每次owner仍按当前调用者判断。原route只用允许本人预览的inspect作share资格，遗漏已存在的exact active/valid metadata约束。

主方唯一writer沿原route抽取同文件readSummary（既有strict schema/source绑定/取消），Create在持久化前及回执前、Resolve重新读取，保原inspect与creator DELETE。不换current/不fallback、不改Schema/wire/owner/鉴权或增加依赖。原HTTP同一用例改为inspect可成功但summary拒绝nonactive，实际RED为withdrawn resolve200!=404；扩四种inactive/已有locator/缺依赖/坏UID或额外字段/迟到取消/提交后撤回，仍原4case。三相关HTTP文件73PASS，manifest lint/type通过；该仓没有eslint，误调用未启动检查，随后使用正式manifest入口，无安装或降门。

独立只读复核无确定新增P0–P2。曾推演inspect忽略取消导致后续create，但追到正式Connect client后确认await后已有abort guard，撤销该生产P2判断，不用缺保障的double冒真实缺陷。取消回归覆盖summary的延迟返回；原caller identity、返回前准入与正式client预算保持。预检失败零create；创建已提交后撤回只阻止误导201，不能声称BFF locator回滚或自动revoke。SQL/真实PG未改，本片先按最低充分层HTTP资格与现repo事务证据分工，不把mock当真实资源集成。

停写冻结五路径后，主方 Node22 完整 format:check、lint、typecheck、contract:check、test:architecture、默认 test 和 build 均 exit 0：contract 678 PASS / 0 SKIP、architecture 36 PASS / 0 SKIP，默认 test 原 manifest 清单以 concurrency=2 执行，1257 PASS / 0 FAIL / 3 既有资源 SKIP（61.40s，测试本体57.46s）。独立复核冻结5/5 SHA一致、无新增确定P0–P2。没有新增 suite/case，也未运行全量真实 PostgreSQL/Redis 集成；HTTP double 不冒充真实 owner 事务。

正常受管 BFF 通过原管理器 SIGTERM 后加载同字节源码，旧三进程退出，管理器参数/环境与已指纹配置文件原字节不变；App/Platform 未重启，三服务健康200。正常3310产品会话实测：原 withdrawn revision2 的 Share POST404 skill_not_found，UI显示失败；原旧链接 Resolve404。active 样本 Share201并复用既有同一 locator，随后 Resolve/Summary/package 全200，source_ref/decimal revision 精确一致，真实 SKILL.md 可读、原已安装状态保留。未调用启用/安装/撤销，未对正常库计数或声称正常零写；拒绝零create来自HTTP回归证据，clipboard桥仍未证明。

前端cd78cb9另已真实验 active 分享在390×480中实际 scrollTop324，自然120s重核后仍324、同Dialog；非默认嵌套文件仍仅受控证据。临时tab49关闭，Network关闭，无新增常驻服务，测试/临时预览端口已释放。完整Skills/MCP/Admin/手册及远端聚合继续OPEN，远端CI/push/PR/merge与Rootindex/gitlink保持暂停。

## SKILLS-ADMIN：discard 当前准入与重放负控（2026-10-16；测试增量）

基线 `d176e3d`，仅扩现有 `test/skill-admin-http.test.mjs` 的 machine-credential 拒绝用例，无生产源码、公开契约、Schema、依赖或凭据变化。保留原 root GET/POST，加入 discard 和 admitted tenant 错配；session/tenant 拒绝均零 owner 调用。action 用例先成功 discard，再撤销 fresh action，以相同 key/body/CAS 再请求，得到 403 且 owner 调用仍只有首次一次，确认服务身份与已成功命令都不替代当前人类 action。授权成功路径另核 native discard operation、可信 tenant/subject 与原请求成员。

主方 Node22：focused 文件 **15 PASS / 0 SKIP**；正常完整默认入口以相同 manifest 文件清单、显式 test-concurrency=2 执行，**1257 PASS / 0 FAIL / 3 既有资源 SKIP / 57.77s**，lint/typecheck/format:check/build 均 exit 0。未新增 suite，只增加一个 tenant 参数风险；未重新生成/发行 contract 或宣称实际 IAM 撤权、真实 owner 数据事务及正常 Admin 页面全部通过。该 HTTP 为真实 loopback listener，session/action/owner 为受控替身；真实事务由 Platform 独占 PostgreSQL receipt 文件 47 PASS 独立证明，各层证据不互相冒充。

本片无正常服务重启、账号/角色/积分/模型请求或共享库写入。后台新样本的终态删除仍待单独确认；远端 CI/push/PR/merge 与 Root gitlink 不变。

## AUTH-P3：BFF 全 Platform 用途移除内部机器 OAuth（源码候选，2026-10-16）

沿基线 96089d8，本仓固定 Platform `9be81465d487be2499a68a76664c14b73c16024b` 的独立 auth profile 1.0.0、provenance 与 digest；当前 Buf module 与唯一 Connect vendor 一致。六用途 catalog/projection/skills_admin/mcp_personal/mcp_admin/custom_api_personal 都使用直接服务凭据；删除 Catalog/Skills Admin 四个 OAuth parser/token/cache source 及 retire。旧专属环境变量拒绝且无 alias，新路径见 `.env.local.example`。每次仍做 Product Session/fresh human action 检查；机器身份不替代权限，用户 Bearer 不传 owner。

公开14.8/139 operations、HTTP6 独立 pin、Proto/两套 generated、canonical SQL 与 lockfile 原字节不变；build 先清理候选 dist，避免已删除 OAuth 入口残留。旧 OAuth-only 测试随已删实现退役，其文件权限/轮换/取消/close 风险由现直接凭据套件承接；新增真实 factory loopback 验五 client 精确 purpose/零机器 IAM，本地导入四正式路由亦为 direct/零 mint。session 与 fresh admin action 拒绝时 GET/POST 均零 owner 调用。malformed private JSON 错误原会带入输入片段，实际 RED 后改通用错误、不挂 cause。

最终 Node22 全门：typecheck/lint/build 通过；contract:check 668 PASS/0 SKIP（保留原3 warnings）、默认 test 1247 PASS/0 FAIL/3 原资源 SKIP；相关格式/diff检查通过。只读审查指出失效 Buf 路径 P2，实际 RED→修正 canonical module/生成器输入检查→重生 manifest→5 pin tests PASS，已复核关闭。最初两项 local-import 测试仍断言机器 IAM 配置/旧 OAuth fixture，迁为 direct fixture并保原四路由/取消/10秒预算，不删风险断言。日志仅本地 `/private/tmp/kokoro-authp3-bff-*`。

源码候选不等正常配对。正常 physical 仍保持 96089d8/Platform e157011，未重启或改私有凭据/用户登录配置；新独立服务凭据部署与配对启用已另行请求确认。没有数据库/积分/模型写入，未操作远端 CI/push/PR/merge 或 Root gitlink。真实 Admin 运营生命周期、完整执行链、MC-01/System/Agent/Billing 仍为后继。

## SKILLS-UPDATE 正常产品组合后补验收（2026-10-16）

业务源码 BFF `615b16a`、Platform `11cb760`、App `d40c839` 已在用户批准的本地源切换后完成正常 Product Session 的自有安装 v1→v2。Web 显式确认前无写，确认后唯一 update 200、同安装 GET/列表 GET 200；独立正常登录回读确认同 installation/series/installed_at/enabled=true、精确原 offered target、更新入口消失且刷新保持。无 Remove/Install、直库写、模型调用或充值，积分/held/流水内容未变。

认证边界仍有 ADR-035 后继：个人安装写默认 CatalogTokenSource、Skills Admin 默认 SkillAdminTokenSource 仍是内部 IAM OAuth；本次业务成功不证明这两条链已改 direct service credentials。人类 session/action IAM 检查继续保留，后继按 ADR-035 收敛全部 Platform 用途，不新增兼容 fallback。

本轮仅该操作 happy path 和新版示例交接，不把健康检查、受控 RPC loopback、未知 ACK/并发单元或隔离 PG 扩成正常浏览器全故障验收；Admin 消费基线及正式 Agent/Billing 执行仍有后继。未改 canonical/machine pin/SQL/配置/凭据，远程 CI/push/PR/merge 与 Root gitlink 保持暂停。下节“未正常激活”保留为前一源码阶段记录，由本节后补事实续接。

## SKILLS-UPDATE U3：显式更新 BFF 源码已接，App/正常产品验收未完成（2026-10-16）

组合基线 `d845164` 保留当前 MCP/Custom API 生命周期与 direct service credential；本地新增 public 14.8.0 的 `POST /v1/skill-installations/{installation_id}/update`（139 operations）。Connect 唯一 current pin 为 Platform `11cb7604a5385047fd872cedc8a55273eae59043`，从精确 Git publication 复制 Proto/descriptor/update profile/provenance 并正规生成；原 current Connect vendor 被替换，不留双读。独立 HTTP projection `6b4c9db`/6.0 pin、SQL/schema、依赖与运行配置保持原字节。

更新每次（含重放）fresh session/tenant + IAM install action；strict UTF-8 两 pin 输入拒重复键/未知身份/尾换行/null。command ID 绑定 operation/可信本人/安装/key，digest 绑定两 pin，未知重放仍用原 A→B/key。同 ID、精确目标、installed=true、upgraded/event_id、无 unknown wire 是 ACK 出口条件，enabled=false 不被自动打开。无 BFF receipt/数据 writer、Remove→Install、自动重试或运行时协议 fallback。

审查补收旧共享 reader 的实际缺口：partial JSON 停住时旧 iterator 不再收到 chunk，超过原绝对预算仍等；新增实际 listener 先 RED（直到客户端 1 秒兜底仍无返回），修为按原单调预算/取消清理 reader，update 到期返回 typed 504/no-store/Connection:close，未完成请求不再 keep-alive。最终用例在回复后等待自然 close、不由客户端主动 destroy，owner 零调用；413 排空/先回复和其它 Skills 正常输入保持。

主方 Node22 本地候选验收：lint/typecheck/build、完整 contract:check 均 exit0（contract 661 PASS/0 SKIP；3 项既存 lint warnings），默认 test **1247 PASS/0 FAIL/3 原资源 SKIP**；具名 input/HTTP/pin 32 PASS。官方 generated binary Connect loopback验证 exact request/credential/FQ method、原 key/pin 重放、改 pin 同 key 409、disabled 保持与错误 ACK 拒绝；owner 独立 digest fixture一致。真实 IAM/Platform/Storage/PG 正常组合、本地当前账号 A→B/刷新和 App 显式更新仍未验；loopback 不是 owner 事务证明，后者见 Platform 的独占 PG 证据。

正常 physical BFF/Platform/App 本轮均未重启、切分支或修改配置，没有模型/资金调用、充值、远端 CI/PR/push/merge 或 Root gitlink；保留原 PR。下一步为 App 固定 BFF contract、同版本更新/试用意图与正常产品旅程。MC-01 的连接版本切换已获用户明确确认，沿原 System/Agent 计划实施；正式资金许可前不发送模型请求。完整 Skills/Admin/MCP 目标仍未完成。


## SET49完整隔离资源门终态

正式合并artifact commit 30df0c428c592ed2710d62035ceb5855d20c7506；public16.0.0/146 digest b4e91483e425fdcc9547eac8bcda554273cbee0863ccb0ddfb185fae18e4e267，Billing唯一pin cd92c728d8f658f54b254d5cbfd28156ca426dc1不变。完整fresh canonical integration实际321PASS/11FAIL/332，自有四归档用例全部PASS；完整资源门FAILED。失败包含既往Project拒绝矩阵、upload503/502与原生SQL/schema边界，另terminal/deletion race此次failureClaim为undefined触发tenantId TypeError；该test及outbox repository与合并前源码字节相同，但不将本轮失败冒旧通过或已修复。未修改任何失败oracle，未宣正常IAM/模型旅程。自有fixture精确清理后PG数据库/Redis库存恢复，正常服务未动。证据追加提交不改变已发行public字节或消费者pin。

## SET49：主线与设置归档合同集成

合并主线已批准的MCP public四写删除及既有设置/归档能力，以16.0.0/146发行（breaking删除，不冒minor）。integration-public-contract.mjs逐字节验证完整当前合同及有序清单，精确恢复原15.4全文/150后委托全部原inverse和oracle；main贡献保留，不修改Skills/MCP业务。Billing唯一pin使用正式experimental.5发行，保三读与严格专用404；正规contract:check791PASS、architecture37PASS、format/lint/type/build0；默认测试终态1417PASS/0FAIL/3SKIP。最初default唯一失败为旧v1 owner fixture，已按唯一正式v2配对更正路径且原余额/身份断言保留。Billing pure1433PASS/492SKIP、真实自有PG本人HTTP25PASS；两仓完整integration将后续串行自有资源执行，当前不宣完整资源门通过。正常服务不变。

## SET47 Root隔离验收与消费者发行（2026-10-15）

Root独立核31交付文件及638保护文件对eec3244完全精确，public15.4/150完整逆恢复原15.3全文与146有序操作；终态独审无剩余确定P1/P2。Root正规lint/type/build通过，contract772PASS/2FAIL、architecture36PASS/1FAIL、default1395PASS/3FAIL/3SKIP，format7warn，完整门仍FAILED。上述三合同/架构失败的共同首步在原15.3 Gitblob也实际抛Admin Skill draft version drift；不修改Skills旧oracle来清零。

Root fresh canonical安装及catalog archived_at精度/nullable/三partial indexes检查通过。四项真实HTTP→PG归档专项4PASS/0FAIL（约1.69s含进程）：正规创建/分享/归档/状态/恢复、历史receipt零写、同毫秒Unicode排序、foreign/invalid-parent、并发同key、锁超时后pool恢复、Move与Projectdelete竞争；使用明确admission double和idle workers，不是正常IAM或模型执行证明。正常串行全部integration322PASS/10FAIL/332（约122s），失败保留：Project负控Skills依赖503三subcase与其父case、upload预期503实502、五项原生SQL/search_path/schema边界；未归因修复，不冒全部既有/全绿。测试owned DB与Redis库存精确恢复，旧正常服务/数据未动。

本提交发布不可变consumer artifact供Web继续实现；PR保持draft，无生产合并/完整设置完成声明。后续仅以正式pin配对在独立fresh fixture实例验Web空态和操作；非空正常任务依赖Agent/model准入，不能seed正常数据冒功能完成。

## SET-47 归档/恢复实现候选（2026-10-15；待 Root 资源验收/发行）

BFF唯一Conversation owner已在现非Nest入口实现四个具名操作：本人归档列表、本人archive-state读取、archive、restore；public候选15.4.0/150。普通任务列表仅排除archived；旧Chat wire/直接读/rename/move/分享/Run不变。没有新增owner、框架、依赖、env、cache、迁移runner或跨仓源码。

D0和canonical见三设计SET47前缀。普通文件`src/http/archived-tasks-input.ts`负责strict输入/身份与limit绑定cursor/安全投影；`src/http/routes/archived-tasks.ts`负责单入口总预算与准入/HTTP生命周期；`src/infrastructure/postgres/archived-tasks.ts`负责同库本人查询与Project→Conversation/receipt事务；`archive-sql-lease.ts`只拥有精确有界lease，不停pool。内部调用为具名Readonly query/command。普通Chat service/port/repository与bootstrap仅窄接线，不改旧删除清理和share/Run事实。

已保留真实旧dist HTTP四操作断言失败，再实现GREEN；新输入/HTTP/repository/contract和原三代contract消费者专项50PASS。正规lint/type/build、semantic150、OpenAPI lint通过；正常contract:test为772PASS/2既有R357FAIL，旧oracle不改；format保留原7warn。architecture正常门36PASS/1FAIL，具名旧集合过滤case在原15.3 Gitblob与原测试同样Admin Skill draft version drift，保留不冒新增或已清。完整仓测试/正常组合不在本worker执行范围。 lease另有具名clock前移/timeout尚未触发的真实RED→GREEN，实际SQL微任务派发前重核released/signal/deadline，过期零dispatch并销毁精确client。原生raw HTTP证实dot-only历史ID可达；Web的WHATWG传输限制按三设计保持禁用说明，未新增编码fallback。

`test/archived-tasks.integration.mjs`已写正规HTTP创建→归档→状态/列表→恢复/重放/删除链、queuedRun/share保持、Unicode同毫秒分页、无父/foreign、并发同key、锁超时后pool恢复及Move/Projectdelete竞争；当前仅语法检查，真实PG/Redis由Root独占后验。独立idle-worker fixture不冒正常应用模型执行；无SQL seed正常任务。canonical只新archived_at及partial indexes，未安装schema/ALTER旧库，旧正常run保持。后继Root独立fresh fixture run与Web已发行pin配对后，才可宣正常UI功能完成。

## SET-21 本人分享列表源码及真实 owner 验证已接收（2026-10-15）

冻结24 writer（16既有/8新）及631原保护路径由Root独立逐SHA/范围核对，四Root设计文另计；终态独审无剩余确定P1/P2。新GET /v1/account/shared-tasks只安全四字段、本人有效Share/Conversation与非NULL Project父校验、单请求预算；public15.3.0/146全文SHA256 694251d4f4c1bcc9a79ae4fd2d4c050c87a0a8af39bea0a9f0bed3a4dcae5ad5，完整15.2/145逆恢复保持。Root专项83PASS、生产build成功。作者lint/type/build与semantic/inventory通过；正常contract764PASS/2既有FAIL，default1354PASS/3既有FAIL/3SKIP，architecture36PASS/1原缺模块失败，format保七旧警告，不冒全门通过。

Root实际HTTP→PostgreSQL1项通过：正规message创建三Conversation→share→安全分页→foreign空→revoke→重读/public404，合法旧标题/Unicode IDs保持，读取前后Share/Conversation/Project事实不变，到期与空project_ref排除。idle worker未执行模型，不冒正常聊天或浏览器正向。合成5000分享/10owner/本人500条读取100条25样本（排除两warmup）p50 1.87ms/p95 3.12ms；实际EXPLAIN执行1.38ms。真实自有锁等待150.94ms到期后同pool再读成功；指标只该本地合成查询含lease/readonly事务，不含HTTP/UI/生产负载。fixture仅新自有库，收尾核10个数据库名称及Redis测试库原零key集合精确恢复，正常服务未停。

原输入真实1PASS/4FAIL与标题/C排序3FAIL输出保留。canonical Share.created_at/expires_at是TIMESTAMPTZ(3)，故与公开UTC毫秒一致；不存在未经证明的微秒迁移需求，不改schema或旧Share API。Root将沿同功能分支/现draft PR正式发行供Web SET21/22消费；Data/Help页面与正常CUA旅程仍后继，完整设置Goal active，Skills/连接器排除。下方任务卡为阶段历史。

## SET-21-BFF 分享列表任务卡（2026-10-15；Root真实RED复现，具名源码准入）

Root固定Node22实际复现两具名测试5项：1PASS/4断言FAIL，合法GET404而非200、非法query404而非400、15.3版本及新增闭集operation缺失。没有编译或缺模块冒RED。651原tracked中647保护hash及两测试冻结hash独立保持。现准入下表既定源码、机器与纯测试集给billing_scheduler_audit唯一writer；Root四docs/INDEX/Git/正常运行/真实资源保留，禁止worker资源操作。原tests-only段保留作为阶段证据，后继范围以本段及下表为准。

基线a88e710d2201342200017f44c2bc34325937b5d0 / 651 tracked clean；Root保存原hash。三设计新增文首方案：沿现Chat/Share owner、单有界本人查询、安全四字段列表、无签名且身份绑定cursor；不新DDL/配置/secret/owner。Web SET20源码已由Root独立复跑174专项、实际HTTP5项/重定向2项及build后接收并提交26695df；其正常集成/browser继续由Root持有。本片现仅准入下列具名tests-only，仍未授机器/source。现正式public15.2/145 SHA2563214e32d273fbc514db1c1f2307f7855b623f1f613fb1da710cc51d23c41f453，拟15.3/146必须完整逆恢复旧面。

| 范围 | 后继允许集（当前仅下方tests-only，其余待真RED） |
| --- | --- |
| Owner / 分工 | BFF；billing_scheduler_audit后继唯一源码writer，storage_platform_audit只读独审，Root四docs/INDEX/Git/真实资源/发行 |
| 新普通源 | src/http/shared-tasks-input.ts；src/http/routes/shared-tasks.ts；src/infrastructure/postgres/shared-tasks.ts；无新目录/module |
| 现源 | src/application/ports/chat-repository.ts只本read类型/签名；src/application/chat-service.ts只本query；src/infrastructure/postgres/chat-repository.ts只委托；src/bootstrap/server.ts只exact raw GET前分派/同shape兜底 |
| 机器 / 正规门 | contract/openapi/v1/openapi.yaml新增唯一GET/closed新components/version15.3；contract/tests/v1-operations.json正规146；新scripts/shared-tasks-public-contract.mjs最外inverse，现verify-openapi.ts/check-contract.mjs仅最外接线，旧oracle不改；package.json仅具名test/contract/format登记，deps/lock不变 |
| 测试 | 新test/shared-tasks-input.test.ts、shared-tasks-http.test.mjs、shared-tasks-contract.test.mjs、shared-tasks-repository.test.ts；现test/chat-facts.integration.mjs只新增具名真实事实场景（Root执行资源）；现test/chat-service.test.ts必要本read转发；现architecture/contract-governance/openapi-contract tests仅新注册/version/count及先还原15.2再委托原断言，旧语义保护；现test/account-profile-contract.test.mjs和account-sessions-contract.test.mjs仅先最外剥SET21回完整15.2/145，再执行原SET19/18断言及负控，旧hash/oracle不刷新 |
| 门 / 保护 | 先现真实HTTP/机器缺口RED；D0独审与当前Web接收后另授。固定既有Node22/pnpm11纯门/freeze/651保护；Root独审/复验及真实PG/Redis/EXPLAIN再正式发行供Web，normal/browser不被纯绿替代。禁止worker Git/docs/INDEX/资源/服务/其他repo/Skills连接器/SQL DDL |

当前四docs D0已独审无确定P1/P2，tests-only仅新增test/shared-tasks-http.test.mjs与test/shared-tasks-contract.test.mjs；HTTP测试调用原实际createBffServer（可构造仅本人read替身但不能伪造route），合法GET期望200及安全四字段、匿名和非法query/body零read；机器测试解析当前canonical新增operation/闭集应不存在，不能依赖不存在的module产生collection错误。先Root实际RED复现后才授source与其余测试，原651保护除四docs及两测试保持。明确只有project_ref IS NULL可无父、空串仍须匹配现父规则；normal组合保持，完整设置Goal active。性能、正常已有真实本人任务与浏览器正向未验，不伪造已齐备或要求用户为内部设计确认。

## SET-19-BFF 本人姓名保存验收（2026-10-15）

本仓已完成本人 PATCH /v1/account/profile，canonical public15.2.0/145operations，全文SHA256 3214e32d273fbc514db1c1f2307f7855b623f1f613fb1da710cc51d23c41f453。唯一IAM消费固定c64faa7992301f31495e163d04049c48a23d0225/internal0.13.0；正常19operations生成，原18保留。独立V2窄审无剩余确定P1/P2；Root核27变更记录、621保护路径及原642tracked基线，三路径P2修补之外首冻字节保持。

Root冻结后具名108PASS/0FAIL；正常lint/typecheck/build与16文件生成检查通过。默认1304PASS/3原FAIL/3SKIP；完整check保留713contractPASS/2原R357FAIL，format仍七个既有警告，未改历史摘要或放宽门禁。首冻合法expected_name escaped lone surrogate的两项真实RED已修为GREEN，旧值原字节转发、新姓名限制保持；全局parser未修改。

Root真实BFF HTTP→正式IAM→PostgreSQL完成十四请求：普通成员保存200且数据库和正式userinfo一致、旧值409、no-op不改updatedAt、非法query/重复JSON/key拒400、超限413、缺scope及machine/operator拒403、不同sid同原值并发200/409、撤销其他会话200后其写入401。测试自有PostgreSQL库及Redis键集合精确恢复；未重复启动基础设施、未操作正常服务。首次保存单样本97.76ms，不作为性能基准。该证据证明后端链路；Web正式消费、fresh16scope登录及页面保存→刷新→重登仍由Root后继验收，整个设置Goal继续active。

## SET-19-BFF 本人姓名 public adapter 任务卡（2026-10-14，D0 独审通过；源码准入）

IAM正式owner已commit/push c64faa7992301f31495e163d04049c48a23d0225，internal/SDK0.13.0 SHA c22c55ef2b963a89ca3e03016138c2da74f5f005edf1b6ee8c5572daaf466262；V2独审/Root完整verify118files1488PASS、真实profile8/8与trusted3/40过滤通过，首冻CAS失败及实际SQL修复证据留存，资源收尾精确恢复。普通运行仍原IAM284bfd8；只有正式消费者齐备才切换，页面改名尚只读。

本片D0三设计明确采用server raw canonical PATCH提前分派，profile独立route内调用原authorizeUserRequest/composition.sessionAdmission并从route入口起单10s预算；相比深改generic admission及所有return/meta分支更窄。outer catch只exact profile plain envelope。Root已核642tracked5399640基线；storage_platform_audit只读独审无确定P1/P2，billing_scheduler_audit只读地图核正式owner Git blob及生成/治理接缝。Root准入下表窄源码集，待freeze独审及实际owner验收，不将D0通过记为功能完成。

首冻57ba96ff经独审发现确定P2：原global strict raw parser拒expected_name合法旧escaped单码元，正式IAM该字段仅max16384，与Web原值保真不符。Root只准入本片input及其input/HTTP两测试三路径修补flat原文codec，保fatal UTF8/duplicate/closed及newname wellformed负控；全局parser、其他源/contract/generated首冻SHA保持，原失败日志保留。新freeze/独审及Root真实owner验收前不发行。

| 项 | 决定 |
| --- | --- |
| P1 / 完成 | BFF本人name/expected_name真消费，closed ACK/权限/CAS/unknown，formal public15.2可供Web接线；不以BFF通过冒设置完成 |
| 唯一 writer / reviewer | billing_scheduler_audit后继实现；storage_platform_audit只读D0/源码独审；Root三设计/任务/INDEX/Git/资源/发行 |
| 基线 | settings-bff feat/settings-team-contract 53996400e4100ed5940b104f0dce139d44fec383 clean；public15.1/144 SHA5972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d |
| 新普通源 | http/account-profile-input.ts、http/routes/account-profile.ts；infrastructure/clients/iam-account-profile.ts与.types.ts（无新目录/module） |
| 现源 | bootstrap/server.ts仅import/exact earlydispatch/最后plain错误兜底；原通用admission/mutation/businessStore/旧operation不改 |
| 机器 / 正规生成 | canonical openapi/v1/openapi.yaml添加profile/closed components/version15.2；operation inventory追加1；新scripts/account-profile-public-contract.mjs独立inverse，现verify-openapi.ts/check-contract.mjs只最外层接线；IAM现config/generator/dependency manifest、唯一旧vendor284bfd8删新c64原字节、正常generated19项（旧18保持）；package脚本仅把新具名测试/format/governance追加 |
| 测试 | 新account-profile-input/client .test.ts及profile-http/contract .test.mjs；现test/iam-protocol-relay-policy.test.ts与test/contract-governance.test.mjs仅当前IAM pin/provenance及新能力负控；现test/architecture.test.ts与test/contract/openapi-contract.test.mjs仅当前public版本/数量及新能力登记，先profile inverse再原历史门。额外准入现test/account-sessions-contract.test.mjs仅先恢复完整15.1/144再原SET18 inverse，原5f6/2e32摘要、141/144及全部旧negative保持。旧会话/Skills/连接器语义oracle不放宽，其他必要路径先报Root |
| 验证 / 保护 | 先具名真实RED，后纯GREEN、normal contract/generation/lint/type/build/check；freeze路径/hash与其余原642tracked保护，Root复核/独审/必要纯复跑+实际BFF→IAM自有资源再发行。现旧check2/test3/format7失败不隐去，新增必须修；无依赖锁/DDL/资源/Git权限 |

## SET-18 登录设备公开投影准备（2026-10-14；D0 独审通过）

IAM正式错误缓存修补已发行284bfd8fea91d57dae18fa2b7c772d75c7b6dcd9，internal0.12.0 artifact仍为SHA256 f6f3588d0fe52e5b3eed57e117e25b991caabc9e2825d1a0edcf9149f6a3e26b。本仓V2业务已冻审并真实BFF→IAM通过，public15.1.0候选SHA2565972f7be07a0117d8ee036fa4e742da7942b3c864d009c2847e70e69112a747d、canonical/inventory144；正式单pin更新及两新增消费元数据/格式回归修补已完成并接收，源码任务仍沿Root卡。本仓待Root正式发行，尚未正常激活；Skills/连接器业务排除，Root保留docs/Git/资源与最终验收。

V3二十六实际实现路径（manifest含退休9d9 absent共27记录）经Root逐hash/613其余tracked保护核及独审，无新增确定P1/P2；正式IAM284bfd8 artifact与Git对象原字节一致。十八保护路径含业务/144 inventory/public5972全文及三generated正文与V2完全相同。Root原pnpm check exit1仅停于既有R357两项（contract675总/673PASS）；原pnpm test实际1267总/1261PASS/3既有FAIL/3SKIP，两个新增消费pin失败已消除。原format9降回原七项，两个新增格式问题已消除。正常生成check/lint/type及生产build成功；既有失败与原错误RED证据保留，未冒全check绿。真实IAM/BFF十二请求及direct403通过，测试资源恢复起点；V3无业务/生成正文变化不重复资源。待Root同一功能分支正式发布后Web接线与正常运行/browser；完整设置Goal继续active。

独立审查唯一P2已修：owner409/TENANT_DISABLED固定403 session_forbidden，只有CONFLICT固定409 account_session_conflict；复审无剩余确定P1/P2。三面方案已准入，owner正式0.12 artifact已接收，本轮只按Root精确允许集接线，运行与资源不授worker。


Root源码复核纠正统计：旧canonical142/旧inventory141漏一个已存在的browser-private操作；本片正规完整inventory144，严格逆恢复旧141清单与完整15.0 API原字节。此清单登记纠偏没有Skills业务/API/权限语义变化，旧Conversation与format失败不冒通过。

## SET-15 正式 Billing Catalog 消费候选（2026-10-13，未真实配对激活）

固定Billing ba98badab9445ae676a8f48faa55912d42ce5d2e的committed原字节exp4，SHA2568a3d12cf7517e7ee6cb2958b740bb69ab4831d38a383e61aca383b5fd1e8b27a；删除旧exp3 vendor单pin，现正常生成器扩唯一getCatalog并使CatalogItem/Envelope/data/Page严格，正规双生成check一致。public15.0.0所有字节/operation/字段不变，无SQL/Redis/锁或Skills/MCP业务变更。

现plans具名Catalog consumer经独立Billing服务Bearer、内部BFF身份及可信u1 tenant读取/v2/commerce/catalog；同一总期限、总headers+body预算、20页/2000项，只有完整合法终页返回。offer_revision_id/offer_key/currency_code映射现id/key/currency，金额与积分字符串原样；未知域、缺key、非法金额、非终页空页、重复cursor/ID/key、尾页失败、redirect、累计预算或deadline失败统一现public503 billing_unavailable，不返回部分清单或假空。abort主动取消锁定reader并退役挂起/迟到请求；旧unused mapper删除。

checkout保持现准入、request/幂等校验后明确503 billing_unavailable且零owner读写，删除旧v1 Catalog/checkout调用；目录200不表示支付可用。旧checkout201真实RED后变503 GREEN。新source/dist临时HTTP/严格fixture与生成契约及原personal读具名73PASS，包含完整两页、合法空终页、BigInt以上字符串、所有闭集/分页/预算与挂起fetch/慢body取消负控；现BFF完整route plans/checkout具名1PASS。

固定Node22.22.2 lint/typecheck/build exit0，生成check两次16文件字节一致，变更具名格式及diffcheck0。完整pnpm check非零：contract634PASS/2既有R357历史恢复版本失败；独立全test1222PASS/3既有FAIL/3SKIP（另一个architecture旧恢复同失败）。这些旧门已在SET13用HEAD14.7字节确认，未改历史摘要/fixture或Skills入口。完整format保留既有7文件失败；projections只精确删除两unused mapper不格式化旧内容。现package明确test清单不自动收新catalog文件，所以其73项具名测试独立执行，不能计入全test数量。正常Billing/Web/Root精确pin配对、真实浏览器目录与checkout不可用、Admin消费者后继由Root验收，未操作共享服务/DB/支付或提交Git。

## SET-13 Team 完整权限投影候选（2026-10-13，未激活）

沿已提交D0，仅canonical TeamRole.permissions新增现IAM合法platform.execute及skill十五动作闭集，public15.0.0 breaking；仅Root自有隔离/v1配对候选，非minor/beta例外，main/日常/生产/Admin消费者均未切换。IAM wire现严格原样输出不改，无SQL/owner/generated/锁/业务权限写入。

旧契约字段声明真实RED1FAIL；完整字段后SET13两契约测试GREEN，owner/admin/member正式权限fixture经自有临时HTTP owner→BFF原样返回，unknown域/platform动作/skill动作与空数组五项均502。最外层先检查完整TeamRole精确字节与15.0.0，再仅撤本片恢复14.7完整SHA598407a3dfc17d62eb4fe703837b836ba85f05b7102a018dac160351ad807c19；缺platform、未知域/动作、空数组schema、错误版本、非Team漂移负控均拒绝。旧历史门/fixture/非Team字节保持；没有用新摘要抹旧门。

首次完整check误用brew22.23.2，被Storage精确Node22.22.2门拒绝；随后固定已装22.22.2重跑，lint/typecheck及全部生成check/contractlint/semantic通过（保既有Redocly warnings），contract:test634PASS/2FAIL，完整check非零。两R357既有失败及全test额外architecture collection失败均旧restorePublic142直接收当前artifact而报Admin Skill draft version drift；只读HEAD14.7原字节调用同helper也失败。独立全test1222PASS/3FAIL/3既有SKIP、build0；Team读写17PASS。完整format:check七既有文件失败，四变更TS/test具名格式0，diffcheck0；不格式化范围外旧文件。实际Web固定消费/strict schema与浏览器、Admin消费者、后继正常发布仍待Root，不能称全check或业务闭环通过。

Root独立build、Team读写与contract-governance共48PASS/0FAIL/0SKIP、semantic141个冻结operations通过；另外直接从基线Git blob核对新inverse恢复全文逐字相等，并独立重现原14.7被旧restore142入口拒绝。冻结六路径独审无确定新增P1/P2。此收据仍不改变上述全check/format未通过及consumer待验边界。
## App API 修复当前切片（2026-10-13）

BFF 基线 `95fbd894ee01053f6c9cabeca481e50151cd4f15`；Billing owner 固定 `1ceeae550f05857d1e7fa0da1e83af23a552f0ca` 的唯一 v1 artifact，Platform HTTP 固定 `6b4c9db6719d2f5fd37a752921e603f4b0221de6` 的 6.0.0 artifact。生成器实际输入、vendor 字节与 manifest 一致，不仅核对声明 digest；旧 projection OAuth/token source 已删除。独立 Connect 消费保持其固定 Proto bundle，不作为 HTTP fallback。

Root 在停止写入的工作树执行：`pnpm lint`、`pnpm typecheck`、`pnpm build`、对应 Billing/Platform HTTP `contract:check` 与变更文件格式检查全部通过；10 个相关测试文件 165 PASS / 0 FAIL / 0 SKIP。现有 credential 用例同时保护 opaque tenant、UTF-16 长度、取消后迟到 I/O、关闭失败和轮换；现有 Billing 用例保护 typed 404、未知路由和未知字段。

真实运行 owner 与隔离 BFF HTTP/Connect 组合已验证：ListHubSkills、ListSkills 均 200；专用服务凭据错误 401、跨 tenant 403；发送方内部 OAuth 请求为零。本人 Billing summary/ledger 正确接收 `billing.credit_account_not_found` 并返回 `billing_account_not_found` 404，未新增账户或资金。此组合仅人类 SessionAdmission 为测试替身，不冒充浏览器真实登录。

完整 `pnpm check` 的 contract tests 为 629 PASS / 2 FAIL；完整 `pnpm test` 为 1212 PASS / 3 FAIL / 3 SKIP。失败均为已有 public14.7 历史恢复链未接入的问题（两项 R357 加一项 Conversation collection architecture）；受影响原 OpenAPI/恢复器与基线字节一致，architecture 的该断言也未改变。未删测试、改旧 hash 或放宽门禁，不宣称全仓通过。由 public contract owner 后续收敛该历史链。

正常服务激活及当前浏览器验收分别留在 Root 本次任务记录和本地 ignored 运行证据；当前浏览器仍需正常登录。此片不改 Schema、目录边界、付款 worker、模型许可或其他内部认证 surface。下方既有记录按原时点理解。

## T-K03.14-BFF-SKILL-AUTH-ERROR Public13.1 源码候选收据（2026-10-10；待 Root 独审提交）

基线 `37efd64a81a66b83df2f8d0a678c6e0e8971cb31`；唯一 current public source 为 `contract/openapi/v1/openapi.yaml` **13.1.0**，仍 `/v1` / 136 operations。本片仅补已存在 IAM Skill action denial 的 `403 skill_forbidden` 契约，不改变 runtime、权限、CAS、owner wire 或数据。五个 Draft/Begin/Complete/Validate/Publish base error enum 与四个命令及个人 Version/Withdraw 共用的 narrow 403 精确补码；安装三 mutation 使用同文件新 `SkillInstallationMutationForbidden`，原安装 GET、package-upload GET、managed read、inspection 与 MCP 不扩展。原 Product/Admin/Github/AI error family 已含此码，保持原字节。

具名契约测试按现 `skillActionForRequest` 逐项枚举全部 26 个真实 action operation（含原 Admin 两 GET），确认实际 403 family 接纳该码；普通无 action 的 GET 保持原闭集。负控覆盖五 base 缺码、六 narrow 错误码混入、安装 GET 错挂 mutation ref、Validate 400 错挂 Forbidden ref。当前入口严格只接 13.1.0；精确逆向恢复整个 Public13.0 source SHA `f100463d3d9b686745e13fd2c07d6fdf8d305fcc8b66169cecddded0f2f82801` 并继续既有 Public13 CAS / Public12 及更早历史证明，历史向量不是生产 fallback；新安装 component 同样核对完整父组件精确派生，不放宽状态/code 闭集。

真实 RED：具名新增契约断言 0 PASS / 1 FAIL，失败为旧 `SkillDraftErrorDetail` 缺码（`/tmp/bff-public131-red.log`）。后续补强测试的初次 operation census 25 与真实 26 不符、负控块抽取过短均修正并保留原记录；正式 focused 使用 Node22/tsx 为 3 PASS / 0 FAIL（`/tmp/bff-public131-focused-final.log`）。

最终 Node22.22.2 串行 `pnpm contract:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` 自然 exit0（`/tmp/bff-public131-final.log`）：contract 729 PASS / 0 FAIL / 0 SKIP，默认 test 1328 PASS / 0 FAIL / 3 既有 SKIP，lint/typecheck/build exit0；契约 lint 保留 3 既有 warnings。operation baseline、vendor/generated、SQL/schema、依赖、框架、Web、正常服务/数据及 Git index 均未修改。Root 独审/主树复跑/正式发行、Web 固定消费 13.1 与真实失权浏览器验收仍待后继 owner，不以此源码契约修复替代完整用户闭环。

<!-- T-K03.14-BFF-SKILL-AUTH-ERROR-CURRENT-END; historical body retained -->

## T-K03.14-BFF-CAS Public13 源码候选收据（2026-10-10；待 Root 独审提交）

基线 `8889701b3640029b7b5751c45111d80f66d0bbd3` 的三设计门后，本候选唯一 public source 是 `contract/openapi/v1/openapi.yaml` **13.0.0**，仍 `/v1` / 136 operations；只收紧 Begin/Complete/Validate 的 mandatory `expected_state_version`。现三 parser/client/route 与 current admission projector要求 canonical positive signed64 decimal string；缺失/非法/重复键在 BFF 400 且 owner 零调用。已有所有 ACK/self read 的真实 state_version、Complete 真实 source_version_id、Publish explicit audience/CAS、metadata/cover/Withdraw/Admin CAS 与普通 CreateVersion无CAS例外保持。当前主semantic入口只接13，Public12仅用于精确父逆向证明，父SHA `7a827ba0497315cb80028c17cc714f187eeddeb2a880f477b27c9b23e0ff3caa`；不改历史owner artifact或generated、不设旧协议fallback。正规 baseline生成仍136且字节未变。

实际RED：三缺CAS HTTP断言0 PASS / 3 FAIL（旧Begin201/Complete200/Validate200）；日志 `/tmp/bff-public13-red.log`。首聚焦46 PASS / 2 FAIL来自两个旧Validate正向fixture漏CAS，已补真实字段；后续54 PASS / 0 FAIL。首默认全门1324 PASS / 1 FAIL / 3 SKIP唯一为architecture current version硬12；Root批准该单行13更新，原结构/授权断言保留；日志 `/tmp/bff-public13-full.log`，不掩失败。

最终 Node22.22.2 串行 `pnpm contract:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build` 自然 exit0，日志 `/tmp/bff-public13-final.log`：contract 727 PASS / 0 FAIL / 0 SKIP，默认test 1326 PASS / 0 FAIL / 3既有SKIP，lint/typecheck/build exit0。契约lint保留3既有warnings。三操作新增实际 BFF HTTP→正规 generated Connect loopback，验证caller观察CAS进入wire/owner digest、stale412、correct ACK、ACK丢失后原key/body/CAS重放与同key改CAS409；缺失/非法/duplicate均owner零调用，大于JS-safe整数仍string精确保留。此loopback只证明消费者wire/恢复，不冒充真实PG/Storage/Platform事务。

SQL/schema、Platform/IAM/Storage vendor/generated、依赖、框架、Web/原Admin、正常服务/数据/Git index均未修改。正常Web3c59071与releasec9b02b6分叉事实保持；后继Root正式发行后再按Public13固定接线完整发布链和原Admin，不整包抄release或恢复替代后台。Root独审、主树复跑、正式提交/重载及真实用户上传发布和有记录Admin CRUD仍OPEN。

<!-- T-K03.14-BFF-CAS-CURRENT-RECEIPT-END; historical body retained -->

## T-K03.14-BFF-PIN 当前 Platform 固定发行（2026-10-10；待 Root 验收）

当前 Connect/HTTP 消费输入唯一固定 Platform `32666c1c18360e707048a1104efe6b50e375002f`；物理 owner 为 `apps/kokoro-capability`。从该正式 Git 对象逐项核对，87 项必要 publication 与原 `84262b...` 字节完全一致，Proto/descriptor、HTTP 5.3.0、execution V5–V10、historical qualification 及所有 artifact 摘要不变；active/routable V10 aggregate 仍为 `dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b`。当前说明覆盖下文历史 pin，不改历史验收事实。

此候选仅完成消费者出处更新；新 pin 测试已真实 RED（actual 84262b、expected e2f6dbf），本轮 Node 22.22.2 正规 Connect/HTTP write 与 platform、platform-http、local-import check 全部 exit 0；lint/typecheck/build 全部 exit 0；具名 Platform Connect/HTTP 与 local import HTTP 测试 58 PASS / 0 FAIL / 0 SKIP。generated 客户端保持原字节，两个 dependency manifest 由正规工具更新。Root 的 16 项真实 Storage/Connect smoke 是 owner 证据，不替代 BFF 全门、正常服务重载或 Web/Admin 浏览器验收；完整用户闭环仍 OPEN。

<!-- T-K03.14-BFF-PIN-CURRENT-END; historical body retained -->

## R357-BFF-ACTIVATION：正式 active local import 源码候选（2026-10-09；完整验收 OPEN）

Platform 已正式发布 `84262b664275229c62370d49f51ad5e276116148`，v10 active/routable aggregate 为 `dddb0d194af44dbf0b83a0a0443d774f3dee63f8cb03c364ad529c4c230fb85b`，Root publication digest 为 `8a850363580521fadf75bc20b1be70bfe62c20004568c00b72a77f614caa672f`。Root 已完成 owner 正常源码重载与 health/ready，但这不是 BFF/Web/browser 完成证据。

本源码候选已将 Connect/HTTP dependency、generator 与单一完整 vendor 同步到正式 Git 对象 `84262b...`，删除旧 `981df60e...`；完整 HTTP OpenAPI、历史 fixed evidence 和 public contract 保持。`runtime.ts` 仅在 Platform base URL、catalog/projection credentials、IAM URL 全部存在时生产装配 local import client；缺任一仍 404/owner 零调用。写与 receipt replay 每次 fresh current session 下 `create_draft AND install`，Get fresh read；catalog/projection machine credential 分离，不透传 human bearer，不新增 public API、BFF Storage/SQL/receipt、fallback 或 alias。正常 BFF 尚未重载，不能将源码候选描述为已正常注册。

Root 实际验收：production composition 聚焦 58 PASS；contract 704 PASS，typecheck/lint/build 均为 0。默认测试为 1287 PASS / 8 FAIL / 3 SKIP；隔离正式基线 `3e19fbed...` 为 1010 PASS / 18 FAIL / 3 SKIP，其中候选的原 7 个 leaf failure 均在基线复现。新增 Billing personal-read summary 在默认并发门出现 `503 != 200`，但 Root 受控具名候选与基线均自然 0，支持固定 75ms 下的资源敏感判断；该失败日志保留，不能据此声称默认全绿。独审同时确认 `src/application/skill-specification.ts` 直接依赖 infrastructure/generated 是真实生产边界债，须由后继窄切片处理；旧 OpenAPI 9 oracle 与当前 Public12、四个 mock quota/MCP/docs 准入断言也须分别按当前机器事实校正，不能放宽 oracle。本片 DATA_MODEL 无变化，正常服务重载、真实 IAM/Platform/Storage/browser 组合及完整 BFF 验收仍 OPEN。

<!-- R357-BFF-LOCAL-IMPORT-ACTIVATION-CURRENT-D0-END -->

## T-K03.4 本地 Skill import BFF 文档门（2026-10-09；未实施）

三设计已收敛为 Kokoro 自有 `/browser/v1/skills/local-imports...` 四个 browser-private route，经Web `/api/browser/v1/...` 同源adapter消费，再调用Platform已批准的四 internal-owner RPC。它不是Manus public upload接口；public OpenAPI原字节、operation census、Developer Portal和public SDK保持不变。专属 exact dispatch/private policy及其确定性生成物仍属后继实现，当前仓没有该路由。

三个写与same-key replay要求fresh `create_draft AND install`，Get为fresh read；统一绝对预算、取消/迟到关闭、900秒PUT、24小时intent、原key/unknown恢复，不新增BFF Storage调用、SQL/Redis/receipt。Begin成功或重签仅限未到期 `upload_pending` 且 Storage pending；进入 `uploaded`/`completed`/`rejected` 或 expired 后旧 Begin 接 owner phase/precondition 错误并改用 Get，绝不重签或再次 createUpload；Finalize completed 原 key 按 owner 至少30天receipt精确重放。现Web严格从成功PUT的`x-amz-version-id`取得source version可供未来Complete使用，但旧链证据不代表新import已通过。GitHub/AI普通Draft流程与Admin Publish保留；仅未来Web本地文件callsite退出旧Draft→Publish串联。

当前候选已固定 Platform `981df60e74b65eccfc2d58044db9965928e4d37e` 的正式 A6 机器事实并正规生成 client，以 typed 注入 seam 实现 private policy/input/projector/四 route 隔离 HTTP 测试；public OpenAPI/SDK/count不变。owner v10 artifact 仍 inactive，因此 production composition 不构造 client，namespace 保持原404而非新增503。只有 owner active/routable、真实 Storage 集成门完成后，后继激活切片才接入 production composition。当前候选待 Root 冻结复验，不代表正常服务或浏览器完成。

<!-- T-K03.4-BROWSER-PRIVATE-LOCAL-IMPORT-CURRENT-END -->

## R357-SKILLS-CANONICAL-IDENTITY 窄修（2026-10-09；待 Root 正式集成）

BFF 当前 Skills validate HTTP projection 与 AI handoff 现按 Platform 正式 owner 合同接受且仅接受 `skill-md-v1:sha256:<64 lowercase hex>` 和 legacy `zip-v2:sha256:<64 lowercase hex>`；不 trim、不设 alias，未知 profile、大小写或空白漂移继续拒绝为 `skill_response_invalid`。请求准入、总预算、CAS、幂等、错误映射及未知 ACK 恢复原逻辑不变。

Public12 OpenAPI 的 `SkillImportResponse`/`SkillValidateResource` 与 runtime 同值域；当前规格门固定两处 exact pattern，历史 Public11→Public8.10 fixture 与完整父逆不变。依据为本仓正规 vendor Platform `execution-operations/skill-series-current-v1.json` 的 `skill-md-v1` 当前身份与 `zip-v2` legacy 身份；未改 vendor/generated/pin、数据库、权限或 Web。源码验证与冻结证据由本片交 Root 独审，不代表正常服务、真实 owner 组合或浏览器完成。

<!-- R357-SKILLS-CANONICAL-IDENTITY-END -->

## R357-H1 人类 MCP 准入源码切片（2026-10-09）

当前 IAM 消费唯一固定55befe5092f96d617088549df3166e1d381e6b1c / 0.11.0（artifact SHA47011671cf2c3631c5ff914db4b40a8a9f9cdecc9b2b6fcd13a359a45b0882d3），正规生成新增 checkAuthorization，原15 consumer operations及完整共用schemas保全。现MCP read/manage每次在可信session后检查mcp_personal/current_membership；tenant/subject/request-id/no-store/closed响应不匹配拒503，false403、失效401、rate429，复用现session_forbidden/session_rate_limited public错误码。
预算从同入口monotonic10s经过session/permission与已有两projection，不在owner阶段重置；取消/到期/迟到不成功。四self MCP GET与非GET尚无正式业务adapter，保持503、无owner副作用；没有读取Platform候选或新增public/SQL契约。
研发证据：实际HTTP失败基线（缺人类检查、self读错误404）、deadline迟到响应失败基线均保留；新checker真实本地HTTP与完整session→action、取消/总预算、旧Team/Skills/鉴权回归由当前源码命令验证，最终数字见Root冻结收据。辅助门不代表正常激活、真实CRUD/授权执行/admin或浏览器完成。
Root独占正常scope/登录/服务、资源、独审、重跑与Git提交；本片未正常激活，连接器完整用户路径仍OPEN。

<!-- R357-MCP-H1-EVIDENCE-END; original suffix retained -->

## R356 普通 Skills 生命周期 Public11 预激活纠正（2026-10-09）

唯一当前契约为 Public11.0.0，同 `/v1`、132 operations。普通 CreateVersion 只接 strict metadata，不接收或转发 expected_state_version；Platform 在事务内核当前主体/owner与 active/disabled base，分配新 revision 并创建独立 draft/stateVersion=1，不改 base。普通 Withdraw 实际修改原 Skill，严格要求当前 expected_state_version；原 key/body、digest、receipt、current IAM、取消与绝对预算保持。Admin version、Publish 及其他真实 CAS 不变。

Root 将未正常激活的 beta 以唯一 corrective major 修正；首次公开激活后的 breaking 策略保持。当前机器只改这两个普通输入与 version，先精确逆回完整 Public10.0.0 SHA2f98f529bda413912b5c15e6de45db7cdadf0e0bc51fd5de44818db9727efbb8，再运行全部原 Public9.0.1/8.10 历史门。无 owner 契约、表、Schema、依赖或新框架；DATA_MODEL/canonical schema 原字节保持。消费者等待 Root 正式提交再固定生成；源码验证不代表真实组合、正常激活或 Skills 页面完成。

<!-- R356-LIFECYCLE-PUBLIC11-END -->

## R356 Publish Public10.0.0 预激活输入修正（2026-10-09；待Root正式集成）

Root裁决首次正常对外激活前 beta corrective major，同 `/v1`、132 operations；仅 Publish 从旧零body错误候选改 required闭集 JSON audience/expected_state_version。原当前用户/tenant准入、PERSONAL visibility、固定key/body/digest/CAS、response/cache/requestID、取消及owner错误保持；无空bodyfallback、无新持久事实或owner生成/Schema/依赖。后续正式公开breaking策略保持，消费者等待本片Root正式commit后正规固定生成。

真实组合原错误由Root留证；本writer registered HTTP＋真实binary具名RED0PASS/2FAIL（400≠200、缺输入digest mismatch）后接线。Node22.22.2针对HTTP/OpenAPI/治理三文件131PASS/0FAIL/0SKIP、type/lint/build自然0，semantic132通过；当前10 Publish exact→9.0.1完整SHA4ad3a0553d3b45a78fdd53c857ad66c25b1baa3d53c3af619333d70fefcad5db→原8.10/历史逆负控保留。首中间测试新增helper未import、raw断连fixture未带JSON Content-Type两问题保留日志，已补fixture，未通过的中间进程只自有终止，不作为成功。局部format首3warn后仅3授权源/test折行；最终绑定ignored冻源证据。

12授权paths由唯一writer交Root审查/提交；所有其它基线file及旧文档/README后缀逐SHA保持。未Git、未启动共享/正常服务、未资源或正常数据写入；普通Web原零bodycaller需正式消费者后继，完整真实owner组合、正常浏览器、Record/管理员他人cover及S01–S10仍OPEN，不以本pure通过宣产品闭环。

<!-- R356-PUBLISH-PUBLIC10-CURRENT-END -->

## R356 Skills Connect HTTP request-id 修正（2026-10-08；候选待Root正式组合）

基线正式427d126/Public9.0.1/132。Root实际first draft POST此前502：owner HTTP200合法ACK，BFF漏传HTTP x-kokoro-request-id，正式Platform telemetry回随机ID且binary cache-control缺失；该真实RED及清理收据由Root保留。本片仅catalog/product/admin三个既有Skills wrapper传当前受信context精确request-id，不改digest/auth/tenant/预算/Schema/契约；response ID与no-store完整性继续严格。owner RPC no-store由Root另一唯一Platform writer修，不用放宽检查掩盖。

对应现HTTP测试采用实际HTTP requestHeader来源，不用body request_id伪echo；缺失/错误response ID及missing/wrong cache继续拒绝。工程/三个聚焦测试与冻结证据随Root ignored交接，真实IAM/Platform/Storage/Agent组合与浏览器仍由Root最终执行，不把loopback当owner资源集成。下方完整旧正文保持原字节。

---

## R356 Public9.0.1 消费者一致性修正（同 132 operations）

GET package-upload 的现有真实 source_version_id 现列入闭合 schema，可选、1–1024 printable ASCII且拒绝字面 null；不从对象 current read 推断版本。owner 无效版本稳定返回502 skill_response_invalid；安装列表 owner query/source-bound cursor 的 InvalidArgument 返回400 invalid_skill_installation_request，不泄露内部原因。原 Public9/Public8.10 父逆和其它 closed blocks 保持。此为源码契约修正，正常服务未重新激活，不能称 Skills 页面验收。

## R353-B2 当前源码候选（2026-10-08；待Root冻源审查/真实配对）

唯一 BFF writer 为 bff_skills_product_source_r353；工作树 HEAD d2695c47bca64a8e83168aa259e2366f7cee3ea8。当前唯一 Platform固定52eeb0b891326a7538926e5fc5ffc89fe87f3c54、Product1.1/HTTP5.1/63RPC/32commands/24proofs、完整76正式publication；aggregate e92205f4c495497cd3e0aadd96027cc925e246c7dc253ddb3544105aa9966191、descriptor 4a8715b5057fbe3a9f443faee0315482de20593ce01430c7c357561a61576bfd、HTTP a8cef2bc45b2c0514f3d1abf06199087ad0efadf9db75224b17c69b1c50b12ce。HTTP直接读同Platform vendor/openapi；原701候选72副本移除，无双pin。IAM7c62e759760448e127b21200f87adeefdc6016f7/0.10、Storage d13f33a/v3继续原正规固定生成；不升级其它owner。

Public唯一9.0.0/132operations，具名Product checker先核完整当前closed blocks，再剥本片还原完整Public8.10字节SHA640f47f9c70341aa49934eec319a4dcc5bab76bba83e4407d6a9e0c3ab0ac389并运行全部旧父证明。机器/纯门只证明本源码；正常Storage旧源版本资格、真实IAM/Platform/Storage/Agent配对、provider、普通/管理员浏览器与S01–S10由Root继续验证，仍OPEN。未运行数据库/资源/服务/正常激活，不以fixture为integration或UI完成。

当前纯门和实际失败日志绑定最终freeze；阶段性默认1187PASS/15FAIL/3SKIP及1201PASS/6FAIL/3SKIP已保留。批准窄fixture与共同lock正规生成后，整份pnpm check自然0：contract620PASS/default1207PASS、0FAIL、3既有资源SKIP；独立format自然0。随后增加URL身份39/100边界负控与同Public9闭集限制，最终同源门以freeze实际命令结果为准。尚未正常服务切换/浏览器验证/真实provider，源码门不代表整页完成。

### R350-B2 示例固定消费者已完成源码验收，页面待接线（2026-10-08）

固定 Platform `94bd0ea94aabc60c666fdb2cfa8784baf194e24b` 的完整60 publication及 HTTP3.5，Public8.10/111；两Create保持 absence 与 present[] 的不同命令身份，四读严格 required example_prompts，安装 typed message 必须present。原文/顺序/重复/Unicode scalar与UTF-8总量规则一致，Publish仍零body；无SQL/权限/新operation。

Root冻结121现存scope SHA及三D0原正文匹配，独审无确定新阻断；Node22.22.2实际 lint/typecheck/双固定生成/semantic/具名checker/build/diffcheck均0，默认909PASS/0FAIL/2原资源SKIP，额外示例10PASS/0FAIL。收据位于Root `var/dev/r255-preserve/r350-root-bff-final.log`。首次Root用了不存在Node路径及zsh只读变量导致工具调用失败，随后正确Node22执行成功，非源码测试失败。

正常BFF5007与Platform42873仍旧配对，未激活、未改持久库；Web尚未消费新字段。工程源码验收不代表真实HTTP/浏览器或Manus页面完成，作者/usage/真实cover/分享下载/分类事实/四创建与后台仍OPEN；其它模块暂停。

<!-- R350-B2-ROOT-CONSUMER-RECEIPT-END -->

### R345 正常 Skills 配对已激活，整体UI未完成（2026-10-08）

Root 同持久 source/env 成对停止旧 BFF/Platform 后启新 Platform03ee664 与 BFF2e5fbaf；本BFF正常句柄5007/listener92197，ready200。未重置PG/Redis/MinIO或用户数据，不变凭据/权限。Web正式e7c7370固定public8.9。真实外部R255 catalog200与预览datetime均2026-10-06T00:38:54.049Z；查看详情真实SKILL.md→Back→Close，本人安装/发布日期同原事实。切换窗口曾502/准入不可确认，正常Retry恢复原账户，失败证据保留。

仅更新时间与本人已安装正文读取局部验收；作者/examples/真实cover/usage/任意未安装正文资格/创建四能力/Skills后台及全页面仍OPEN。正常源进程持续运行，后继Root持有句柄；其它模块暂停。实际浏览器收据Root var/dev/r255-preserve/r345-live-browser-read-receipt.json。

<!-- R345-NORMAL-SKILLS-PAIR-ACTIVATED-END -->

### R345 Skill 更新时间运行投影已独审（2026-10-08，正常组合待成对激活）

Root 接收原 Skills owner 冻结十路径，仅两客户端及八测试；固定 Platform af38f441 / HTTP3.4、public8.9/111。四 Skill 投影严格 required `skill_updated_at` UTC Z/closed shape，安装取 tag14，tag7/8生命周期不冒来源时间；无SQL、权限、receipt、环境或依赖变更。

Root 原 RED 134PASS/5FAIL→完整check89767 903PASS/2既有资源SKIP；独审另发现 Timestamp seconds 越界P1，Root新负控0PASS/1FAIL后最窄BigInt范围修复。最终Root73169完整check自然0：contract324PASS/default904PASS、0FAIL、2既有资源SKIP，lint/typecheck/正规生成/build均0。独审绑定984dce25/c0aebae5关闭P1，十SHA与freeze一致；旧V5bytes保持。不以工程门替用户UI验收。

原正常BFF44454/Platform31887非watch旧配对仍保持，尚未激活新字段。Web正在固定消费；Root后继同持久配置成对切换并实际点目录/本人预览与详情。作者/例子/真实cover/usage/未安装目录正文资格及后台仍OPEN，其它模块暂停。

<!-- R345-B-RUNTIME-ROOT-END -->

### R345 Skill 更新时间正式机器发行，运行消费者尚待接线（2026-10-08）

Root 固定 Platform正式af38f44的55 publication与独立HTTP原Git字节；public8.9.0/111只给四closed schemas新增required skill_updated_at/string/date-time/Z$，剥回完整8.8 parent与原R342完整8.7 parent均保持。单owner pin，无旧vendor fallback，SQL、runtime、配置、权限与依赖未改。正式source SHA f7f69075fc79ca0bd93a3b2bd5137b8094a6d1a56546a86ede5833ffdfcc0846，parsed canonical e95f026581b389dad643d390f543f9ab057a2bfd0cbb02dfab0aeb8cc662631d。

Root真实tests RED143PASS/31FAIL→GREEN174PASS/0FAIL，双固定generator drift check与build0；129冻结paths及55正式Git bytes独审匹配。独审P2过期版本诊断已窄修并重新semantic111通过，判断未变。Writer完整contract现312PASS/9FAIL（4未接线runtime502、5旧vendor测试字面ENOENT）明确待后继runtime切片，Root未以focused宣全门绿。

正常BFF32003/PID44454仍旧进程，与旧Platform40745配对未变。P运行03ee664已完成真实隔离资源核验但尚未正常激活；Web只D0。正式机器可供消费，不代表用户页面已有日期；外部与我的技能、作者/例子/真实封面/usage/创建/后台仍未完整对齐Manus，其它模块及kokoro-10继续暂停。

<!-- R345-B-MACHINE-ROOT-RECEIPT-END -->

### R343 本人技能包正文运行已接通；Web 详情仍待验收（2026-10-08）

本片基线 e70562759e80a18a959c0e418e495721027ac54f/public8.8.0/111，不改机器契约、SQL、scope或配置。新增三个普通文件分别承接两GET编排、固定Connect与严格响应映射；现server精确分流，projection credential/token仅有界读取/绝对预算/轮换防迟到强化。唯一调用仍 Browser→Web→BFF→Platform→Storage，正文不缓存、不伪造。

Root正常持久用户正式HTTP/form/OAuth登录后，用现本人active source与同revision安装作正控：Platform真实两个目录和全部两文件200且相等；新public四GET真实先0PASS/4FAIL（均404），受控源码激活后4PASS/0FAIL/0SKIP。真实正常九条边界/缺失GET全部通过：未知/重复/空query、相对穿越、NFD、读幂等头、Content-Length0均400；不存在文件/本人源404，严格request ID/no-store/closed不可重试error/无Retry-After。不是浏览器UI/E2E证据。

Root Node22.22.2完整check自然0：contract317PASS；default897PASS/0FAIL/2原资源SKIP，lint/typecheck/all固定consumer生成检查/build通过。独审 iam_skills_admission_review_r343对8冻结源码/测试无确定P0/P1/P2阻断。另一次Root误用Node24在固定Node22门自然失败留日志；不是放宽pin，显式Node22重跑。Root完整format:check及8冻结文件定向Prettier均自然0。

正式资源故障：Platform OAuth resource尚legacy5导致introspection403，Root匹配已配置operator后沿IAM官方read/extend/read得到current6，fresh introspection200；角色/client/binding/凭据没改。初次受控启动Root误注旧manifest enabled=false遮当前持久.env.local true导致安装列表503，已停原句柄并只沿正式.env.local同端口启动；当前来源和安装列表200。未新建数据/账号/包/安装，未reset共享基础设施，未重启其它owner。

普通查看详情Web接线仍在实现；真实作者/Skill日期/示例/usage、任意catalog未安装正文资格、后台同步及完整页面验收继续OPEN。工程或四GET通过不表示与Manus一致。所有Root证据仅ignored私有var/dev/r255-preserve，秘密不提交。

<!-- R343-PACKAGE-RUNTIME-RECEIPT-END -->

## R342 两个本人包读取公开机器契约已验证，用户详情仍未实现（2026-10-08）

当前 canonical public OpenAPI **8.8.0 / 111 operations**：两个本人 package GET，严格目录/选中原文、uint64字符串、空正文/null、原BOM/换行、no-store/request-ID与闭合错误；managed source_ref精确匹配skill路径，selected_file.path精确匹配请求。原109完整parsed文档剥新增后Root deepStrictEqual通过，architecture只当前版本行逆变换后全bytes相同。固定Platform52/45、runtime/source/SQL/正常配置保持，运行中BFF仍d218a1a，未新接HTTP route。

Root原两缺失RED83PASS/2FAIL；首次完整check虽886PASS，但独审发现请求响应绑定/path schema漏守。先新增9强负控，Root真实RED16PASS/10FAIL（含父套件）；只两新operation描述、两output path描述与具名checker补强，原负控保持。最终冻结Root Node22.22.2 pnpm check句柄23333自然exit0：合同/默认全部无失败，default898中896PASS/2原资源SKIP，lint/typecheck/生成/build通过；format句柄9511自然exit0。日志Root var/dev/r255-preserve/r342-root-{binding-red,full-check-final,format-final}.log。两原资源skip不算真实owner通过。

独审bff_skills_consumer_review_r341（gpt-5.6-sol）复核最终10 SHA，原P1/P2关闭，无新增确定阻断；Root全old109解析比较和完整范围外保护独立执行。Root首次inverse审计把含反斜线的regex当普通版本literal两次失败，改为只检查实际第607行escaped版本后全bytes通过；产品未因审计失败修改。提交由Root独占明确路径，原var与557范围外tracked保护。

这只是公开接口机器切片，**不是 Skills 页面验收**：真实IAM/Platform/Storage/BFF新读取链、normal paired activation、Web同弹窗查看详情/文件/正文仍未跑。作者/examples/usage/cover、任意目录卡片读取资格、后台同owner联动仍OPEN；完整70/个人33不升，其他模块和heartbeat继续暂停。README既存84操作旧说明仍为独立文档债务。本轮恢复五个正式源码开发服务只证健康，不把200或辅助门冒浏览器闭环。

<!-- R342-PUBLIC-MACHINE-ROOT-END -->

## R341 Skills 查看详情固定消费前置已验证，页面仍未验收（2026-10-08）

当前源码固定Platform **1f6f764bc4bcf09d235e086ae7fe137acf16d63d** 唯一52输入，逐bytes对正式Git/aggregate e4201bc8674c470bf49c840712f87c34e869b96e59a0e96ba83eb3e4df19446a；正规common/platform生成、当前45RPC/20command/24proof，V8/V9历史各43/20/24及三双父原图保护。旧e83a vendor删除，六旧测试仅反pin字面替换恢复原断言；独立Platform HTTP vendor保持原样。public仍8.7.0/109，SQL/正常配置/身份/进程不变；两本人正文GET和Web查看详情尚未实现。

Root独审确认现wire缺原BOM/合法空presence守卫，新增后真实20PASS/1FAIL：默认Protobuf2.14.0 decoder丢U+FEFF；原FAIL日志保留。现进程级wire策略同步幂等初始化，在server composition之前配置strict/non-strict ignoreBOM:true，复用encode/check，非法UTF8严格拒绝/非严格replacement保持；零异步切换、无测试mock或generated手改。两service原BOM/混合换行/合法空正文/目录absence/uint64守卫22PASS，正常服务未启用本源码。

Root最终冻结Node22.22.2 pnpm check句柄15282自然exit0：contract304PASS、default885中883PASS/0FAIL/2原资源SKIP，lint/typecheck/正式生成/build0；随后pnpm format:check自然0。此前format仅新增长assert报错，最窄3行换行后完整check/format重跑；不隐藏历史失败。日志Root var/dev/r255-preserve/r341-bff-root-{contract,contract-after,check-final,format-final}.log。独审 /root/bff_skills_consumer_review_r341（gpt-5.6-sol）最终无新增源码/安全阻断；Root加CURRENT/INDEX窄收据再冻，494范围外tracked逐SHA保护，原var保留。D0原TECH最后SHA270f8bb3（下节384de170为旧误记，现纠正），API51d71be1/DATAd02ab1原suffix保留。

这是正式详情接线前置，未跑当前真实IAM/Platform/Storage/PG/BFF正文系统或用户浏览器链；不把辅助门当页面闭环，不升完整70/个人33。真实Manus同800×752对照仍缺查看详情/文件树/示例list/作者日期usage与真实cover，安装动作高24px、首卡短33.5px，用户验收FAIL。下一只推进Skills正文public→真实系统→runtime→Web同弹窗详情与示例字段，其他模块/heartbeat继续暂停。README既存84operation陈旧说明债务保留，不宣全仓文档闭环。

<!-- R341-FIXED-CONSUMER-ROOT-END -->

## R340 Skills 包正文三面设计已冻结，功能仍待实现（2026-10-08）

Root审查三D0一致，独审对应原8996fe/51d71b/d02ab1未发现设计阻断；Root核现client/owner metadata后TECH仅明确token tenant authority、x-kokoro-subject/typed request_id/响应x-kokoro-request-id，最终270f8bb3（R341纠正旧收据384de170误记），API/DATA不改。三原suffix/548其它tracked保留。当前固定Connect仍e83a43且两inspection缺失，Root实际资格assert自然exit1；真实owner1f6f764 clean、52正式输入以owner仓相对path含contract/记录聚合e4201bc可独立重算。第一次无前缀聚合断言失败仅审计算法差异，重核源未变。

下步仅完整fixedconsumer/正规生成，之后独立public8.8/111→真实系统RED→runtime→正常激活→Web真实查看详情；当前无public正文路由，不冒UI完成。无SQL/正常进程/身份/资源更改，其它模块暂停，完整目标仍active。三D0完整路径见现TECH/API/DATA顶部R340，正文资格/作者usage/Admin仍OPEN。

<!-- R340-D0-ROOT-END -->

## R323 本人 MCP 四读机器契约已发布，运行接线尚未实现（2026-10-07）

当前唯一public OpenAPI **8.7.0 / 109 operations**，新增四 `/v1/self/mcp/*` GET（本人connector列表/详情、connector下connection列表、connection详情），固定metadata、安全closed shape/参数/错误与no-store。原105 operations/88path items/456components Root独立完整document剥增量后deepEqual，Platform固定vendor/generated、runtime/source/Schema/正常身份完全未动。旧R320三面中“尚未写机器契约”的阶段现由本节替代；五普通TS、正规OAuth HTTP到owner组合及正常激活仍目标，不把contract发行当已存在HTTP路由。没有新数据库/credential或兼容层。

Root实际四缺口RED 77旧PASS/4新FAIL；首机器contract73381 302PASS/1FAIL为旧R240闭集包含新path，最窄排除仅四新path/四ID，原hash/92不变。独审发现新Retry-After范围P2，现尾负控2PASS/1FAIL拒86401；只新header/verifier两行修canonical1..86400/绝对末尾、不容LF。原四RED组全文exact，旧response不改。专用checker和11漂移负控保闭集；scope JSONSchema字符计数不同于UTF-16 JS string.length，描述明确后继mapper仍须真实运行补强，不能单靠maxLength冒同规则。

Root显式Node22.22.2最终71468完整pnpm check自然exit0：contract304PASS/0SKIP、default879中877PASS/0FAIL/2原资源SKIP，lint/typecheck/build；13002 format:check自然exit0。只辅助机器验收，未运行全资源integration、真实本人四读HTTP/E2E或正常用户连接器CRUD，不把两skip计为通过。独审最终1fa085a4无确定阻断，七机器freeze加三已批准D0/本CURRENT/INDEX精确十二paths由Root独占提交；539其它tracked exact，原var保留。完整70/个人33不升级，支付最后，后继按既定实际IAM HTTP/Platform/BFF系统RED再授runtime五文件。

## R319 固定 Platform V8 消费已通过 Root 工程验收（未正常激活）

BFF 现消费 owner e83a2ad3a7c7d333ad0b0b8e7f3d3f64e497bc42 的38个固定发布对象；唯一vendor迁移，V8→V7→V6→V5 provenance逐byte固定、当前43 RPC/父39描述剥除四本人读精确回父版。实际生成只common/platform；Storage第三proto保留完整固定来源而不生成第三业务模块。现generator删除原未调用的request-bindings读取，正式V5来源与对应GetSkillPackageUpload描述/字段守卫可达；四provenance本身的摘要也固定。public 8.6/105、Schema、runtime消费者、服务身份和正常进程均不变，仍 generated-not-activated，不能把本片当四本人读用户流程完成。

Root完整check第一正确Node22尝试contract 289PASS/9FAIL：六既有test旧vendor路径ENOENT；只9处40字符commit字面更新，所有原断言/版本/计数inverse exact，不恢复旧vendor或放松门。最终Node22.22.2完整pnpm check句柄54243自然exit0：contract298PASS、default873中871PASS/0FAIL/2原资源SKIP，lint/typecheck/build/固定生成验证通过；format:check句柄92634自然exit0。此前48723子进程Node24被固定guard拒绝单列。所有日志保Root r319-bff-root-*.log，辅助门不替用户浏览器验收。

82路径freeze55c03a99精确、其余499tracked byte一致；原独审f40caa91无确定新阻断、六引用inverse与三D0历史suffix exact。Root仅再加本CURRENT与INDEX前缀，Git独占显式路径。真实OAuth client_credentials HTTP→owner introspection→BFF四本人读、正常8086接入/资格和完整CRUD仍OPEN；本轮只只读核官方IAM HTTP接缝，未启动测试fixture/扩权/重启资源。

---

## R291 Root worker 候选验收（2026-10-07；未发行/未激活）

当前8生产文件+2测试实现具名Project scope release worker。Root先见两个真实PG失败：冷却恢复被普通due挤住、真实600ms pool等待后owner调用0；三source窄修后Node22全部15PG通过/0失败/0跳过，满limit10总10/恢复1/普通9、include=false保剩余普通与terminal状态均实际到达。原迟到COMMIT/55P03/取消/晚lease/停止/十秒预算也重跑通过。SQL claim前required单调观察＋实际DB剩余不双扣，queue/commit仍耗预算。凭据原短timer屏障只在测试改为单调重检，产品5ms/零fetch/assert不弱化；当前完整9与重复15次通过，旧默认失败历史保留。

Root22656当前 build/check/format/exact source format 各exit0；默认867PASS/0FAIL/2原资源SKIP，合同检查与类型/lint/build通过。十hash及所有tracked运行起终exact，独审a4cc4484无新增确定阻断；required字段接缝inverse完整c2c9原文exact，HEAD190113bytes保护。Root只复用自有r285隔离库，26表最终0行/0其它客户端；正常服务/数据/资金未重启重置或写入。

这是源码候选资格，不是完整产品PASS。正常BFF仍39db/public8.5，当前候选public8.6/105尚未发行/正常激活。真实Storage/IAM资格、正常schema组合、Web消费及17删除用户路径仍OPEN，完整Wave0–7不缩小。下面原阶段文字按历史时点读。

---

## R284 Project scope release worker 文档门（2026-10-07；未实施）

BFF本地Project删除切片已由Root提交为`6f20f81a8d15992b35bc07e76ac8808d7072bee8`：19路径包含本地runtime、canonical两表与`8.6.0 / 105`机器候选，Root隔离HTTP/PostgreSQL为16/0。正常BFF仍运行`39db` / public`8.5.0`，未激活本候选；Storage worker、正常schema组合、Web 17条用户链、完整DELETE并发/COMMIT-unknown及真实Storage ACK-unknown恢复均未验，T-C05保持OPEN。

本轮只收敛后继设计：新增具名scope-release client、dispatcher、outbox port与PostgreSQL repository，并只接现business-store/repositories/runtime/server四装配入口。复用固定Storage `e8b9928418924812587b7ac07900aee4be5bc27f`/combined`c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`、现两表和原N+1命令；不新增public operation、Schema、receipt、通用bus或repair API。

恢复政策已锁定：普通claim不动blocked；unknown/retryable永远同command/digest恢复且不按次数冒终态；只有正规`UNAUTHENTICATED`资格错误可在至少300秒冷却、每轮最多一条、同可信identity/新fence下尝试一次可能写的RPC。其它terminal/损坏保持blocked。下一阶段须先用真实PostgreSQL与固定Storage owner做failure-first RED；本D0未运行任何门、资源或用户验收。

## R282 Project 删除本地候选（已实现、未发行）

当前工作树已实现 Project DELETE/status、本地事务、canonical SQL、Conversation/ScheduledTask 聚合处理与 Storage release outbox；Root 隔离 HTTP/PostgreSQL 16/0 及完整工程门已通过。正常 BFF 仍运行正式 `39db` / public `8.5.0`，本工作树 `8.6.0 / 105 operations` 机器与 runtime 候选尚未正式发行或激活；Storage worker、Web 消费和 17 条真实用户链均未实现验收，T-C05 仍为 OPEN。

## R277 Project 删除机器候选（未发行、未实现）

当前工作树仅候选 public `8.6.0` / 105 operations：在原103项之外增加 `DELETE /v1/projects/{projectId}` / `deleteProject` 与 `GET /v1/projects/{projectId}/deletion` / `getProjectDeletion`。成功与错误保持本仓 data-only/error-only profile，request ID仅header；DELETE保存原始202 pending receipt，status GET只投影 logical pending/blocked/released，physical恒pending。共享旧Project GET/PATCH参数与原103 wire不改。此候选尚无runtime、canonical SQL、worker、Storage/Scheduler真链、Web消费或浏览器用户验收；v1 baseline只能由Root正规生成并审查。

Root 当前候选验收（2026-10-07）：Node22正规 `pnpm contract:update-baseline` 写105唯一baseline；`pnpm format:check`、`pnpm lint`、`pnpm contract:check`、`pnpm test`、`pnpm typecheck`、`pnpm build`均exit0。contract **298PASS/0FAIL**，默认 **867PASS/0FAIL/2既有SKIP**；独立target contract+architecture **112PASS/0FAIL**。4既有OpenAPI warning保留。此前Root真实新RED3FAIL/0PASS，首次完整contract297PASS/1FAIL因现governance当前版本仍8.5；仅同步标题/当前regex至8.6，其余生命周期断言逐字exact，保首次失败日志。

Root对旧103operation/path参数和旧components结构逐项deep equal、旧baseline subset exact；独审绑定冻结机器685862b5，GET400/闭合profile问题已修正，无剩余确定阻断。当前三D0已明确“已发行8.5/103 vs 工作树8.6/105机器候选”。本轮不触source/schema或正常服务、不生成Web消费；无真实PG/owner/项目删除浏览器验收，所以仍是待运行实现的候选。证据Root `var/dev/r255-preserve/r277-project-final-pure-gates.log`、`r277-project-old-wire-preservation.json`、`r277-project-machine-final-review.md`；后续由原BFF owner补运行/同事务冻结与任务恢复fence，Root真实验收后才发行。

## R269 个人 Skill 生命周期 producer 正式交接（2026-10-07）

BFF `39db896b9755a8b710d27ae1a220cdbb182b72b7` 已固定 public `8.5.0` / 103 operations；canonical OpenAPI raw SHA-256 为 `01009fb40ba2fbd2bb4829543e4b038d151ae56bcd1e11666f11c6a51344f296`。本仓正式源码现具备 `createPersonalSkillVersion` 与 `withdrawPersonalSkill` 两个公开命令，可由 Web 后继固定该 commit/digest 后通过既有 generator 消费；Platform Connect pin 与其历史证明链不变，无兼容双轨、BFF SQL、第二 receipt 或 owner mirror。

Root 资格装配 commit `6831e0bb330127d9172bf99e51d020b7257f794e` 的真实 IAM → BFF → Platform owner 链在 73.036 秒内 PASS，且 resources clean。证据包含新版本 revision 2 / 同 series、原 key replay、异 body 409、安装保持原 exact revision、草稿不继承 package、撤回 replay、新 key terminal 412、安装 source_status=withdrawn、completed receipt +3、retryable-failed receipt +1、唯一 withdraw event，以及撤权后两个原 key 401 且 Platform HTTP 请求零增量。资格过程使用正式 ZIP V2，保留此前错误 fixture 与 counter RED 证据，不以放宽 owner 规则过门。

当前边界：正常 BFF 尚未受控重载至该源码；Web 尚未 repin/生成/消费 8.5；新版本与撤回的浏览器 CRUD 尚未验证。因此本节是 producer 与真实 owner 资格的正式交接，不是正常运行激活或完整 T-K03 用户验收。下方 R268 “候选/资格待验”文字为历史阶段记录。

## R268 个人技能生命周期运行候选（未发行、未正常激活）

本次候选在 a55f70f3 的 public 8.5.0 / 103 机器定义上实现两个精确个人命令；正常 BFF 仍为 930028b9721587e9c21535eff1e78ce361b82df9 / 8.4.0，Web 禁止在真实 owner 资格通过前消费候选。新增两个 input、两个 owner 3.0 digest projector、两个具名 route 与一个仅服务这两命令的请求生命周期 helper；复用既有 Catalog client/token 与 bootstrap，无 Schema、第二 receipt、owner mirror、latest 或自动升级/重试。

Root 对最终冻结 13 路径重跑：format/lint/typecheck/build exit 0；contract:check 295 PASS / 0 FAIL，architecture 35 PASS / 0 FAIL，默认 864 PASS / 0 FAIL / 2 既有 SKIP；目标两 suite 22 PASS / 0 FAIL / 0 SKIP。4 个既有 OpenAPI warning保留。真实本地 HTTP/生成 Connect binary 和固定正式 owner digest 向量证明此候选的传输/校验边界，不是正式 IAM/Platform PostgreSQL 组合或用户整页验收。独审 1338f91c 绑定最终 manifest e99ffc08，旧两 P1/三 P2与 early-body 缺口在本切片闭合；Root 核其余521文件及原 Catalog/bootstrap/credential 断言保护。

原全部实际 RED、两次类型错误、格式失败及测试 oracle 错误证据保留于 Root var/dev/r255-preserve/r268-*。后继仍须真实 IAM→BFF→Platform receipt/replay、安装精确 revision 保持和撤权拒绝资格，再接 Web 新版本/撤回 UI及浏览器 CRUD。真实 owner integration / 正常加载 / 用户端到端：未运行，不记通过。源码候选提交不等公开发行或完整 T-K03 通过；原正常服务和共享基础设施未重启/重置。

## R266 本人 Skill 管理读取源码/机器已验收（2026-10-06 23:38 UTC）

本片准备由Root精确提交；下方候选/D0/旧版本文字为历史，以本段和实际commit为当前事实。Public 8.4.0/101正式源码新增exact GET /v1/self/skills及/{skill_id}，固定Platform HTTP3.3 owner3d4ba6c/rawb6e5d0e0，旧vendor3.2删除，正规生成16输出且原六/原99 wire和原components保持。Connect/Proto c949独立pin、数据库/Redis/凭据文件与安装/发布命令不变。

新route在通用准入前精确分派，本次Session admission→现shared machine token→owner/body/strict parse→成功序列化后复核共一个单调10秒预算，取消/过期/late结果不提交200；safe8/五状态/本人可信身份、closed请求/错误tuple/no-store/request-id/1MiB均按三D0实施。普通版本号仍string，无额外owner mirror/缓存/receipt/权限grant。旧六client后缀byte exact。

Root实际新build四HTTP44PASS/0FAIL/0SKIP；full contract276/0、architecture35/0、default841PASS/0FAIL/2原资源SKIP，lint/types/build/目标format全0。机器独审bd3aaed3/runtime最终c380fc35均无剩余确定阻断；Root重新核504任务外文件/三已提交D0/旧99及components/旧六exact。三架构oracle旧version/importerFAIL32/3后只同步exact批准route/8.4/owner3.3固定pin；有效RED、类型失败和错误harness证据保留，不靠删skip或放宽预算。

这是BFF已验收源与机器，不是正常进程或Web用户全CRUD。正常53714/Platform8086未重载，Web仍ee4056c/8.3，真IAM→BFF→Platform组合、新五状态管理页/版本/撤回及浏览器33用例待验。无normal DB/资金/模型/权限写或restart/reset；Root统一Git和资源。证据Root var/dev/r255-preserve/r266-bff-managed-read-{runtime-green,root-full-gates,root-final-gates}.log及freeze/review/receipt。

## R257 管理路由 HTTP 实施验收（2026-10-06 16:16 UTC）

四个已发布public8.2操作现有具名route/client实施，System3.0固定artifact与全部旧operation不变；无BFF DDL/新owner/兼容proxy。

Root92682 Node22 check+format exit0：contract264/0、主829PASS/0FAIL/2既有skip、lint/types/drift/build0；Root50905正式IAM CLI资格/Audit/CodePKCE/current admission→BFF四具名操作→System真实PG官方seed/三读/visible CAS保存/权威回读/原key重放/异body与旧版本409/坏Session401通过。资源PG77→77/IAM前缀keys0→0、cleanup passed；独审ea30e379，route8f59/clientb308/test3aeae1冻结。

正常BFF仍旧进程，本次未重启/授正常管理员；Web管理页面仍占位，合法普通Session403/管理员撤权后重放、普通models visible投影、浏览器保存确认、推理和资金未验。仅owner子链及本切片工程通过，旧404/400/502/取消抖动证据保留；下方阶段描述为历史exact suffix，不作当前否认实现的依据。

## R256-ADMIN-03 固定管理契约发布（2026-10-06，仅机器切片）

Public 8.2.0新增四具名tenant-scoped model-routing管理operations；原95wire逐字节保护。System owner固定3.0.0/955bd587f46a771e43a4330d202d90a7d2d67262、原artifact SHA94ed91655741cbba66ce80a4c41717b9179cc509cb6858534e0b78aa3e6dc059，正规工具仅生成四operation/16文件；本固定artifact后处理20个对象strict、原vendor不改，无手改generated/锁升级。
Root Node22完整check46931实际exit0：contract264PASS/0，主test814PASS/0/2既有资源skip，lint/typecheck/drift/build0、4既有OpenAPI warning。独审d125f4b6关闭四P2：data数组、字段界/默认、真实current admission错误status/code与必需header、generated closed对象；三D0原后缀/旧95事实保持。architecture最终只8.1→8.2版本oracle一行，不夹整文件格式。
Root首门252/10及后续813/1/2skip失败证据保留。本片无production route/client/bootstrap/Schema/配置/正常资格/资金/provider变化；有效真实管理员GET404 RED仍OPEN，后台页面与CRUD未实现。后继具名HTTP实现须沿已批准三D0与合法owner RED，浏览器正向/撤权/持久读写单独验收。
证据Root var/dev/r255-preserve/r257-admin-contract-final-root-freeze.json 与 final-exact-root-check.log；纯机器门不替代真实用户闭环。

## R257 当前排程 terminal 失败投影切片（2026-10-06）

现 PostgresScheduledTaskRepository 在有效outbox lease/fence行锁下，将当前revision且active+enabled的register/replace终止失败与outbox终结同事务提交为failed、next_run_at=null；paused/stale/delete/retryable不覆盖或复活任务。无schema/contract/新状态变化。
Root Node22完整check813PASS/0/2skip，完整owner integrations277PASS/0/0skip（真实PG/Redis/BFF HTTP；Session准入及Scheduler HTTP响应替身仅证明本方分支）；独立源审475c1ae3无确定P0–P2。298源/测试冻结与自有库0连接回收、PG集合77→77/Redis15零exact。前两fixture前置与HTTP revision/global-call oracle错误已保留并精确修正，最终完整工程与业务库断言重跑通过。
这不是正常Scheduler接纳/dispatch/Agent执行/费用或浏览器完整排程闭环；正常配置与源码受控重载另由Root核定。本提交不修改旧failed命令或正常QA paused事实。

## R257 当前本人管理员资格消费源码发布（正常切换待验）

本提交冻结来源04a6a123：固定IAM d24aa2b internal0.8原字节0153a16f，成功必填platformAdmin仅具名AdmittedUserRequestContext；原GET /v1/me追加required platform_admin，普通false合法200，未知/缺失/错型不假false。public首发前8.0.0/93operation，YAML cec91c36c836319af4acbb4e2cf372434b70dd0f52bdf266420e1957057ac4be，旧MCP6d46ec8 immutable artifact不覆写；Web后继必须固定本新发布，不双读兼容。

Root22285显式Node22.22.2 pnpm check实际exit0：contract259/0，全纯802PASS/0FAIL/1资源skip，lint/types/generators/build0；独审69ef3abb无已证P0–P2，35候选/19protected/3extra起终exact。19仅本阶段保护，不冒最初全部mixed hash；未全format（原Project两protected失败）、未跑正常IAM组合/PG/浏览器后台。Root8589合法owner0.8两HTTP正控先2FAIL，最终true/false/同token在线撤权/伪身份/依赖与取消回归是辅助门，不代表正常后台完成。

正常仍原BFF51474/6d46ec8进程配旧IAM/schema；不先半边激活。IAM只有fresh installer、正常有数据演进入口仍缺，Web旧strict /me会拒新字段，必须owner正规演进+Web消费与server/admin gate后Root受控整组切换。未授任何帐号管理员资格，Settings入口/直链保护/后台业务CRUD/财务权限尚未验。

## R257 本人 MCP Connection 读取研发切片（2026-10-06）

源码/机器契约6d46ec8bdd2d2ffaa06513fd0561272eae907919已精确提交，新增唯一GET /v1/mcp/connections，固定Platform HTTP3.2.0/9ab3b653360d04fb498a238659edeec01e72f62d/digest4b42dd161c972b3447cfea3a6f80a949bbdb573c46213dbf8ef4c3ecb58e72da，旧3.1vendor删除。六字段本人投影、可信actor、closed四query、strict错误/header、1MiB与贯穿token/owner/body/parse单5s、取消迟到退役；Server与Skill旧分支不重解释。

Root原81428完整pnpm check真实exit0：795PASS/0FAIL/1skip，lint/types/完整contract生成一致性与build通过；作者窄111/0、独审0c31098a最终33hash一致无P0/P1/P2。全format:check仍原受保护Project两文件失败，不冒全仓格式通过。原19mixed排除暂存且当下stage前后hash保持；R257启动未逐一保存source before，不称19原始byte全部审。正常原48037停止130后复用原持久env唯一51474/53714 ready200，没有重启PG/Redis/改业务数据。

当前Web仍旧Server消费者；固定public8.0.0 YAML digest8d5b452ba554f7b9ce723481a0a619abf12d9fb3174b9f15f52a395ad1372783已给Web后继。本人正常owner与浏览器读取尚未验收，ready和补充替身门不等真实产品闭环。创建/授权/启停/调用/撤销仍OPEN，空列表不能证明生命周期完成。管理员当前资格IAM0.8消费设计独立进行，normal IAM旧required形状不先上线半边。

## R255 02:44 ScheduledTask 本地 immutable artifact 交接

Root已接收固定owner commit `45e67f0e783fb4bcdb086665a09b7c3c5fadbb6f` 的唯一 `contract/openapi/v1/openapi.yaml` 原字节：public发布前 `8.0.0`，git blob `1b42d49388ca26eaaef7371daf23cbf1158d5fe6`，SHA-256 `0802a31f9469a17cd8fc8b78e6d2326e0571bc93f3ac8d19811a42a1b185df95`。当前canonical与该immutable blob byte-equal；旧Web pin97a99d35/33971eaa仍冻结，不改旧commit内容。此本地交接允许后继消费者锁定新commit/version/digest，经现generator正规生成；不是remote push、registry release或正常运行激活。

相对旧Web artifact只有ScheduledTask输出必有nullable next_run_at、create的可选recurrence_anchor_at以及closed PATCH显式规则字段；92operation、身份/错误/权限/其余schema保持。三D0已批准public8.0发布前clean-slate更正且源码e603bd55落地，不引入/v2、双协议、旧字段alias。后继Web只显示owner确认next，null不以应用时钟补齐；规则anchor与next不互填。

验收绑定源tree77c81139：Root精确index真实PG/Redis175pass/0fail/0skip、fullcontract242pass/0fail与八纯门0；本轮Node22.22.2直接semantic再次0（92operation）。这些是artifact/source验收，不替代真实IAM/Scheduler/provider/浏览器；normal BFF非watch未重载、schema调整一次待答、Web consumer未改，持续next读取仍待后继，T-P02未闭环。沿现任务/QA台账与owner边界接续，不用全文历史状态覆盖本节。

## R255 02:02 ScheduledTask 源码集成验收（正常页面尚未激活）

当前源码已与发布前 OpenAPI 候选对齐：持久规则锚点 recurrence_anchor_at 与 nullable next_run_at 分离；create/replace 先置 next 为 null，Scheduler 成功回执通过生成 validator 与业务等值校验后，当前 task revision 与 outbox lease/token/fence 核验，task 投影及 outbox success 同事务提交。暂停/禁用/删除与迟到回执不复活任务；V2严格payload，删除无V1兼容或可选projection fallback。Scheduler.version独立于BFF task revision。持续执行后的 next 刷新仍待 owner 读/事件接续，不称整个排程生命周期完成。

Root真实PG先8 tests/1pass/7fail（父失败含在内）；修复后的混合工作树5文件174/0，再将24批准source/test精确暂存，排除三mixed原Project改动，在 index tree 77c811391c697e370cdcab888b5c427c71ae4c32 独立快照复跑真实PG/Redis175/0/0skip（含保留HEAD的R237 catalog），库目录77→77 exact。localhost网络负控13/13已在现 validator 下通过，不是新RED；先前缺validator判断正式撤回，没有扩大control-client写集。真实PG与existing Redis、localhost owner doubles不是正常IAM/Scheduler/provider/浏览器E2E。

同Node22.22.2暂存快照 format/lint/types/build/semantic/schema/scheduler generated/full contract均exit0；默认779pass/0fail/2资源skip，schema纯门10pass/2资源skip，完整contract242pass/0fail/0skip。原mixed工作树 format仍exit1（两个任务外Project文件），不格式化他人修改、不放宽门。独立暂存审查625092a8零P0/P1/P2；当前源码+测试无依赖original mixed。Root只提交24source/test及本CURRENT前缀，原全文/三mixed批准外hunks/提交前468非source路径（466 tracked+两原untracked）保护，追加CURRENT后467任务外路径仍exact。

正常开发BFF tsx非watch，仍旧已加载源码；唯一QA暂停任务仅只读盘点，局部排程表重建请求一次待答，未删除/重启/改normal schema。Web消费者pin尚未更新，候选未发布；必须 owner artifact→Web repin→批准的局部激活→真实创建/编辑/暂停/刷新/时区/执行浏览器验收。完整70组11/8/14/36/1不变，T-P02整组FAIL保留，0主动模型/赠送/结算。证据沿Root现var/dev/r255-preserve/0202-*，本CURRENT新增只记本切片，不覆盖以下历史时点。

## R255 01:41 ScheduledTask 时间机器合同候选（未发布，生产实现待续）

当前 public OpenAPI 8.0.0 发布前切片：create/closed PATCH 仅接受可选 recurrence_anchor_at，不再接受输入 next_run_at；输出 next_run_at 必有且可 null。保原92操作、权限、envelope、weekly锚点规则和owner计算职责，无旧字段alias。仅机器合同、现semantic gate及既有contract断言改变；生产parser/SQL/receipt投影/generated消费者/pins未改变，暂不发布或宣称正式用户修好。

Root按本仓Node22.22.2重跑目标format、typecheck、lint、build、contract:semantic、inventory、focused 77/0、contract:check 242/0全部exit0；worker先前Node24 pin失败原日志保留，未修改pin放宽门。独立冻结审查 f1ee0cb0 无P0/P1/P2；490 tracked中批准三文件变化，另485 exact、原mixed保护。正常每周08:00创建与刷新反例仍FAIL；下一同卡实施源码/schema及Scheduler receipt事务投影，最后真实浏览器复验。这些工程门不替代E2E。

证据：Root ignored var/dev/r255-preserve/0141-bff-root-gates.json，冻结handoff 3e34fb14、diff 1438e0d6；SQL/真实Scheduler/浏览器本切片未执行，0模型/赠送/结算/服务重启。

# R251 Skills V2 consumer 候选（2026-10-05，未发布）

当前隔离候选把唯一 Platform Connect source 固定到 `494b118ae7c29f1fc1005122d72c6c2bbf2640b6`，验证 V7 `3384a88f…` → V6 `0d728881…` → V5 `3f97b3c9…` 继承、当前 Proto/descriptor，并由现 generator 正常生成；V7 仍为 inactive/routable=false，不表示 activation。

Validate localhost HTTP 只接受 `zip-v2:sha256:<64 lowercase hex>`，拒绝旧 V1、错误长度、大小写与前后缀；public 路径保持 `/v1`，唯一 OpenAPI 候选为 `8.0.0`/91 operations。请求 shape、IAM、权限、幂等、错误、数据库和 receipt 均未改变。

当前 Node 22.22.2 实证：原 6-failure HTTP RED 已为 14/14 GREEN；Platform 双次生成/check、OpenAPI semantic 91 项、OpenAPI lint（保留 4 个既有 warning）、相关 137 tests、contract 238 tests 均通过。最终 `format:check` 与完整 `check` 均 exit 0，完整纯测试 745 pass/0 fail/2 resource skip，lint/typecheck/build 均通过。未运行真实 IAM/Storage/Platform/BFF/Web 发布安装旅程、PG/Redis、provider 或 browser；未提交、未发布。

## R241 Project rename 候选完整 owner 验收（2026-10-05；待精确 Git 交付）

当前已实现 canonical Project name PATCH，public OpenAPI 候选 `7.2.0` / 91 operations；本节覆盖下方 R240“仅合同/未实施/待复测”的旧阶段时态。正式基线 `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2` 不变，新交付 commit 尚未产生；原20protected mixed不进入切片。

有限功能：name严格输入/最小ACK、当前IAM→锁内active owner→同事务receipt、LWW/no-op、旧key不覆盖、权威GET/list/旧slug/重建服务读回及所选系统失败恢复均已形成候选。源码事务 SHA `aa4da6fc75e1732e240d0cf59afdc62a7bdafb81b7b2b156c15e6570f6792cb8`；测试 SHA `b480f9d2455d279b1d26df6903577eba74de465d0a7464effc50fc74f772021a`。

Root7719原样基础五组+所选17叶：TAP含父子27pass/0fail/0skip；旧L6 receipt取消失败经transaction-local100ms窄修关闭，原1500ms oracle未放宽。该证据不是27个独立用例或取消300ms SLA；Linux/macOS研发CI平台边界不等于两种OS均已实跑，静默network partition不在断链检查保证内。

Root82423完整门终态0：installer/build/check/format均0；默认check745pass/2资源skip，另行真实PG/Redis integration244pass/0fail/0skip（TAP约73.820秒，进程step约76.898秒）。manifest `/var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r241-bff-full-27__lc_g/manifest.json` 记录source_hashes_equal、redis_keys_equal、secondary_dbs_unchanged均true，自有DB已回收；默认skip不冒资源通过。定点27证据 `/var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r241-bff-http-green-t7yto45m/manifest.json`。

当前独审 `/tmp/r241-rename-lifecycle-review.md` 为0P0/0P1/1P2，剩余P2仅R240旧时态；本四前缀供Root窄审关闭该文档项，不预写已关闭。未选C4/C5/F3/L4/L5/L7、同PID后继setting实测、正式IAM/Web组合仍OPEN；无生产DELETE或Task/Storage/Run完整删除完成声明。

后继owner：Root独占四文档复审、精确Git交付/发布commit与digest；Web owner在正式owner发布后另卡接入并验证ACK→GET→刷新。当前未发布producer、未消费者repin、未启用3310、无push；本轮docs-only，不重跑或冒领Root资源验收。

## R240 rename 机器合同候选（2026-10-05；待 Root 独审）

正式基线为本地 main `cdad0ad6580dcbca18b75fdfbdbac4aa61f750d2`，active 前置已交付；下方历史“候选/未实施”描述不再否定该 commit。此次从该 HEAD 的 clean artifact 构建，原 20 protected mixed 完全不进入交付。

候选只将唯一 public OpenAPI 升为 7.2.0/91 operations，增加 `renameProject` 独立 name PATCH；原 90 项与 instruction 合同保持。同步正常生成的 inventory、窄语义/合同门及四设计当前前缀；无 source/schema/installer/依赖/消费者 pin 变更。

本次无资源合同检查结果以 `/tmp/r240-bff-rename-contract-handoff.md` 与 JSON manifest 为准，Root 仍需独立复验。机器合同不等于 endpoint 可用：真实 HTTP/PG RED、实现、失败恢复、完整 owner 门、正式发布和 Web ACK→权威 GET→刷新保持均待后继卡。没有生产 DELETE writer，完整 Task/Storage/Run 删除生命周期仍 OPEN；不启用用户 3310 组合、不 push。

## R239 Project active前置Root完整验收（2026-10-05；本地交付身份以Git与Root收据为准）

本节为当前已验证候选事实；下方R236为实施前设计记录，其“未实施/未验证”时态由本节替代，位置及边界说明仍有效。基线main 7289b3a4ae8f2df5c249350d59b9405c33fb4083，本地交付身份以本仓Git与Root收据为准，尚未启用用户3310组合。

真实RED→schema完整12/0/0skip→同8业务组35父子统计GREEN→最终owner完整门：installer/build/check/format均exit0，默认743pass/2资源skip，236contract pass；全部真实PG/Redis integration217pass/0fail/0skip（65.592秒）。不可把默认资源skip算真实通过，完整资源门另有实际证据。七TS独审P0/P1/P2=0，business格式调整仅AST等价。

资源manifest：`/var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r238-bff-full-4wxzajt6/manifest.json`；source_hashes_equal/redis_keys_equal/secondary_dbs_unchanged均true，自有数据库已不存在。schema治理收据沿Root progress R238。

候选10 code/schema/tests路径及四现行设计前缀从HEAD重建，不整包20mixed；Root独占Git，提交身份以本仓Git与Root收据为准。生产删除writer、rename/delete、正式IAM、用户3310与模型费用完整旅程均尚未闭环；无push/组合重启/清共享数据。

## R236 Project active 前置当前门（2026-10-04；docs-only）

当前正式 `main 7289b3a4ae8f2df5c249350d59b9405c33fb4083` 无Project.deleted_at；20protected mixed及原R234全文保持。本轮仅四D0顶端追加短R236前缀，Root已选R235路径A，未改source/schema/test/contract/lock。完整CRUD目标不变，active前置不等于Project删除或改名完成。

后继范围固定为TECH R236的7生产/schema位置（nullable墓碑列/原索引partial＋25处资格predicate）及现schema-governance/business-store两测试。必须从HEAD构成Root自有clean artifact，保正式chat-turn-commit三处及其有限事务、outbox委派/Message早返回，保全部HEAD测试和7个R217期限/断链/unknown case、request-id断言；不整包mixed回退。

当前无生产tombstone writer、公开DELETE、删除三表、Service/port/installer变更或兼容路径。独立Task政策、Storage释放、Run/Share/stream完整删除生命周期仍OPEN；R234 name合同与实现另卡，本片不改public7.1.0或发布状态。

**下一阶段：** Root独审三面一致性→单独授clean artifact和两测试范围→真实HTTP/PG与fresh catalog RED→7位置最小GREEN→独审/完整门→精确commit，再推进rename或完整删除后继。本次0测试执行/0通过/0失败（未执行）；禁止把设计、缺列报错或历史R217数量当本片通过。

Root后继在自有随机数据库/owner schema、复用现PG/Redis且不清共享数据，执行 `pnpm db:apply-schema`、`pnpm schema:check`（显式KOKORO_TEST_POSTGRES_ADMIN_URL以运行真catalog）、`pnpm check`、`pnpm format:check`、`pnpm test:architecture`、`pnpm test:integration`；保R207/R209/R211/R215定点与完整门、源码hash/资源回收收据。HTTP/PG负例需全事实零差并有P/Direct正控，正式IAM/浏览器另验。后续BFF单writer按新卡工作，Root独占资源验收/Git/发布；本次交接后停写。

## R217 Message 有限准入切片已获Root验收

基于正式BFF `8e33bc0a64d2f92ab2fcd113b1951f490487a8d3`重建的15路径clean候选，现Message准入以`chat-turn-commit.ts`承接单一4.5秒绝对期限、Project→Conversation锁、canonical replay及exact checked-out client error租约。首次真实四矩阵为3通过/1失败：真实backend terminate触发`Connection terminated unexpectedly` uncaught；窄修只增加operation listener标记destroy并在Pool release后卸载，不改预算/API/schema。Root随后四真实HTTP/PG矩阵4通过0失败（5.462秒），独审0P0/P1/P2；最终完整owner门182个真实PG/Redis测试0失败0跳过（58.539秒），743默认测试/1既定资源skip、236 contract及schema/format/lint/typecheck/build全部通过。资源manifest为`/var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r217-bff-full-ygz0gcao/manifest.json`，源码、自有数据库、Redis与secondary集合终态保持。

准确交付commit、Root gitlink与启用状态由Root CURRENT/progress维护；当前3310仍是旧组合，未取得当前UI消费证据。主动HTTP取消、Project DELETE/Storage release、Agent实际消费与用户全链继续开放；不以182测试泛称全部产品能力闭环。

以下R213段是实现前的历史D0；现实现与验收状态以上方R217段为准。

## R213 Message 单一有界准入D0（2026-10-04；实现待验）

Root真实R211 pool饱和RED为HTTP 5225.8ms/202，确认现Message在`commitChatTurn`4.5秒期限之前仍有无界Conversation授权预读。已裁决目标为：保IAM与strict wire门，删除仅Message POST的授权DB预读，由现单一事务按Project→Conversation锁序完成tenant/owner/active/current Project、首次Project与replay判断；缺key/Agent配置继续静态零DB，首次Project不可见映射既有404。当前三生产文件尚未修改，R211仍RED；本D0不代表行为、资源门或发布完成。

## R205/R189 Message scope 独立提取候选（2026-10-04）

基于正式`8e33bc0`，本候选只包含Message当前Conversation scope、same-key Move后replay、首次client-created绑定及Project→Conversation锁序；无SQL/OpenAPI/route/generated差异，也不依赖尚未提交的Project `deleted_at`。聚焦纯payload反例与R189/R190真实PG/HTTP测试尚待Root在clean提取树执行；候选不等于已提交、已发布或R203 Project DELETE前置已闭环。

## R176 Storage scope-release consumer pin（2026-10-03；实现仍未接线）

Storage producer 已正式发布 `e8b9928418924812587b7ac07900aee4be5bc27f`，BFF 唯一 vendor/generator/manifest/generated consumer 固定该 commit 与 digest `c22b5c10ee698d579753dcac370be371d8dba1df8fead1a12883f5443fbad18a`。本切片只建立 `ReleaseProjectScope`/`ReleaseConversationScope` wire 类型基线；Project DELETE SQL/service、release command repository/dispatcher/runtime/route均未实现，外部 provider与最终用户链未验收。

## R155 Move 持久化职责拆分已发布（2026-10-03；Web 尚未消费）

已提交并推送的 `main 6c5cee0ca5b64dd7e1a855eae1022290eb16cd9a` 是 public `7.1.0` Move producer 的职责拆分源码；此前 `0333cd7c515846e977b1b05d8349e8c04d2a49dd` 是原已发布布局。R154/R155 只按已审三设计面重新放置同一 Move 实现：`src/infrastructure/postgres/conversation-move.ts` 独占单一事务与赢家 receipt 重放，`conversation-move-lease.ts` 独占有界 PoolClient 生命周期，既有 `chat-repository-mappers.ts` 承接纯 receipt Row 校验；`PostgresChatRepository.moveConversation()` 仅具名委派。原 `chat-repository.ts` 从 979 降至 678 行，新两文件分别 158/133 行，Root 800 行门的本项已由真实 153→152 证明关闭；全仓标准门仍 exit 1，其他 152 项不据此转绿。唯一 public OpenAPI `7.1.0`、canonical SQL、现 port、generated/pin 与所有 Move 行为语义未变。

Root `73539` 在冻结候选上完成八文件真实 PostgreSQL/Redis integration 173 pass、0 skip、37.730 秒；自有数据库已删除，运行前后源码 hash、Redis key 集合及另建数据库集合一致。Root `27938` Node22 完整 `pnpm check && pnpm format:check` exit 0：纯测试 742 pass、1 个既有资源 skip，lint/typecheck/contract/build/format 均通过；contract lint 的 4 条既有 warning 仍在。Root `1462` 九项 Move 真 HTTP/PG 9 pass、0 skip、14.0297 秒，自有数据库已删除，源码 hash 与 Redis key 集合不变。独立源码审 `89c280f0` 为 0 P0/P1/P2。这些是本仓已发布源码的行为与架构证据，不代表整个 152 项标准债务合规或用户端闭环。

源码已由 Root 精确提交并推送；Web 尚未固定 BFF commit/digest 或验浏览器 Move 消费，Project DELETE、Storage Conversation/Project scope release 消费、ScheduledTask 关联、T-C05 和原用户首屏 P0 继续开放。下方 R150 描述此前已发布的原 Move producer 布局，不覆盖当前新职责或验收状态。

## R150 Move 7.1.0 BFF producer 已发布（2026-10-03；Web 尚未消费）

已提交并推送的 `main 284b5e04c4c09759787ef239b1a19fcdcd5ed8fa` 是 public `7.1.0`；此前 `main a68cbe55cde709f9b21f3d5803bfbd3ca5d14e2b` 是 public `7.0.0` 基线。当前唯一 OpenAPI 已加 `7.1.0` `POST /v1/sessions/{id}/move`，BFF 专用 HTTP handler、Chat service/repository 和同事务最终 receipt 已实现。`database/schema.sql`、owner generated/pin 与 Project DELETE 源码均未改；既有 Skill strict raw JSON 解析器只作原字节中立位置迁移和 import 更新，不是第二个业务能力。

Root 对当前源 `219c2268…`、测试 `c3575c67…` 的最终门：Node22 `pnpm check && pnpm format:check` exit 0，纯测试 741 pass、1 个既有资源 skip，lint/typecheck/contract/build/format 均通过；contract lint 保留 4 条已知 warning，不称零 warning。完整八文件真实 PG/Redis integration 173 pass、0 skip、37.305 秒，installer/build exit 0；自有主数据库已删除，392 个源文件 hash 与运行前相同，Redis key 集合及测试另建数据库集合未变。日志 `/tmp/kokoro-r151-bff-check-root.log`、`/tmp/kokoro-r151-bff-format-root.log`、`/tmp/kokoro-r151-bff-full-integration-root.log`，资源 manifest `/var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r150-bff-full-fn4_9w4m/manifest.json`。

Root 聚焦真 HTTP/PG Move 9/9、0 skip、14.051 秒：先以真实 COMMIT 成功后受控 socket/ACK 丢失证明原源码将 broken client `release(false)` 的 RED，再以仅 Move catch 的 `release(true)` 返修证明 typed 503、精确 backend 淘汰、新 backend 可用、同 key 权威 receipt 恢复且事实仅一份；日志 `/tmp/kokoro-r150-bff-move-final-nine-r2-root.log`。这是真 PostgreSQL/HTTP 与 fixture 传输故障，不冒称独立网络代理验证。unknown COMMIT 源码差异独立静态复审 0 P0/P1/P2；BFF producer 源码已提交推送，Web 尚未固定 BFF commit/digest 或完成浏览器消费，不能把 BFF 发布等同于正式用户界面可用。

Move 已作为独立 BFF producer 切片发布；未实现的 Project DELETE、Storage Conversation/Project scope release 消费、ScheduledTask 关联规则、DELETE 竞态、Web 先移出再删界面及 T-C05 均继续开放。下方 R133 与更早段落保留当时已发布/候选的历史证据，不覆盖此当前态。

## R133 当前切片 Root 验收事实（2026-10-03）

HTTP5 正式消费、public7 过程契约、两 canonical process 表、同事务 RR 快照、immutable anchor 分页、START 与分批 GC 完整性切片已由 Root 复验。真实 PG/HTTP：15 焦点和完整 74 项全部通过、0 skip；完整默认纯门 736 pass/1 既定 PG schema resource skip，四 pure 149 pass；format（含全部变更 TS/MJS）、lint、typecheck、build、全 contract pipeline 与 233 contract tests 通过。最新证据：资源19016f31、纯门7c8284b1、contract f7e3519c；两独立限定源码审0/0/0。

两个 fixture 的时间戳/umask 假前置及 public7 Snapshot 示例缺字段已修并真实复测。当前 contract lint 剩4条 warning：3条 conditional-schema局部 required-properties提示、1条既有特殊操作无2xx提示；不称零warning或整个owner集成通过。下方“5条全既有/待Root”是历史阶段，不作为最新状态。集成提交身份以本仓 Git 与 Root progress E108 为准；Web7消费、当前真实浏览器、外部模型、正规积分及完整BFF其他资源/镜像验收仍未完成。

以下为此前阶段与已批准技术方案。

## R132 snapshot example 更正候选（2026-10-03，待 Root 复验）

Root 真实 RED 已确认 public7 `SessionSnapshotResponse.example.data.execution_process` 缺失；下方把 5 条 contract lint warning 全记为既有并不准确。本片已补 active head 同 Run 的四字段安全过程示例，机器 schema、版本与 API 不变；实际剩余 warning 数、contract 结果、Git 提交与发布均待 Root 重跑后记录。

## R132 BFF HTTP5 / public7 本片 Root 验收事实（2026-10-03，Git 发布待 Root）

HTTP5 安全过程消费、public `7.0.0`、两张 canonical process 表、授权 RR、immutable anchor 分页、START successor 保留及 provenance/partial-GC 已完成本片有限验收。Root 证据为资源 `19016f31`（15 焦点与完整 74 全通过）、pure/default `3b926e2d`（149 pure；default 736 pass + 1 既定 PostgreSQL schema resource skip）及完整 format/contract `4811c5e9`（233 contract pass / 0 skip，保留 5 条既有 lint warning）；两次 R131 独立源码终审均为 0/0/0。原 73/1 timestamp 与 232/1 permission fixture 失败经精确窄 ACK 修正后，Root 已复测关闭。BFF7 Git 提交/推送仍待 Root；全部 BFF 业务、其余资源、镜像、用户 Web/浏览器、真实 provider/外部模型及正式积分仍未验。

## R129 provenance / partial-GC 当前候选事实（2026-10-03）

当前工作树已补 Run process Todo/activity 的双向 provenance fail-closed 与历史 START 分批回收语义，并保留 immutable anchor、未知 Run 404 和现有 GC 锁/retention 边界。writer 的 lint、typecheck、build 与默认纯门通过；真实 PostgreSQL 新三例、完整 74 项、独立终审、Git 与发布尚由 Root 接续，当前不称正式发布。

## R126-GREEN-C 当前候选事实（2026-10-02）

当前工作树已实现 public7 安全过程 snapshot/page、两张 canonical compact 表、START successor 保留、GC 与旧 tool-call cache 删除。writer授权定点纯门及静态/build通过；architecture public7 ACK 已应用；writer 完整默认门 737 tests / 736 pass / 0 fail / 1 既定资源 skip。PG/Redis/resource、独立审查、Git 与正式发布尚未执行，均由 Root 接续。

## R123-GREEN-A 当前实现候选（2026-10-02，待 Root 最终全门）

BFF 已单轨固定 Agent main `79bf98c5aa63b9bace207afdf42d8c7aefee4fe8` / HTTP `5.0.0`，严格解码完整 Todo 与安全 Skill/tool/subagent activity，并输出 `kokoro.todo.updated` / `kokoro.activity.updated` CUSTOM；旧 HTTP4 raw activity 网络路径已删除。writer 验证为 generator check、format/lint/typecheck/build 全 0，四 pure 149 pass / 0 fail / 0 skip；Root 最终全门与提交仍待完成。public machine 仍为 `6.0.0`，SQL、snapshot/process 分页、GC、START registration 与旧 private `toolCalls` 持久字段均未修改。

## R123-BFF-HTTP5-D0 当前状态（2026-10-02，三P1已裁决，仍未实施）

BFF基线仍为 main `02276b623f8390288fbf86d6efaa0f5152256afa`；public machine仍`6.0.0`，Agent pin仍HTTP4 `e977923ea9992cbddaf0cdbc6c8f8d23b3af120e`。Agent正式main `79bf98c5aa63b9bace207afdf42d8c7aefee4fe8`已发布HTTP5，canonical OpenAPI SHA-256 `bca8e4f4fd613e4325f594266893d5b089168cf14f2ad7a7df03f3f116af85f2`。现snapshot虽同一RR读取Message、FIFO head、完整HITL、Delivery与opaque watermark，但Todo未解码、activity仍旧raw映射、Skill phase/preflight无compact安全投影。

Root已裁决public唯一后继为breaking`7.0.0`：snapshot `execution_process` required nullable，非null必含`run_id,todos,activities,next_cursor`；activities只是`event_watermark`锚定的≤100项/≤1MiB第一页。1MiB只预算序列化process对象，不含同snapshot的Message/Delivery等字段。授权`GET /v1/sessions/{sessionId}/runs/{runId}/process`要求watermark、cursor可省略：省略可读任意已授权历史Run第一锚定页，提供则续上一页；每页重验scope并从不可变safe CUSTOM ledger作as-of还原，opaque cursor不泄source/public sequence，过期410且不从0或latest Row猜恢复。

`execution_process`与FIFO `execution_head`独立：选择最近durable START，terminal后及successor仅queued时保留旧Run，直到新START才切换，从未START才null。当前`agui-consumer-registration.ts`在expected Run变化时清`latest_run_start_sequence`是已确认生产缺口；后继只保START至新START，原version/fence/lease规则不变。采用两表RunProcessProjection；不建activity revision/cursor表，不从Agent5 enum发明Skill phase或tool/subagent status单向transition。

Root已独立复现R123-RED1：Node22 build exit0；四pure 148 tests / 120 pass / 28预期行为fail / 0skip，既有106正控通过。当前四测试SHA-256：`ff865fe5a1f6f1862e952870e86b8ba535f5fbe005fe7bd265e1d9cb5c2f6f1b`、`fdd557c0771fb1d126f1ac4e7cca9439128545148f531fae44c1a2642c91572c`、`195135e3e6d8a46536721a4857965cc0ff4493f38e0cfcf08f922dcdccefceb3`、`f95e592fbd2c09b731862c3dff066b4d25f8c7044ebe0d81c3a3d9e1c3b5f505`。这些是wire/reader/mapper/projector与strict fail-closed的真实RED，不是修复证据。

后继先行GREEN只允许owner artifact/pin/generated、strict process decoder与安全CUSTOM projector，使现RED转绿；不实施SQL、public7 machine、snapshot分页或GC。Root审后再授权public/SQL/RR/page/registration/GC RED与实现。精确文件、§8位置比较、事务/CAS、错误和资源门见本轮TECHNICAL_DESIGN/API_CONTRACT/DATA_MODEL前缀。

本D0仅改四份现文档前缀，production、四tests、public machine、canonical SQL、vendor/generated、lock、Git与资源均冻结；D0不是功能、发布或验收完成。

---

## R118 Root 四事实 RR 组合回归（2026-10-02）

Root已接收原WIN02唯一EOF测试交付并负责本节/最终Git，原writer cursor150 completed/idle。production、canonical public6、SQL、generated与locks未改；新增现test/agui-projection.integration.mjs用真实ingest在另一PG连接同事务提交assistant delta及完整interaction revision，已授权RR旧读四事实保旧集合，fresh读四事实为新集合，从旧opaque cursor精确replay本批delta/完整CUSTOM envelope到同watermark。

Root实际Node22.22.2 build/本仓installer各0、新node1pass/0fail/0skip、完整projection file39pass/0fail/0skip；另lint/typecheck/Node语法/diff门各0。冻结test SHA01ae22f3d786858fbc5ffa5f26ba71fa143a1ebf4289526323975b9f864c18dd，原166102bytes前缀/435外围保持；资源运行前后436源hash一致。自有随机fixture库已CREATE/DROP ACK并独立精确确认不存在，Redis仅连接/PING/PUBLISH及本机proxy、不写业务key，精确marker已回收/前后集合0→0；全部owned PGID自然终态。资源manifest /var/folders/gn/wbk8wfbd047_wvwkwtyn331r0000gn/T/kokoro-r118-bff-root-1j4ynzrc/manifest.json SHA6a2fc482e0a4f21aa373432fadb5a9cb15a6dcc44b43fe39d594a3a5267d8b51；独立r3静态审586edff4为0/0/0。

首次新node失败因测试expected遗漏合法AGUI type/timestamp/metadata，原日志/manifest f6b24375保留；仅补精确全schema断言后Root重跑，不改生产或放宽门。此验收只覆盖该完整投影file和同次RR组合分支，不证明完整BFF integration、浏览器刷新展示、Agent候选、真实模型或积分。T-C09用户全范围仍未验收，Root E90/E91测试台账为权威运行证据。

## R87 Root Conversation collection 验收（2026-10-02）

Root在b1ea063/public6冻结候选重跑完整pnpm check：contract231、architecture28、unit688pass/0fail/1既定资源skip，lint/typecheck/build均0；另format与schema门通过（schema8pass/0fail/1既定资源skip）。独立Astra审0P0/P1/P2；436冻结hash全部相同、425外围保留、原integration514c不变。

真实owner资源门：新建且只回收本次独有临时库，复用既有Redis、不清空共享状态，生产HTTP paginates Conversation ties completely 1pass/0fail/0skip，覆盖direct/project/owner全集、tie分页、另主体/租户/deleted及冲突400。owned临时库removed=true、cleanup=[]，日志/tmp/kokoro-r87-bff-direct-pg.tap与/tmp/kokoro-r87-bff-owned-resource.json。此为BFF过滤切片验收，不是IAM真实登录、Agent推理、Web端到端或收费全链；Web须在发布后再固定public6的commit/digest。

## R83-BFF-DIRECT：public6 collection direct GREEN 候选（待 Root 资源验收与发布）

基线 `main / b1ea063d4020b983e11f9243078fb17814e808b7`，Root 已复跑冻结 RED 为 27 项中 22 pass / 5 fail。当前候选只修 `GET /v1/sessions`：authorization、route、application port/service 与 PostgreSQL repository 沿单一判别联合传递 `all | direct | project`；explicit direct 在 SQL 中加 `project_ref IS NULL`，omitted/empty 保 admitted tenant+subject 的全部可见 active Conversation，project 保本人 Project 参数化等值过滤。direct 与非空 project_ref 在 Project/Conversation 查询前 400 `invalid_scope`。resource detail/message/events/control/title/delete/share 仍只消费既有 projectRef 授权，不解释 collection filter。

canonical source candidate 已升为 public `6.0.0` 且仍只有 `/v1`；collection operation 明确三种过滤、冲突 400 与换 filter 丢弃旧 cursor。已发布 public5 bytes/digest 不改，不建兼容分支、string/internal 双轨、alias、fallback 或 cursor 新字段。ScheduledTask、execution head、operation inventory、database/schema.sql、索引、依赖与 generated 保持。Web 必须等 Root 发布不可变 public6 commit/version/SHA-256 后再独立正规 repin。

本切片的纯行为测试覆盖 omitted、empty、direct、project 判别传播、冲突在 Project lookup 前拒绝及 resource 正控；真实 PostgreSQL fixture 已覆盖 owner-wide、direct、other subject/tenant、deleted、同 timestamp 的 limit 1/2 keyset、无重复与 cursor 终止，但仍由 Root 独占运行。固定 Node 22.22.2 的 format、lint、typecheck、contract、architecture、schema、unit、build 与 diff check 均 exit 0：contract 231 pass，architecture 28 pass，unit 688 pass / 1 既定资源 skip，schema 8 pass / 1 既定资源 skip，定点 Chat 27 pass。日志在 `/tmp/kokoro-r83-bff-direct-green/node22/`。当前 writer 未启动服务、PostgreSQL、Redis、provider 或浏览器，未操作 Git，不以纯门宣称资源链或消费者闭环。

后继门：Root 冻结审查 → Root 独占临时 PostgreSQL/Redis DB8 fixture 复验和精准回收 → 发布 public6 不可变 owner artifact → Web 独立 repin/生成/用户旅程验收。任何资源门或发布证据只能在实际完成后追加；当前阶段仍是待验收候选。

## R76 Root 精确冻结验收：public5 首次发布候选通过

Root 实核 R75 十二文件冻结 b916b9adc5808222a8fa46fca5992094f1eee25cf0295b21802702a04e5f7885，独立 Sol 0P0/P1/P2，required 属性缺失 P1 关闭。fresh Node22 两纯文件93pass/0fail/0skip、完整契约230pass/0fail/0skip；fresh owner canonical install/build exit0、完整八文件真实 HTTP/PG/Redis integration149pass/0fail/0skip，24.317s。日志 /tmp/kokoro-bff-r76-root-pure.tap、/tmp/kokoro-bff-r76-root-contract.log、/tmp/kokoro-bff-r76-full-root-integration.log；owned bff_full_r76_3400ae666fb0412f 完整回收、tracked未变、Redis15余0、无他库删除或新库剩余。上一轮 supported Node22 完整离线门 exit0；本轮只补 required/canonical测试与当前证据，没有修改生产源码或SQL。

Root 接管十二文件提交/public5.0.0 发布；尚未完成 Web public5 消费、Root composition 或浏览器/真实模型/积分整链，原 RED 与 skip 不清零。这是 owner 创建输入/任务边界组件验收，不是 Wave0–7 完成。

## R74：ScheduledTask create / public5 源码 GREEN 候选（未发布）

R75 当前阶段：Root修复前final真实full integration 149pass/0fail/0skip（23.395s）且owned完整回收；supported Node22 format/lint/typecheck/architecture27/schema8+1skip/contract222/unit672+1skip/build全部exit0，日志 `/tmp/kokoro-bff-r75-root-supported-node22.log`；native Sol十二冻结0。以上是Root报告的修复前证据，本窗口未重跑资源。随后Root精准机器一致性审及独立确认P1：CreateScheduledTaskRequest缺属性required，{}机器合法而现production拒绝。当前public5未发布，获准同5.0.0只补五字段required，不改其他语义。

本片实际Node22 RED：两纯文件93tests/92pass/1fail/0skip，唯一失败为canonical required=[]而期待五字段；合法最小独立任务、删除各必填项与{}七项production controls全部通过。日志 `/tmp/kokoro-bff-r75-required/pure-red.tap`。随即只补canonical required:[title,prompt,frequency,time,timezone]；project_id/next_run_at/expires_at/auto_approve仍optional，EOF原测试不动。本片GREEN已实测：Node22两纯文件93pass/0fail/0skip（pure-green.tap），完整 pnpm contract:check 230pass/0fail/0skip、exit0（contract-check.log），Node语法与git diff --check均exit0。机器解析差异证明仅新增该required数组，其他schema值、版本/default/clock声明完全一致。原contract测试全文保EOF前缀；源码、SQL、integration测试、其余版本/生成/pin保持，430个本阶段非目标tracked字节保护。未重跑非必要整套门或资源。Root唯一Git/发布owner；十二路径完整hash与保护见 /tmp/kokoro-bff-r75-required/freeze.json，停写交付，待Root按新hash复验并发布。

基线 main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c；Root 已复验 R73 纯 RED 83=51pass/32fail/0skip，以及 owned canonical fixture 上真实 HTTP+PG+Redis 53=14pass/39fail/0skip（含父/嵌套 failure，不是 39 个独立缺陷）。资源已由 Root 回收。本节覆盖下方 R73 的「版本待裁定/生产未修改」阶段描述；全部下方原正文保留，不作为当前完成证据。

| 任务                         | 责任/写集                                                                                                        | 当前阶段                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| R74-BFF-CREATE-PUBLIC5-GREEN | WIN02 单 writer；Root Git/资源/发布；仅三生产文件、canonical OpenAPI/contract README、四当前D0前缀、三已授权测试 | 源码与纯GREEN候选已冻结待Root全owner资源复验；未提交/发布 |

Root实际证据：/tmp/kokoro-bff-r74-root-pure-red-explicit.tap；/tmp/kokoro-bff-r74-full-root-integration.log；/tmp/kokoro-bff-r74-full-owned-resource.json。owned bff_full_r74_fc8e901688aa40f0 已回收、Redis15余0、tracked保持；此为Root报告，本窗口未重复跑资源。独立7文件/429保护审0P0/P1/P2。

public5 /v1 pre-release breaking已裁定，正式公共发布后版本政策不变。当前只接 create 单次严格解析与前置拒绝，保 PATCH、同tenant/subject项目事务、通用幂等及原 replay/撤权控制。实际实现：scheduledCreateInput closed allowed keys、exact project/boolean校验；server 对任意 query component（含裸 ? /空pairs）400，单次parse在Project查询及receipt前；同对象传authorize/create，无重复trim。shared Project-path仍保原path binding，PATCH parser字节不变，仓储/通用幂等/SQL/生成均不改。新增两纯control与六项（含父）真实HTTP query/前置语法测试；新增资源测试只写未跑。

本窗口实际证据（Node24.20.0，pnpm11.25.0；未更改仓Node22 engine声明）：

| 实际命令                                                                                             | 结果                                                               | 日志（/tmp/kokoro-bff-r74-green/）          |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| node --test --test-reporter=tap test/scheduled-input.test.ts test/contract/openapi-contract.test.mjs | 85pass/0fail/0skip；原83回归先已83/83                              | pure-green.tap / pure-initial.tap           |
| pnpm format:check / lint / typecheck                                                                 | 各exit0                                                            | format-check.log / lint.log / typecheck.log |
| pnpm contract:check（Node24）                                                                        | exit1：既有Platform生成器要求精确Node22.22.2；非业务RED，未放宽pin | contract-check.log                          |
| pnpm test:architecture                                                                               | 27pass/0fail/0skip                                                 | test-architecture.log                       |
| pnpm test                                                                                            | 672pass/0fail/1既定资源skip，共673                                 | test.log                                    |
| pnpm schema:check                                                                                    | 8pass/0fail/1既定资源skip                                          | schema-check.log                            |
| pnpm build                                                                                           | exit0                                                              | build.log                                   |
| pnpm contract:check（固定Node22.22.2补跑）                                                           | 222pass/0fail/0skip，完整生成drift/lint/semantic门exit0            | contract-check-node22.log                   |

Node24 engine warning与contract失败均保留；Node22补跑不算Node24八门全绿。无需修改 scripts/verify-openapi.ts 或 contract-governance。机器解析后除当前version、create schema/description/404外与原完全相同，immutable baseArtifact4/vendor/生成输入保持；contract测试仅五处授权文本机械迁移。原R73两个测试全文保prefix、四文档全部保suffix；最终精确hash/424非目标tracked保护见freeze.json，gates.json列每条结果。

本窗口未执行真实PG/Redis/owner integration、installer、应用预览或浏览器，未进行Git写入。只读独立预审0P0/P1/P2，最终冻结待复核；后继Root按冻结运行原全owner集成及R74新增原始query测试、审查并发布精确public5 commit/digest，Web当前R74切片验收后独立repin/生成。不能以纯门冒称资源或整体闭环。

## R73：ScheduledTask create D0 + tests RED（未实施 / 未发布）

基线 `main / d695fcbc0cd3f0376c34f64f6217d9d8e74c1b3c`，R71 已由 Root 发布。本节为 R73 ScheduledTask create 的唯一当前目标；下方全部旧正文逐字节保留，其 R71「待发布」和宽松输入描述仅是历史阶段，不覆盖本节。当前阶段仅 D0 + tests RED，生产实现、canonical contract、SQL、package/pin/generated 尚未修改。

| 任务                           | Owner / 执行 / 审查                                  | 基线与写集                                                                                                                                                                                                                                                                                                    | 验收 / 状态                                                                                                                                |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| R73-BFF-PROJECT-RUNTIME-D0-RED | BFF / WIN02 唯一 writer / 原 native 只读审查员、Root | 本仓绝对目录 /Users/nako/WebstormProjects/github/thefoxfairy/Kokoro/apps/kokoro-bff；main/d695fcbc；起点无未提交变更。仅本仓 TECHNICAL_DESIGN、API_CONTRACT、DATA_MODEL、CURRENT 四 doc 前缀及 test/scheduled-input.test.ts、test/business-store.integration.mjs、test/contract/openapi-contract.test.mjs EOF | 纯定点行为 RED、合法 control、旧正文/测试前缀及所有非目标 tracked 字节保持；集成只冻结由 Root 真跑。当前待独立审查 / Root 资源复验，未提交 |

Root 已裁定：独立 ScheduledTask 的 optional project_id 为精确非空无边缘空白 string，保可见 ID/slug；未知 body/query（含重复）、非法引用类型/null/数组/空白、非 bool auto_approve 与 create enabled/status 拒绝 400。创建默认 active/enabled=true，PATCH 保留。拒绝与项目预检在 receipt 前；其他 owner/缺失/跨 tenant 项目同 404，原不匹配 tenant admission 403 不变。合法重启 replay200、另一可见项目 same-key409、撤权 replay404，以及拒绝零写/事务回滚均进入新增测试。

三个设计前缀使用相同 owner/契约/SQL 目标，原正文完整保留；机器与源码仍旧态。删除 create 字段为 breaking，正式 GREEN 前需 Root 裁定唯一版本/consumer 顺序并授权迁移旧 R71 exact properties 断言；当前不扩写契约、源码、SQL、依赖、generated 或 Web pin，不重写 generic idempotency/PATCH。Root 唯一 Git/共享资源 owner。

本窗口实际 Node 22.22.2 定点：`node --test --test-reporter=tap test/scheduled-input.test.ts test/contract/openapi-contract.test.mjs` → 83 tests / 51 pass / 32 fail / 0 skip（1383.411458ms）；旧 44 项全部通过，新增 7 项合法/契约对照通过，29 项输入拒绝失败＋3 项机器目标失败（create 旧 enabled/status、缺引用空白 pattern、缺 404）。均为行为/契约断言 RED，非 missing import/collection。日志 `/tmp/kokoro-bff-r73-red/pure-red.tap`。

首次在 Root 目录使用 pnpm --dir 构建触发 package-manager version 检查，exit1，保留 `/tmp/kokoro-bff-r73-red/build.log`；进入本仓执行 `pnpm build` exit0，日志 build-bff.log。三测试文件 Node --check 均 exit0；business-store integration 的现 format 检查 exit0。四文档只 prepend、三测试只 EOF append，七原始 bytes 与非目标 tracked hash 证明随 `/tmp/kokoro-bff-r73-red/freeze.json` 冻结。

新增五个真实资源 integration 入口已写，含逐项拒绝零写、两种合法关联/独立 control、隐私/tenant403 对照、完整响应重启 replay/冲突/撤权、tenant/subject 同 key 隔离、outbox 真实 SQL 故障回滚与同 key 恢复。只暂停 delivery 调度，不 mock HTTP/仓储；Root 需先安装 owned canonical fixture，以 `node --test --test-name-pattern='R73' test/business-store.integration.mjs` 定点，然后完整回归。原有旧 integration 包含 installer/reset，不在本窗口执行。

本窗口未执行 HTTP/PG/Redis/installer，无深层资源 RED 或修复通过宣称；未重复 schema/Scheduler accept 门，未提交、未发布。完整 D0/机器门与版本策略仍 pending，后续 owner：Root 真实资源 RED/独立审后授权同负责人 contract/source GREEN。

## R71：独立 ScheduledTask 可选项目契约补齐候选，待 Root 发布

基线 main / 3928043ec243eaec28af32c231a0bbf75a8b19ec；本轮仅 canonical `CreateScheduledTaskRequest` 补 optional、非 nullable 的 `project_id: string / minLength: 1`，不加入 required，不绑定 Conversation，不改其他字段/operation/version。三设计面同步记录既有 parser 与同 owner Project 校验，不改 SQL、运行时源码或依赖。

tests-only 定点真实 RED：41 tests / 40 pass / 1 fail / 0 skip，原 38 例和两个直接加载生产 TypeScript parser 的合法对照通过，失败为 closed schema 缺 `project_id`；原测试全文及新增三例保持。修复后定点 41 pass / 0 fail / 0 skip，已到达 optional/type/minLength 断言；Node 22.22.2 八项离线门均 exit 0：contract 217 pass、architecture 27 pass、unit 631 pass / 1 既定资源 skip、schema 8 pass / 1 既定资源 skip，format/lint/typecheck/build 通过。命令与日志索引 `/tmp/kokoro-bff-r71-green-results.json`。整份 OpenAPI 解析后移除新增 property 即与 HEAD 完全一致，未改变其他机器语义；六路径仍为待 Root 审查/提交候选。本片未运行 HTTP/PG/Redis，不以 schema 声明冒称运行时 closed validation、真实资源或完整项目功能已通过。Web 当前仍固定旧 published artifact，消费者切换留待 owner 发布后串行执行。下文历史正文完整保留。

## R68：Scheduled prepared receipt 生命周期已通过 Root 组件验收

基线 main / 3c08a422f3a6aa3cf204c308716cfa64f6d61bb2；本节随本次 R68 源码/测试切片提交，发布记录以本仓 Git 为准。恢复 prepared occurrence 时，缺失或非本人 task 持久拒绝 404，inactive 或 revision drift 持久拒绝 409；receipt→task 锁事务内保存原 terminal response，重启/恢复后同 key 精确重放。accept 具名区分 accepted、rejected 与 claim_lost；真正租约丢失仍返回 503 并回滚候选事实。已 accepted/admitted 的原 202、run/dispatch/head 保留，暂停不取消或释放 head。

Root 对冻结六文件实际执行正式八份 integration：90 pass / 0 fail / 0 skip，22.741750 秒；日志 `/tmp/kokoro-bff-r68-full-root-integration.log`。资源证据 `/tmp/kokoro-bff-r68-full-owned-resource.json`：owned 资源已关闭、tracked 保持、cleanup_errors=[]、Redis15 剩余键 0，未删除无关数据库。独立源码审查 0 P0/P1/P2。此前 receiver 缺表前提失败及 canonical install 后 9 pass / 2 fail 的业务 RED 日志保留，不以最终通过覆盖历史。

本窗口离线八门全部 exit 0：unit 628 pass / 1 既定资源 skip，contract 214 pass，architecture 27 pass，schema 8 pass / 1 既定资源 skip；日志索引 `/tmp/kokoro-bff-r68-pure-results.json`。上述证明本仓组件，不证明真实 IAM/模型/浏览器整链；历史 Scheduled ready-null 风险仍未闭环。Git、最终离线复验与发布由 Root 执行；下文原正文完整保留为历史记录。

## Root R64：public4 / Agent4 切片实际验收

Root冻结全436、六R57保护区、四D0旧body、3删除核对；生产源码独立0P0/P1/P2，最终fixture/HTTP断言独立0P0/P1/P2。Node22完整真实PG/Redis/localhost HTTP81pass/0fail/0skip22.9486s，/tmp/kokoro-bff-r64b-full-root-integration.log。owned bff_full_r64b_73945ee6216a480e closed/tracked_unchanged=true/cleanup_errors=[]/unrelated_databases_removed=[]/new_databases_remaining=[]/Redis15余0；owner资源是临时库/同现PG Redis实例，不清共享状态。

此前R62完整71pass10fail，R64首轮77pass4fail均保原日志：先修owner schema/合法RR父事实/精确持久dispatch序号/exhausted terminal，再修三HTTP queued/预算2的五帧三页断言。首轮另Scheduled ready单次null，最终同源码例通过，当前仅默认毫秒available_at舍入的假设，诊断仍待，未声称该风险已修。不能以最终81绿删除该历史失败或声称全用户旅程完成。

本片删除旧public active_run/顶层pending及旧Agent3 artifact/legacy selectors，仅public4完整execution_head/fullpause和固定Agent HTTP4。真实Agent端消费、Web准确发布消费者、IAM→真实模型双轮/刷新及正式积分/文件/独立任务能力仍各门待验，当前owner组件验收不代替整链。Root最后完整离线门日志/tmp/kokoro-bff-r64-root-offline-final.log；源码及机器由先前冻结固定，只有本段CURRENT追加证据。

## R62 / R59 实施状态：public4 完整候选已离线验证，未发布或资源验收

当前 BFF 分支/基线 main / 759bfe0a8c521946cae31a74b6426f43b063bae1；WIN02 唯一写入、Root 独占 Git/共享资源/集成验收。R59 与 R61/R62 精准追加写集形成当前候选；以下 R48 原 body 逐字节保留，不以历史阶段句替代当前事实。

- canonical public OpenAPI 4.0.0：唯一 execution_head 四态与完整 pending collection，删除 active_run/顶层 pending；required revision/ref、五类 closed decisions。Agent HTTP4 固定 e977923ea9992cbddaf0cdbc6c8f8d23b3af120e，旧两个 vendor/split event pin 已删除，17 文件仅正规生成。
- 一张 bff_agui_run_interaction；完整 state 与 source/CUSTOM/cursor/HWM/CAS 同事务，no-op 只推进 source；授权 RR 核验 head、START、完整 state/source/frame 的存在性与 digest。GC 保留活跃依赖，ACK 不消费 pause，resume 读取完整集合后才调用 owner。
- R57 六段冻结断言原字节保持；R59 旧九项、R61 配送合法 FIFO/START fixture 与 R62 两个无 pause active head 断言仅按批准语义迁移。重复 START 问题已加 app/事务拒绝及纯回归；exact START replay/拒绝后合法写集的真实回归追加在现 integration 文件末尾，待 Root 执行。
- Root R62 授权的普通 interaction persistence helper 已抽出：原 projection repository 739 行、helper 165 行；父锁/lease/CAS/事务提交留原 repo，无反向 repo import。职责表见 TECHNICAL_DESIGN 当前前缀。
- 本轮实际 Node 22.22.2 / pnpm 11.25.0：pnpm format:check、lint、typecheck、contract:check、test:architecture、schema:check、test、build 均 exit 0。pnpm test 628 pass / 0 fail / 1 resource skip；contract:test 214 pass / 0 skip；architecture 27 pass；schema:check 8 pass / 1 resource skip。Agent 17 文件两次生成 byte-identical；OpenAPI 88 operations，保留两个既有 lint warnings，未放宽门。日志 /tmp/kokoro-bff-r62-offline-results.json 及各项引用。
- 三个获准 Scheduled 文件仅固定 Prettier 机械格式化：HEAD 重放精确相等；TS 与 emit JS 结构（节点/标识符/字面量/operator/顺序及 ASI 语句结构，忽略位置/trivia/冗余括号）相等；emit JS 经同一 Prettier 后字节相等。最初 raw emit JS 比对因换行差异失败，明确不是 raw byte-equal；Root 已接受此修订证据口径。详见 /tmp/kokoro-bff-r62-scheduled-format-proof.json 与原 emit 文件。
- control receipt 对齐固定 owner Python JSON 的 Unicode code-point key 排序和数字表示；业务 null 保留，外层 fingerprint 与 interaction_digest 不变。9,991 有限数字纯交叉向量 0 差异，Unicode/null 固定 expected digest 输入先通过 pinned control schema；不替代 owner HTTP/资源验收。

本窗口未执行真实 PostgreSQL/Redis/HTTP、fresh catalog、双连接 RR/lease/CAS/GC 或真实 Agent admission/消费、Web 发布消费者验收；未启动共享服务、创建数据库/角色、操作 Git。整片文件、R57 区域、四文档历史 body、格式证明及本轮日志收录 /tmp/kokoro-bff-r62-final-freeze.json 后停写，后续 owner 为 Root。源码候选/离线通过不代表 public4 发布或用户端到端闭环。

---

## R48-BFF-D0：Agent4/full pause/public4 三面已形成设计候选，等待 Root 放行

本前缀是当前阶段记录；以下原正文全部保留历史，包括旧“等待 Agent 发布”状态，后继不得据其继续猜 owner。WIN02 为 BFF 唯一 writer；基线 main 759bfe0a8c521946cae31a74b6426f43b063bae1，本轮仅 docs/TECHNICAL_DESIGN.md、docs/API_CONTRACT.md、docs/DATA_MODEL.md、docs/CURRENT.md 前置当前方案，旧 body 逐字节保留。没有 Git/index/commit、共享服务、PG/Redis、源码/测试/SQL/contract/pin/generated 写入。

### 当前 owner 与三面决定

Agent main e977923ea9992cbddaf0cdbc6c8f8d23b3af120e 的 HTTP4.0.0 已由 Root 发布；机器 contract SHA-256 763ff7a9cf668eb59ae7cfb59b2fd4f84fafde124063d9a365f138b6a30cf04f、provenance SHA-256 e2e6cd9f2228900d0c0a8d795f19815a145bd8f0d18c785ffbe059214b5ed99a、combined 7710ec0e88b55c15279503d6d4aa9494f3ee91c5411284f255df8f107fdc5806。interaction.state 必须携带完整 revision/groups/action_result；ResumeControl 必须 expected_pause_revision/pause_ref 与完整 decisions。LaunchRequest 没有 retry_of_run_id，未发布 retry4.1 不纳入本 cut。

三面已对齐为待审设计：execution_head 的 queued|active|waiting|resuming（active 对应 UI streaming）、当前 full PendingPause 与 event_watermark 同一授权 RR；waiting/resuming 保留完整集合，不做 partial merge、不用固定[]冒充有效无 pause；202 ACK 不是 native consumption。新 bff_agui_run_interaction 最新 run-scoped read model 与 source/CUSTOM/cursor/CAS 同事务，canonical schema 唯一；resume reuse 现 receipt/auth/幂等，owner 最终复核 locator/整集合，不持数据库锁跨网络。public4 在原 /v1 corrective 发布，删除 active_run/旧顶层 pending/旧 Agent3消费，无双轨 fallback；BFF 全切片发布后 Web 才固定 artifact/fresh 激活。精确文件集、放置表、状态/失败恢复与 RED 在 TECH/API/DATA 的 R48 前缀，不新建计划中心。

### R56 P2：digest 文案返修，源码/向量仍未迁移

BFF mutation fingerprint 绑定本仓外层 durable receipt scope（可信 tenant/subject/method/path/key）及现 method/path/query/canonical headers/semantic body 请求语义；它是现 stableStringify 指纹，不是 Agent request_digest，也不是 interaction_digest。不同请求表示是否在 BFF receipt 层冲突仍按本仓规则；owner 的 null/omitted 等值不自动使两份 BFF mutation fingerprint 或 receipt 可互换，不重写全站幂等策略。

Agent4 control request digest 基于固定 owner 的 RunResume typed normalization：material 含 kind/run_id/session_id/expected_pause_revision/pause_ref/decisions，排除 command_id/request_digest；只在 owner 声明的可选 nullable model 字段 approve.args、reject.reason 上将 null 与 omitted 归为同值。其余 required locator/item identity 不默认、不省略；decisions 保序；对象键排序、紧凑 UTF-8 JSON 后输出 sha256:<hex>。不得递归删除 submit.value、edit.args 或非空 approve.args 内的业务 null；业务字典中的 {"x":null} 与 {} 是不同 material。

interaction_digest 仅绑定 owner 完整六字段 full state：对象键递归排序、groups/items 等数组保序，optional 字段的实际存在性与 null 值保持；不套用 control 的 optional-null 归一规则。同 revision 的 full-state digest 相等才允许 no-op，mutation fingerprint/control digest 均不能证明 state/source 相等。

现 src/infrastructure/clients/agent/control.ts、control-receipt.ts 与 control route 仍消费旧逻辑，后继必须在已列精准写集迁移 required locator、typed normalization 和 receipt digest 对照；对应现 test/agent-control-adapter.test.ts 的 owner-fixed 向量至少覆盖 approve.args/reject.reason null↔omitted 同 digest、submit.value/edit.args/非空 approve.args 内业务 null 保留且不同 digest、排除 delivery IDs、required revision/ref 与决策顺序。full-state 同 revision optional omitted↔null 不等值的投影向量独立保留，不用 control 向量替代。当前仅修正文档，未迁移 adapter/向量，不构成 public4 完成。

本轮仅改四份当前前缀的 digest 语义；旧 body 完整保护。GC source 0fce9906d35f5922d5f9841ba803e2fb6e2e81369ef9efe1471e00954fc6705c 与 R52 test 6e1f1a78c1bf64d9abc3eabbe774ed9dcb5944c3b12d575c06e387eed56adb05 保持冻结、由 Root 另行审验；以下 R48 实测是原阶段记录，不据其冒称当前完整 public4 或投影矩阵已过。

### 实测证据与冻结范围

- Root R47 authority 真 PG **4passed/0failed/0skip，281.213ms**；独立审 0P0/P1/P2。对应 consumer source b0741f1055cc6832b0d0886a062ff546f7548718562a097b9943f61ec4b3785f、R46 authority test 55cc7cfdb31a462db285df6188e240edae022b3c6705ed1d3ba370d1fcd4a731 全文继续冻结。该门只证明 register/GC 父边界，不证明 public4 或 GC公平性。
- Root 现完整 test/agui-projection.integration.mjs **21passed/9failed/0skip，1661.549ms**，实际30顶层；日志 /tmp/kokoro-bff-projection-r48-root-regression.log。owned bff_projection_r48_329b89a26d64411e 已关闭、Redis15余0、无 cleanup 错误。WIN03 只读归因为7项 queued/head-aware 精确语义迁移、1项 eligible-later 合法 fixture 缺父、1项 public head 能力缺失；Root独立审核/精确写卡仍待完成，原断言未改。
- 新独立 P1：candidate 以 sequence<START 挑入，但 delete 以 min(START,live queued) 删除，会让 A boundary1 无可删帧占满 batchSize1、饿死后续可删 B。后继唯一 A/B 真父、真实 submit/claim/admitted/ingest 的 tests-only RED 卡在 TECH；candidate/requery/delete 的 effective boundary 与 LIMIT 前完整 eligibility 必须一致。尚未追加测试、未执行真实 RED、未修源码。
- 本轮无资源检查：固定 Agent owner JSON 的版本/digest/required six-field full state/required ResumeControl 与无 retry 字段检查通过；Node22 node scripts/check-contract.mjs 与 node --import tsx scripts/verify-openapi.ts 各 PASS（88 frozen operations）。这是冻结 public3 的治理/语义检查，不是 public4 验收。四旧 body 尾部 hash 与其余429 tracked 文件保护在写入后独立校验；没有把 Markdown 一致性称作运行门。

### 未决与后续 owner

状态为 D0待审，不是实现完成：Root/独立审先裁决当前三面与九失败精确迁移，再逐卡授 tests-only（先独立GC公平性实际RED）、source/机器/SQL/固定生成消费；所有发布字段与完整 pending/source/transaction 需真正同片转绿。Root 后继执行 contract:check、schema:check、test:architecture、完整 test/build、自有空 kokoro_bff schema db:apply-schema/catalog drift、串行真实 integration、完整 pause/control/unknown/re-pause/rollback/RR/restart/GC与精确锁 barrier，再独立审、提交发布。未执行门明确待验，不靠 skip/过滤CUSTOM/删除安全断言消除失败。

当前 public canonical 仍3.0.0、Agent3消费仍未切换，新表不存在；四内部源与 consumer、原测试、所有机器/SQL/generated/pin字节保持。本轮不宣称全 BFF GREEN、Web/fresh schema组合或正式 IAM→模型多轮→余额预占/结算/释放旅程已通过；后续 owner为 BFF WIN02（精准写卡）、Root（审查/资源/Git/发布）、Web（已发布 artifact 消费）。

---

## R33 scheduled accept 锁后租约复验局部已验

沿现 ScheduledTask owner，receipt→task→scope→dispatch 全部潜在锁等待后、terminal receipt UPDATE 前同连接再取 DB clock；原 lease 失效即整个事务 ROLLBACK/false，保 pending ACK/零新scope或dispatch。无延lease/Nodeclock/旧fallback，API/schema/envelope未变。Root frozen source8662196e0fbb34f046229c900d30492ffd6771bb7ef00747bf3e5ae4095eb5df，test64dc829477124d76e4e4228653be8582a98e5c9d3cc07e7df68ec8ebc5f58abd；独立Sol终审0P0/P1/P2。

Root Node22真实完整file RED9pass/2fail→GREEN11/11、三相关PG file **19/19、0skip**（4.65s）；三个自有随机数据库全drop，Redis14余0。首pattern未跑旧首例schema安装所致4启动错误保留，不计业务RED。Root lint/typecheck/build退出0及四相关pure **26/26**。日志 /tmp/kokoro-bff-scheduled-lease-r33-root-{red,red-r2,green,related-pg,pure}.log；431其他tracked和原8dirty内容独立hash核保持。

仅本两个源码/测试及CURRENT新记录prefix可提交，原4docs/4Chat RED内容不接。完整Chat waiting/head/Agent4依赖和实际浏览器/IAM/Billing链仍未完成，不称全BFF或产品闭环；保当前后继目标，不以定时任务组件替代个人会话。

## Scheduled dispatch Root 源码与真实数据库验收（2026-10-01）

最终31路径r4 manifest1c5923d9已Root hash/范围核验，独立复审0P0/0P1/0P2；Root Node22完整pnpm check exit0：563 passed/0 failed/1既定skip、contract/generation/lint/typecheck/build成功，日志 /tmp/kokoro-bff-scheduled-r26-r4-root-static.log。Root真实PG/Redis八文件 **59 passed/0 failed/0 cancelled/0 skipped（16.88s）**，包括Scheduled跨页terminal drain、预算/fence、精确PID双赢家/queue soft chain、rollback/重启/非零cursor/digest与身份冲突/expired lease/跨scope与stop drain。日志 /tmp/kokoro-bff-scheduled-r26-r4-root-integration.log；自有DBbff_fifo_a432245aad4f4e40已drop、Redis14=0。此前真实56/2、58/1诊断保留，不以错误夹具通过或测试数量代替源码审查。

本切片不代表所有Product能力、queued reload identity/实时跨tab、完整scope/native/retention或浏览器组合已闭环。当前应用没有新DDL/后台源码热切换；正式fresh schema组合验证后继。Root只提交四docs批准prefix+HEAD，原495行草案完整留工作树未暂存，保护suffix4/4保持；支付最后，积分owner正式流程未冒称通过。

## BFF-SCHEDULED-R24：terminal-gated Scheduled occurrence 候选（2026-10-01；真实 PostgreSQL 矩阵已通过，待独立复审/提交）

当前`main e7a325ce` callback直接POST Agent并以2xx固化receipt202，不等待共享`scheduled:<task_id>`的Run terminal；Chat FIFO不覆盖。另有三项已确认事实：task delete在现repository物理DELETE；Agent Chat event seq/cursor属于整个session而非run；已经leased/admitted的active不能被迟到更早occurrence替换。

修正目标采用Scheduled专用三表：无task FK的durable scope anchor、dispatch rows、session级source ledger。scope在task删除后保存active identity与连续cursor；无active才按accepted occurrence纳秒顺序选head，active A固定后迟到B排其后。source adapter读取整个session并在任何过滤前保存sourceRunId，历史/零frame事件也推进ledger，只有active run terminal释放。

callback原子scope/enqueue+receipt202、三表schema、dispatcher、session source consumer与runtime生命周期已形成R22工作树候选；pause/delete只阻止未来接纳，现物理delete与Scheduler delete outbox保持，不取消/释放已accepted。Root最终以隔离自有数据库/Redis namespace执行八文件矩阵，结果为51 passed/0 failed/0 cancelled/0 skipped（16.66s，日志`/tmp/kokoro-bff-scheduled-r24-root-integration-r3.log`，数据库与Redis资源均回收）；离线`pnpm check`为555 passed/0 failed/1 skipped。该证据仍待独立复审与Root提交，不等于完整产品发布。Agent4仍只是未来第二防线。public `active_run` 仍只在受信 `RUN_STARTED` source投影后可见；dispatch已admitted但尚无`RUN_STARTED`的窗口不会公开queued/inflight run identity，本Scheduled切片不声称补齐Chat刷新时的完整queued状态。该public queue契约属于后续独立owner切片。TTL、最终scope/source回收与未来Scheduled run query/cancel仍未决，当前不purge、不新增API。

### R25-P1 独立复审拒收与当前边界

R26独立复审新增的source digest缺口已进入返修：digest算法移至Scheduled application ledger唯一helper，adapter与repository共同使用，wrong-digest及已存sequence/event-id冲突需要真实PostgreSQL零写证据；Root复验前仍不标记Scheduled gate验收。

R24曾取得隔离真实PG 51 passed与离线555 passed，但独立复审确认五组P1，故该结果只作为历史候选证据，不是完整Scheduled gate验收：terminal非末页过早释放；COMMIT前/网络前预算边界不完整；runner缺有界多scope并行；周期错误静默且缺正式退避观测；15项矩阵多为代码行映射而非真实故障注入。

R25冻结目标是不改公开wire/owner/DDL，在现三表与runner内补terminal drain anchor、最终预算与fenced never-sent release、有界worker pool、runtime结构化log hook及全参数严格校验。必须以真实多连接证明enqueue-receipt rollback、callback/delete两个赢家、精确backend PID barrier、N+1 cursor、terminal跨页、冲突批零写、expired/never-sent、慢scope隔离与错误退避。R25代码与新真实矩阵完成前保持“返修中”。public queued/inflight identity、TTL/purge、Scheduled query/cancel仍属后续。

## BFF-EXECUTION-HEAD-D0 当前状态（R27 设计候选）

### BFF-QUEUED-RED-R27 测试卡（tests-only，预期RED）

本波只在现`test/chat-service.test.ts`、`test/chat-facts.integration.mjs`、`test/agui-projection.integration.mjs`、`test/agui-http.integration.mjs`写public 4.0 queued head RED：精确run identity、四个nonterminal state映射、submit时Message/outbox/queued frame/cursor同事务、幂等replay不增cursor、FIFO A head/B waiting、terminal handoff及GC不伪造terminal head。Agent HITL full revision、waiting/resuming machine/source/DDL不在本波猜测或实现。

当前生产/OpenAPI/Schema仍为3.0旧行为，因此这些新增断言必须真实失败；不使用skip/xfail/弱断言，也不把既有3.0门当4.0验收。Root独占自有PostgreSQL/Redis运行四integration文件；本Agent只运行无基础设施的unit RED并交精确失败。

当前commit `d6b7da5200784ed1838de396011d3ed6a8934124`的Chat snapshot仍只在latest=expected时返回`active_run`；durable enqueue/claim/admitted到RUN_STARTED前没有public run identity，enqueue也不推进cursor。尚未修改OpenAPI、Schema、TypeScript、测试或Web。

Root已裁决首次上线前public `4.0.0` corrective：保留`/v1`但只发布breaking新schema；ROLE2 3.0为正式基线，删除旧consumer，不建v2/双轨。BFF owner artifact先固定，Web后repin/fresh组合；future BFF retry为4.1并依赖Agent实际retry发布。Agent HITL 4.0仍是D0候选，版本号一致不代表依赖能力已完成。

锁图已精确到函数：submit/delete/artifact为Conversation-first；claim/failure及consumer/GC尚未统一。目标Conversation→stream→dispatch→Message/Artifact/ledger；同Conversation锁完全串行tail，跨conversation batch先按tenant/conversation一次锁全。未来写集明确包含`agui-consumer-repository.ts`和`conversation-artifact-projection.ts`；独立cancellation outbox不触Chat事实，retry不在本片。

Agent awaiting已有Chat interaction durable入口，但没有可信完整解除revision。waiting/resuming依赖Agent owner发布full revisioned pending collection与durable decision-accepted/effective-native-consumed/re-pause语义；waiting表示未提交，resuming保留同一完整集合并标记submitted以禁止重复decide。BFF不发明逐项event或partial merge，browser/unknown ACK与普通activity不改变状态。`pending_pauses`必须与head、四态state、submitted marker、watermark同RR读取最新authoritative revision。该artifact未交付前为hard阻塞，现固定`pending_pauses=[]`仍是产品缺口。

本轮仅更新四docs批准prefix；machine/production/SQL/README/Git/服务/数据库均未改。源码实施与真实PG矩阵仍待Root后续授权。

R43 doc-only收敛：上述FIFO/RR目标明确durable queued head存在时，历史`terminal_run_id`不表示Conversation流结束；replay须同一一致性读边界推导head-aware有效结束结果，先drain ledger且仅无head/合法terminal时结束，不伪造下一Run的RUN_STARTED或清除历史source守卫。当前`agui-projection-repository.ts`仍直接返回stream terminal marker，`routes/agent.ts`据此在ledger head结束SSE，故此语义尚未实施或验收。本片仅在四现D0文档段补充设计；原四Chat测试字节保持，新增queued故障回滚/同key重放、RR barrier交接及restart opaque cursor RED仍待Root授tests-only。Agent main e977923ea9992cbddaf0cdbc6c8f8d23b3af120e / HTTP4.0.0已由Root验收发布，但BFF尚未固定消费；本片pin/source/schema/generated不变；未运行Git、数据库、Redis、服务或测试，不据文档声明public4能力完成。

R44 内部源码候选：基线 main 759bfe0a8c521946cae31a74b6426f43b063bae1；WIN02 仅五现内部源及四 doc 的本 R43 前缀阶段说明。queued 同事务写入、terminal/never-admitted failure 交接、Conversation-first batch、RR 内部 typed head、head-aware replay 与 GC 已形成待审查候选；public3 schema/service、canonical SQL、pin/generated/parser 与四 Chat 测试字节不变。Root 前序实际三 R43 行为 RED 保留（RR 隔离断言已通过）；本片不运行共享资源，完整三例均仍含后继公开 execution_head 断言，不宣称全部 GREEN。Agent e977923 / HTTP4 已正式发布但 BFF 未消费；内部冻结后同 owner 立即承接 full pause/四态公开4 三面 D0，不无限延期消费者升级。本片实际 Node v22.22.2 顺序执行 node scripts/lint-source.mjs、node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit、node node_modules/typescript/bin/tsc -p tsconfig.json，3 命令 exit0（合计4.84s，无诊断）；没有运行测试，0 条测试通过声明。真实 PG/Redis、完整测试、独立审查与 Git 提交由 Root 执行。

## BFF-FIFO-ATOMIC：Conversation terminal gate 源码与真实owner门已验证（2026-10-01）

锁后数据库时钟补强：dispatch 与 AG-UI consumer 的 claim/renew/settle 必须先按既定 stream→dispatch 顺序取得目标行锁，再由同一连接读取一次 `clock_timestamp()`，并把该值传入最终 lease expiry CAS 与写入；禁止用事务起点 `CURRENT_TIMESTAMP`、worker 时间或 `GREATEST/Math.max(1)` 把已耗尽预算伪装为可用。普通 Agent terminal source 不受 dispatch HTTP lease expiry 限制。

当前main `88c54dbc`仍由enqueue覆盖expected、HTTP2xx=`succeeded`，且invalid2xx/oversize可能被误判permanent failed。
返修目标已纳入：terminal可早于ACK并从leased/retryable/admitted原子收口；迟到settlement fenced no-op；sticky
`admission_unknown_seen`覆盖expired lease及所有不确定网络/响应，unknown后4xx与快速预算耗尽都不failed放行；同row/run/key按现30秒cap跨cyclepaced POST，AG-UI consumer durable poll并行恢复；terminal清current expected，但历史dispatch继续阻断旧run新source。public3.0、Agent现wire与retry4草案不变。
Scheduled direct receiver的同session FIFO是独立P0缺口，本片不冒称覆盖。当前源码/DDL候选已实现，Node22 build/lint/typecheck与聚焦unit通过；Root真PG R3/R4均为2通过/1失败，依次暴露拒绝后fixture跳号与cancel fixture未正式claim；现候选已修正连续source及三个run正式claim绑定。耗尽探测无论settled与否均在独立事务释放stream锁，普通claim才按tenant/session确定序执行stream→dispatch，避免X→A与A→X反序。正式reader现于frame过滤前保留nullable sourceRunId，零frame旧run同样受terminal/failed历史dispatch守卫；所有派生run identity须一致。最终真PG、完整门与运行激活仍待Root复验。

Root R17实际验证：完整七integration文件50/50、0失败/取消/跳过，16.41s；`/tmp/kokoro-bff-fifo-root-full-integration-r17.log`。最终remaining正预算后真实COMMIT延迟分别证明dispatch/consumer空claim与过期重领，不伪造SQL结果；仅仓储行为，不声称完整sender网络验收。format/lint/typecheck/contract191/architecture27/build成功；默认测试549/549、0跳过，2.72s，`/tmp/kokoro-bff-fifo-root-full-gates-r17.log`。自有DB603074e8766f432f与4789659a6d0042d1均closed、Redis14剩0；独立R17冻结审查0 P0/P1。原四文档495行retry草案未纳本片提交；完整Agent4/queued/retry、Scheduled同session及真实provider浏览器组合仍待后继。

## BFF-CHAT-PAGING1：源码与真实owner门已验证（2026-10-01）

源码基线 main293dfe7；public canonical仍3.0.0，机器contract/DDL/generated/Scope/Retry/FIFO没有变更。
唯一生产diff是 listConversations keyset：时间降序的下一页用updated_at小于，tie时ID升序用conversation_id大于。
Root实际RED：unit11通过/1失败，真实PG HTTP0通过/1失败，旧SQL明确漏tie_b、tie_c；不是fixture或mock失败。
GREEN：unit12/12；真实PostgreSQL/Redis Chat9/9；format、lint、typecheck、contract193/193、build、architecture27/27均exit0。
第一full无admin fixture为547通过/1既定schema skip；随后提供现实例/同role的自有SQL fixture，fresh full为548/548、零skip，完整owner integration48/48（13.95秒）。
日志 /tmp/kokoro-bff-chat-paging1-{red-unit,red-pg,green-unit,green-pg,full,full-real}.log；canonical fresh apply和真实catalog验证TIMESTAMPTZ(3)/原索引。
静态可见集合ties与时间边界、limit1/2、cursor终页、Project A/B/空、tenant/subject/deleted/orphan回归已验；不承诺跨页更新snapshot一致性。
PG/Redis是真实，IAM/Agent/Storage等外部边界按既有owner测试double；这不是全产品真实IAM、外部存储、模型或浏览器验收。
Root只创建/回收自有临时测试库，不重启3310、不flush共享Redis。原4doc495行retry草案保留且不纳入本片提交。
独立候选源码review0/0/0；早期CURRENT阶段文字P1由本段实际证据更新。主控最终提交与集成以Root CURRENT/task/progress为准。

# kokoro-bff 当前实现

## BFF-CHAT-ROLE2：两角色源码与 fresh schema 已验证（2026-10-01）

实施基线 main `ccb8e144d72e35d90f9edc23f8b3ed0c82fde98d` 的 public contract 为 `2.0.0`，四项声明含无 producer
的 `system`。当前候选仅把 canonical SQL、domain/public TypeScript 与 OpenAPI 统一为 `user`/`assistant`，public
artifact 为 `3.0.0`，保持 `/v1` 和 operation inventory；这是首次公开发布前仅本次 corrective breaking 例外，不称兼容，
正式发布后 breaking 仍走 `/v2`。Message writer、mapper、failure guards、owner pins 和查询不变。

Root 已取得真实 RED：OpenAPI 35通过/2失败；实际 PostgreSQL schema 6通过/2失败（其中普通system未被约束拒绝）。
GREEN 后 `pnpm check` exit0，lint/typecheck/contract/build通过，全test **546通过/1跳过/0失败**；该次全test未带PG URL，
跳过的是动态schema用例，Root单独带现PG admin URL执行同schema门 **8通过/0跳过**，随机临时数据库finally清理。
日志 `/tmp/kokoro-bff-role2-{red-openapi,red-schema,green-schema,check}.log`。独立终审与Root选择性源码提交仍待执行。

旧 schema 不会被 fresh installer 自动更新，当前用户 DB/rows 不修改、不过滤、不伪装。源码发布不等于运行激活；3310
未切换，Web exact public3 repin、fresh跨仓组合与实际浏览器整链仍待验。未来 retry 目标仅候选 additive `3.1.0`，依赖
ROLE2 发布/消费和未发布 Agent `4.0.0`，本片没有实现 retry，也没有新增 production migration/fallback。

## BFF-RETRY-DESIGN：三设计候选已写，生产未实施（2026-09-30）

当前 BFF main 是 `ccb8e144d72e35d90f9edc23f8b3ed0c82fde98d`；Root 任务基线是
`e27ae2077068475bbe8f26d375d271375ec542b0`。public contract 仍是 `2.0.0`，当前没有
`POST /v1/sessions/{session_id}/messages/{assistant_message_id}/retry`、retry application command 或 retry SQL
writer。本轮只更新 TECHNICAL_DESIGN/API_CONTRACT/DATA_MODEL/CURRENT 四份设计文档；没有修改
OpenAPI、schema、source、generated、vendor 或 tests，也没有运行服务、PostgreSQL、Redis、浏览器或模型。

已裁决的目标是 additive public `3.1.0`（以 BFF-CHAT-ROLE2 的 public `3.0.0` 发布及 consumer 锁步完成为前置），且 HTTP `/v1` 不变：请求只有精确 `{}`、private
`scope` / `project_ref` 与唯一 `Idempotency-Key`，202 复用现
`{run_id,user_message_id,assistant_message_id}` receipt。首次请求只接受最新、严格已验 Agent
failure 且 `retryable=true` 的 assistant；原 user/content/model/agent/thinking/Skill/MCP/project 都从原 BFF
outbox 恢复，保留原 user、failed assistant、run/outbox，只新建 assistant/run/outbox 并在同事务
重置 consumer fence。BFF 零 DDL，不新建 retry 表。

幂等权威为 committed Agent dispatch outbox：当前 ACL/project/target visibility 通过后，同 key +
operation/target digest 回收早于 tail/run/HITL 动态拒绝，以便恢复 commit 后丢失的 HTTP reply。
`bff_idempotency_receipt` 与业务事实不原子，所以目标 `durableChatAdmission` 必须包含 retry，
不使用 generic pending receipt。同 key 并发只能有一 attempt；同 key 用于 submit/另 target 冲突。

当前阻塞在 Agent owner，不在 BFF DDL。Root 无网络复现得到
`SAME_RUN_REPLAY=PASS`、`SAME_USER_NEW_RUN=ChatIdentityConflict`、
`CURRENT_NATIVE_IDS_DUPLICATE_HUMAN=2`。当前 Agent 3.0 `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703`
不能支持同 original user 的新 attempt。Agent owner 需先发布 typed `retry_of_run_id`、稳定 user
origin、native pre-turn checkpoint 与单 HumanMessage 语义。Agent `4.0.0` 已是 owner 四文档冻结的
breaking 目标设计候选，但尚未实施/发布，因而无 commit、OpenAPI/provenance digest 可 pin。
BFF 不会用伪 user ID、identity 放宽、optional wire 或部分 phase
retry 绕过该前置。

R2 补全了 BFF 内部实际 consumer inventory：Agent 4.0 的 `retry_of_run_id` 是 required nullable，
normal 不能省略，必须显式发 JSON null。BFF 不只有 Chat `outbox-delivery.ts`，
`scheduler.ts`→`clients/agent/launch.ts` 也是 Agent `/v1/runs` producer；两者必须在同一 BFF
consumer cutover 中更新，Scheduler 不是下一个独立仓阶段。Chat persisted
`AGENT_DISPATCH_SCHEMA_VERSION` 目标从 2 升为 3；Scheduler `bff_idempotency_receipt.response_body`
envelope 从实际 2 升为 3。两个 v3 parser 都 closed/fail closed：旧 v2、missing/extra/错类型不读；
Chat normal/retry 分别要求 null/非空 parent，Scheduler 只允许 null，并重验 canonical occurrence 与
run/user/assistant/session/request/assertion receipt identity。public 202 receipt 形状不改。

权限不新增 IAM 角色或权限名；目标 OpenAPI 复用 `chat.message.create` 能力描述。当前实际
enforcement 是 Web→BFF service + Bearer online session verify + fixed tenant + Conversation/project/target private
owner 检查，不冒称当前 IAM session verify 已做 action-specific grant 判定。这一“标准权限命名 vs
当前 enforcement”差异是已知边界，本片不引入假 stub。

后续只能按 TECHNICAL_DESIGN 的精确阶段门推进：Agent 先发布具体 immutable 4.0
artifact 但不 activate；Root 再把具体 owner path/version/SHA 写入任务卡；先仅改现有 tests 获得真行为
RED；独立复核后才授机器契约/generated/runtime GREEN。真实验收必须包含随机临时
PostgreSQL 的单事务/并发/rollback/fence 矩阵，以及真 Agent owner 的同 original user/new run、
`retry_of_run_id`、完整 pre-turn context 与唯一 native HumanMessage。当前阶段没有上述 PASS
证据，不宣称 retry 完成。

激活还有一个明示未决生命周期边界：Root-owned 验收可用 fresh fixture，但现受管运行组必须
先决定 fresh 替换或在无新 admission 窗口 drain 非终态 Chat/Scheduler v2，并明确已终态 v2 的
same-key replay/retry 政策。旧 v2 不在 v3 parser 内自动补 null、升级或删除。本文档片未清理任何
用户/共享数据，也未将该问题扩成 scope/会话删除 SQL 或新 retention contract。

后续验证命令必须显式使用 Node `v22.22.2`：

```bash
export PATH=/Users/nako/.nvm/versions/node/v22.22.2/bin:$PATH
node --version
pnpm format:check
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
# Root 独占随机临时库/自有 Redis namespace 后才运行：
pnpm db:apply-schema
pnpm test:integration
```

本文档阶段只能执行 Markdown/hash/diff 检查；上述 source/contract/PG/Agent 命令尚未运行。
下方已验收 BFF-AGENT-FAILURE3 和更早章节保持各自历史证据，不代表本 retry 功能已存在。

## BFF-AGENT-FAILURE3：源码与 owner 隔离集成已验收，Web/运行组合待闭环（2026-09-30）

起始基线是 BFF main `15e07fa44670bc13705ce3f6f700e73afcb72ccc`；本节覆盖下方历史章节中的旧 Agent
pin、七码 fallback 与“待实施”文字，但不改写历史。当前源码已经形成单一路径：

- public canonical `info.version=2.0.0`，HTTP `/v1` 不变；`ChatMessage.failure` 是 optional closed
  `{source:"agent",code,retryable}`，只有 failure 存在时单向要求 assistant + failed + 非空 `run_id`；
- Agent HTTP 固定 `f3be3b97dd67df69ed3c6cb88c59f3bc2db97703` / `3.0.0` / OpenAPI SHA-256
  `e9f0a543f74dee34212f0ea4fe366d46218268462ac54dce08e41965f34d2d2c` / provenance SHA-256
  `d116657f65027de8bd829dc0408fd86046da0ac0a1d2934bd2a87e835c897b5f`；固定目录只有两份 regular file，旧
  `dd34` HTTP vendor 已删除，独立 delivery `486adb` pin 原字节不变；
- generator 从 owner `Failure` / `ChatFailure` / `ChatEvent` schema 图派生唯一
  `src/generated/agent-http/failure-profile.gen.ts`，17 文件 allowlist、manifest digest、published provenance、双次
  byte-identical generation 与 required/enum/if-then/ref/status/closed mutants 都有可执行门；
- `bff_message` 有 nullable `agent_failure_code` / `agent_failure_retryable` 与完整 CHECK：两列同 NULL/同非 NULL、
  十码 false、仅两码 true、assistant/failed/非空 run；verified Agent failure 沿现 projection transaction 同写
  Message/source/frame/version/watermark，cancel/dispatch/delete 明确保持 NULL；
- source reader 在返回 page 前完整映射并严格验证所有 `run.failed`，坏页首/中/末都不进入 ingest，只按既有 runner
  语义 block 对应 consumer；没有 unknown→`internal_error`、逐 event skip 或 raw diagnostics；
- snapshot、Message list 与合法 Share 都由 Message 两列映射同一 safe shape；实时标准 `RUN_ERROR` 使用固定
  `Agent run failed`、同值顶层 code 与 `metadata.kokoro.failure`，无顶层 retryable/status/raw/extra；AG-UI GC 不清
  Message failure。

Root 在最终冻结32文件manifest `c12ced8d6d6d30dc1a8e6be5bb6a7595c461912412b7fadeaa71a3e809bd0b41` 上
独立完成当前门禁：Node `v22.22.2` / pnpm `11.25.0`，`pnpm format:check` 与完整 `pnpm check` exit0，
contract193/193、主测试545 pass / 0 fail / 1 schema-fixture skip、lint/typecheck/build通过；
`contract:check:agent` 的17生成文件与双次生成字节一致也包含在完整check内。随后在同一现有PG/Redis实例、同一role的
Root-owned随机临时数据库与原子占有Redis15，canonical fresh `db:apply-schema`、动态schema7/7、architecture27/27、
全部七文件真实PostgreSQL/Redis/localhost HTTP integration47/47均通过，0跳过。PG CHECK/rollback/RR/lease fence、坏页零写、
ACL与当前Share撤销、实际旧RUN_ERROR GC后snapshot/list/active Share保留safe profile均执行；System/IAM/Agent等上游仍为
测试double，不冒充真实owner浏览器或模型E2E。

独立契约与SQL审查最终均P0/P1/P2=0/0/0；曾发现的reachable-schema额外限制漂移、当前Share撤销误查旧ID、
GC后list/Share缺断言均已本片修复后重跑。Root最终资源run `f1db3932a3edbe3f195580f1`：source/test hash前后稳定，
自有DB残留false、owner临时fixture增量[]、Redis15剩余keys0、cleanup_errors[]；独立残留查询同为0。
日志 `/tmp/kokoro-bff-failure3-root-final-{format,full-check}.log` 与
`/tmp/kokoro-bff-failure3-root-real-acceptance-r2{.log,-result.json}`。随后Root只更新四份设计文档的验收metadata，
源码/机器/SQL/测试不改变；发布commit由Root组合台账记录。

这只放行BFF-AGENT-FAILURE3切片，不宣称整个BFF或全产品完成。Root全工程标准门仍FAIL137（BFF31项），
日志 `/tmp/kokoro-bff-failure3-root-standard.json`，不放宽门或建立绿baseline。Web public2/实时与hydration消费者、正式同user重试、
管理运行组协调切换、fresh输入框视觉、真实IAM/Agent/provider/browser全矩阵仍待闭环；3310原运行组未重启或半套热切，Payment最后。

## BFF-CHAT-ACTIVE-DOC：`active_run` 一致快照实现与owner验收（2026-09-30）

Root 已裁决首片保持现有 v1 OpenAPI 原字节，只恢复契约已经定义的 `active_run.status=running`；不新增 `queued`、不收窄 enum、不修改手写 `src/contracts/chat.ts` 或要求 Web contract repin。基线 `d654a1bc6ce0347e28dd90a0ce0ee1553b8d67ed` 的 `ChatApplicationService.snapshot()` 从不输出 `active_run`；本候选已由 Chat repository 在读取 Conversation、最近 100 条 Message、Delivery 与 AG-UI watermark 的同一 PostgreSQL `REPEATABLE READ READ ONLY` 事务中读取本仓 `bff_agui_stream.expected_run_id/latest_run_id/terminal_run_id`，并映射可证明的 running。

映射只输出可证明事实：expected 为空时不认领任何历史 run；expected 非空且 terminal 等于 expected 时，无论 latest 是 expected、其他 run 或 null，均省略终态；terminal 为空且 latest 等于 expected 时输出 `{run_id:expected,status:"running"}`；terminal 为空且 latest 为 null 或其他 run 时保守省略。新 expected 保留旧 latest、晚到旧 `RUN_STARTED` 覆盖 latest、终态后晚到旧 start 形成 `expected=X,terminal=X,latest=O` 都是三个真实 writer 可达状态，不得报损坏。任一非 null run marker 为空白，或 expected 非空而 terminal 是另一个 run，抛固定内部 `CHAT_ACTIVE_RUN_STATE_INVALID`，不降级为假状态。

当前源码已在 `ChatSnapshot.activeRun`、`PostgresChatRepository.readSnapshot()` 与 `ChatApplicationService.snapshot()` 实现上述 running 首片：ACL 成功后在同一只读 RR 事务读取 stream marker，非法 marker 回滚并释放连接，service 只映射既有 v1 running shape。Node 22 纯门已通过 format、lint、typecheck、contract、architecture、506 pass/1 skip test 与 build。Root 隔离 PostgreSQL GREEN 候选运行得到 7 pass/1 fail；唯一失败确认是 newer-run fixture 只注册 consumer、未通过 Chat turn admission 建立 assistant/dispatch binding，因而被既有 projection guard 正确拒绝，不是 active-run 读逻辑失败。fixture 已改为使用正式 `chatTurns.submit()` receipt run identity；修复后的真实 PostgreSQL/localhost GREEN 仍待 Root 复验，因此不声称真实组合完成。`queued`、`waiting`、durable `pending_pauses`、旧 start 覆写风险和 `files` 仍是开放后继。

Root最终复验已通过：Node22 format/lint/typecheck/contract191/architecture27/test506pass1skip/build，日志 `/tmp/kokoro-bff-active-run-root-pg-fixture-final-gates.log`；canonical `db:apply-schema` fresh install、同RED定向8/8及全部7文件真实PG/Redis/localhost HTTP integration47/47、0失败/0跳过，日志 `/tmp/kokoro-bff-active-run-real-pg-final-green.log`。新fixture经正常ChatTurn.submit创建assistant/dispatch binding，未放宽guard；原7/1失败记录保留。临时数据库/新增数据库0、Redis新增0且baseline完整。Root接受该running snapshot片；浏览器终态全文/全产品计费及queued/waiting/pending/files仍未验收。

## BFF-IAM-REPIN：当前 IAM owner provenance（2026-09-30）

当前 IAM consumer 唯一固定 owner `e3c035b99cf9479ac8357c7d38147f1541dcbcac`、internal OpenAPI 0.7.0、SHA-256 `c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`。该 owner 的四项输入与前一 `4d981441d154c83b63987f284e3a82a559595870` pin 逐 byte 相同；vendor 只保留当前 commit 路径，manifest、生成配置及 relay policy provenance 已重钉。public OpenAPI、relay policy 2.1.0 的 route/method/header/cookie/limit、16 个 generated SDK 文件、数据库与运行语义均未变化。当前受管旧 BFF 进程仍加载已验收 `67755d16`，本片提交不等于该进程已重启或 Web/Root inventory 已完成后继 repin。

## BFF-PERSONAL-CONSUMER：本人安装消费者在途，真实组合待验（2026-09-30)

- **当前代码：** 工作树已唯一固定 Platform `6519ae9a7dba63586474d2860f6725d3165b701e` v5.0.1 aggregate `3f97b3c98fd8e7ce46e4a8ea73237ddb85e764849d2b15dd28d0a3a58a69e42f`，官方工具生成五个 `ProductSkillInstallationService` 方法并接线 public POST+GET `/v1/skill-installations`、GET+DELETE `/{installation_id}` 与 PUT `/{installation_id}/enabled`。旧 v4 vendor、按 name enable/disable、503 stub、alias 与 fallback 已删除。
- **边界：** current IAM tenant/user 映射为 BFF workload token、可信 `x-tenant-ref` 与 `x-kokoro-subject`；三写使用 catalog scope，二读使用 projection scope。BFF 只投影 owner 九字段、ACK 与 optional `next_cursor`，不建 installation 表、receipt、cache 或跨 owner SQL；Publish 不自动安装。
- **严格失败：** source、installation ID、cursor 不 trim；uint64 输出十进制 string，时间输出 UTC `Z`。owner enum/event/page/九字段异常为 502；权限为 403，资源缺失为 404，依赖不可用为 503，统一绝对预算耗尽为 504；五个操作的可达 body 上限均以专属 413 `request_body_too_large` 表达。caller cancel 不伪装为 deadline。
- **验证状态：** Node 22 的 format、lint、typecheck、build、默认 test、contract test/check 与 operation/schema 门已覆盖本片新增 input/HTTP 测试及 status→error.code 约束。fixture 不启动共享服务、PostgreSQL、Redis 或 3310。
- **未完成：** 当前仍是待 Root 审查/提交的代码，真实 IAM→BFF→Platform 组合与产品激活尚未验收；后续历史章节只记录各自当时切片，不覆盖本节当前事实。

## W3-BFF-CHAT-SKILL-SELECTION-CONSUMER：代码已接，真实组合待验

从文档基线 `78c92c09ea056e5b9901342fd6cd875cd9de5ce0` 实施：唯一 public OpenAPI 使用 optional exact `selected_skill_source_refs`，缺失与 `[]` 同语义；普通 Chat 输入、请求摘要、v2 durable outbox 与 Agent launch 保留选择顺序。Scheduler launch 显式 `[]`，receipt envelope v2 与 snapshot 恢复拒绝旧版/缺字段，不在重试时补值。旧 name/trace `pinned_skills` 和无生产调用 `buildAgentLaunch` 删除；无 SQL/角色/lockfile 改动。

Agent HTTP 2.0.0 固定 `dd34a4800b4ce0cc61eb80dd715e528b9d4517da`，OpenAPI SHA-256 `20398c59f42031c1b6ae2e2c3708e63ec8b5645baf741bf831bc67e14625ef99`，vendor 与 generated 由工具更新。非空选择当前 Agent reader 仍 fail closed；本片不代表 Skill 执行已闭环。Web 必须另片停止发送旧字段并使用 exact refs；本人 Publish 后不自动安装/启用；用户须显式创建 installation，不影响无 Skill Chat 消费修复。

实测：新增测试先 RED（3 fail）后聚焦 27 pass，owner/public/runtime 语法一致性与旧 Scheduler snapshot 拒绝 12 pass。Node 22 `pnpm format:check`、`pnpm check`（lint/typecheck/contract/488 pass、1 既有 skip/build）及 `pnpm schema:check`（5 pass、1 无 PG fixture skip）PASS。Root 真 PostgreSQL/Agent HTTP 组合尚未执行；未操作用户 3310 或共享数据库。

## 当前读投影切换（待 Root 真组合验收）

本仓当前实现已将五个 public GET（Skills、by-ID、Pool、Catalog、MCP）统一接到 Platform HTTP 3.1.0；独立 `platform:projection.read` IAM workload credential、当前 Product user/tenant admission、owner-native 字段与严格 `{data}`/`{error}` 均由 BFF 负责。旧 Capability HTTP facade、2.0.0 vendor/generated/manifest、旧 shared-secret read 路径已删除。无 BFF Skill/MCP SQL、receipt 或缓存。Node22 单仓门与 Root 真 IAM/BFF/Platform 组合证据分开记录；Web 读契约尚未更新，不能宣称页面闭环。以下 W3-PREFLIGHT 和更早段落是提交时点历史记录，不覆盖本节。

## 历史快照：W3-BFF-PUBLISHED-SKILL-READ-PREFLIGHT（已由上文运行实现替代）

基线 BFF clean `55ca6c1d8a7fbd0a21bea8d3539667a68d67e9d9`、Platform owner clean `6a09913a96c686b316bfe707b823d039e625607a`。唯一 public OpenAPI 新增 `GET /v1/skills/{skill_id}`、operationId=`getPublishedPersonalSkill` 的未激活候选：当前 IAM Product user/tenant 将由 BFF 投影到 Platform，只有本人 PERSONAL/ACTIVE Skill 可读且不要求安装；不存在、非本人、跨 tenant、非 PERSONAL 或非 ACTIVE 统一 404。200 只有 `skill_id/source_ref/revision/status/name/summary/tags` 七个安全字段的 `{data}`；无 query/body/Idempotency-Key；400/401/403/404/429/502/503 使用状态专属错误，成功与每个错误都要求 `x-request-id` 和 `Cache-Control: no-store`。本片没有 route、owner client、credential、generated、配置、SQL/receipt/cache 或 Web 入口，因此不得声称已运行或 Web 可见。

当前活跃 `listSkills` 仍是 legacy `{data,meta}`，且会丢失 Platform `source_ref/revision`；本片不预改其机器响应。下一运行 cutover 必须在一个提交中把既有 Skills/Pool/Catalog/MCP 四个 GET 原子迁到 Platform HTTP 3.1.0，使用专用 projection credential/Bearer，并删除旧 Capability secret、source selector 与 generated consumer；本人 ACTIVE list 使用 owner `/v1/skills?scope_kind=personal`，pool/catalog 不恢复 ACK。MCP 必须按 owner-native `server_id/provider_key/server_identity/transport/declaration_digest/status` 与 Web 同步重定义，并移除当前实际 503 的旧控件；不得保留伪造 `revision=1`、URL、空 allowed_tools、null secret_ref 或压扁 transport/status 的兼容映射。v4 写候选保持 default-off。

状态：2026-09-29
适用范围：当前分支代码、`database/schema.sql` 与 `contract/openapi/v1/openapi.yaml`。历史报告不作当前证据。

## W3-BFF-SKILL-PUBLISH-RUNTIME：默认关闭运行候选

基线 BFF clean `b357c190`，固定 owner `263a28f` inactive v4、command digest `3.0.0`。现有同一 Skill catalog candidate flag 下接入 user-only `POST /v1/skills/{skill_id}/publish` 具名路由；严格零字节体/单个 Idempotency-Key、当次 IAM/fixed tenant/user 先于 Platform，固定 PERSONAL(1)，独立 JCS projector 对齐 owner 8 向量、generated Connect Publish。200 仅投影经核对的 `source_ref=skill:<id>`、正 uint64 revision、ACTIVE、UUID event、replayed；`publish_snapshot_conflict` 的稳定 Aborted metadata 精确映射 412，其他 Aborted 409，坏 owner 502。重放/未知 ACK 不经 BFF receipt，撤权不调用 Platform；无 BFF SQL/Storage RPC/ZIP 代理/旧 Capability fallback。HTTP 聚焦和本仓门是运行候选证据，Root 真 IAM/Platform/Storage/同 event 重放与产品激活仍待独立门；下节“无 Publish route”仅为文档门历史状态。

## W3-BFF-SKILL-PUBLISH-DOC-GATE：仅未激活机器/文档候选

BFF 基线 clean `main 1264607`，owner `263a28f` inactive v4。唯一 public OpenAPI/operation inventory/语义门新增 user-only Publish 的严格零字节体、单键、固定 PERSONAL(1) 目标、200 active/source_ref/uint64 revision/UUID event/replayed 与状态专属错误；直接契约测试锁 owner 3.0.0 的 8 条命令向量、Proto 字段及旧 operation 误引。**本片不新增 Publish route、Connect 调用、projector、SQL/receipt/outbox 或配置**；CreateDraft/Get/Begin/Complete/Validate 仍默认关闭，Platform v4 inactive、产品未激活。Root 真 IAM/Storage/同 event replay/撤权、Web Chromium 与产品发布仍待后续门。下方 Validate/Complete 各节按各自切片基线理解；W1E caller visibility 是废止历史目标，不是当前 public 输入。

## W3-BFF-SKILL-VALIDATE-RUNTIME：默认关闭运行候选

在固定 owner `263a28f` inactive v4 上，BFF 现有具名 `POST /v1/skills/{skill_id}/validate` route、严格 `attempt_id` 输入、固定 3.0.0 JCS/8 向量 projector 与 generated Connect 调用；复用 CreateDraft/Get/Begin/Complete 的默认关闭候选开关。当次 IAM/fixed tenant/user 在每次同键重放及 Platform 前；稳定 command ID 绑定 operation+受信 tenant/user/skill/key，owner 持有 current attempt、Storage CLEAN/ZIP V1 与 receipt。仅校验并公开 strict valid=true/digest/manifest/series/replayed；坏 owner 502，旧/感染/坏 ZIP 由 owner 前置失败 412。无 BFF SQL/receipt/Storage RPC/旧 Capability fallback。直接 HTTP 与机器向量门已覆盖本仓候选；Root 真 IAM/Platform/Storage/ZIP/撤权组合、Publish public、Web Chromium 与正式激活仍待独立验收。下节“无 Validate route”为文档门历史事实。

## W3-BFF-SKILL-VALIDATE-DOC-GATE：仅未激活机器/文档候选

基线 BFF clean main `1aee402`；唯一 public OpenAPI 新增 user-only Validate 的 strict `attempt_id` 请求、200 valid=true/digest/manifest/series 与状态专属错误，operation inventory/semantic checker/直接 contract test 锁 owner v4 Proto tag 7、command digest `3.0.0` 的 8 条向量和旧 operation 误引。BFF **未新增 Validate route、Connect 方法、projector 或 SQL/receipt**，CreateDraft/Get/Begin/Complete 仍默认关闭；Platform v4 inactive、产品未激活。下方“Complete 只有文档候选”等按各自历史切片理解；旧“Validate 无 body”与 v4 tag 7 冲突，以上述当前机器合同为准。Root 真 IAM/Storage/ZIP Validate、撤权重放、Publish public 与 Web Chromium 尚待后续门。

## W3-BFF-SKILL-COMPLETE-RUNTIME：默认关闭运行候选

基线 BFF clean main `457472d`；已在既有 Skills candidate flag 下接入 user-only `/v1/skills/{skill_id}/package-upload/complete`，当前 IAM/fixed tenant/user 每次先于 Platform，且不走旧 Capability。strict 四字段输入、固定 owner v4 command digest `3.0.0` JCS/11 向量与 Connect Complete、稳定 command ID、owner response 的 skill/attempt/upload/hash/asset/epoch/phase/scan 全核后投影 strict 200（不公开 asset_id）；无 BFF SQL/receipt/Storage RPC 或字节代理。直接 HTTP RED 证明原路径缺新路由并无 x-request-id，GREEN 覆盖默认关闭、重放/冲突/撤权、坏 owner、超时/取消和 request ID/no-store。Platform v4 inactive、产品未激活；Root 真 IAM/Storage Complete 与 Web 真 Chromium/CORS/PUT 仍待验。下节“仅机器候选、没有 route”为文档门当时事实。

## W3-BFF-SKILL-COMPLETE-DOC-GATE：仅未激活机器/文档候选

基线 BFF clean main `571108b`，Platform owner `263a28f` inactive v4 与 command digest `3.0.0` pin 不变。唯一 public OpenAPI 新增 user-only Complete 的 strict 四字段请求、200 uploaded/scan 三态且无 asset_id 的响应、状态专属错误和 x-request-id/no-store；operation inventory/语义门/直接契约测试锁定 owner 11 条命令向量及旧 operation 误引负例。本片**不新增 Complete runtime route**，不改 SQL/receipt/Storage/config/generated；CreateDraft/Get/Begin 仍默认关闭，产品未激活。Root 既有真 owner 组合验证的是 Begin→signed PUT 及旧 Validate/Publish 回归，不是 BFF public Complete、浏览器 Chromium CORS/PUT。Get 缺 hash/size 的刷新恢复须保留 Begin 描述符或重选原文件重算，否则显式新 Begin 替换。Complete 运行与真 IAM/Storage/撤权重放、感染/旧 attempt 隔离组合仍待后续切片。

## W3-BFF-SKILL-BEGIN-RUNTIME：默认关闭运行候选

本片基线 BFF `145c422c052b7409b960deeeb2d185285492e4e8`，owner pin 仍为 Platform `263a28f` inactive v4/command digest 3.0.0。新增同 Get path 的 POST Begin 具名路由、strict 输入/255 字节 UTF-8 边界、稳定命令身份及 owner 14 条投影向量相符的 JCS/SHA-256、generated Connect client 方法；当前 IAM/固定 tenant 先于 Platform。`KOKORO_STORAGE_OBJECT_ORIGIN` 可单独提供签名 PUT public origin，不启用 Storage RPC secret；缺失时 Begin 503、CreateDraft/Get 不回退。201 仅在校验完整 URL/origin/method/headers/expiry 与 attempt/epoch 后发 strict `{data}`，同键 replay 不走 BFF receipt。BFF SQL/Redis/签名缓存零变化，旧 Capability 不承接包命令。这里是本仓 HTTP/contract/静态代码门，Root 真 owner 组合、Web 真 Chromium/CORS/PUT 与正式 public activation 尚待验；下方“Begin 无 route”是文档门当时事实。

## W3-BFF-SKILL-BEGIN-DOC-GATE：仅未激活机器候选

本片基线 BFF `f0aaf386bc7f7ca81ff4b996b84d29f0ce05e02f`。唯一 public OpenAPI 增 user-only `POST /v1/skills/{skill_id}/package-upload` 的 Begin 候选与严格请求/201 完整 PUT TransferReference/状态专属错误；owner `263a28f` inactive v4 pin 原字节和其 `command_digest_version=3.0.0` 均不改变。BFF **没有 Begin 运行路由、Connect 调用或浏览器正式入口**，CreateDraft/Get 仍默认关闭。Root 既有真组合仅验证 Get none/发布后 412/撤权 401，先前 Begin 是 Platform owner CLI，不冒称本候选 public 已验。三面文档同意 Web 同源控制面→BFF→Platform、浏览器向批准 ObjectStore public origin 直 PUT；后续 BFF 运行时做 signed URL/method/headers/expiry 严格验证，真 Chromium/CORS 和 Complete/Validate/Publish 串行。BFF Skill/Upload SQL、Redis、receipt 与签名缓存零变化；本节机器/文档门验证结果以本片提交报告为准。下方 Get/DOC-GATE/W1E 均为彼时阶段事实。

## W3-BFF-SKILL-GET-RUNTIME：v4 精确 pin 与默认关闭的真实只读候选

本片基线 BFF `58bcfc7da656981c1a43a9918ab9f96d207bbecc`。BFF 现改为固定 Platform owner `263a28f1e55745bd1829a61f68228d775751adbc` 的两份原字节 Proto（`common.proto` SHA-256 `65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08`、`platform_runtime.proto` SHA-256 `8ccab4aee4efdfd8210f2e5f02ae8ec85c2c470e90451915209406e16621289a`）与完整 inactive v4 artifact/provenance aggregate `902f8f2c2fbeb95a441820c1cf16b0a9c793eadac7106f9fcd5e41e3878b7f79`；旧 v3 vendor 已删，不双轨。生成脚本核全树文件/字节/aggregate、24 request bindings、17 command identities、34 operation、唯一 Get read binding 与 descriptor，并两次独立生成字节比较。CreateDraft 仍用 owner v4 未变的 command digest v3 绑定与 45 条向量，不能误把 artifact v4 写成 digest v4。

运行时 `GET /v1/skills/{skill_id}/package-upload` 与 CreateDraft 复用同一个 `KOKORO_SKILL_DRAFT_CANDIDATE_ENABLED` loopback-only 默认关闭 catalog client。每次 IAM session/user/固定 tenant 先于 Platform socket；只有受信上下文构造 `ProductCatalogContext(user,user)`，再以短期 catalog workload token 调 owner Get。public 仅 strict `{data:{skill_id,attempt_epoch,phase,attempt_id?,upload_id?}}`，正整数 epoch 保持 decimal string；对 owner 错 ID/phase/epoch/presence/格式返回 502，不返回半成品。404 掩蔽非本 user/tenant、412 非 draft、429 可选有界 Retry-After；成功/错误均 `x-request-id` header 与 no-store；公共 request ID 入口只原样接收单个、可打印且最多 128 字符的值，其他输入改为本次稳定 UUID，避免坏 header 回显或上下游不一致。无 BFF Skill SQL/receipt、Storage I/O/签名、浏览器 bearer 透传或旧 Capability fallback。此为**运行候选**而非产品激活；Root `4300f4fc` 真 IAM/BFF/Platform 隔离组合已验 fresh draft `none` 200、Publish 后 412、同一 session 撤权后 401 且零新增 Platform socket。中间各 package phase 未经 BFF public Get 真 owner 组合逐一采样；Begin/Complete/Validate/Publish public 与最终 activation 尚未完成。下方 DOC-GATE/W1E 各节按其当时基线保留，不覆盖本节当前态。

## W3-BFF-SKILL-GET-DOC-GATE 候选：只有机器契约，尚无 Get 运行路由

本片起点 BFF clean `main caa99d90f57329065eeb0e98168316b2b1874159`；当前新 Platform Product 入口仍仅为默认关闭的 `POST /v1/skills/drafts` 候选，另外三条旧 Capability Skills GET 与一条 MCP GET 保持原旧 HTTP 路径，旧 Skills 其他声明是 503，不是包产品。BFF generated Platform consumer/manifest 仍 pin owner `5b6eb2c` inactive v3。Platform owner 当前 `263a28f` 的正式 Get/Begin/Complete/ZIP Validate/Publish 已通过 Root 独占真实 IAM/BFF/Platform/Storage/PostgreSQL/Redis/MinIO/ClamAV 组合；组合中的 Begin→Publish 来自 owner CLI，**不是 BFF public Get/Begin/Complete/Validate/Publish 或浏览器 session 撤权闭环**。下方 W1E CreateDraft 及更早段落是当时历史切片；其中“真实三 owner sandbox 未验”不覆盖上述 Root 当前组合事实。

本轮仅将 user-only `GET /v1/skills/{skill_id}/package-upload` 写入唯一 public OpenAPI 作为未激活候选，并用直接契约/语义门锁定 strict 字段与无 Idempotency-Key、无签名/Asset/hash 的边界；**不新增 route、Platform v4 pin/生成物、配置、SQL、Redis 或运行代码**。未来运行链为 Web 同源→BFF 当次 IAM session→固定 v4 Platform catalog Get，owner current draft 检查每次执行；`phase=none` 为 epoch `"0"`、attempt/upload absent，其余阶段仅投影当前 known IDs。BFF 不保存包事实或自己的 Skill receipt。下一代码片先精确 pin Platform `263a28f` 两份 Proto、完整 inactive v4 artifact/provenance/read binding，再实现 Get route 与隔离真 IAM/session/owner 负例；正式公开仍待 Root 协调 activation。后继 Begin signed PUT/CORS、Complete、Validate、Publish 按独立切片串行；Storage orphan retirement、Agent pin 与产品激活未完成。

## W1E-BFF-USER-SKILL-DRAFT 文档门（2026-09-29；仅目标设计，运行未激活）

本代码片已把 Platform consumer 原子重钉到 owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0`：两份 Proto 原字节 SHA 保持不变，完整 inactive v3 artifact/provenance aggregate 为 `324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`。BFF 独立 CreateDraft raw projector、RFC 8785 JCS/SHA-256 已覆盖 owner 45 条正反向量；source/aggregate drift fail closed。canonical OpenAPI 已新增严格 user-only `POST /v1/skills/drafts` 候选契约；runtime 候选已实现该 route、catalog machine credential 与精确
`mutationTicket` bypass 已在 IAM admission 后、通用 mutation receipt 前按精确 raw route 分派；候选默认关闭且真实三 owner sandbox 尚未验证。旧 Capability HTTP 四条 GET 仍是当前态，不因本设计而声称已删除。

**当前已固定的机器来源** 是 Platform main `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0`：
`kokoro.platform.v1` 的 `platform_runtime.proto` SHA-256
`282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020`、`common.proto` SHA-256
`65025b86a89119954bfbc7ad8eb89d59109ae7f390db5ee1a68f016eefa7da08`，以及
`platform-execution-operations/3.0.0` aggregate SHA-256
`324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`。
v3 manifest 明确 `status=inactive`、`routable=false`；其 registry、逐命令 schema 与向量是后续 consumer
生成/核验事实源，不是 BFF route 激活证据。该发布标记不是 runtime RPC kill switch：Platform 已按 v3 注册 SkillCatalogService。激活前允许 Root 在隔离 sandbox 做真实 IAM→候选 BFF→Platform 201/replay 预激活验证，但不构成 public 发布；只有六 owner sandbox 全门通过、Platform 发布 active/routable=true artifact、BFF 重钉并由 Root 协调激活后，public CreateDraft 才可用。当前 Stage B 已实现同一生产 handler 的默认关闭候选；仅 loopback 且完整配置时可供 Root 隔离真 sandbox，当前尚未执行该 sandbox，正式 public 仍未激活。v1/v2 仅历史冻结，不作为新 consumer 或运行 fallback。
Stage B 已增加 runtime 候选与本地短命 IAM/token/Connect/断连边界测试；Schema 未改，真实 IAM→BFF→Platform sandbox 尚未验。

## W2-F2-S9 Chat 作品快照：BFF 单仓代码门已验，Web/真链待验

基线 BFF main `f7a4614eb75f08791a4381fc77e829b35d56be6c` 起始 clean。本代码片已在唯一 OpenAPI、canonical SQL、受信 Agent 投影与现有 Chat repeatable-read repository/service 实现二元 Artifact Delivery：`source_title/source_mime/source_size_bytes` 为必填 immutable claim 窄投影，不复制 Storage 当前 metadata；snapshot 同一事务按本人 active Conversation/Project ACL 读取最近 100 件、`deliveries_has_more` 和公开 cursor，按 `(delivered_at DESC,artifact_id ASC)` 稳定排序。Message `message_seq` 独立；正式 snapshot 不再输出 hash/path 选择器。未使用旧 hash-only `buildSessionDetail` 已删除，AG-UI live/replay 完整事件保持。

直接 TDD 先 RED 4 项，再 GREEN：聚焦 34 pass/1 无库 skip；隔离真 PostgreSQL + 空 Redis DB15 的 `agui-projection.integration.mjs` 24/24 pass，数据库已删除、Redis 0→0，覆盖同 hash 两 ID、101 件边界、本人/Project/软删、重复来源、同一 MVCC 交付+水位竞态。Node22 `pnpm format:check && pnpm check && pnpm schema:check` 全绿：默认 366 pass/1 无库 skip，Schema 默认 5 pass/1 无库 skip，另以隔离 PostgreSQL 管理连接重跑 Schema 6/6 pass。隔离 PG `EXPLAIN` 20k 关联/100 会话仅示样本：原索引 109 buffers/0.288ms，新单会话索引 6 buffers/0.037ms，不冒充生产性能。正常 AG-UI GC 保留最新 Run 帧；同一真 PG fixture 已断言旧 cursor replay expired 后重取快照仍有持久 `(conversation_id,artifact_id)` 与当前 head watermark。Agent claim 的 `size=-1/1.5/字符串/2^53` 由直接测试拒绝，真 PG 的 `source_size_bytes=2^53` 被具名 CHECK 拒绝；101 件夹同一 `delivered_at` 仍按 `artifact_id ASC` 决定边界。Web 后续须处理 expired/HTTP 410 并按二元 ID 去重；null watermark 不等于作品为空。

Web 尚未 pin 新契约，严格事件解析、hydration/Canvas、正式旧 hash/Blob 双轨删除及 Root 真 IAM→Chromium→Agent→Storage S9 链均待后续串行门；本片不宣称用户页面已闭环。S8 已验事实见下节。

## W2-F2-S8 大作品下载时限：单仓与真浏览器小件已验，真大件待验

基线 BFF `55d3c9cd55386d9dcc074e893cc388924dd94c13` 的单个
`AbortSignal.timeout(120_000)` 贯穿作品取回/校验和出站，合法慢下载可能先于 Web 的独立预算被截断。
本切片以 BFF main `f558acc36bf9947e48753be510499b08a8011e85` 为基线，已在精确 Artifact
`/content` route 实现三段预算：本人关联/Storage FINAL+CLEAN/短期引用保留最多 120 秒，ObjectStore
取回及完整临时文件校验独立 7 分钟总/45 秒无落盘进度，已校验文件出站独立 28 分钟总/25 秒已完成
写入进度。2+7 分钟小于 Web 10 分钟未发头预算，出站 28 分钟小于 Web 30 分钟 200 流预算；这些
是有限故障预算，不是 1 GiB 慢链路 SLA。

共同客户端取消向可取消 I/O 传播；异常对象流的 `body.cancel()`/`reader.cancel()` 即使永不完成，
也不阻塞本地临时目录与两个进程内 spool 名额的释放。准入已超时而本仓查询迟返 404 时优先返回
稳定 503；未发头按现有 JSON 错误，已发 200 后失败只终止连接，不伪装完整下载。普通 PG query
与磁盘 syscall 不宣称严格硬取消。1 GiB 上限、本人/FINAL+CLEAN 授权、OpenAPI、Storage Proto、
SQL/Redis、个人文件路径均未改。

直接假钟/受控流与真实慢消费者 Node HTTP 测试已覆盖阶段总/idle、成功与截断、异常取消回收；
Root 独立 Node 22 `pnpm format:check && pnpm check && pnpm schema:check` 全绿：默认测试
365 pass/1 无库 skip，Schema 5 pass/1 无库 skip。Root `f9f5befa92f30c650397837120b7cc0be8bc37b0`
固定本代码片 `b382642affa27332e91b49078e0500c6716b820e` 的真 IAM→HTTPS Chromium→Web→BFF→
Agent→Storage/MinIO/ClamAV run exit0/PASS：两件真实 CLEAN 作品从 UI 原生下载保存原字节，另一成员
列表空/内容 404，个人文件/Project/EICAR 回归通过，测试自有数据库、Redis 键、进程与对象版本清零。
这证明真实 owner 小件路径与回归，不是代表性 1 GiB 限速或故障恢复验收；后两者仍待专测。

## W2-F2-S5 第二代码片：本人私有 Artifact Product 读取/下载（单仓已验，跨仓待验）

基线是已验 BFF main `8f46ff6aa96b51a04088a3323d1e1f738d550480` 的来源/持久关联第一片。
本代码片把唯一 OpenAPI 的 `listLibrary` 扩为显式 `kind=file|artifact`，新增按
`(conversation_id,artifact_id)` 的单项与 `/content` 原字节操作；本人 active Conversation 与现有
Project owner predicate 在 BFF SQL 的 LIMIT 前过滤，跨会话按关联时间/二元 ID 做有界 keyset。
每个候选再用受信 conversation scope 调 Storage `GetFinalArtifact`，核对 FINAL+CLEAN owner
返回的 artifact/asset/kind/digest/run；单项和下载同样逐次重验。签名对象 GET 只允许配置的精确
ObjectStore origin、未过期 GET、空附加 header；原字节在发头前进入请求独占临时文件，完整校验
SHA-256/长度、限制 1 GiB，响应完成、取消或失败均清理，不复用 1 MiB 个人 Buffer 路径。
进程内最多两个并发 spool；满额请求在 ObjectStore GET 前返回 `503 artifact_download_busy`，
释放由成功/失败/断开路径验证。Library OpenAPI 在页级互斥空页、纯 file 页和纯 artifact 页，
不再允许一个 `items[]` 同时混排两种 kind。
固定 Product tenant 外仍由既有 admission 先返回 403，固定租户内他人/错二元组统一 404。
不做分享、`kind=all`、旧 hash/frame fallback 或 Web 入口；Storage 仍唯一拥有 Artifact metadata。
本仓 Node 22.22.2 的 `pnpm format:check && pnpm check && pnpm schema:check` 已通过：默认
359 项/358 pass/1 无数据库 skip，Schema 5 pass/1 无数据库 skip，OpenAPI 77 个 frozen operation；
直接 Connect/HTTP 测试覆盖本人原字节、跨 subject 404、固定租户外 403、坏 owner 与篡改 502。
writer 在自建临时 PostgreSQL 库、空 Redis DB15 的聚焦真 PG 测试验证跨 Conversation
keyset、owner/Project 先筛、错 tenant/subject/二元组与 frame GC 后关联仍可读，1/1 pass，
DB 已删除、Redis DB15 前后 0。Root 对最终代码独立 Node22 `pnpm format:check && pnpm check && pnpm schema:check` 全绿：
默认 358 pass/1 既有无库 skip、Contract 65/65、Schema 默认 5 pass/1 skip；
自建隔离 PostgreSQL/Redis DB8 完整 integration **44/44** 与真实 schema **6/6**，
数据库已 DROP、Redis DB8 初末 0。真 Storage/ObjectStore/Agent 三仓组合与 Web/浏览器入口仍待验；
**本代码片发布 Product HTTP，不等于用户当前页面已可见或 W2-F2 完成**。

## W2-F2-S5 第一代码片：上游来源与持久关联（2026-09-28；Root 已验，Product API 未发布）

本片已将 Storage F2 Proto 固定到 `d5cfc442c675e32363ae767f5ec662a9e0d9eaea` 并确定性重生
Connect client；Agent HTTP 旧 pin 保持不变，另列 `486adb1539dd8a06ca90684e66f91be031aa70cf`
event-protocol 来源，并在本仓 vendor 冻结 `protocol/events.py` 原字节，生成器 `--check` 核文件
allowlist、regular 与 SHA-256；不依赖兄弟 checkout。BFF 严格解析 Chat `delivery` 的
artifact/asset/kind/tool-call/摘要及非负安全整数 size，在现有
`commitProjection` PostgreSQL 事务中，先按 active Conversation 锁定删除竞态，再以已注册
consumer subject/expected run 与本仓不可变 dispatch 的 tenant/conversation/run/subject 核对，写入
`bff_conversation_artifact` 关联、source ledger、AG-UI frame 与水位；旧 Run 迟到交付按其历史 dispatch
核对，不误用最新 expected run 排除。Conversation 软删除同事务清理关联，AG-UI frame GC 不清理关联。
本表只保存 Agent 不可变来源声明，不复制 Storage Artifact metadata。
新具名 `src/infrastructure/postgres/conversation-artifact-projection.ts` 只负责关联的 Conversation 锁与
同事务 INSERT：采用它而非把关联 SQL 再堆进现有 AG-UI repository；调用仍由后者拥有事务和 source
顺序，未新建业务层、进程、数据库或跨 owner import。目标 Product 读取将另由具名查询/route 承接，
不在本片建立空目录或提前发布 API。

**尚未实现 Product Artifact API。** 当前唯一 OpenAPI、Library 路由、Storage Final Artifact 读取与原字节下载
均未在此片改动；用户不能通过 `/v1/library?kind=artifact`、单项或 `/content` 访问作品，旧 hash-only
Chat delivery 和 frame 不是替代入口。本片 Node 22.22.2 的 `pnpm format:check && pnpm check && pnpm schema:check`
已由 Root 独立重跑：默认全门 353 pass/1 无数据库 skip、Agent/Storage 生成器 `--check`、唯一
OpenAPI 语义 75 个 frozen operation；自建临时 PostgreSQL 库 + 空 Redis DB8 的 `pnpm test:integration`
**44/44**、带真实数据库的 `pnpm schema:check` **6/6**，临时库和自有 Redis 键均清零。首轮真集成揭示
删除关联 SQL 参数序号错误与旧 HTTP fixture 固定租户不一致；同片加直接 RED 回归并修正，扩充 source
冲突/整页回滚负例，第三轮真集成全绿。此为来源/关联代码片验收，不是 Product API 或浏览器闭环。

## W2-F2-S5 Agent 作品 Product 链：设计门，运行面未实施

BFF 当前 `main` `d5c868f8ab8b8a33750e1286e9d020ca72895641` 的 public
`GET /v1/library` 仍仅有 `kind=file`；个人文件列表/上传/下载与 Agent Artifact 是两种资源。
`src/infrastructure/clients/agent/projection.ts` 的 Chat `delivery` 映射和
`src/contracts/chat.ts` 旧 Delivery 仍是 hash-only，尚未消费 Agent `artifact_id/asset_id/artifact_kind`。
`database/schema.sql` 没有 conversation↔artifact 关联表；Storage consumer manifest 仍固定
`2d87e26`，尚无 F2 Final Artifact 三个读取 RPC；唯一 OpenAPI 尚无 Artifact Library 200、
单项或原字节下载。AG-UI frame 有限期 GC，现有 frame/Redis 不构成持久作品列表。

本次**只提交设计**：四份顶端 S5 段约定在现有 `commitProjection` PostgreSQL 事务按 Agent
source identity 写 BFF-owned conversation↔artifact 关联，跨当前本人 active Conversation 做 keyset
`GET /v1/library?kind=artifact`；单项和下载按 `(conversation_id,artifact_id)` 逐次核 BFF ACL、
Storage FINAL+CLEAN 与原字节。默认个人私有，Share 只有显式 share-bound 当前有效授权才可读取，
Project/Team 关系不自动开放；`kind=file` 保持，`kind=all` 另片。Storage 仍是 Artifact 唯一事实源，
无旧 hash/AG-UI GC fallback。**本工作树没有改** OpenAPI、SQL、生成 client、运行代码或测试，
这些接口与投影当前不可用。

后续代码门的 owner 来源已固定为 Agent
`486adb1539dd8a06ca90684e66f91be031aa70cf` event-protocol aggregate
`cae30a40d712bce39ef33ef2dc857af4f5b69c6afd1956fda065ec77379ae02e` 与 Storage
`d5cfc442c675e32363ae767f5ec662a9e0d9eaea` Proto aggregate
`8317e644d45c8db310b44f114afa22892a6a40d6ee7d0c1c4a37a8203e79f427`；
本仓 consumer manifest 尚未更新，不能据此宣称已 pin/生成。Root 审查文档门后须另锁精确代码文件集，
先 RED 再改唯一 OpenAPI/Schema/消费者，跑 Node22 contract/schema/full/真实 PG 与 Root 真组合。
本次文档检查不替代任何 Product 验收。

## W2-BFF-PERSONAL-DOWNLOAD 代码片（2026-09-28；BFF→Storage owner 组合已验）

设计门基线 BFF main `74bb714d5867399bc50806c158c2ffb838c27b40` clean，个人文件列表与上传已有。
当前代码片已在唯一 public OpenAPI 增加 `GET /v1/library/files/{asset_id}/content` 与 frozen operation baseline；
`src/bootstrap/server.ts` 在每次 Product IAM admission 后精确分发具名 route，个人 Storage Connect adapter
沿已固定 v2 owner Proto 在可信 personal scope 先 `GetAsset(asset_id)` 校验普通 ASSET/CLEAN，再用返回摘要
`GetDownloadReference` 并核对 ID、摘要、大小、MIME、CLEAN。Web 文件卡和同源下载 adapter 尚未接线。

对象 GET 只允许配置的精确 origin、未过期 GET、空 required headers，不带 Cookie/Authorization、无重定向；
完整缓冲不超过 1 MiB，验证长度和 SHA-256 后才发带安全下载头的二进制 200，错误为稳定 JSON，
签名 URL 不暴露、不入日志/receipt。直接测试用 Connect/ObjectStore double 验证本人原字节、每次 IAM
admission、跨 subject 404、非 ASSET/非 CLEAN、坏引用/摘要/重定向及失败不出部分 200；这不是
真实 Storage/MinIO/ClamAV 或 Web/Chromium 验收。BFF Schema、SQL、Redis、receipt、role、生成物均未改。
Root 已独立以 Node22 复跑 `pnpm format:check && pnpm check && pnpm schema:check`（347 pass/1 既有 skip、schema 5 pass/1 无库 skip）；BFF code commit `318cf6ab756801c4c80c59154c6cbd969d5a159d` 与 Storage `2d87e26` 在隔离真 PostgreSQL/Redis/MinIO/ClamAV 的 Root W2 runner `run_id=5036454fc7b1397a19695361` 通过 14/14：个人原字节下载、同租户他人 404，并回归上传/列表/Complete 响应丢失后 BFF OS 重启同键恢复。运行自有 DB/对象版本/进程清零、独占 bucket 删除；IAM 是身份桩，不等于真 Web/Chromium 下载。首次组合尝试的 PostgreSQL URL 缺显式用户名，在 owner schema 安装门失败且自有数据库未留下；修正为本机用户后重跑通过，不是 runtime 修复。Web 精确 pin、同源二进制 adapter 和真 Chromium 点击属于后续独立切片；`EDGE-BFF-STORAGE` 仍 broken。

## W2-BFF-LIBRARY-PERSONAL-UPLOAD-CODE（2026-09-28，已发布并通过个人文件真链纵切）

BFF main `8a90fdd9ec3809000924229bfc7b986ba8ba1522` 已发布 public OpenAPI 和 runtime
`POST /v1/library/files`、独立 personal Storage Connect adapter、个人上传 checkpoint saga 与直接合同/行为测试；
没有修改 canonical Schema 或新增角色。Root 已独立复验本仓 Node 22 的 `pnpm format:check && pnpm check && pnpm schema:check`
（342 pass/1 skip；schema 5 pass/1 skip）。Root 固定 `0a9206969b2edfcf40bb8d5f0f2d85952995fb8f`
组合的真 IAM→Chromium→Web→BFF→Storage/PG/MinIO/ClamAV 已从可见 UI 点击验个人 CLEAN 200、本人 GET/刷新、
同租户成员私有、并发同键、同键重放/异文件冲突、EICAR 422/终态重放；测试自有资源清零。

实现是一个 `files` part/1 MiB/必填 Idempotency-Key 的 Product POST：当次 IAM admission 后派生
personal scope，Storage CreateUpload→先持久 checkpoint→安全 PUT→Complete→GetAsset；只在普通
ASSET/CLEAN 且 public 终态 receipt 确认持久后返回 200。同键同文件恢复原 Upload，Complete 结果未知时
不内联 Abort 可恢复的 upload；感染 422、待扫/未知结果 503 同键重试、异文件 409。既有
`bff_idempotency_receipt` 的 public 终态和 `personal-file-upload:v1` checkpoint 用独立 scope，
无需预建新表/角色；本片已修复/测试 `putReceipt` 条件写 0 行静默成功风险。Project owner
predicate、`project-resource-upload:v1` namespace 不进入个人入口，Storage 仍唯一拥有文件事实。

上述单仓直接 HTTP fixture 使用假的 Connect 与对象 PUT；真纵切证据来自 Root 固定组合，不以单测冒充。
现有直接测试中 Complete 丢应答的“restart-style”仍在同一实例/内存 Map 上运行，尚未证明真实 PostgreSQL
checkpoint 在 BFF 停止/重启后的恢复。本次候选增加测试自有 PostgreSQL、独立 BFF 实例及受控应答丢失的
`test/personal-file-upload.integration.mjs`，只证明 BFF 持久回执/恢复与 Connect fault proxy；真实 Storage
进程已提交 Complete、BFF 重启后的当前固定组合门仍待 Root 放行。个人下载、Agent Artifact 及整条 W2 边仍未完成；
未触碰用户 3310。

## W2-LIBRARY-BFF-FILE 代码片（2026-09-28，个人文件 GET 真跨仓已验）

`GET /v1/library?kind=file` 已在 IAM admission 后调用 Storage personal scope 的 Connect `ListAssets`，OpenAPI 有严格文件 200、必填 kind
及 400/502/503；旧固定 `storage_integration_unavailable` 运行分支已删除。无 kind/未知 kind 400。
BFF Storage consumer manifest 现 pin `2d87e26`/combined SHA-256
`11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`；项目 GET/POST 仍用
独立 project scope，不把 `projectId=subjectId` 当个人查询。

Storage owner main `2d87e26bbaed9a70dcd91ad1e9d126d39d275f38` 已发布原 v2 `ListAssets` 的 personal
CLEAN ASSET 查询、隔离 `personal_library` cursor 与受信 `scope_id=subject_id`，combined SHA-256
`11edffcdd668c59ef07c7b4c47d44b38dd95c2b8aee5a4d0c6475fba58850713`；本仓已重钉并调用。
首片 `GET /v1/library?kind=file` 的 `kind` 必填，无参/未知 400；200 只列本人个人文件并
标 `kind:"file"`，不是 Agent 作品。未来 `kind=artifact`/`all`、下载 Product 动作和 Web
旧 `/api/session/artifacts` 迁移仍未实现。个人上传代码片的当前状态以上方为准，已通过个人文件真组合正向与私有负例；
下载另需当次 GetAsset 校验普通 ASSET/CLEAN 后再签短期引用，不能只调用 GetDownloadReference。
Storage 单仓通过不等于 BFF/Web 用户可见闭环。

本片无 Schema/role/缓存/旧 HTTP fallback；`x-request-id` header 已写，但现有 BFF JSON envelope 仍含
`meta.request_id`，与 Root API 手册 header-only 目标有既有全仓偏差，留独立 breaking 裁决。
Root 在此工作树独立使用 Node 22.22.2 复验 `pnpm format:check && pnpm check && pnpm schema:check` exit0：
全量 332 pass/1 skip、schema 5 pass/1 skip，Storage 精确来源与双次生成均 PASS；独立只读审查无 P0/P1。
新增 live Product HTTP→Storage Connect fixture 覆盖逐页重新 IAM admission、personal header、跨 subject cursor 400，
但仍不是 Storage 真进程/PostgreSQL/browser。Root 已在上方固定组合独立执行真 Storage/PG、
Web 浏览器刷新/同租户其他人不可见验收。未触碰用户 3310，不把本片称为完整 Library。

## W1E-BFF-PRODUCT-CREATE-DRAFT-DOC（2026-09-28 历史设计候选；以上 v3 目标取代旧 pin）

当前代码基线为 BFF main `55b2809b2f73addbac2b56bd8a04aa0c1706521b`。IAM 0.7 用户 admission 已存在；但 canonical
OpenAPI、runtime route、Platform Connect consumer、catalog workload credential 和 server receipt bypass 均不存在。Skill mutation
仍 fail closed，且 generic `mutationTicket` 位于业务 route 之前，terminal replay 可以跳过本次 Product 当前授权；因此当前运行态尚无
user CreateDraft 正向链。本节记录目标，不把四份 Markdown 当作实现或验收证据。

下一实现片只开放 `POST /v1/skills/drafts` 的 user owner：public body 仅含 `display_name`、`summary`、`tags`；BFF 从每次
IAM admission 的受信 tenant/subject 派生一致的 user owner 与 Product context，固定 `metadata_json` 为 UTF-8 `{}`。同一 public
idempotency key 派生稳定 Platform command，Platform receipt 是唯一 durable 幂等事实；CreateDraft 精确绕开 BFF PostgreSQL/Map
generic receipt，使首次请求和 replay 每次都先重验 IAM/current owner。BFF 不新增 schema、Redis、Skill catalog 或 receipt 事实。

本节原目标 pin 已过期；现目标固定 owner `5b6eb2c1532b23b9747bc4bf6ac99f69ad453de0`、Proto package
`kokoro.platform.v1`，`platform_runtime.proto` SHA-256
`282bf886ea9648f7ce5208abd36ab47d879b2002a036d90aada2af59e74b4020`，以及 execution artifact/digest v3
`3.0.0` aggregate SHA-256 `324e749da1bc66c1ff03de74e7299716f798f5f5bb5fa19556033b79fa09ff8d`（inactive、routable=false）。调用身份是 BFF
tenant machine catalog workload；旧 Capability HTTP shared secret、用户 Bearer、手写 Proto DTO 和 v1 digest 都不是 fallback。

仍未实现且不阻塞**候选代码准备**的范围是 organization/project/session owner、其余五个 catalog mutation、Storage/package 与 Web consumer。
首片已完成 public OpenAPI 候选/contract test、generated Connect client、credential/token provider、server admission cut、默认关闭 route 候选与离线/本地短命传输测试；当前 v3 artifact inactive/routable=false 是发布标记而非 runtime kill switch。Root 尚未执行真实 IAM+候选 BFF+Platform 隔离 sandbox；验证后也不得称为公开可用。六 owner sandbox 与 active artifact 重钉、协调激活仍是发布门：首次 201、响应丢失 replay、撤销 session 后同 key 拒绝及 Platform 仅一条 Skill/receipt，不能略过。本候选未改 schema、数据库、共享服务或 3310。

## W1E-BFF-IAM-0.7-PIN（2026-09-28，仓内验证通过；跨仓待验）

基线 `9b9aff46205a7bbe486244195b81e1e87e6ec2c6`；本切片完整 vendor/manifest/generated 已固定 IAM
`4d981441d154c83b63987f284e3a82a559595870`、OpenAPI 0.7.0、SHA-256
`c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`，旧 0.6 vendor 删除。
现有确定性生成器新增唯一 `checkTenantSkillAuthorization`；Session/Team/invitation consumer 保持原操作。
relay policy 仍为 2.1.0，仅来源 tuple 改变，生成 JSON SHA-256 为
`e58bf3e7992c2ac40efdf386ec2e652c021f2dd92747461207dede9d2c5d2786`，没有新增 browser-private route。

窄 `SkillAuthorizationClient` 在 server auth 边界使用调用方当前 user Bearer，严格检查
allowed/tenant/subject/action、no-store/request-id/JSON，拒绝额外字段；不缓存、不重试，也没有 BFF 机器凭据回退；用户 token 语义由 IAM 当前校验。
有界 transport 只有 session verify 和 Skill check 两个具名入口，不开放任意 URL/body 透传。
本片尚未挂接 Product mutation 或四 scope 编排，不改变 SQL/基础设施；Platform 受信上下文、Storage 包绑定和
public 机器字段仍是后续实现门。下节 0.6 描述属于该设计片原始盘点，不覆盖本切片来源。

Writer Node 22.22.2 / pnpm 11.25.0 验证：format:check、lint、typecheck、contract:check（28/28）、build 通过；
最终 test 为 297 pass、1 既有 skip，schema:check 为 5 pass、1 缺数据库 fixture skip；Session/Skill 聚焦 18/18。
IAM 生成 drift 两次 byte-identical、relay drift、diff 检查通过；relay 仅 commit/version/OpenAPI digest 三个来源键变化。
Root 已独立按 Node22.22.2/pnpm11.25.0 复验 `pnpm format:check && pnpm check && pnpm schema:check`，结果与上行一致；真实 IAM/BFF/Platform 和浏览器未在本片验证，不把本地 HTTP double 记为真实 owner integration。

## W1E-BFF-SKILL-PRODUCT-DOC 历史评审基线（已被上节首片收敛）

盘点基线 BFF main `1105553cfc24d4f44a90f626132bc30323a77946`，开始时工作树 clean。
本片仅四份既有文档的设计增量；不是代码实现、IAM pin 更新、Platform consumer 接通或四 scope 验收。

- 该设计评审时，BFF `contract/dependencies/iam-http.json` 固定 IAM 0.6.0；IAM owner
  `4d981441d154c83b63987f284e3a82a559595870` 已发布 0.7.0 `checkTenantSkillAuthorization`，
  artifact SHA-256 `c8d7af8a365ad5d13eaabccf7f31133e0918ef198bdc3e7c790d90933eae91b2`，BFF 尚未消费。
- 当前 Skill/MCP facade 仍是 Capability 2.0.0 四 GET；其余 Skill route 返回 503。Platform 当前物理仓
  `apps/kokoro-capability`、盘点 `ee25c1f4d6df08be183ca10f7f5e852e0b21f641`，六 catalog mutation 的 workload+tenant
  不等于受信 Product subject/owner 当前授权；不能以这些 RPC 已存在宣称 Product mutation 完成。
- 目标四 scope 为 user/organization/project/session；BFF 负责 Product 身份与个人/Project/Conversation 当前策略，IAM 负责组织 Skill
  当前动作，Platform 负责真实 Skill owner/状态/receipt，Storage 负责 package。详细矩阵、目标 public API、数据不变量分别见三设计文档。
- 当时计划的下一片先精确 pin IAM 0.7 SDK，落实 BFF 四 scope check；Platform Product 受信上下文/资源 owner 查询/撤权与 replay 协议先发布，
  随后精确 pin consumer 并逐项实施；Storage→Platform Begin/Complete 与持久包绑定必须先闭环，才激活 Validate/Publish 成功路径，
  未就绪时两动作保持 fail closed，不宣称六 mutation 均可成功。其余 installation、Web scope/UI、Root 端到端按依赖推进；
  user-only 首片不等于全部目标。
- 未决发布门：Platform Product admission 的可验证承载与撤权竞态时点、资源 owner 查询机器契约；Storage upload/package 消费 pin；
  BFF public 六 mutation 机器 OpenAPI/错误码与 generated consumer；Root 专用真实三 owner Skill smoke runner/命令。
  这些分别归 owner/Root，不用文档或 stub 替代。无 schema 变更，无应用服务启动，无共享 3310 操作。
- 本轮四文档现状/目标评审已完成；代码前置文档门仍待 Platform owner 机器契约及 public 字段收敛，尚非完整三设计文档门通过。
  Root 独立 Node 22 新增章节 Prettier、CURRENT 整文件检查及 `git diff --check` 通过；
  schema governance 为 5 pass、1 skip（未提供真实数据库 fixture）。本片代码、机器契约与真实跨仓链路仍未实现。
  代码 lint/typecheck/test/build、真实 PG/Redis、三 owner smoke 与浏览器均未在本片执行；本节不覆盖既有历史门禁记录，
  也不提前修改 Root active dependency 库存。

## W1E-IAM-0.6-BFF-PIN 历史来源

IAM owner `a4c2b61467f1fc1772d6b6d8e98f081c090289fb` 的 internal OpenAPI `0.6.0` 原始 SHA-256 为
`392ca0e49544c0ec6e0d2fa782c46c33c1847e2c350102e7ad3b8af43f858ced`。本仓完整只读 vendor、生成配置、manifest
与 browser-private relay policy 来源 tuple 均重钉到此唯一 owner commit，旧 `0.5.0` vendor 删除。生成器仍只筛既有 session、Team、
invitation 操作；新增 Platform workload introspection 与原有 E2 verifier 都不进入 BFF generated client 或浏览器 relay。
relay policy 仍为 `2.1.0`，route/header/cookie/status 未变；派生 JSON SHA-256 为
`8f7d4f4cb6fa0ec34d2cce8702d8882d3270a316a6cbdb2d8bdaccefb9c6b4a1`。本片不改 Product API、SQL/Redis、业务逻辑。
IAM 0.6 ingress 契约与运行端点已在 IAM owner 发布；Platform owner 尚未消费该端点或完成原子 cutover，后续跨仓验证仍需独立验收。
Node 22.22.2 本仓 `pnpm format:check && pnpm check` 已由 Root 独立复跑通过：IAM 生成链无 drift，contract/全量测试
292 passed、1 既有 skip，最终 build 通过；Redocly 仅有既有 Library 无 2xx warning。Root 跨仓来源验证仍待
IAM→BFF→Web 三方组合固定；本片未启动共享服务或触碰 Web 3310。

## W1E-IAM-E2-BFF-SOURCE-PIN 历史来源

IAM owner `b720b6dc095b883237682102ca0a87ed6451a968` 的 internal OpenAPI `0.5.0` 原始 SHA-256 为
`cddfec4cd3439d98f399254911232c447582a97e9b1d4c109139e68baaf030b9`。BFF 已替换旧 vendor，固定生成配置/manifest 并重生
16 个 client 文件；生成 operation allowlist 保持原有 session、Team、invitation 集合，不生成或调用 IAM E2 verifier。
browser-private relay policy 仍为 `2.1.0`，route/header/cookie/status 与前一 pin 完全一致，只更新来源 commit/version/digest；
派生 JSON SHA-256 为 `ed476b63205c0eaf59106dc618c138df6110ef6240ce2be50b417fea8ec800e4`。
public Product API、SQL/Redis、运行时业务逻辑均未变；Web 与 Root 后续按已发布 BFF commit 串行重钉。

## W1E-IAM-PERMISSION-CONSUMER 来源更新（历史验收）

当前 IAM owner 为 `5c9cecf714c87234bbc9558665b23e09afa6e9f6`；internal OpenAPI `0.4.0` 的 SHA-256 为
`05ff7ff712ce06571ca5e092fdaf234b9ee4d1b4978c54e0d54d2b50fe51dde2`。唯一 wire 变化是角色列表响应增加
可选 `platform:["execute"]`；BFF 已重钉 owner 原始字节并重新生成 16 个 client 文件，其中只读角色类型与 Zod schema 有变化。
browser-private relay `2.1.0` 的 route/header/cookie/status 不变，policy 仅更新 IAM 来源 commit/digest，派生 JSON SHA-256 为
`7bb829c988908804d0c3cac0cb023a6c247af6b0b4a55e8baf90b39d795f7118`。BFF 不解释或授予该权限；IAM
execution authorization endpoint 与 Platform consumer 仍待后续切片。

## W1D-RELAY-PIN-BFF 来源更新（历史验收）

IAM owner 已发布 `6a55ffb4c22f0b155ddb83157735c0ace766701d`；固定 allowlist、Better Auth 1.7.3 snapshot 与
internal OpenAPI 0.4.0 的 SHA-256 分别为 `f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`、
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`、
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`，与先前 pin 完全同字节。
BFF 唯一手写 policy 仅重钉 `iamOwnerCommit`，派生 JSON SHA-256 变为
`b18a559d162509c3029908b2e1c77ee7e59ed6af61b82e18be6b2e7669a0ef0c`；原 commit 替换回去时的 digest 仍为
`f7a3a44d9839a0e54faffc8cf6b7ceb601d0d6b647637faf10e9070c927d93e7`，证明 route/header/cookie/status 等字段未漂移。
IAM OpenAPI vendor 已按新 commit 路径迁移，旧路径删除；配置与 generated manifest 同 pin，生成的 16 个 client 文件原始字节无变化。
本片不改 public Product API、SQL/Schema、Redis、状态机或 HTTP 行为。Node22 聚焦测试先观察 3 RED（policy commit/新 vendor/manifest），
生成后 22/22 GREEN；`pnpm format:check && pnpm check` 通过，contract 28/28、全量 291 pass/1 既有 skip、build 通过，IAM client
drift gate 为 16 文件两次字节相同。无隔离 IAM owner URL，因此未运行需外部进程的 `test:iam-relay:integration`；Web 消费与 Root 固定
SHA/跨仓验收待后续串行完成。下面 R5 段落保留当时的来源和历史验收记录，不是当前 pin。

## R5-INVITE-BFF-RELAY 当前实现与来源重钉

IAM `7215223b2ed27a0d5217f3bbaaabce547006d3bb` 只更新测试 SMTP fixture，0.4.0 OpenAPI 原始字节未变。BFF 已把 IAM owner 固定到
`7215223b2ed27a0d5217f3bbaaabce547006d3bb`、OpenAPI 0.4.0 SHA-256
`a18d57172df841cb2f55aa845a3eeb519ddb5abc8bea1c2be74fbb7e0fb62416`。vendor、dependency manifest、生成配置和 IAM client
只新增三条 browser-private invitation operation；policy `2.1.0` 的派生 JSON SHA-256 为
`f7a3a44d9839a0e54faffc8cf6b7ceb601d0d6b647637faf10e9070c927d93e7`。静态 `routes` 只从 IAM `AUTH_ROUTES` 增加精确
`POST /sign-up/email`；context/accept/reject 仍位于独立 `invitationRoutes` 与具名动态 matcher，不形成 wildcard 或静态 map 模板。

四路都在 Product admission、SQL、Redis、receipt 和业务 store 之前验证 Web 服务身份、精确 Origin 与有界 transport。动态三路另要求
配置中的固定 tenant、IAM canonical 小写 UUID、过滤后的非空 issuer Session，且无 query/body/Authorization/Idempotency-Key；
sign-up 只接受恰好 `name,email,password,callbackURL` 的 JSON、无 issuer Session，并把 callback 固定为同源单邀请 ID。其 pinned
Better Auth snapshot status 集为 200/400/401/403/404/422/429/500，不含 409/503；`requireEmailVerification=true` 的 200 必须是
`token:null` 或省略 token 且 `emailVerified:false`，string credential token 或任意 Set-Cookie 都会被脱敏为 502，确保 SMTP 验证前不跨过
issuer Session；user email/URI/date-time 也必须通过 pinned snapshot format。Web 后续不得渲染或使用 token 字段，
所有邀请 POST 的一次性 CSRF 仍由 Web 在注入 BFF 服务凭据前消费。

动态响应按 generated owner schema 严格验证 status、JSON media type、成功/error body，禁止 Location/Set-Cookie；sign-up 同样限制
snapshot status/body 并拒 3xx。动态错误额外要求 `details=[]`，只保留 generated 稳定 code/retryable 并用 code→固定安全文案重建；sign-up
错误按 snapshot 的必填/可选 message 形状验证后，改用 status 对应的固定 `IAM_SIGN_UP_*` code/message，二者都不透传 owner 原始
message/payload。全部邀请结果固定 no-store/no-referrer/request-id，429 只保留合法 Retry-After；未知、畸形或超限
上游响应不泄露原文，transport/timeout 不重试。verify-email 只新增精确同源
`/iam/interactions/invitation?id=<canonical UUID>`，失败只允许 owner 四值
`TOKEN_EXPIRED|INVALID_TOKEN|USER_NOT_FOUND|INVALID_USER` 作为唯一追加 error；其他 query/顺序/编码/外域仍 502。BFF 不新增
Product API、数据库或缓存事实。真 HTTPS SMTP/Chromium、Web interaction/CSRF 与 Root 来源 verifier 仍待跨仓串行验收。

BFF 初次实现切片的 Node 22.22.2 `pnpm format:check && pnpm check` 通过：IAM/policy/其他 generated drift gate 均为双生成字节一致，
contract test 28/28，全量 291 passed、1 skipped，最终 build 通过；Redocly 仅保留既有 Library 无 2xx warning。相邻 relay policy/真
BFF HTTP 假 IAM 测试 32/32 通过并覆盖零上游 socket 拒绝、三动态成功/error、sign-up、Location、未知 status/schema/header、大小/
deadline/取消与不重试。没有可用的 `KOKORO_TEST_IAM_BASE_URL` test-owned loopback owner，本次未启动共享 IAM/PostgreSQL/Redis，
故 `test:iam-relay:integration`、真实 SMTP/PG/Redis 与浏览器验收明确未运行。

## W1C-Team-R5 工作树目标（未获 Root 组合验收）

基线 BFF `e0663a8c85f055c2bac5af894070fea8e24ff3ce` 只有 Team 三 GET；当前工作树增加六条 IAM user-delegated Team Product mutation。IAM owner pin 为 `ad5224a9e0a3a31d1c593d214d37940d6923b2e7`，internal OpenAPI 0.3.0 SHA-256 为 `e1a023d3ae9839c345d65ec91c3674bd105a9c27f65bb6ecb10f74c965340c54`（字节与旧 pin 相同）；browser-private policy `2.0.0` 只重钉 IAM SHA，派生 artifact SHA-256 `74893ba4e566e4824a278cd3ee1548030a33435f9b37b7026a8a7e943c080037`，route/header/cookie 语义不变。Team 不落 BFF SQL/Redis；IAM write scope/权限、冲突与并发由 IAM owner 裁决。Node22 `pnpm check` 本仓通过：282 passed、1 skipped；真固定租户 Web→BFF→IAM 链待 Root 验，未获 Root 组合验收。

W1C IAM 来源重钉（2026-09-24）：IAM main `7f39193fff97dbb1398cb536ded7dca0db354213`
仅调整 test-owned Web OIDC host 与集成测试；前一 IAM main `3231d2e9b225c337a1432ffb431cd7a5269d988d`
已发布的第一方 Web client 固定 Tenant issuer 续接约束保持不变。IAM ingress allowlist 与 vendor
snapshot 原始字节未变，BFF 只更新 browser-private policy 的 owner commit 来源并保持 `2.0.0`
的 route/body/cookie 语义；派生 `contract/iam-relay-policy.json` SHA-256 为
`70cc9704ecf6f61d616011a72447ff3df8c209b3a769d5e4009692b81329e96f`。Web 须固定新 artifact digest；
本片来源重钉不单独证明浏览器 tenant 续接或 refresh 已闭环。

W1C-FIXED-TENANT-BFF-C 当前工作树候选：公开 `GET /v1/me` 仅在普通 Product service+Bearer、IAM 在线 admission、固定 tenant guard 成功后读取本次 `RequestContext`，返回 `{data:{user_id,tenant_id},meta:{request_id}}`，无 BFF/IAM 数据库或 Redis 读写。OpenAPI 与 v1 operation baseline 已从 66 增至 67，canonical OpenAPI SHA-256 `75ab482132602bd1d7ce77dbec1423b10d4ce7a8244ad284ecac78cd4e7b50ca`；其他业务/relay 契约不变。相邻真实 BFF/IAM-stub HTTP 与 contract 测试先观察 2 个 RED，额外 GET body 负例再观察 1 个 RED，实施后聚焦 24/24 GREEN；Node22 `pnpm format:check && pnpm check` 通过，contract 27/27、全量 276 pass/1 skip、build 通过。本仓候选尚需 Root 冻结 SHA 审查、Web consumer pin 与真 IAM OAuth same/foreign/revoked 组合；IAM-stub HTTP 不能冒称 IAM 实际撤权链，真实 PG/Redis integration 未运行。

W1C-FIXED-TENANT-BFF-B 当前实现：browser-private policy 已按 breaking 提升至 `2.0.0`，删除 `/organization/list`；`/organization/set-active` 仅在固定配置 tenant、精确 Web Origin/受信服务、非空 issuer session cookie、精确 JSON body 与有界 signed `oauth_query` 均通过时出站，缺/错 tenant 等负例在 IAM socket 前拒绝。policy JSON 由唯一 TS 事实源派生，SHA-256 为 `954ea40e828266488db7cd6bdf5309aab868436de665f22b9608744f51280606`。public OpenAPI、IAM 通用原生 endpoint、BFF Schema/Redis/receipt 不变。相邻 Node 22 真 HTTP 测试先观察 3 个 RED，实施及重新生成 artifact 后 24/24 GREEN；本仓 `pnpm format:check && pnpm check` 通过，contract test 26/26、全量 273 pass/1 skip、build 通过，未运行需要外部 IAM 进程的 `test:iam-relay:integration` 或真实 PG/Redis integration。下面 `1.1.0` 记录为起始已发布基线；Root 已在本仓工作树重跑完整 Node22 门，正式固定 SHA/跨仓组合待 Web 消费后验证。Web 当前仍使用 list/可选选择表单，须在 BFF 发布后原子切换；真 IAM OAuth/Root 来源 pin 尚未验收。

W1C-Team 历史来源级联（BFF-B 前基线）：IAM main `b363554d07e5b6e182160b42ae1402330e55d9db` 仅校正 Team/固定 Product Tenant 三设计与 CURRENT；ingress allowlist SHA-256 `f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`、Better Auth vendor snapshot SHA-256 `b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1` 均未改变。本仓 browser-private policy 仅重钉 IAM commit，version `1.1.0`、路径/方法/头/cookie/限额语义不变；派生 artifact digest `97022ea8727619bae03927027ef6a8ce87a3d2da4580ba5d211dc63b16fdc42c`。Web 消费方与 Root gitlink/库存必须在本仓提交后按固定 SHA 续钉，未完成前不能称来源组合通过。

W1C-FIXED-TENANT-BFF-A：普通 `/v1` 用户在 service + Bearer 检查后若缺 `KOKORO_TENANT_ID` 返回 `503 product_tenant_not_configured`（零 IAM I/O）；IAM 在线 admission 后若受信 tenant 不等固定配置返回 `403 product_tenant_forbidden`。两者在业务 route、body、receipt 与 owner I/O 前终止；同租户保留原有 tenant + subject 私有边界。service-only runtime manifest、Share、Scheduler callback 和 browser-private `/iam` 不经此闸；无 Team 写投影、Schema/索引或 relay policy 变更。Node 22 admission 测试先 2 RED，实施后 12/12 GREEN；Root 在冻结工作树复跑 `pnpm format:check && pnpm check`（全量 272 pass、1 skip）。Root `9f8d8d60` 已以真实 IAM Code+S256 A/C 异租户组合验证三条 Team GET 分别 200/403、自有资源0；这不等于 Web 固定 tenant 登录或 Team 写闭环。

W1D-Chat-B1 当前实现：
Web 本地 `conv_<UUID>` 首条 `POST /v1/sessions/{id}/messages` 已改为在 BFF Chat turn 同一 PostgreSQL
事务内隐式建 active Conversation，并写两条 Message、Agent outbox 与 expected-run registration；
首条内容派生标题。既有 active 会话继续追加；foreign/deleted ID、非候选缺失 ID 与不可见 Project 返回
404。没有新增表或 Agent 协议字段。
真实 PG/Redis 隔离回归与本仓完整门禁以本次执行结果为准，不以本段文字代替验收。

W1D-Chat-B2 已于 BFF main `8dedcb2510d8c5e3917561b9c979e7aa6ce8b8ae` 发布：Agent source 的 assistant delta/completed 与 run terminal 已在 BFF AG-UI
source commit 同一事务中更新 outbox/expected-run 绑定的 assistant Message；多段以最后一段权威正文
表示，中间段 completed 仍是 streaming，run 成功/失败/取消才终态。session snapshot 的 Message 与
AG-UI watermark 使用同一只读 repeatable-read 快照，Message 只取最新 100 条并按 sequence 升序呈现。
当前 run 对 active Conversation 的 outbox/assistant 绑定缺损会使 source/frame/watermark 整事务回滚，
Agent mapper 不再把非字符串 delta/content 强制为空串。Agent owner main
`520ec181a101298b4f336aad273ce003b2735955` 已发布空 `assistant.completed` 的真实 replay；
BFF 已验证草稿→工具→空最终段→run success 后 Message 正文为空，重开 snapshot 与 watermark 同快照。
Node 22 在已创建空 `kokoro_bff` schema 的自有临时数据库实跑 `pnpm test:integration` 42/42，
`pnpm test` 262 pass/1 skip、`pnpm contract:check` 26/26；上述为 B2 发布前实测门禁，不冒充 B3 的当前结果。

W1D-Chat-B3 本提交：Agent HTTP v1.1.0 固定 owner commit
`520ec181a101298b4f336aad273ce003b2735955` 与完整 OpenAPI SHA-256
`2b9c7aad6f38db3e20200b037e4818ae932209ba3deecabf8fc984db6bcec492`；两条生成 operation 的
严格 202/200 success envelope 取代宽松手写接收和裸 body 回退。Node 22 在本提交候选上经 Root 独立复验
`format:check`、`lint`、`typecheck`、`contract:check`（26/26）、`test`（267 pass/1 skip）、
`test:architecture`（27/27）、`build` 与独占临时 PostgreSQL/Redis `test:integration`（42/42）
已实跑通过；vendor 字节篡改会令 drift check 非零。该结果不替代 Root 对固定 gitlink 与真实
Agent HTTP/worker 组合的最终验收。

W1C-Team-R2 本仓源码已在 main `fd74202e69e4d40beaef9d3f9ab9b871365589a8` 发布：IAM owner `68aa0da259df1f1ea9030936b8d5a46acba8c6ab` 的内部 OpenAPI `0.3.0` 已替换旧 `0.2.0` vendor，生成链精确增加当前租户 members/invitations/roles 三 GET，旧 vendor 已删除；BFF public 三 GET、只读 Team 客户端与六项假 IAM HTTP 回归也已提交。当前 IAM `093b76513a9aa71611c65d4f210e279d3227e002` 仍保留 test-owned Web OIDC client 的三个 Team 只读 scope；本仓 relay policy 来源已跟进该 commit，IAM allowlist 与原生快照 digest 未变。Web Team 消费仍未验，不能称 Team 跨仓闭环。

## 已实现事实

### W1C-DB-BFF：固定 PostgreSQL owner schema（待 Root 验收）

- `KOKORO_BFF_POSTGRES_URL` 必须含唯一 `schema=kokoro_bff`；config/installer/runtime Pool 拒绝旧 public 或其他 owner URL，
  实际连接固定 `search_path=kokoro_bff`；readiness 还校验 `current_schema()` 与关键 BFF 表，空 owner schema 或缺表不报告就绪。
  SQL-first `database/schema.sql` 不变。
- 安装器在 owner-scoped advisory lock 和事务内只检查/创建 `kokoro_bff`，以 schema 依赖 catalog 覆盖 table/type/function/collation 等对象；其他 schema 已有表允许，目标非空、重复安装、
  SQL 失败均 fail closed。临时数据库真实测试覆盖 rollback/共存/重试拒绝，运行时独立临时库实测
  `current_schema()=kokoro_bff`、`public` 表数 0、BFF 表数 16；测试自建数据库已清理。
- `schema:check` 仍仅静态检查 canonical SQL，完整 persisted catalog drift 未覆盖；此项不冒称完成。

### W1C-1 本次源码切片：browser-private IAM relay

- R2e-IAM-VERIFY-RELAY 本仓切片在 IAM `093b76513a9aa71611c65d4f210e279d3227e002` 已发布的 allowlist 内，仅向现有 browser-private relay
  增加 `GET /iam/verify-email`，policy version `1.1.0`，生成 artifact 保持只读。相邻 policy/transport 测试
  先 RED 后 GREEN，验证原始 token query、模拟 IAM 原生 302 到固定同源 `/auth/sign-in`，以及上游缺失或
  返回可缓存 header 时 BFF 强制的 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`、外域
  `Location` fail closed，以及错误方法/编码别名/浏览器 Authorization 零上游 socket、Product cookie 不出站。
  BFF 不读写本地 SQL/Redis，也不拥有验证 token；IAM Better Auth 1.7.3 使用有期签名 JWT 与邮箱状态幂等语义。
  真实 IAM 邮件点击、JWT 验证、Web policy 消费、正式账号 bootstrap 与普通 IAB HTTPS 登录仍待 Root/owner
  后续组合，不表示用户当前 3310 可登录。Node 22 在本候选运行 `pnpm format:check && pnpm check` 通过，
  单元/静态测试 270 pass、1 skip；未运行真实 PG/Redis integration。
- 本次源码切片在普通 `/v1` IAM admission 之外，新增由 Web service secret 准入的精确 `/iam` 原生协议 relay；
  runtime 不签发 token、不开 IAM internal API、不读写 BFF SQL/Redis、不过 Product envelope。BFF 本地门已运行，
  仍待 Root gitlink 来源门与真实正向 OAuth 组合验收，因此不表示完整登录已可用。
- 单一 TS 准入事实源为 `src/http/routes/iam-protocol-relay.policy.ts`；`contract/iam-relay-policy.json` 由
  `pnpm contract:generate:iam-relay` 确定性派生，`pnpm contract:check:iam-relay` 拒绝生成 artifact 漂移。
  本次仅重钉 IAM test-fixture owner commit，artifact SHA-256 为
  `731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；policy version、路径、header、limit 与运行时行为未变。
  IAM 私有来源不复制入 BFF；其 digest 与 allowlist 子集留 Root 固定 gitlink commit blob 组合机器门验证。公开 Product OpenAPI
  未改，Web consumer 仍待本仓 SHA/contract digest 冻结后串行实施。
- 精确 endpoint/method、Web origin、server-only Basic/Bearer、issuer cookie、signed interaction redirect、response
  header 与 timeout/cancellation 规则见 `docs/API_CONTRACT.md` 的 W1C-1 节。入站慢 body 与上游共用单一截止，
  超限 response header/body 会取消上游真实 socket；本仓 HTTP 测试覆盖入站超时/取消/header/body cap。
  IAM 本地 fixture 中登录与 issuer Session 原生 HTTP 已通过聚焦测试；Code+PKCE/consent/logout 成功链以及
  完整 Web Auth.js RP、Product Session 和跨仓登录仍待 W1C-1 后续联调及 W1C-2/3。

### 契约治理

- `kokoro-bff` 是唯一 public HTTP Product API owner；canonical OpenAPI 位于
  `contract/openapi/v1/openapi.yaml`。
- 当前 OpenAPI 有 67 个 operation；每个 operation 都声明 owner、visibility、stability、idempotency 和
  permission 元数据。
- `pnpm contract:check` 执行 Redocly、metadata 检查和冻结 v1 path/method/operationId surface 检查。
- AG-UI 是 BFF 对 Web 暴露的 Agent 事件 wire protocol；BFF 使用 `@ag-ui/core` schema 校验输出帧。
- `Last-Event-ID` 是 BFF 为每个持久化 public frame 分配的 `agui_*` opaque cursor；Agent source sequence 不再是
  public resume cursor。
- BFF runtime 的 Capability generated consumer、facade 与四条 canonical route 已实现：accepted owner commit
  `7f89a267d745cbb9870f52d6edb23dec1a3c469b` 的 HTTP OpenAPI `2.0.0` 已作为 immutable vendor input 固定；
  manifest 状态为 `generated`，exact 16-file client、facade、canonical owner routes 与 generation drift gate 已激活。
  固定的 generator `0.99.0` 产物通过生成流水线内固定命中数的 `exactOptionalPropertyTypes` compatibility normalization，
  禁止 TypeScript suppression 或手改产物；drift gate 连续生成两次并验证 byte-identical。升级到原生兼容的固定 generator 版本且
  regeneration、drift、typecheck、build 全通过后删除该 normalization。
  Root `EDGE-BFF-CAPABILITY` 仍为 broken，待 W0B-5 real smoke 与 W0B-6 integration 闭环后才可标记 active；本仓实现完成
  不代表跨仓 edge 已激活。
- IAM session admission 已固定消费 IAM commit `259a66e6a569889c030734f380e99685d8b9e21c` 的完整 OpenAPI `0.2.0`，
  再由 generator scope 过滤出 `POST /internal/v1/session-authorizations/verify` 及引用 schema。manifest 固定 owner digest、
  Node `22.22.2`、pnpm `11.25.0`、generator `0.99.0`、Zod `4.5.4`、lockfile 与 16 个生成文件 digest；drift gate 做
  allowlist、两次 byte-identical generation 与 strict response normalization 检查。

### Library / Storage 历史 degraded boundary（已被上文 W2 文件列表替代）

- 当时 `GET /v1/library` 在 service-envelope admission 后固定返回 `503 storage_integration_unavailable`；未认证请求仍返回
  `403 service_auth_failed`。BFF 不调用旧 `/internal/bff/library`，也不打开 Storage 连接。
- 当时 public OpenAPI 保留 path、method、`listLibrary` operationId 与 metadata，删除不可达 200 以及孤立的
  `LibraryResponse`/`LibraryItem` schema；该历史状态已被上文正式个人文件 success contract 替代。
- 该 503 阶段已结束，但 `EDGE-BFF-STORAGE` 在 Root 全边验收前仍按 `broken`。个人 `kind=file` 已接入
  Storage personal CLEAN ASSET 查询、本人成员准入与单 kind 分页；完整 Library/Artifact 与整边激活仍需 Agent
  trusted Run/ExecutionIdentity、相关 Capability scope、产物列表/下载与双源分页及真实组合验收，不能用
  文件列表 200 代替。

### 当前运行时与持久化

- 普通 `/v1/*` 先校验 `web-bff` 服务身份与共享 secret，再要求唯一 Bearer 并在线调用 IAM；业务 context 的
  namespace/userId 只来自严格验证后的 IAM `tenant_id`/`user_id`。legacy identity headers 不参与身份建立。
- IAM request 无 body/query/redirect/retry/cache，受统一 5 秒与 1 MiB 上限、caller cancellation、合法 request-id 与
  `Cache-Control: no-store` 约束。401/403/429/503 使用稳定 BFF error code；Bearer 不进入日志、receipt、store 或业务 owner。
- Share 和 runtime manifest 只使用 service envelope，不要求或使用用户 Bearer；额外 Authorization header 被忽略。Scheduler
  callback 继续使用独立 Scheduler bearer。production 未配置 IAM origin 时 readiness 与普通用户请求 fail closed。
- Live Project、instruction revision、project skill、project task、ScheduledTask 与 mutation receipt 使用本仓
  PostgreSQL repository。Project 与 ScheduledTask 用户路径均以 IAM admission 的 tenant + subject 为 scope；Project slug 在 owner scope 唯一，
  子事实由父 Project predicate/lock 保护，ScheduledTask 引用 Project 在 task+outbox 事务内重验。Project Redis 列表 cache 与 invalidate 已删除；
  Redis 当前用于 readiness/ping 与 AG-UI 通知，不是业务事实源。
- Live Conversation、Message、Share 使用本仓 `bff_conversation`、`bff_message`、`bff_share` PostgreSQL repository；
  所有私有读写带 tenant + owner predicate；非空 `project_ref` 还必须匹配同 scope Project。资源 gate 在通用 receipt 与 Agent I/O 前执行，
  mutation repository/事务再次校验。删除保留 tombstone，share 撤销/过期后保留记录并只暴露 active/unexpired share。
- Chat session list/detail/message history/title/delete/share routes 不再读取 Agent history。Message create 在一个 BFF
  PostgreSQL 事务中同时写入 completed user message、pending assistant message、`bff_agent_dispatch_outbox` 与预注册的
  AG-UI expected run；HTTP 在本地事务提交后返回 `202`，后台 dispatcher 再通过窄 Agent client 投递。Agent 仍只拥有
  Run/control/source execution events。
- ScheduledTask aggregate 的 `nextRunAt`/`expiresAt` 在 application/domain 内是有效的 UTC `Date`；HTTP/JSON 与
  Scheduler command 使用 RFC 3339 UTC 字符串，`time` + IANA `timezone` 保留本地周期规则。数据库事实使用
  `TIMESTAMPTZ(3)`。
- Live mutation 仅在 BFF business store 已配置时使用 PostgreSQL receipt；没有 business store 的非 BFF owner
  mutation 仍使用进程内 Map。因此“所有 Live mutation 均持久幂等”不是当前事实。
- 当前 receipt scope 是 `namespace + actor + method + canonical path + Idempotency-Key`；fingerprint 覆盖规范化 body，
  但尚未覆盖 query 与 selected headers。
- 独立 `AgUiProjectorRunner` 通过窄 Agent source reader 主动读取 execution source facts；公开 SSE 请求不再访问
  Agent source，只读取本仓 PostgreSQL：
  `bff_agui_source_event` 去重 source identity，`bff_agui_event` 保存完整 AG-UI frame，`bff_agui_stream` 保存
  source high-watermark、projection state、version fence 与下一 public sequence。HTTP 只从该 ledger 输出 replay/live
  frame。
- 每个 public frame 有独立 cursor；一个 source fact 展开为 START+CONTENT 等多个 frame 时，可以从任一 frame 后
  strictly-after 恢复。Repository 查询均携带 tenant + session；不存在于当前 tenant 的 session 先返回与普通缺失资源
  相同的 `404 session_not_found`，当前 session 内未知 cursor 返回 `400 invalid_event_cursor`。
- 投影事务以 stream row lock + version fence 串行化并发写；source event id 与 source sequence 都有唯一约束，digest
  冲突 fail closed。未映射的 Agent event 也登记 source identity 并推进 source high-watermark，避免重复轮询遮蔽缺口。
- Redis 对 AG-UI 只执行 ephemeral `PUBLISH`；发布失败不回滚已提交 ledger，也没有 Redis replay key/stream。终态 ledger
  可在 Agent disabled/unavailable 及 BFF 重启后独立 replay。
- `bff_agui_stream` 同时保存 consumer subject、next poll、lease owner/token/fence、连续失败计数、错误与最后完成时间；
  `expected_run_id` 是最新接纳的 run fence，`latest_run_id` 只记录最近投影的 source run。多个实例使用
  `FOR UPDATE SKIP LOCKED` 领取 scope，lease eligibility/deadline 由 PostgreSQL 时钟计算，worker 只用 monotonic clock
  消耗数据库返回的剩余预算；不同 expected run 的注册会递增 version/fence 并撤销旧 lease，旧 worker或新 lease 补投的
  旧 run 都无法提交 terminal 或覆盖 settlement。message/tool state
  以 run identity 隔离，任一终态只清理所属 run。source read 在
  lease deadline 内使用显式 attempt budget；timeout/connection/429/5xx 等瞬时错误跨 claim 执行 capped exponential
  backoff + jitter，并在配置上限内尊重 `Retry-After`；成功后清零失败计数。契约、identity、source gap 预算耗尽、
  401/403、410、非法 4xx 或过大响应进入可诊断 blocked 状态。
- 后台 GC 使用 `latest_run_start_sequence` 作为安全边界，只删除该边界之前且超过 retention 的旧 run frame，保留
  从最新 `RUN_STARTED` 到当前 head 的完整 run slice；没有可靠边界或 suffix 包含找不到同 run `RUN_STARTED` 的交错
  frame 时跳过该 stream。回收前先把 frame cursor 写入
  `bff_agui_cursor_tombstone`，再推进 retention floor。tombstone 窗口内重连返回 `410 event_cursor_expired`；窗口
  结束后按未知 cursor 处理。
- ScheduledTask create/update/delete/retry 以 tenant + subject scope 先在同一 PostgreSQL 本地事务写入 task revision 与
  `bff_scheduled_task_outbox` command；事务提交后由 bounded dispatcher 在事务外调用 Scheduler。command 保留
  `tenant_id`、`actor_id`、`request_id`、`idempotency_key` 和版本化 task snapshot；稳定 task id 绑定 tenant、subject、path、key，并以 `SKIP LOCKED`、lease token、
  fence、指数退避、重试上限和 `pending/leased/retryable/succeeded/failed` 状态恢复。Scheduler dispatch receipt 仍使用
  旧 compact occurrence idempotency key；与 pinned Scheduler producer 尚未闭环。
- Chat → Agent dispatcher 使用稳定 run/message/idempotency identity、`FOR UPDATE SKIP LOCKED`、lease token/fence、
  有界 attempt 与指数退避执行 at-least-once 投递。BFF 或 Agent 重启不会丢失已接纳命令；过期 lease 可重新领取，旧
  worker 和跨 tenant settlement 都不能覆盖当前结果。明确永久失败会把 provisional assistant message 标记为 failed。
- Agent 自有 wire protocol 不在本切片改写；若其事件边界使用 epoch milliseconds，BFF 将其视为 wire encoding，AG-UI
  projection 的内部时间仍在边界解析为 UTC instant。
- 缺失 BFF store、非法请求/响应和未接写操作会返回稳定错误；ScheduledTask 在 Scheduler 缺失时仍可提交本地
  fact+outbox，外部 command 保持 retryable，不伪造 Scheduler 已成功。
- 当前 runtime 通过唯一 Capability facade 调用四个 canonical owner GET；Skills 只接受 `query,tags,scope_kind,limit,cursor`，
  MCP 只接受 `provider_key,limit,cursor`。旧路径、搜索 alias、handwritten compatibility fallback 均已删除；未知或非法
  query 在出站 I/O 前返回 400。5 秒 timeout、1 MiB response cap、单次尝试、generated success/error 校验与稳定 502/503
  映射已经由 focused test 锁定。

## 未完成缺口

### P0：运行时正确性

1. **Chat assistant message reconciliation 已发布 BFF 单仓实现，Root 组合仍待验收。** W1D-Chat-B2 BFF main `8dedcb2` 已加入 source event →
   `bff_message` 同事务回写，含 Agent owner 已发布空终帧的消费测试；Root 须在 BFF 集成版本重跑
   真实 PG/Redis、静态及契约门。AG-UI ledger 与 BFF Message 仍是不同事实，不从 ledger 临时拼出产品 Message。
2. **事务型 outbox 仍按 owner/切片分阶段。** ScheduledTask → Scheduler 与 Chat → Agent 的 bounded outbox 已实现并有
   真实 PG integration；Project side effect，以及 mutation receipt claim 与 aggregate/outbox 的统一事务仍未完成。两条
   外部投递均是 at-least-once，依靠稳定 command identity 与带 fence 的条件 settlement 收敛。
3. **幂等摘要与事务边界不完整。** query、selected headers 未进入 fingerprint；receipt 与业务事实/出站命令
   没有统一事务和 fencing。
4. **AG-UI 跨版本重投影与备份恢复演练仍未完成。** 主动 consumer、lease/fence、retention floor、frame GC、cursor
   tombstone 与 expired-cursor 错误已经实现；尚缺 projection version 升级策略、生产 PG restore 演练和长时故障注入。

### P1：架构与工程门禁

- `src/application/agui/` 已形成 projection use case、source/consumer ports 与独立 runner；具体 Agent client、PostgreSQL
  ledger 和 consumer/GC 实现位于 `src/infrastructure/`，启动装配位于 `src/bootstrap/`。
- Mock、fixture 与 route test doubles 只在 `test/`，不编入生产产物。
- TypeScript strict、`exactOptionalPropertyTypes`、`noImplicitReturns`、`noUnusedLocals`、`noUnusedParameters` 与
  `useUnknownInCatchVariables` 均已启用。
- canonical schema 中所有瞬时点已统一使用 `TIMESTAMPTZ(3)` 与 `CURRENT_TIMESTAMP(3)`；部分既有 constraint/index
  命名，以及 receipt/outbox retention 仍待后续切片处理。
- `ProjectInstructionRevision` 当前仍暴露 `updatedAt`、`actorName` 和 Unix milliseconds；这是已知 wire-naming/
  UTC 违例，需与 runtime mapper、Web consumer 和 OpenAPI 同一切片删除，不能只改文档伪造 snake_case。
- CI 尚未提供真实 PostgreSQL/Redis service gate、fresh-schema 安装、固定 SHA actions 与完整供应链扫描。
- Docker base digest、HEALTHCHECK、SBOM/provenance/signature/vulnerability scan 尚未在本阶段处理。
- `.env.example` 已固定共享本地 PostgreSQL 端口与 Redis logical DB 8；CI 的隔离 service 端口由 workflow 显式覆盖。

## 本阶段闭环边界

本阶段闭环 BFF-owned Conversation/Message/Share、Chat → Agent transactional outbox、独立 durable AG-UI source
consumer、lease/fence、retention/GC、expired cursor 与当前工作树的 assistant message reconciliation。它不拥有 Agent Run，也不扩展到
完整 IAM permission enforcement、projection 跨版本重建或生产 telemetry。

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
KOKORO_BFF_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' pnpm db:apply-schema
KOKORO_TEST_POSTGRES_URL='POSTGRES_URL?schema=kokoro_bff' \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

未提供 PostgreSQL/Redis fixture 时，后两项状态是“未执行”，不是“通过”。验收状态见
[`ACCEPTANCE.md`](./ACCEPTANCE.md)。

## Scheduler W0B-9 BFF 实现

Scheduler manifest 状态为 `generated`，固定 owner commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e`、version `1.0.0`、SHA-256
`6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`。16 个 generated 文件由
`contract:check:scheduler` 在临时目录连续生成两次，校验 exact allow-list、byte-identical 与 manifest digest。

BFF ScheduledTask outbox 已改用 generated create/replace/delete control client 与 canonical Schedule 路径、header、稳定错误码；
daily/weekly cron 从本地 wall time 与 IANA timezone 映射。dispatch receiver 先通过 generated webhook Zod 校验 exact header/body，
再校验 trusted header tenant 与 body tenant 完全一致，并使用 RFC3339Nano canonical occurrence、递归 canonical JSON semantic digest。
generated 校验只决定接纳，不用其 transform 后对象建立摘要；receipt 使用已验证的原始 parsed JSON 全部 own keys，递归拒绝非有限数字。
opaque key 不 trim，只进入独立协议 scope。control client 对 response body 逐块计数，超过 hard cap 立即 cancel/abort，不先缓冲整包。

专用 Scheduler receipt repository 复用现有 `bff_idempotency_receipt` 与连接池：digest 首次绑定后不可替换，60 秒数据库时钟 lease、
claim token CAS、不可变首授权 launch snapshot、425 active pending、409 different digest、terminal replay 与 response-unknown 恢复已实现。
claim/prepare/finalize/release 均先取得目标 row lock，再读取 `clock_timestamp()` 判断 deadline；claim/prepare 返回数据库剩余预算，
Scheduler Agent 调用以进程内 monotonic elapsed 扣除固定 settlement reserve，独立于可配置的普通 upstream timeout。
Scheduler Run identity 只依赖 trusted tenant、schedule 与 canonical occurrence；普通 Chat identity 未改变。真实 PostgreSQL integration
覆盖并发 claim、短 row-lock 等待后的完整新 lease、等待期间过期的 prepare/finalize/release fencing、tenant isolation 与 response-unknown。
真实 PostgreSQL + BFF HTTP + Agent stub integration 覆盖 Agent 接纳后 finalize 失败、关闭并重建 BFF、数据库 task 与 transport request ID
变化后按原 key 重发首次完整 snapshot/Run，以及 stale prepare 零 Agent I/O；stub 调用次数不代表真实 Agent durable Run 事实。

`EDGE-BFF-SCHEDULER` 与 `EDGE-SCHEDULER-BFF` 仍保持 broken；本仓完成只证明 BFF/PG 行为，待 W0B-10 真实 Scheduler + BFF +
Agent receipt stub smoke 与 W0B-11 Root 集成后再激活。真实 Agent admission、同 Run 参数冲突及 Agent 重启后唯一 Run 事实归
后续 Agent-owner closure（W4）；`EDGE-BFF-AGENT` 保持 broken。

## Platform Connect Proto 消费准备（2026-09-28）

当时已从 Platform main `f26d147a09350c3a041722107d277beb93eaad60` 精确固定两份 `kokoro.platform.v1` Proto，使用本仓固定 Buf/Protobuf-ES/Connect 版本生成独立客户端类型。`contract/dependencies/platform-connect.json` 记录原始 SHA、生成器、lockfile 与 build policy；`pnpm contract:check:platform` 两次生成并核对字节。此片当时仅证明 wire/descriptor 可独立消费。后续 BFF `2a95da2410fd89c300dc18064867ee66617549e2` 已重钉新 owner commit、完整 inactive v3 artifact，并实现离线 projector/JCS；当前仍未实现 machine credential、runtime route 或真实 owner 调用，既有 Capability HTTP GET 继续单独运行，因此不能把生成客户端视为 Product CreateDraft 闭环。

## W2 项目资源单文件上传（待 Root 审查/真实集成）

基线 BFF `61b8074ba0264a77496fee8bcb475def46430a63`，Storage `094847da9f4f03e5f3dbda06658430c74bc32f54`。本片替换 resources 503 stub，保持 multipart files 请求形态，限制为单文件 / 1 MiB；多文件、Library、Skill package、chat 关联不在范围，零 Schema 变化。

W2 本片已实现单文件 route、native multipart、有界 ConnectRPC/presigned PUT、terminal create checkpoint 与最终 receipt。固定 Storage owner `094847da9f4f03e5f3dbda06658430c74bc32f54` 的两个 Proto；新增唯一依赖 `@connectrpc/connect-node@2.2.0`（peer Connect 2.2.0、protobuf ^2.7.0，与 2.14.0 兼容）。配置为 `KOKORO_STORAGE_RPC_BASE_URL` + `KOKORO_BFF_STORAGE_SECRET` + `KOKORO_STORAGE_OBJECT_ORIGIN`，旧 Storage HTTP 环境变量仍被忽略。新增测试覆盖 HTTP→Connect→PUT、最终 receipt 失败恢复与当前项目权限先于 replay；测试 owner/对象服务是进程内 double，不是 Storage 集成。Node 22 format/lint/typecheck/contract/build/schema 门已执行；最终测试数量以本次交付报告为准。Root 待验真实 PostgreSQL + Storage + ObjectStore，未运行共享基础设施。

W2 审查修正：项目资源成功态收窄为 CLEAN。INFECTED 为稳定不可重试 422；PENDING/UNKNOWN 为可重试 503。Complete 和 GetAsset 都执行该检查，负例验证不返回资源/引用且同 key 不重复创建资产。

## W2 项目资源持久 GET（当前实现，待 Root 真实组合验证）

基线 `main 199a183`；固定 Storage owner `ef0fd7779bf434120ac1f8a58592222f534a7c45`，published combined SHA-256 `05c6ef390c06b512218520b44e76d2d3212630df574a4fd63b6238b05631189f`。原 vendor pin 已替换并由本仓 Buf 连续两次生成一致，旧 owner vendor 删除；无依赖升级、SQL/Schema/receipt修改。

新增 public GET `/v1/projects/{projectId}/resources`：每页先按可信tenant/subject查当前私人Project owner，canonical id入Storage project scope；未授权/不存在404且零Storage调用。默认limit50（1..100），opaque cursor上限4096；只返回ASSET/CLEAN metadata、next_cursor及既有RequestMeta，不含upload_id/URL。坏查询400、坏owner页502、依赖失败503，不降级空列表。空项目200空items。公开OpenAPI、baseline、生成drift与负例同步；POST/checkpoint保持原行为。

聚焦测试覆盖HTTP→Connect分页、跨project/subject、cursor拒绝、owner故障/坏页、当前授权与GET/POST元数据一致；owner transport在测试中是double，不算真实Storage/PG集成。Node22 format/lint/typecheck/build全部通过；contract 40/40，test 328通过/1跳过，schema 5通过/1跳过，Storage生成/check均两轮字节一致。当前未提供隔离 KOKORO_TEST_POSTGRES_URL/REDIS_URL/POSTGRES_ADMIN_URL，故未运行真实PG integration；真实Storage/PostgreSQL/ObjectStore/Web刷新组合由Root后续串行验证，Web consumer仍属后续片。

### T-K03.4 BFF main signal lifecycle（2026-10-09；候选待 Root 提交/重载）

基线 `49b555c227edd24f7ba2497bf6732a2597bb982e` 的 server 已有有序 shutdown，但 main 未接 SIGINT/SIGTERM。本候选只接线既有 `shutdown(30s)`，关闭中重复 signal 不提前终止；成功自然退出 0，同步/异步失败固定安全错误 exit 1，referenced 31s deadline 对永不 settle 提供有界失败终态。deadline 强退不冒充资源 drain。现有真实 HTTP/worker/store 顺序用例保持，新真实 Node 子进程覆盖两种 signal、重复 signal、拒绝及永不 settle。

Node 22 候选实测：lifecycle 6/6；format、lint、typecheck、build 均 exit 0；contract 704/704；默认 1303 tests、1300 pass、0 fail、3 既定 skip。本片不改 contract、SQL、权限、owner、配置或关闭预算，未操作正常 session 9724、服务或数据；Root 提交、正常重载及运行 PID 验收仍待执行。
## R357 Local Skill import package phase projection

Platform `SkillPackagePhase.VALIDATED` 现在由既有 Skill Product response mapper 显式投影为 public
`package_phase: "valid"`，与 canonical OpenAPI 的既有闭集一致。mapper 不再机械小写 owner enum；没有 public
Skill record 对应值的 `UNSPECIFIED`、`INTENT` 及未知值 fail closed。Finalize 与 completed Get 共用该 mapper，
不改变 Platform wire、public contract、权限、幂等、SQL 或预算；正常服务重载和既有 intent 恢复由 Root 执行。
## T-K03.4 exact Skill download BFF源码候选（待Root验收）

基线`e380066`。BFF现候选保持参考DownloadSkill的series-current语义，并新增三条browser-private exact准备动作；closed qualifier区分catalog current、installation、managed version与share，统一现60秒/128容量opaque handle及字节spool前后资格确认。private policy由`skill-download.policy.ts`唯一生成；public/generated/Platform contract及SQL不变。Node22候选工作树实际门为focused 87 PASS、contract 715 PASS、默认1311 PASS/0 FAIL/3 SKIP，format/typecheck/lint/build均exit 0；基线隔离真HTTP对installation准备动作返回404，证明新行为原先不存在。以上仍待Root独审、正式提交、服务重载与Web消费，不能宣称正常浏览器下载完成。

<!-- R357-BFF-EXACT-SKILL-DOWNLOAD-CURRENT-END -->


## Connector command 恢复错误消费候选（2026-10-16，未正常启用）

Platform Connect 固定 ac56a1f8e9491e3e8383bff833b0f9f771fae3b1 receipt error profile/provenance并正规生成，旧vendor删除；Public14.8/139、Proto与HTTP独立pin未变。窄错误mapper/私有恢复policy区分原receipt状态和MCP原生OAuth三项typed原因，拒绝未知/重复/错码/混合/read marker；不按message猜、不自动重放或新key。原server-response错误export删除并移至对应client错误边界，无alias。code-first profile正规发布为只读JSON，App尚未消费，正常服务无watch/未重启。

原unknown被误报generic retryable及原生OAuth typed原因被丢失均实际HTTP RED后修复；真实两个HTTP hop使用production Connect client确认expired不被旧typed-detail guard误报502。HTTP/SDK是真实传输，owner/凭据/IAM仍为受控fixture，不冒真实receipt DB、正常用户或第三方授权。完整门禁、独审与最终commit由Root有效计划收口。
