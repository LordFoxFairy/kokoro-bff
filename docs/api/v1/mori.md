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
GET  /v1/mori/projects
GET  /v1/mori/projects/{project_ref}
POST /v1/mori/projects/{project_ref}/generations       → 202
GET  /v1/mori/generations/{generation_ref}
GET  /v1/mori/generations/{generation_ref}/events      → text/event-stream
POST /v1/mori/generations/{generation_ref}/cancel      → 202
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

SSE 使用 `Last-Event-ID: GENERATION_REF:SEQUENCE` 作为 replay anchor。事件 id 不重复发送，
事件 data 仍使用 Mori 成功 envelope。非法或属于其他 Generation 的 cursor 返回
`400 invalid_event_cursor`。

## Live 边界

Live 模式目前对 Mori 返回 `503 mori_projection_not_configured`，保持 fail-closed。接入时应
增加 `src/adapters/music.ts`，由 Music owner 负责 provider-neutral generation fact；BFF 只做
身份、幂等、状态/事件 projection 和错误归一。浏览器永远不接触 provider token、task id、
provider URL 或 provider 名称。

## Mock 验证

```bash
pnpm build
node --test test/mori.test.ts
```
