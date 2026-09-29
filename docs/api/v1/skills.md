# Skills API v1：当前读投影

浏览器经 Web 同源 adapter 到 BFF；BFF 每次验证当前 IAM Product session，再用独立 `platform:projection.read` workload 身份读取 Platform。唯一机器事实源为 `contract/openapi/v1/openapi.yaml`。

| GET | 当前返回 |
| --- | --- |
| `/v1/skills` | `{data:{skills:[...],next_cursor?}}` |
| `/v1/skills/{skill_id}` | `{data:{skill_id,source_ref,revision,status,name,summary,tags}}`；仅本人 PERSONAL/ACTIVE，未安装也可读 |
| `/v1/skills/pool` | owner-native `{data:{skills:[...],next_cursor?}}` |
| `/v1/skills/catalog` | owner-native `{data:{skills:[...],next_cursor?}}` |

列表 Skill 保留 `source_ref`、十进制字符串 `revision`、`enabled`、`categories`，不再合成旧 selector/默认 revision。请求只接受机器契约列明的参数；by-ID 不接受 query、body、幂等键。成功/错误均有 `x-request-id`、`Cache-Control: no-store`，错误严格 `{error:{code,message,retryable}}`。

`POST /v1/skills/drafts` 与包上传、验证、发布属于默认关闭的 v4 候选；`/v1/skills/quota`、旧 enable/disable/import/revisions 尚无当前生产 owner 路由，返回 503，不应作为 Web 正式控件。Web 读契约及真实 IAM/BFF/Platform 组合仍待验。
