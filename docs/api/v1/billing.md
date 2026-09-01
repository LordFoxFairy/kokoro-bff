# Billing API v1

Billing 只提供计划、摘要和 checkout 投影，不承载支付网关实现。

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

Billing live 模式走 `KOKORO_BILLING_BASE_URL`。
