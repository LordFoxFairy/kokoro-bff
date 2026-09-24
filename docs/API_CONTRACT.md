# kokoro-bff API contract policy

## W1C-FIXED-TENANT-BFF-B：browser-private relay breaking policy

**当前态（BFF `dadf9264`）：** relay policy `1.1.0` 仍公布 `GET /iam/organization/list`，且 `POST /iam/organization/set-active` 在通用 service/Origin/cookie/body size 检查后把任意 JSON 透传 IAM。下面 W1C-1 原始表记录的是该已发布基线，不是固定租户目标。

**目标态：** policy `2.0.0` 删除 list，无 alias/fallback；set-active 仅供受信 `web-bff` 服务以配置的精确 Origin 调用。请求 URL 不带 query；入站须有合法且非空的 issuer `session_token` cookie，不能用 Product cookie 代替。`Content-Type: application/json`；body 是恰好两个 key 的 JSON object：`organizationId` 为与服务端 `KOKORO_TENANT_ID` 精确相等的非空 string，`oauth_query` 为无前导 `?`、不超过 policy `maxQueryBytes`、无控制字符/反斜线/畸形 percent escape 且恰有一个非空 `sig` 的原始 continuation query。BFF 保留原始 query 字节给 IAM，不自行验证或重签 `sig`。缺固定配置返回 `503 product_tenant_not_configured`；未知 path/method 包括 list 返回 404；其余本地拒绝为稳定 400/403，统一 `x-request-id`/`Cache-Control: no-store`，且均零 IAM socket。IAM 原生响应、权限和验签语义保持原样，BFF 不新增公开 `/v1` operation、幂等 receipt、分页或事件。Web 必须按固定 BFF commit/digest 切换消费者；跨仓切换前固定租户登录尚未闭环。

## W1C-FIXED-TENANT-BFF-A：普通 Product admission 的固定租户错误

普通 `/v1` 用户操作保留既有 service envelope、唯一 User Bearer 与 IAM 在线 session admission；服务身份或 Bearer 格式先失败。`KOKORO_TENANT_ID` 未配置时在 IAM I/O 与业务处理前返回 `503 product_tenant_not_configured`；IAM admission 成功但其受信 `tenant_id` 与固定部署租户不相等时，在 route/body/idempotency/owner I/O 前返回 `403 product_tenant_forbidden`。两者使用现有错误 envelope、`x-request-id` 与 `Cache-Control: no-store`，不回显任何租户 ID；IAM 自身 401/403/429/503 仍按既有映射，不能由 header/query/body 提供另一租户值覆盖。Team 三 GET 与其他普通 Product 操作共用此闸；这不是 IAM Team 写 permission 的替代品。Share、runtime manifest、Scheduler callback 与 `/iam` browser-private 原生协议各守其独立服务边界，不应用此普通用户租户错误。当前 public OpenAPI 的 403/503 通用错误响应不新增 operation 或字段。

## W1C-Team-R2：已实现、待真实 IAM 组合验收的公开只读契约

IAM owner 内部 OpenAPI `0.3.0` 固定于 `68aa0da259df1f1ea9030936b8d5a46acba8c6ab`；BFF public OpenAPI 是 Web/开发者唯一 Product 契约。`GET /v1/team/members|invitations|roles` 使用现有 service + User Bearer 准入，tenant 从 IAM admission 结果取得；唯一查询为 `limit` 与 `cursor`，默认 25、范围 1..100、cursor 最长 2048。成功 `{data:[...],meta:{request_id,next_cursor}}`，资源项字段与 IAM 0.3.0 一致，不复制 IAM 的写操作。错误明确区分本地非法分页 400、IAM 身份/权限拒绝 401/403/404、限流 429 与依赖/契约失败 503/502，`Retry-After` 只在合法且有界时保留；所有响应带 `x-request-id` 和 `Cache-Control:no-store`。public schema 与运行时在同一未提交切片，假 IAM HTTP 六项已通过；真 IAM scope/权限及 Web 消费仍待组合验证，不将当前工作树视作已发布接口。

## 事实源与可见性

[`../contract/openapi/v1/openapi.yaml`](../contract/openapi/v1/openapi.yaml) 是本仓唯一字段级机器事实源。
`docs/api/` 只解释资源和生命周期；Root 只发布 catalog/reference，不保存可编辑镜像。

BFF 是 Kokoro 唯一 `public` HTTP owner。Browser 仍必须经 `kokoro` same-origin adapter 调用；“public”不表示浏览器
持有服务 secret。IAM、System（含 model-catalog）、Billing、Capability、Storage、Agent、Scheduler 和 Music 的接口均为各 owner
自己的 internal contract，BFF 只发布重新投影后的 Product API。

## W1C-DB-BFF 数据库连接边界（源码已实现；待 Root 验收）

当前 BFF `cd1c2600ea2a6e0716b07628822a49653964675a` 的 PostgreSQL 连接未固定 owner schema，安装器只检查
`public`；这不是单库组合的已验收状态。目标为同一应用数据库和账号下的固定 `kokoro_bff` schema，连接 URL
显式 `schema=kokoro_bff`，运行时及安装器独立校验并固定 search_path；误指向 `public`/其他 owner 拒绝。
这是仅限 BFF 数据边界的配置与安装契约，不改变本仓 public OpenAPI、`browser-private` IAM relay policy、
内部 HTTP/RPC wire、version、错误 envelope、generated client 或消费者 pin。数据库 URL 不从浏览器请求、
Header、tenant 或 actor 推导；其他 owner 的 schema 仍只能通过其公开 API/RPC 访问。

## W1C-1 `browser-private` IAM relay（本次源码切片；待组合验收）

