# kokoro-bff runbook

## 1. 识别版本与保护现场

```bash
git rev-parse HEAD
git status --short --branch
node --version
pnpm --version
```

记录部署 tag/image digest、BFF mode、request id、发生时间（UTC）和受影响 route。不要输出 shared secret、owner token、
完整 receipt body 或用户内容。

## 2. 本地启动

Mock：

```bash
cp .env.local.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Live fresh schema：

```bash
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
KOKORO_BFF_MODE=live \
KOKORO_IAM_BASE_URL=http://127.0.0.1:4201 \
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL \
KOKORO_BFF_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm start
```

先探测并复用已有共享 PostgreSQL/Redis；只清理本次创建的 database/process。不要为 BFF 单独启动第二套依赖。

## 3. 探针与最小诊断

```bash
curl -fsS http://127.0.0.1:4300/healthz
curl -fsS http://127.0.0.1:4300/readyz
```

- health 失败：检查进程、端口、Node 版本和启动日志。
- health 成功而 ready 失败：检查 mode、PG、Redis DB 8、严格 IAM origin，以及启用 profile 对应的 upstream config。
- `service_auth_failed`：核对 Web/BFF shared secret 与 `x-kokoro-service`，不要临时关闭认证。
- `session_authentication_required`/`session_invalid`/`session_forbidden`：核对 Web adapter 是否只发送一个当前 session
  Bearer，并在 IAM 按 request id 查 session/membership；不要恢复 legacy identity headers。
- `session_rate_limited`：只按 BFF 返回的受控 `Retry-After` 重试；`iam_admission_unavailable` 检查 IAM origin、owner
  `x-request-id`、`Cache-Control: no-store`、响应 envelope、5 秒/1 MiB 限制与网络，不缓存放行。
- `business_store_not_configured`：补齐 BFF PG/Redis，不能切到 Mock 伪造 Live 成功。
- `upstream_*` / `*_not_configured`：按 route owner 检查 base URL、token、timeout 和 owner health。

## 4. Contract 与 schema

```bash
pnpm contract:check
shasum -a 256 contract/openapi/v1/openapi.yaml
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL pnpm db:apply-schema
```

schema 安装只面向 fresh/empty database；`IF NOT EXISTS` 不修复 drift。发现 drift 时停止发布，比较当前
`database/schema.sql` 与目标环境，保留快照并按独立恢复计划处理，不临时创建 migration/fallback。

## 5. Idempotency incident

1. 用 IAM admission 得到的 namespace/userId、method、canonical path、Idempotency-Key 定位 scope；不要在日志中暴露
   Bearer 或业务 body。
2. 查询 receipt 的 fingerprint/status/created_at，确认是 pending、terminal 还是不同 digest。
3. pending 小于 60 秒：返回/等待 `idempotency_in_progress`，不并发重放。
4. 超过 60 秒：由相同请求和 key 触发 claim recovery；先确认原 side effect 是否已有 owner receipt。
5. terminal：返回原 status/body。不要删除 receipt 让 caller 用同 key重做副作用。
6. query/header 差异当前未进入 fingerprint；涉及这些差异时按已知缺口升级处理。

## 6. Scheduler divergence

- `scheduler_registration_failed`/`scheduler_update_failed`：检查 BFF task 状态是否已标为 failed，再修复 Scheduler 后调用
  `/v1/scheduled-tasks/{id}/retry` 并复用新的显式 mutation key。
- delete command 已与本地 fact 删除同事务提交；Scheduler 失败时 outbox 保留可恢复 command。先恢复 Scheduler delivery，不手工重建 fact 或删除 outbox。
- BFF 重启后 dispatcher 从 PostgreSQL outbox 恢复 pending/retryable command；检查 lease owner/token/fence、attempt 与 last_error_code。
- 禁止直接删除 BFF fact/outbox 或伪造 Scheduler receipt 来“修复”分叉；用户诊断必须同时带 tenant + trusted subject。

## 7. AG-UI replay incident

1. 记录 tenant、session id、最后确认的 opaque `Last-Event-ID`、request id 和 UTC 时间；不记录 event payload。
2. 用同一 tenant/session/cursor 重连。`400 invalid_event_cursor` 表示当前 session 内格式错误或未知 token；`404
   session_not_found` 表示 trusted tenant 下没有该 session；`410 event_cursor_expired` 表示 cursor 已越过保留水位。不要把
   Agent source `seq`、数据库 `public_sequence` 或其他 session cursor 代入。
3. 查询 stream 与 source/public 水位，始终带 tenant + session predicate：

   ```sql
   SELECT version, source_high_watermark, next_public_sequence, retention_floor_sequence,
          consumer_state, consumer_next_poll_at, consumer_lease_owner, consumer_failure_count,
          consumer_lease_until, consumer_fence, consumer_last_error_code,
          consumer_last_error_at, consumer_last_polled_at, updated_at
   FROM bff_agui_stream
   WHERE tenant_id = 'TENANT' AND session_id = 'SESSION';

   SELECT public_sequence, cursor, source_owner, source_event_id, frame_index, event_type, recorded_at
   FROM bff_agui_event
   WHERE tenant_id = 'TENANT' AND session_id = 'SESSION'
   ORDER BY public_sequence;
   ```

4. `agui_projection_blocked`：按同 scope 查询 consumer error 与 `bff_agui_source_event` 的 source event id、sequence、
   digest；保留 Agent 原响应并停止发布。若故障发生在 SSE headers 发送后，连接只会关闭，客户端应携带最后确认 cursor
   重连并取得结构化 JSON error；SSE comment 只有 `keep-alive`，不承载错误。不得 update digest、覆盖 payload、删除
   unique row 或直接把 blocked 改 active 来强行前进。
5. Agent 不可用但 ledger head 是终态：BFF 应可只从 PostgreSQL replay。非终态只有部分 ledger 时先保护 PG，再恢复
   Agent source history；Redis 不能补历史。
6. Redis 不可用：readyz 会失败，AG-UI publish 提示会丢失，但 committed replay 不应丢。恢复 Redis 后无需复制或
   回填 event key；AG-UI 不应存在 Redis 持久 key/stream。
7. cursor gap/duplicate：立即冻结发布，比较 source event、frame index 与 public sequence。不要切换 legacy
   SessionEvent、Vercel stream fallback，或重置 source high-watermark。
8. `410 event_cursor_expired`：先读取 session snapshot 与当前 `event_watermark`，再建立新流；检查
   `bff_agui_cursor_tombstone` 与 `retention_floor_sequence`。禁止手工单独删除 event/tombstone 或回退 source watermark。

## 8. 回滚

- 回滚到上一个已验证的 immutable image/tag，并记录 digest。
- v1 contract 若已被消费者使用，不通过回滚删除 operation/字段；必要时保留兼容实现或发布新版本。
- 本仓 V1 无 migration 链；涉及 schema 的版本不做盲目 downgrade。先保护数据、验证旧二进制能读取现有 schema。
- 已发布 opaque cursor 依赖 ledger row；回滚不得恢复 numeric Agent sequence cursor。回滚后重新运行 health/ready、
  最小 authenticated GET、idempotent replay 和 AG-UI reconnect。

## 9. 发布证据

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
git diff --check

KOKORO_TEST_POSTGRES_URL=POSTGRES_URL \
KOKORO_TEST_REDIS_URL=redis://127.0.0.1:56380/8 \
pnpm test:integration
```

真实 PostgreSQL/Redis integration、candidate image smoke、安全扫描、SBOM/provenance/signature 需要单独附 evidence；缺少
其中任一项时按 [`CURRENT.md`](./CURRENT.md) 保留开放缺口。
