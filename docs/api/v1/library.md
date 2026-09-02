# Library API v1

Library 只提供资源/产物投影。

## GET `/v1/library`

### Response `200`

```json
{
  "data": {
    "items": [
      { "id": "artifact_contract", "title": "Business API contract", "type": "document", "created_at": "2026-01-01T00:00:00.000Z", "url": "/artifacts/artifact_contract" }
    ]
  },
  "meta": { "request_id": "req_library_1" }
}
```

## Live upstream

Library live 模式走 Storage owner 的 `KOKORO_STORAGE_BASE_URL`。