起始 BFF commit `6238599667110fbfbc2d5ef3a9d53731f2623cfe` 的 `/iam/*` 返回 404；本次源码切片已实现下述
BFF transport 准入，但仍待 Root gitlink 来源门与真实正向 OAuth 组合验收，不表示登录已可用。它不是 BFF public Product `/v1` operation，不在
`contract/openapi/v1/openapi.yaml` 复制 IAM 字段或伪造 OAuth schema。IAM 是 native OAuth/OIDC 与 Better Auth
wire owner；BFF 只决定 Web adapter 可经 relay 访问哪些固定 path/method，以及如何处理 HTTP 安全边界。
机器证据由唯一手写 `src/http/routes/iam-protocol-relay.policy.ts` 经确定性脚本派生只读
`contract/iam-relay-policy.json`（该历史切片初始 policy version `1.0.0`，当前为 `2.0.0`；IAM 固定 commit/allowlist/snapshot SHA-256、下面的
path/method、请求/响应 header、cookie/redirect 策略）。它是 `browser-private` BFF 自有准入策略，不是
IAM OpenAPI/Better Auth schema 副本；手写 TS 与 JSON 不双向编辑。`pnpm contract:check` 重生 policy JSON
字节并拒绝漂移；IAM 私有 allowlist/snapshot 不复制入 BFF。Root 独立组合机器门从固定 IAM/BFF gitlink commit
blob 验证两份 IAM digest、relay path/method 子集及 BFF artifact，含篡改负例；该门通过前 W1C-1 不验收。
Web 以固定 BFF commit + 此 artifact blob/SHA-256 digest 保存只读 vendor 输入，并运行 consumer test 比较
Web route policy 与 BFF 已发布矩阵；不能只看本页 Markdown 或松散版本范围。

固定上游来源为 IAM main `b363554d07e5b6e182160b42ae1402330e55d9db`，
`src/modules/auth/ingress/auth-routes.constants.ts` SHA-256
`f63dacfa8a7bcec3c56efb8ffb762a3f8bd82bb380eff40a1462db1e77d61ead`；原生 schema 快照
`contract/vendor/better-auth.v1.7.3.json` SHA-256
`b2eac1919e16fdc30a40bee0f3c4300b641bd8f674214aea7731bf10299559e1`。下面集合**比 IAM allowlist 更窄**；
升级或增加 endpoint 必须重新固定 owner commit/digest、逐项审查用途/方法、运行真实 IAM HTTP，不从 vendor snapshot 自动开放。

| BFF `/iam` 精确相对路径 | 方法 | 本片用途与 caller | 额外身份/载荷边界 |
| --- | --- | --- | --- |
| `/.well-known/openid-configuration`、`/.well-known/oauth-authorization-server`、`/jwks` | GET | Auth.js discovery/JWKS，Web server 或受控浏览器同源读取 | 无用户 Bearer、无 cookie mutation |
| `/oauth2/authorize` | GET、POST | Code+S256 PKCE，Browser 经 Web | issuer cookie；唯一 `resource` 和注册 client/redirect 由 IAM 检查 |
| `/oauth2/token` | POST | Auth.js server-only code/refresh exchange | 仅受信 Web server 生成 `client_secret_basic`；浏览器 Basic/Bearer 在 Web ingress 剔除；无 issuer/Product cookie |
| `/oauth2/userinfo` | GET | Auth.js server-only claims fetch | 只转发 Web server 所持 user-delegated Bearer；浏览器 Bearer 不透传 |
| `/oauth2/revoke` | POST | Auth.js server-only refresh/access revoke | 只接受 Web server 生成的 client Basic；无浏览器 Authorization |
| `/oauth2/end-session` | GET、POST | RP logout，Browser 经 Web | issuer cookie/ID token hint 由 IAM 验证，post-logout URI 精确注册 |
| `/oauth2/end-session/confirm` | POST | 仅 IAM 原生 logout 确认续接 | issuer cookie + 同源 mutation 检查 |
| `/sign-in/email`、`/sign-out` | POST | Web 登录页/退出 issuer Session | issuer cookie（如有）及 IAM Origin/CSRF；Product Session 独立清理 |
| `/get-session` | GET | Web 登录页/tenant/consent 当前 issuer Session | 只读取 issuer cookie，不建立 BFF Product identity |
| `/organization/list` | GET | `1.1.0` 历史基线；`2.0.0` 已删除 | 当前 relay 返回 404，零 IAM socket |
| `/organization/set-active` | POST | 固定 tenant OAuth 续接；不提供选择器 | 以本页 W1C-FIXED-TENANT-BFF-B 的精确输入准入；IAM 继续原生验签与 Session/成员校验 |
| `/oauth2/consent`、`/oauth2/continue` | POST | Web consent/authorize 续接 | issuer Session、原生 consent/reference 校验 |

本片**不开放** IAM allowlist 中的 `sign-in/magic-link`、`magic-link/verify`、注册/邮件验证/密码重置、其他 Session
管理、organization create/get/update/member/invitation/role 写入、`oauth2/introspect`；旧 Web magic-link/team-session
直连不会借 relay 换路径恢复。`/internal/v1`、`/iam/v1`、admin、匿名 dynamic client registration、client/resource CRUD、
未知/编码 alias 均拒绝。若真实 Web 登录/consent 证明上表缺少 IAM **已发布**的具名路径，只能单独评审并加测试，
不能改成通配 relay。

所有路径由 Web 同源 adapter 用 `x-kokoro-service: web-bff` 与固定 BFF shared secret 调用；BFF 先验此服务身份，
再在原始 request target 上对 path+method 精确匹配。缺/错服务身份 403，未配置服务凭据 503；未知、不规范 path
或错误方法统一 404，均不得形成上游 socket。禁止 percent-encoded slash/dot、大小写/双斜线/尾斜线别名、绝对 URL、任意 Host/Forwarded
改向及 CRLF。BFF 不能凭 Web service secret 证明 Basic/Bearer 在 Web 入口的原始来源；Web 必须移除浏览器 Authorization，
只有 Web server 的 token/revoke/userinfo 分支可生成/传递上述精确 credential。BFF 不持有 OAuth client secret，
也绝不把 service secret 发给 IAM。

