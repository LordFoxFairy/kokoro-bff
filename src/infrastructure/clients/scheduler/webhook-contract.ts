import type { IncomingHttpHeaders } from "node:http"

import { zDispatchScheduleOccurrencePostWebhookRequest } from "../../../generated/scheduler/zod.gen.js"
import { canonicalSchedulerJson, canonicalSchedulerOccurrence } from "./dispatch-identity.js"

export type SchedulerDispatchWire = {
  tenantId: string
  schedule: string
  occurrence: string
  requestId: string
  idempotencyKey: string
  traceparent: string
  body: Record<string, unknown>
}

function singleHeader(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name]
  return typeof value === "string" ? value : null
}

/** Terminates producer-owned generated schemas before local receipt/application mapping. */
export function parseSchedulerDispatchWebhook(headers: IncomingHttpHeaders, body: unknown): SchedulerDispatchWire | null {
  const tenantId = singleHeader(headers, "x-kokoro-tenant-id")
  const schedule = singleHeader(headers, "x-kokoro-scheduler-schedule")
  const occurrence = singleHeader(headers, "x-kokoro-scheduler-occurrence")
  const requestId = singleHeader(headers, "x-request-id")
  const idempotencyKey = singleHeader(headers, "idempotency-key")
  const traceparent = singleHeader(headers, "traceparent")
  if (tenantId === null || schedule === null || occurrence === null || requestId === null || idempotencyKey === null || traceparent === null) return null
  const generated = zDispatchScheduleOccurrencePostWebhookRequest.safeParse({
    body,
    headers: {
      "X-Kokoro-Tenant-Id": tenantId,
      "X-Kokoro-Scheduler-Schedule": schedule,
      "X-Kokoro-Scheduler-Occurrence": occurrence,
      "X-Request-Id": requestId,
      "Idempotency-Key": idempotencyKey,
      traceparent,
    },
  })
  if (!generated.success) return null
  try {
    canonicalSchedulerJson(body)
    return {
      tenantId,
      schedule,
      occurrence: canonicalSchedulerOccurrence(occurrence),
      requestId,
      idempotencyKey,
      traceparent,
      // Generated schemas prove producer-contract acceptance. The original
      // parsed object is the receipt/digest fact: Zod record transforms must
      // not erase JSON own keys such as a top-level "__proto__".
      body: body as Record<string, unknown>,
    }
  } catch {
    return null
  }
}
