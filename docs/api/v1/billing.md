# Billing API v1

Billing 只提供计划、摘要和 checkout 投影，不承载支付网关实现。BFF 的 live adapter 会把 Web
兼容的 `plan_id` 解析为 Billing 的 `offer_revision_id`，金额、币种和 quote snapshot 均从
Billing catalog 读取，不接受浏览器自行提交的价格。

## GET `/v1/billing/plans`

### Response `200`

```json
{ "data": { "plans": [] }, "meta": { "request_id": "req_billing_plans_1" } }
```

## GET `/v1/billing/summary`

### Response `200`

```json
{ "data": { "balance": 100, "currency": "USD", "period": "2026-01", "usage": 0 }, "meta": { "request_id": "req_billing_summary_1" } }
```

## POST `/v1/billing/checkout`

必须携带 `Idempotency-Key`，请求体为：

```json
{ "plan_id": "plan_starter" }
```

### Response `200`

```json
{ "data": { "checkout_url": "/billing/mock-checkout/plan_starter" }, "meta": { "request_id": "req_billing_checkout_1" } }
```

## Errors

- `plan_not_found`
- `idempotency_key_required`
- `idempotency_conflict`

## Live upstream

Billing live 模式走 `KOKORO_BILLING_BASE_URL`：

- `GET /v1/billing/plans` → owner `GET /v1/commerce/catalog`，将 `offers` 投影为 `plans`；
- `POST /v1/billing/checkout` → 先读取 catalog，再调用 owner `POST /v1/billing/checkout`；
- BFF 出站使用 `x-kokoro-service: web-bff`、`x-kokoro-tenant-id`、`x-kokoro-subject`、
  `x-kokoro-request-id` 和部署 secret；
- `summary`、ledger、subscription 等读取面在 owner 侧没有同形 Web projection 前保持显式
  `upstream_not_configured`/owner contract error，不回退到 Mock。
