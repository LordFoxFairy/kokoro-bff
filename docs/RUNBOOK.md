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
KOKORO_BFF_POSTGRES_URL=POSTGRES_URL \
KOKORO_BFF_REDIS_URL=redis://127.0.0.1:6379/8 \
pnpm start
```

先探测并复用已有共享 PostgreSQL/Redis；只清理本次创建的 database/process。不要为 BFF 单独启动第二套依赖。

## 3. 探针与最小诊断

```bash
curl -fsS http://127.0.0.1:4300/healthz
curl -fsS http://127.0.0.1:4300/readyz
```

- health 失败：检查进程、端口、Node 版本和启动日志。
- health 成功而 ready 失败：检查 mode、PG、Redis DB 8，以及启用 profile 对应的 upstream config。
- `service_auth_failed`：核对 Web/BFF shared secret 与 `x-kokoro-service`，不要临时关闭认证。
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

1. 用 namespace、method、canonical path、Idempotency-Key 定位 scope；不要在日志中暴露业务 body。
2. 查询 receipt 的 fingerprint/status/created_at，确认是 pending、terminal 还是不同 digest。
3. pending 小于 60 秒：返回/等待 `idempotency_in_progress`，不并发重放。
4. 超过 60 秒：由相同请求和 key 触发 claim recovery；先确认原 side effect 是否已有 owner receipt。
5. terminal：返回原 status/body。不要删除 receipt 让 caller 用同 key重做副作用。
6. query/header 差异当前未进入 fingerprint；涉及这些差异时按已知缺口升级处理。

## 6. Scheduler divergence

- `scheduler_registration_failed`/`scheduler_update_failed`：检查 BFF task 状态是否已标为 failed，再修复 Scheduler 后调用
  `/v1/scheduled-tasks/{id}/retry` 并复用新的显式 mutation key。
- delete 失败：BFF fact 应仍存在；先恢复 Scheduler，再重试相同 delete key。
- BFF 重启会 best-effort 注册 active/enabled/unexpired tasks；查看 registered/skipped/failed 计数。
- 在 outbox 落地前，禁止直接删除 BFF fact 或伪造 Scheduler receipt 来“修复”分叉。

## 7. AG-UI replay incident

1. 记录 session id、最后确认的 `Last-Event-ID`、request id 和 Agent replay watermark。
2. 用同一 cursor 重连；当前 cursor 是 Agent source sequence，不是 BFF durable public cursor。
3. 若 Agent history 缺失、cursor gap 或同 source fact 的 frame 不完整，保留原始响应并升级；BFF 当前没有 ledger 可独立重建。
4. 不切换 legacy SessionEvent 或 Vercel stream fallback。

## 8. 回滚

- 回滚到上一个已验证的 immutable image/tag，并记录 digest。
- v1 contract 若已被消费者使用，不通过回滚删除 operation/字段；必要时保留兼容实现或发布新版本。
- 本仓 V1 无 migration 链；涉及 schema 的版本不做盲目 downgrade。先保护数据、验证旧二进制能读取现有 schema。
- 回滚后重新运行 health/ready、最小 authenticated GET、idempotent replay 和 AG-UI reconnect。

## 9. 发布证据

```bash
pnpm lint
pnpm typecheck
pnpm contract:check
pnpm test:architecture
pnpm test
pnpm build
git diff --check
```

真实 PostgreSQL/Redis integration、candidate image smoke、安全扫描、SBOM/provenance/signature 需要单独附 evidence；缺少
其中任一项时按 [`CURRENT.md`](./CURRENT.md) 保留开放缺口。
