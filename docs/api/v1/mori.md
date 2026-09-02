# Mori Music v1

Mori 是 Kokoro 的音乐创作产品 projection。为避免与通用 Projects 资源混淆，音乐契约
使用 `/v1/mori/*` 命名空间。Mock 模式由 BFF 内置确定性 fixture 提供；Live 模式必须接入
独立的 provider-neutral Music owner，不会把 Mock 事实或供应商字段带入生产响应。

## 调用约定

调用方仍是 Web server，不是浏览器。请求必须携带 BFF 的 `web-bff` 服务身份、内部 secret、
namespace 和 principal headers。所有产生事实变化的 POST 必须携带 `Idempotency-Key`。

成功和错误统一使用：

```json
{ "data": {}, "meta": { "request_id": "REQUEST_ID" } }
```

```json
{
  "error": { "code": "stable_error_code", "message": "Log-safe message" },
  "meta": { "request_id": "REQUEST_ID" }
}
```

## 已接入的 Mock endpoints

```text
POST /v1/mori/projects                                    → 201
GET  /v1/mori/projects
GET  /v1/mori/projects/{project_ref}
POST /v1/mori/projects/{project_ref}/song_plans            → 201
POST /v1/mori/projects/{project_ref}/generations       → 202
GET  /v1/mori/generations/{generation_ref}
GET  /v1/mori/generations/{generation_ref}/events      → text/event-stream
POST /v1/mori/generations/{generation_ref}/cancel      → 202
GET  /v1/mori/projects/{project_ref}/candidates
POST /v1/mori/candidates/{candidate_ref}/promote       → 201
POST /v1/mori/versions/{version_ref}/remix             → 202
GET  /v1/mori/library
POST /v1/mori/versions/{version_ref}/exports            → 202
GET  /v1/mori/exports/{export_ref}
```

Generation 请求体：

```json
{
  "song_plan_ref": "SONG_PLAN_REF",
  "mode": "smart",
  "prompt": "A warm late-night track for the drive home.",
  "lyrics": null,
  "lyrics_mode": "instrumental",
  "style": "dream pop intimate organic",
  "reference_asset_refs": [],
  "voice_ref": null,
  "duration_seconds": 180
}
```

创建返回 `generation_ref` 和 `status: queued`。Mock 会按 `queued → preparing → generating →
post_processing → succeeded` 推进，并在成功时生成两个候选方向。取消是显式命令；已经进入
终态的 Generation 不会被网络断开或取消请求改写。

Promote 会把 Candidate 确认成不可变 Version，并更新 Project 的 `current_version_ref`；旧的
current Version 只会变成 `archived`，不会被覆盖。Library 只展示已经 Promote 的 Version。
Remix 复用 Version 的输入上下文创建新的异步 Generation。Export 以 `queued → processing →
succeeded` 推进，成功后才出现短时 `download_url` projection。

SSE 使用 `Last-Event-ID: GENERATION_REF:SEQUENCE` 作为 replay anchor。事件 id 不重复发送，
事件 data 仍使用 Mori 成功 envelope。非法或属于其他 Generation 的 cursor 返回
`400 invalid_event_cursor`。

## Live 边界

Live 模式通过 `KOKORO_MUSIC_BASE_URL` 接入独立的 Music owner。BFF 将已 allowlist 的 Mori
路由映射到 owner 的 `/internal/bff/mori/*` ingress，并负责身份、幂等、状态/事件 projection
和错误归一；未配置 owner 时返回 `503 music_owner_not_configured`，不回退到 Mock 事实。

Music owner 的响应会经过 `src/adapters/music.ts` 的 provider-neutral projection：未知字段会
被丢弃，SSE 只转发合法的 Mori generation event envelope，provider token、task id、provider
URL 和 provider 名称永远不会进入浏览器响应。owner 的服务身份通过 `KOKORO_INTERNAL_SECRET_BFF`
传递，浏览器提交的 bearer token 不会被转发。

本地 live 接线示例：

```bash
KOKORO_BFF_MODE=live \
KOKORO_MUSIC_BASE_URL=http://kokoro-music:4410 \
KOKORO_INTERNAL_SECRET_BFF=example-internal-secret
```

## Mock 验证

```bash
pnpm build
node --test test/mori.test.ts
```