浏览器 cookie mutation 须带精确配置的 Web Origin；Web adapter 自行验证同源 CSRF 证据，BFF 复核 Origin，IAM
继续执行原生 Session/CSRF/权限规则。Web server-only token/revoke 不复用浏览器 mutation 分支；只有预先定义的
protocol request-id 可传输，不把浏览器任意身份、forwarded host 或自报 tenant/actor 当作 authority。

只转发原生协议必要的 query、Content-Type/Accept/Origin、body 和 IAM 固定版本的**精确 cookie 名称**：
`kokoro-issuer.session_token`、`kokoro-issuer.session_data`、`kokoro-issuer.dont_remember`、
`kokoro-issuer.session_token.oauth_logout_confirmation`（生产对应 `__Secure-` 前缀）；若真实 IAM fixture 证明
需要清理 `session_data.<非负十进制整数>` chunk，仅准入该数字后缀。这里不是 `kokoro-issuer.*` 通配。
拒绝重复或畸形 cookie，不转发 Auth.js/Product Session cookie。响应只回传合法 issuer `Set-Cookie` 多值（不折叠）、
必要原生 header、status、body；普通 issuer cookie `Path=/iam`，logout confirmation cookie **仅**允许
`Path=/iam/oauth2/end-session/confirm`。全部 cookie 要求 `HttpOnly; SameSite=Lax`、host-only（无 Domain），生产另要求
`Secure`；不接受其他 Path、域或名称。该例外来自 IAM 当前锁定的 OAuth Provider 1.7.3 logout confirmation 原生行为，
必须以真实 HTTP 断言，不能因简化 cookie filter 而破坏合法 logout。
`Location` 只可指向固定公开 issuer origin 下已批准的 `/iam` GET 路径、Web `/auth/sign-in`、`/auth/select-tenant`、`/auth/consent`，
或事先配置且经 IAM client 注册的**精确** Auth.js callback/post-logout URI。三种 Web 交互页上的 IAM 原生
authorize query 含 `sig`、`ba_iat` 与重复 `ba_param` 等动态签名参数；callback 也带动态 code/state/iss。
BFF 只固定实际 `Location` 的 origin/path，并对 raw query 做 ≤8 KiB、合法结构与 CRLF/控制字符检查；合法原生
query 原样保留，不解析重排、不消费/伪造 IAM 签名，也不把其中的 `redirect_uri` 当作另一个 HTTP 目标。
Web 续接原样传回 IAM，由 IAM 验签；不允许任意外域、任意 Web path、未注册 redirect、fragment、
scheme-relative 或 userinfo。IAM 原生 OAuth/Better Auth body/error、表单、redirect 和 cache header 不套 BFF
Product envelope，也不重写合法 Location。IAM 原生 429 的合法有界 `Retry-After` 保留；logout HTML 的
`Content-Security-Policy`、`X-Content-Type-Options`、`Pragma` 经严格值校验后保留，hop-by-hop headers 仍剔除。
BFF 自有拒绝/依赖错误可用脱敏稳定 code 与 `x-request-id`/`Cache-Control: no-store`，绝不透出 upstream URL、token、cookie。

仅固定 `/oauth2/end-session` GET 在 BFF 内部合成 `Sec-Fetch-Mode: navigate` 以保留 IAM 无 hint 的原生浏览器确认语义；
客户端提供的同名 header 不参与此决定且不透传到其他路由。此服务端传输细节不扩展 browser-private 请求 header allowlist。
上游固定 IAM origin，单次有界 I/O（不自动重定向、不重试、不缓存）；入站 body 与上游 headers/body 共用单一
timeout ≤5 秒，响应 ≤1 MiB，且不超过更小的现有 BFF upstream 配置；请求 body ≤64 KiB、headers ≤16 KiB，
断连或上游 header/body 超限即 abort/cancel 真实 socket/reader 并清理资源。IAM 不可达、超时、超限和非法响应
统一 fail closed 为 502/503；本地拒绝零 IAM socket，响应后恶意 Location/Set-Cookie 允许一次 IAM socket 但值不可
出站；全部 relay 路径零 BFF SQL/Redis/receipt/outbox。普通 `/v1` 仍执行已有 IAM 0.2.0 在线 admission，
Share/runtime-manifest/Scheduler 各自服务例外保持不变。只有 W1C 真进程测试通过后，本节才转为当前 contract；
完整 `EDGE-WEB-BFF` 仍待 Product generated consumer 与 AG-UI 单协议另片验收。
真实 IAM HTTP 正向测试必须覆盖三种交互页签名 query 续接、429 `Retry-After` 与 logout HTML 上述安全 header，
不能只用手工 stub 假设协议值。

### R2e-IAM-VERIFY-RELAY 增量（本仓已实现，待 Root 验收）

IAM owner `093b76513a9aa71611c65d4f210e279d3227e002` 的固定 ingress allowlist 已发布原生
`GET /verify-email`；起始 BFF `eb1eb2926d08b8a3779898b2c31e604a8585ec8b` 的
`src/http/routes/iam-protocol-relay.policy.ts` 和派生 `contract/iam-relay-policy.json` 均无此项。
上表“本片不开放邮件验证”描述 W1C-1 已实现的旧范围；R2e 本仓切片**只**从该范围中增加
`/iam/verify-email` 的 GET，不增加 POST/别名、不更新 public `/v1` OpenAPI、不复制 Better Auth 字段 schema。
policy version 由 `1.0.0` 升为 `1.1.0`，生成 artifact 仍为只读。
本次来源级联只重钉 IAM test-fixture commit，当前 artifact SHA-256 为
`731735ba8ce07c578fe04fa51783a95c7ac7daf50df33cea0ef9cefedc32d032`；路由、header 和限额语义未变。
Web 须在 BFF policy 发布后固定其 commit/blob digest，才能增加同源入口；IAM 是 token 和验证结果唯一 owner。

