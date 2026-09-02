# Skills API v1

Skills 由 BFF 负责聚合、配额、启停和 GitHub skill 导入；具体包字节和安装事实由 Skills/PG adapter 或对应 upstream 提供。

## 资源模型

```json
{
  "name": "contract-review",
  "description": "Review a versioned business API contract.",
  "content_hash": "sha256:fixture-contract-review",
  "scope": "official",
  "installed": true,
  "enabled": true,
  "categories": ["coding", "business"],
  "updated_at": 1767225600
}
```

## GET `/v1/skills`

返回当前 namespace 可见技能投影。

### Response `200`

```json
{ "data": { "skills": [] }, "meta": { "request_id": "req_skills_1" } }
```

## GET `/v1/skills/pool`

返回已启用技能池投影。

## GET `/v1/skills/catalog`

返回技能目录与 `next_cursor: null`。

## GET `/v1/skills/quota`

返回 namespace 配额。

```json
{
  "data": {
    "namespace": "ns_demo",
    "package_count": 1,
    "package_bytes": 122880,
    "max_packages": 20,
    "max_bytes": 52428800
  },
  "meta": { "request_id": "req_skills_quota_1" }
}
```

## GET `/v1/skills/:name/revisions[?scope=...]`

返回版本历史。`scope` 可选；未传时返回所有 scope。

## POST `/v1/skills/:name/enable[?scope=...]`
## POST `/v1/skills/:name/disable[?scope=...]`

启停技能，必须携带 `Idempotency-Key`。同 key 同 payload 重放原 receipt；同 key 不同 payload 返回 `409 idempotency_conflict`。

### Response `200`

```json
{ "data": { "ok": true }, "meta": { "request_id": "req_skill_toggle_1" } }
```

## POST `/v1/skills/github/preview`

预览 GitHub skill，不要求 `Idempotency-Key`。

### Request

```json
{ "repository": "https://github.com/OWNER/REPO" }
```

### Response `200`

```json
{
  "data": {
    "repository": "https://github.com/OWNER/REPO",
    "default_branch": "main",
    "skill": { "name": "REPO", "description": "Mock GitHub skill from OWNER/REPO" }
  },
  "meta": { "request_id": "req_github_preview_1" }
}
```

## POST `/v1/skills/github/import`

导入 GitHub skill，必须携带 `Idempotency-Key`。

### Response `200`

与 preview 相同的 data 形状。

## Errors

- `invalid_github_url`
- `skill_not_found`
- `idempotency_key_required`
- `idempotency_conflict`

## Live upstream

Skills live 模式走 Capability owner 的 `KOKORO_CAPABILITY_BASE_URL`，返回必须是 JSON；HTTP error、空 body、非 JSON、错误 envelope 都不得当作成功数据。
