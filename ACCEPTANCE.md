# kokoro-bff acceptance

`kokoro-bff` is the Web-facing v1 business boundary. It owns project and
scheduled-task definitions, durable idempotency receipts, and transport
projection. It does not read another repository's database.

## Required local checks

```bash
pnpm check
KOKORO_TEST_POSTGRES_URL=... KOKORO_TEST_REDIS_URL=... pnpm test:integration
docker build -t kokoro-bff:acceptance .
```

The integration fixture must provide PostgreSQL and Redis. A missing fixture is
not a passing integration result.

## Acceptance matrix

| Area | Scenario | Expected result |
| --- | --- | --- |
| Boundary auth | Browser/user bearer is supplied to a v1 route | BFF authenticates the Web service envelope and never forwards the user bearer to an owner |
| Context | A request carries tenant, subject, actor, `Forwarded`, and request id | BFF builds trusted owner headers and preserves one request id |
| Projects | Create, update instruction, list revisions, replay the same idempotency key | One durable fact and one stable receipt |
| Chat | POST a session message through the BFF | Agent HTTP admission returns a v1 run receipt |
| Capability | List skills/MCP with query and cursor | BFF forwards only the allowlisted query and returns snake_case `next_cursor` |
| Model | List models with feature and cursor | BFF forwards the filter and preserves the owner page cursor |
| Storage | Read the library projection | BFF receives Storage's read-only projection without database access |
| Billing | Read catalog and create checkout | BFF uses the Billing web-bff service boundary and stable v1 envelope |
| Mori Music | Live Project/Generation/Library/Export routes | BFF allowlists the route, projects the Music owner response, and never leaks provider fields |
| Scheduler | Create/update/delete a task | PostgreSQL fact and Scheduler `ScheduleJob` registration are synchronized |
| Scheduler recovery | Restart BFF or Scheduler | Active, enabled, unexpired facts are re-registered; paused/failed/expired facts are skipped |
| Scheduler dispatch | Replay one occurrence | Same idempotency key returns the durable receipt and never starts a second Agent run |
| Scheduler gate | Dispatch a paused, disabled, failed, or expired task | Stable `scheduled_task_not_active`/`scheduled_task_expired` error and no Agent launch |

## Owner boundary

The BFF is the only owner of the Web business projection. System, IAM, Model,
Billing, Capability, Storage, Scheduler, Agent, and Music remain independent
owner services and are reached only through their documented HTTP/protobuf boundary.