| BFF browser-private 请求 | 原生效果与约束 |
| --- | --- |
| `GET /iam/verify-email?<raw-query>` | BFF 按现有服务 envelope 与原始 path/method 准入，透传有界原始 query；IAM 校验 Better Auth 1.7.3 的有期签名 JWT `token`，邮箱已验证状态幂等，并决定原生结果。BFF 不解析/重排/记录 token，也不从 query 的 `callbackURL` 选择上游或重定向目的地。错误方法、编码 alias、越界/畸形 query 在出站前拒绝。 |
| IAM 原生响应 | 保留原生 status、已允许 header/body 和合法独立 `Set-Cookie`；302 仅接受实际 `Location` 指向固定 Web origin 的已批准 `/auth/sign-in`，或现有允许的精确 issuer GET/Web callback/post-logout 目标。`callbackURL=${WEB_ORIGIN}/auth/sign-in` 由 IAM owner 的初次开通流程指定；其 query 字面值自身不构成 BFF 的 `Location` 授权。对该 GET 的上游响应无论缺失或带可缓存的 `Cache-Control`，BFF 均固定输出 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`；自有拒绝/上游失败仍返回脱敏稳定 code、`x-request-id` 与 `Cache-Control: no-store`。不自动跟随 redirect、重试或缓存。 |

GET 仍拒绝任意 `Authorization`，只筛选既有 issuer cookie，绝不把 Product Session cookie 或 Web service secret
送往 IAM；现有精确 Origin、request/response header、body、timeout、大小上限、取消和非法 `Location`/`Set-Cookie`
fail-closed 规则不变。验证邮件 raw query、token、原生响应 body/Location 不进入 BFF 日志、缓存、receipt、
数据库或 Redis；IAM 原生失败/过期/重复使用的具体状态由 IAM 决定，BFF 不改写为 Product envelope。
`/sign-up/email`、`/send-verification-email`、组织创建/写入和通配 `/iam/*` 继续不开放。首次正式账号与固定
tenant 的受控 bootstrap 由 IAM owner 独立完成；一次邮箱验证成功是必要条件，不代表 Product Session、
OIDC client、tenant 成员或完整 R2e 登录入口已完成。本仓 policy/transport 测试已覆盖模拟 IAM 的
302/no-store/no-referrer 及外域、编码、错方法负例；真 IAM 邮件点击、JWT 校验与完整登录仍待 Root 组合验证。

## Operation metadata

每个 operation 必须声明：

| 扩展                   | 当前值/格式                           | 含义                        |
| ---------------------- | ------------------------------------- | --------------------------- |
| `x-kokoro-owner`       | `kokoro-bff`                          | 公开协议 owner              |
| `x-kokoro-visibility`  | `public`                              | Product API 可见性          |
| `x-kokoro-stability`   | `stable\|beta\|experimental`          | 兼容承诺；当前 v1 为 `beta` |
| `x-kokoro-idempotency` | `none\|required`                      | 是否要求 `Idempotency-Key`  |
| `x-kokoro-permission`  | 稳定 dotted identifier 或 `anonymous` | admission 权限意图          |

`pnpm contract:check` 对全部 operation 执行门禁；`node scripts/verify-openapi.ts` 另外校验字段命名、响应 envelope、
状态码、幂等参数、分页游标和 AG-UI replay 形状。metadata 表示协议策略，不证明对应 Live adapter、数据库事实或
SLO 已经完成；实现状态看 [`CURRENT.md`](./CURRENT.md)。

## 调用与鉴权

### `c5e9b3c` 起始基线

普通用户请求目前由 Web server 发送以下 header：

```http
x-kokoro-service: web-bff
x-kokoro-internal-secret: <server secret>
x-kokoro-namespace: <trusted namespace>
x-kokoro-principal-id: <trusted principal>
x-kokoro-request-id: <optional correlation id>
```

`src/http/request.ts::authorize` 在 shared secret 通过后直接信任 namespace/principal header，尚未调用 IAM。这是 Task 1
要删除的旧身份来源，不是目标安全契约。当前 runtime manifest 还使用伪造 `runtime-manifest` principal；Task 1 把它改为显式
service-only operation。这段只记录起始 commit；下节描述 Task 1 admission，随后章节描述 Task 2 已实现的私有资源 contract。

### Task 1 本变更：IAM session admission

普通 `/v1/*` 顶层 OpenAPI security 使用 `serviceHeader + internalSecret + userBearer` 的 AND 关系：Web adapter 必须同时提供
`x-kokoro-service: web-bff`、正确 internal secret 与唯一 `Authorization: Bearer <session credential>`。旧
`namespace`/`principalId` security scheme 删除；即使客户端继续发送同名 header，也不参与身份建立或 owner 请求。
现有 66 个 path/method/operationId 保持冻结；所有受保护 operation 在 machine contract 中显式发布 401/403/429/503，
Share 与 runtime manifest 使用下表的 operation-level service-only override。该 clean-slate 身份修正不承诺与未上线旧 header
契约兼容。

BFF 先检查服务身份，再解析 Bearer，然后消费 IAM 固定 commit
`259a66e6a569889c030734f380e99685d8b9e21c`、internal OpenAPI `0.2.0`、SHA-256
`f7a3ea2e5ae7ade82ae1a6756a2f560d3129ca1b2977c6b0905633a284bd3aab` 的
`POST /internal/v1/session-authorizations/verify`。请求无 body/query，只带 Bearer、JSON Accept 与受控 `x-request-id`；
redirect、自动重试和 admission cache 都关闭。只有 strict 200 且 `allowed=true`、`tenant_id`、`user_id`、`session_id`、
`client_id` 非空才建立 `RequestContext.identity={namespace:tenant_id,userId:user_id}`。BFF 不解码 JWT 自建 authority，
不把 Bearer 保存到 context、日志、receipt、数据库或转发给其他 owner。

用户 admission 失败在 body 业务解析、idempotency claim/replay、SQL、outbox、SSE 与 owner socket 之前返回：

| 条件 | Public status / code | 约束 |
| --- | --- | --- |
| service 缺失/错误 | `403 service_auth_failed` | 不调用 IAM；shared secret 未配置属于部署错误，不改用用户凭据 |
| Bearer 缺失、重复或格式错误 | `401 session_authentication_required` | 不调用 IAM |
| IAM 401 | `401 session_invalid` | 不复制 owner message |
| IAM 403/404/409 | `403 session_forbidden` | membership/session/tenant 不可用都 fail closed |
| IAM 429 | `429 session_rate_limited` | 仅转发十进制 1..86400 秒的合法 `Retry-After` |
| IAM timeout/transport/其他 status/非法 envelope、header 或过大响应 | `503 iam_admission_unavailable` | 零重试、无缓存 fallback |

IAM 成功与错误都必须有合法 `x-request-id` 和 `Cache-Control: no-store`。BFF admission 响应使用本仓 canonical
`ErrorEnvelope`、`x-request-id` 与 `Cache-Control: no-store`，不返回 IAM body、token 或 stack。请求取消或 response 提前关闭会
取消 IAM I/O；正常 request body end 不视为取消。一次用户请求或每次 SSE 建连/重连都重新 admission。

### 显式服务边界

| Operation | 身份与 authority | 与普通用户入口的关系 |
| --- | --- | --- |
| `GET /healthz`、`GET /readyz` | probe contract | 无用户身份；readiness 必须反映 IAM 配置缺失而不能伪装可服务用户 |
| `GET /v1/shared/{shareId}` | `serviceHeader + internalSecret` + active/unexpired Share capability | OpenAPI 覆盖顶层 userBearer；不以额外 Authorization 授权，也不因其存在而拒绝；只读分享不授予 Run control/HITL/events/未分享文件 |
| `GET /v1/system/runtime-manifest` | `serviceHeader + internalSecret` + server-side tenant/domain | OpenAPI 覆盖顶层 userBearer；无 fake user，不是 IAM fallback |
| `POST /internal/bff/scheduled-tasks/dispatch` | 独立 Scheduler bearer + trusted event headers + durable receipt | 不属于 public OpenAPI 顶层 security，不接受 Web session Bearer |

四类凭据不可互换。`x-kokoro-permission` 继续表示 Product operation 的动作意图；IAM session admission 不返回也不合成
公开 API 的业务 permission，BFF-owned facts 仍由资源 predicate 授权。

### Task 2 当前 contract：个人私有资源

W1D-Chat-B1 目标语义：`POST /v1/sessions/{id}/messages` 对 Web 本地新造的
`conv_<UUID>` 可在首条合法消息的 BFF 事务中隐式创建 active Conversation；成功仍返回既有
`202 MessageReceiptResponse`，不增加独立 create-session operation。首条内容派生服务端标题，
body 不接受 title。既有 active Conversation 的追加消息行为不变；其他格式的缺失 ID、
已删除 ID、跨 tenant/subject 的 ID，以及不可见 Project 一律 fail closed 为 404。
客户端提供的 ID 不赋予任何既存资源权限。相同 `Idempotency-Key` 与请求摘要重试返回原 receipt，
同 key 不同内容返回 `409 idempotency_conflict`；同 ID 并发首发不会创建多条 Conversation。

普通用户资源默认 scope 为 IAM 验证得到的 `{ tenantId, subjectId }`，body/query/header 不能自报覆盖。Project 的
list/detail/slug/instruction/revisions/skills/tasks、ScheduledTask 的 list/detail/create/update/delete/retry、Chat/Message、
AG-UI events 与 cancel/resume/steer 都同时验证 tenant + subject。其他用户的 detail/mutation/control/events 与不存在资源使用同一
404，不通过 403 或字段差异泄漏存在性；list 不返回同 tenant 其他用户资源。Project slug 只在同一 owner scope 唯一，因此同租户
不同用户可使用相同 slug。

ScheduledTask create 中 `owner_id` 只取 trusted subject，body 不能指定；引用 `project_id` 必须属于相同 scope。Scheduler callback
继续从受信事件 tenant 与已存 task owner 建立内部执行身份，不把事件 body actor 变成 authority。Conversation 非空
`project_ref` 必须解析为同 scope Project；创建和后续 message/query/control 都 fail closed。message body 与 query 同时提供不同
`project_ref` 返回 `400 invalid_message`；Chat query `scope` 只允许省略、空或 `direct`，其他值返回 400，并且永远不作为 tenant
或共享授权来源。

显式 Share 仍是 Conversation 的独立只读 capability，可撤销/过期；持有 Share 不授权 Project、ScheduledTask、Run control、
HITL、AG-UI events 或未分享文件。Task 2 不引入 Project ACL、团队共享或通用 authorization table。

## Envelope 与字段

JSON 成功：

```json
{ "data": {}, "meta": { "request_id": "REQUEST_ID" } }
```

JSON 错误：

```json
{ "error": { "code": "stable_code", "message": "Log-safe message" }, "meta": { "request_id": "REQUEST_ID" } }
```

外部 JSON 字段统一使用 `snake_case`，瞬时点使用 RFC 3339 UTC 毫秒精度。`ProjectInstructionRevision` 的 canonical
字段是 `updated_at`（`string`、`date-time`）和 `actor_name`，对应 schema example 也使用相同字段。此契约切片只更新
BFF 的机器事实与契约门禁；runtime mapper、Web consumer 和 `docs/api/v1/projects.md` 仍由 source/documentation owner
同步，在同步完成前不把运行时 parity 当作已验证事实。错误 `code` 可编程且稳定；message 不暴露 SQL、stack、credential
或 provider 原文。

业务 JSON 成功响应统一使用 `{data, meta}`，错误响应统一使用 `{error, meta}`。`/healthz` 的 `200`、`/readyz` 的
`200/503` 是明确的 probe `HealthResponse` 例外；probe 的无效请求和业务失败仍使用 `ErrorEnvelope`。SSE 响应使用
各自的 `text/event-stream` schema，不套 JSON envelope。

## 列表、并发与版本

- 列表使用 opaque cursor、稳定排序与明确 limit；客户端只原样回传 cursor。
- 当前 mutation 并发主要由 idempotency claim 和数据库约束控制；Project/ScheduledTask 尚未公开 version/ETag。
- `/v1` 的 breaking policy 与 provenance 见 [`../contract/README.md`](../contract/README.md)。删除 path/method、重命名
  operationId、收窄 schema 或改变 permission/idempotency 语义必须进入新版本。

## Library degraded contract and Storage v2 prerequisites

`GET /v1/library` 保留既有 path、method、`listLibrary` operationId 与 operation metadata。`c5e9b3c` 在受信
service-envelope admission 通过后只返回 `503 storage_integration_unavailable`；Task 1 后它与其他普通用户 operation 一样，
还必须先通过 IAM Bearer admission。认证失败使用本页稳定 401/403/429/503 语义，admission 成功后仍返回 Storage 503。
503 使用 canonical `ErrorEnvelope`，当前 `meta.request_id` 行为保持不变。机器契约删除了
不可达的 200 success 与仅服务旧 transport 的 `LibraryResponse`/`LibraryItem` schema；这不是 Library 可用性声明。

未来 W2 success contract 必须在 Storage Proto v2 over ConnectRPC、caller × operation × scope、Capability scope
mapping、trusted Run/ExecutionIdentity 与 per-kind 或 BFF composite pagination 全部确定后重新发布；W1 IAM admission 已在
Task 1 本变更闭环。
本切片不激活 Storage edge，不接受旧 HTTP fallback，也不把 placeholder 200 当作兼容承诺。

## Capability projection dependency

Capability internal-owner contract 已在 BFF runtime 内生成并接线，固定为 commit
`7f89a267d745cbb9870f52d6edb23dec1a3c469b`、version `2.0.0`、artifact
`contract/openapi/capability-http.openapi.json`、SHA-256
`e0b7c4b57ac030efb73878b51da2a3595ec0172bce0608a88ea925b57a69761a`。BFF vendored artifact 是只读生成输入；
Capability 仍拥有 wire schema 与四个 internal-owner GET，BFF 拥有 public `/v1/skills`、`/v1/skills/pool`、
`/v1/skills/catalog`、`/v1/mcp/servers` 的 projection contract。

public Skills 查询中 `query` 是唯一 canonical 搜索参数；旧搜索参数返回 `400 invalid_query_parameter`，不作为 alias、
不转发。Skills 请求只允许 `query`、`tags`、`scope_kind`、`limit`、`cursor`，MCP 请求只允许
`provider_key`、`limit`、`cursor`；未知 query parameter fail closed。Skills cursor scope 固定为 `tenant + subject + operation + normalized filters`。
MCP cursor scope 固定为 `tenant + operation + provider_key filters`；MCP owner contract 不提供 subject binding，BFF 不自造 subject binding。
两类 cursor 都是 owner 生成的 opaque continuation，BFF 只原样传递，不解析、不持久化。四个 GET 无副作用，
`x-kokoro-idempotency=none`，不新增 mutation receipt 或事件协议。

BFF 在 `c5e9b3c` 从 Web service context 构造 Capability 的 `web-bff` service identity、tenant、subject 和 request id；
Task 1 后 tenant/subject 必须来自 IAM admission 建立的 context，legacy identity header 不得参与。
浏览器的 Authorization、Host、X-Domain、X-Forwarded-* 与 body identity 不转发。Capability `200 {data}` 在 BFF
边界映射为 canonical public `{data, meta}`；owner response `x-kokoro-request-id` 只用于关联，不进入 owner data，且按 Unicode
code point 校验长度为 1..255，缺失、空值或过长均映射为 `502 capability_response_invalid`。BFF 参数错误与
owner 400 映射为稳定 public 400；owner 401 视为内部 service credential/configuration failure 并映射为
`503 capability_unavailable`；owner 503 映射为 `503 capability_unavailable` 并保留可重试语义；非法 envelope、过大
响应或其他 owner 5xx 映射为 `502 capability_response_invalid`。所有 public 错误仍遵守本仓 canonical OpenAPI；
四个 GET 的 canonical query 与 400/502/503 已同步到 public OpenAPI，path/method/operationId 保持冻结基线不变。
owner `additionalProperties:false` 的 response/data/item/error object 均由 strict generated validator 执行；任何 legacy
`meta`、混合资源字段或 nested extra 都映射为 `502 capability_response_invalid`。
Catalog owner 省略 cursor 时 public projection 固定返回 `next_cursor:null`；其他列表不自造 cursor。MCP transport
显式映射 `stdio → http`、`streamable_http → streamable_http`、`sse_compat → streamable_http`，`unknown` fail closed 为 502。

BFF runtime 的 Capability generated consumer、facade 与 route 已实现；Root
`EDGE-BFF-CAPABILITY` 仍为 broken，必须由 W0B-5 real smoke 与 W0B-6 integration 闭环后才能标记 active。

Capability HTTP 是 Wave 0B 的临时 hard-link closure；Wave 3 以 Platform ConnectRPC 原子替换并删除 HTTP consumer，
不承诺 HTTP/Proto 双协议兼容。

## 幂等：当前事实与目标

除无副作用 GitHub preview 外，POST/PATCH/DELETE 要求 `Idempotency-Key`。当前 scope 为 namespace、actor、method、canonical
path 和 key；fingerprint 覆盖 method、canonical path、排序 query、canonical body、content-type 与 `if-match`。Live 且
business store 配置时 receipt 持久化到 PostgreSQL；否则部分
非 BFF-owned Live mutation 和 Mock 使用进程内 Map。

目标仍需按 operation 确认更多 selected headers，并让普通 receipt、BFF business fact 与 outbox 在同一事务提交；该目标
尚未统一。现有资源 owner predicate 先于通用 receipt replay/claim，防止同 tenant 其他用户重放已存在结果；repository/事务继续重验。

## AG-UI

W1D-Chat-B2 目标语义：`GET /v1/sessions/{id}` 的 `messages` 是最新至多 100 条、按
sequence 稳定升序呈现，与 `event_watermark` 来自同一 BFF PostgreSQL 读取快照；更早历史
使用独立 Message 分页接口。该 cursor 只表示此快照已持久化的 AG-UI ledger head，
不表示 Agent execution 的实时状态。首发 `202` 的 `assistant_message_id` 是 BFF 产品 Message ID，
与 Agent source `chat_message_id`/AG-UI segment ID 不要求相同。一个 run 的多段 assistant
输出在 BFF snapshot 中以最后一个实际已发布 segment 的权威 completed 正文（可为空）表示；中间段 completed
仅维持 `streaming`，run success 才标记 `completed`，run failure/cancel 标记 `failed`。
Agent HTTP consumer W1D-Chat-B3 将 owner `contract/openapi/v1/openapi.json` v1.1.0 固定于
`520ec181a101298b4f336aad273ce003b2735955` / SHA-256
`2b9c7aad6f38db3e20200b037e4818ae932209ba3deecabf8fc984db6bcec492`。仅生成
`createRun`/`replaySessionEvents`，分别只接受 202 `LaunchReceiptEnvelope` 与 200
`ReplayPageEnvelope`；缺少或多出 wire 字段、裸 body、204、非法 enum/int64/epoch 时间值均视为
owner contract mismatch。BFF 自有 run/session 比对和 source seq 连续性仍独立执行；Agent
运行时未列出的 replay 400、x-request-id 与 error retryable 差异留 Agent owner 后续修正。

Agent owner main `520ec181a101298b4f336aad273ce003b2735955` 已发布空
`assistant.completed(content="")` source；BFF 按该真实事件覆盖此前草稿，且不伪造缺失终帧。
以上不改变已发布 JSON 字段、SSE frame 或 cursor 形状。

`GET /v1/sessions/{id}/events` 的网络 payload 是 AG-UI SSE。BFF 不发布 legacy SessionEvent wire，也不发布 Vercel
AI SDK data stream。独立后台 projector 把 Live source 事件原子写入 BFF PostgreSQL ledger 后，HTTP 才能读取；每个
AG-UI frame 的 SSE `id` 都是独立
`agui_*` opaque cursor。客户端只保存并原样回传最后确认的 `id`，不得解析、构造或跨 tenant/session 复用；replay
严格从该 cursor 对应内部位置之后开始。

Agent source `seq` 只保留在 AG-UI `metadata.kokoro` 中用于诊断和投影 provenance，不是 public cursor。当前 session 内
无效格式或未知 `Last-Event-ID` 返回 `400 invalid_event_cursor`；不属于 trusted tenant 的 session 返回与普通缺失一致的
`404 session_not_found`。已知但已被 retention GC 回收的 cursor 返回 `410 event_cursor_expired`。终态已提交时，即使 Agent disabled/unavailable，
BFF 重启后仍可只从 PostgreSQL replay；Redis 不参与 cursor 解析或历史读取。`event_watermark` 是当前 public ledger head
cursor；第一帧尚未产生时为 `null`。

projector 通过 PostgreSQL lease/token/fence 独立于浏览器连接运行；后台 GC 以最新 `RUN_STARTED` 的 public sequence
作为安全回收边界，只回收该边界之前且超过 retention 的旧 run frame，并保留从边界到 head 的完整 run slice；没有
可靠边界时不回收该 stream。retention floor 与有界 cursor tombstone 同步维护。字段级定义与例子只看 canonical OpenAPI；实现、
恢复和剩余缺口见 [`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)、[`RELIABILITY.md`](./RELIABILITY.md) 与
[`CURRENT.md`](./CURRENT.md)。

## 资源文档

资源路径、请求、响应和示例从 [`api/README.md`](./api/README.md) 进入。OpenAPI 与资源文档冲突时以 canonical
OpenAPI 为字段事实源，以 `CURRENT.md` 判断运行时是否已接线。

## System owner dependency

`GET /v1/system/runtime-manifest` 与 `GET /v1/models` 分别消费 System owner 的
`GET /v1/system/runtime-manifest` 和 `GET /v1/system/model-catalog/catalog`。owner wire JSON 使用
snake_case、成功 envelope 仅为 `{data}`，request ID 仅由 `x-request-id` header 表达；BFF 再按本仓
public v1 envelope 投影。旧 `meta` 与裸 body 均拒绝；System 错误必须是仅含
`error.code`、`error.message`、布尔 `error.retryable` 的 owner envelope。模型目录的 `key`、
`display_name`、布尔 `is_default` 与必填的 string/null `next_cursor` 被严格消费。

## Scheduler control and event dependency

W0B-9 已把固定 artifact 生成并接入 BFF control 与 event runtime。Scheduler producer 的唯一机器来源是 commit
`92bf9e7e6724c591bab4b7fa27f08d694b59a67e` 的 `contract/openapi/v1/openapi.yaml`（version `1.0.0`，SHA-256
`6ec2f6d5d71efa60b92bba1eb2dd0c81b7439734e2bc4450caa221e952e24183`），本仓只读 vendor 与
`contract/dependencies/scheduler.json` 绑定它；不把 internal/event operations 加入本仓 public OpenAPI。

- Control：`/internal/scheduler/v1/schedules/{name}`，generated create/replace/delete consumer；以 bearer service token
  认证，tenant 使用 `X-Kokoro-Tenant-Id`，关联使用 `X-Request-Id`，command `Idempotency-Key` 来自 durable outbox。
  请求、成功/错误（当前 owner 的 `{data,meta}` / `{error,meta}`）均按 pinned owner schema 校验；本切片不替 owner 重写 envelope。
  稳定错误只使用 `schedule_already_exists` / `schedule_not_found`。BFF 不消费不存在的 Schedule GET/list 或 occurrence query API，
  不自造分页/recovery query。pause/resume 虽由 owner 发布，本切片只通过 replace 的 paused 字段表达业务启停。
- Event：producer 的 `webhooks.scheduleOccurrenceDispatch` 拥有 POST/PUT wire schema、headers、at-least-once delivery
  和 retry classification；BFF 配置的 target 是 `POST /internal/bff/scheduled-tasks/dispatch`，PUT 返回 405，
  不是承诺实现所有 producer 支持的 target method。BFF target 必须启用 bearer token，即使 producer schema 允许其他 target 无认证。
- Receiver 首先验证 Scheduler 服务凭据，再把 `X-Kokoro-Tenant-Id` 作为唯一 trusted tenant。
  BFF payload `tenant_id` 仅作完整性字段，必须逐字等于受信 header；不一致返回 `400 invalid_scheduler_dispatch`，
  不用 body 建立身份，也不采用旧 namespace/job header。`task_id` 与 schedule name 必须符合 BFF 映射，`owner_id` 必须匹配
  受信 tenant 下的 stored task；prompt/project/auto_approve/timezone 是 BFF payload 的业务映射与一致性校验，不上升为 Scheduler schema。
- `X-Kokoro-Scheduler-Schedule`、`X-Kokoro-Scheduler-Occurrence`、`X-Request-Id`、`Idempotency-Key`、`traceparent`
  按生成 webhook validator 校验，headers 大小写按 HTTP 规则归一。Scheduler key 是 opaque，存储原值，不 trim、解析、重构，
  不校验自造 `schedule:<name>:<time>` 格式；owner schema 长度上限仍生效。生成 validator 的 transform 后对象不作为摘要输入；
  接纳成功后保留原始 parsed JSON 的全部 own keys（包括顶层/嵌套 `__proto__`）。

### Semantic digest 与身份

semantic digest 是 SHA-256(UTF-8 canonical JSON([trusted tenant, schedule, canonical RFC3339Nano occurrence, parsed body]))。
occurrence 只接受合法 UTC `YYYY-MM-DDTHH:mm:ss[.fraction]Z`，fraction 为 1..9 位；规范化仅去掉末尾零和空小数点，
保留纳秒区分，以手写 proleptic Gregorian 规则校验四位年（含 `0000`/`0099`/`0100`），不使用会把 0..99 映射到
1900..1999 的 `Date.UTC`，拒绝无效日历日期、秒 60、偏移量及旧 compact 时间。无 fraction 与全零 fraction
表示相同 instant。request ID、traceparent、header 排列和 JSON 原始空白不参与摘要，opaque key 只索引 receipt，不参与 digest。

canonical JSON 对对象递归按 UTF-16 code unit 排序键，并按该顺序逐项递归序列化为文本：
每项是 JSON.stringify(key) + ":" + canonical(value)，用逗号连接后包在花括号内；数组逐项递归序列化、保持原顺序。
JSON.stringify 仅用于 key 与 scalar 的转义/编码，不将排序后的条目重建为 object 再整体 stringify，因为 JavaScript
会把 integer-index key 重排为数值顺序。例如 `"2"`、`"10"`、`"01"` 必须输出为 `"01"`、`"10"`、`"2"`，嵌套对象同样如此。
字符串不做 Unicode normalization。入口使用 JSON.parse 的 JSON 语义（重复键取最后一项），仅允许有限 IEEE-754 number，
`-0` 归一为 `0`；溢出为 Infinity 的数字、非 JSON 值拒绝，不跳过任何已接纳字段。顶层必须是 object。
该算法是本 receiver 的版本化规则，不是声称完整实现 RFC 8785；W0B-9 独立 unit 测试必须锁定 `"2"`/`"10"`/`"01"`
及嵌套数字键的精确输出，并覆盖 Unicode、嵌套键、数组、数字、request ID 变化和纳秒差异。
本设计的文档治理断言不构成 canonical JSON 算法已实现或已验收的证据。

receipt scope 为 JSON.stringify([trusted tenant, "scheduler-dispatch:v1", opaque key])，排除 payload actor 与请求关联字段。
同 scope 不同 digest 恒为 `409 idempotency_conflict`，包括 pending 已超时、失败与重启后；同 digest terminal 重放原 status/body。
同 digest 活跃 pending 为 `425 idempotency_in_progress`，不能返回 producer 视为永久错误的 409。
首次不可信/非法入参为 400，认证失败为 401，任务不存在/不可见为 404，任务不活动或 snapshot 不一致为 409，过期为 410；
这些明确终态不触发第二个 Run。持久 store 缺失/不可用、依赖配置失败为 503；Agent 网络/响应未知为 502，保留可恢复 receipt。
返回 202 仅在 Agent 确认相同 Run 且 terminal receipt 落盘后；响应丢失通过原 receipt 重放。
Scheduler Agent admission 还必须有大于零的 `database remaining lease - monotonic elapsed - settlement reserve`；预算耗尽不执行 Agent I/O。
该专用预算上限不改变普通 Chat/owner 调用的全局 upstream timeout。

receiver 的 Run identity 只依赖 trusted tenant + schedule + canonical occurrence（无歧义 JSON tuple + SHA-256），
与 opaque key、actor 和 payload 变化解耦；改变 key 不得产生同 occurrence 的第二个 Run，Agent 对不同 launch 参数须冲突而非新建。
body 仍需 tenant 完整性与业务授权校验；身份摘要不是授权凭据。pending snapshot、claim token、保留策略见 DATA_MODEL。
producer 的 408/425/429/5xx 可重试，其他非 2xx 永久失败；BFF 不重新定义其 retry 分类。
owner artifact 升级须更新 commit/digest/config provenance、重新生成和验证两条 consumer 边界，breaking 变更按 owner 版本策略评审；
W0B-9 clean-slate 同时删除 jobs/job_*、旧 header 与 compact occurrence 路径，不维护 alias 或双协议 fallback。
