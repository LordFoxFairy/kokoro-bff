import { createClient } from "../../../generated/scheduler/client/client.gen.js"
import { createSchedule, deleteSchedule, getCurrentSchedule, replaceSchedule } from "../../../generated/scheduler/sdk.gen.js"
import { zCurrentScheduleResponse, zErrorResponse } from "../../../generated/scheduler/zod.gen.js"
import type { SchedulerScheduleInput } from "./schedule.js"
import { isRecord } from "../../../domain/json.js"
import { canonicalSchedulerOccurrence } from "./dispatch-identity.js"

export type SchedulerControlAttempt = { kind: "response"; status: number; body: unknown } | { kind: "transport"; errorCode: string }

/** Keep owner wire decoding in this single fixed-artifact boundary. */
export function decodeSchedulerCurrent(attempt: SchedulerControlAttempt) {
  if (attempt.kind !== "response" || attempt.status !== 200) return null
  const parsed = zCurrentScheduleResponse.safeParse(attempt.body)
  return parsed.success ? parsed.data.data.schedule : null
}

export type SchedulerControlLineage = {
  tenantId: string
  requestId: string
  idempotencyKey: string
}

export class SchedulerControlClient {
  public constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs: number,
    private readonly maxResponseBytes: number,
  ) {}

  public create(name: string, body: SchedulerScheduleInput, lineage: SchedulerControlLineage): Promise<SchedulerControlAttempt> {
    return this.request("create", name, body, lineage)
  }

  public replace(name: string, body: SchedulerScheduleInput, lineage: SchedulerControlLineage): Promise<SchedulerControlAttempt> {
    return this.request("replace", name, body, lineage)
  }

  public delete(name: string, lineage: SchedulerControlLineage): Promise<SchedulerControlAttempt> {
    return this.request("delete", name, undefined, lineage)
  }

  /** Current state is a query, never the frozen result of an old mutation. */
  public async current(name: string, lineage: Pick<SchedulerControlLineage, "tenantId" | "requestId">, signal?: AbortSignal): Promise<SchedulerControlAttempt> {
    if (signal?.aborted) return { kind: "transport", errorCode: "scheduler_request_cancelled" }
    const client = createClient({ baseUrl: this.baseUrl, auth: this.serviceToken, fetch: this.boundedFetch.bind(this) })
    try {
      const result = await getCurrentSchedule({
        client,
        headers: { "X-Kokoro-Tenant-Id": lineage.tenantId, "X-Request-Id": lineage.requestId, "x-kokoro-service": "web-bff" },
        path: { name },
        ...(signal === undefined ? {} : { signal }),
      })
      if (signal?.aborted) return { kind: "transport", errorCode: "scheduler_request_cancelled" }
      const response = result.response
      if (response === undefined) return { kind: "transport", errorCode: "scheduler_response_invalid" }
      const status = response.status
      if (status === 200 && result.data !== undefined) {
        const schedule = result.data.data.schedule
        if (
          response.headers.get("cache-control") !== "no-store" ||
          response.headers.get("x-request-id") !== lineage.requestId ||
          schedule.name !== name ||
          schedule.paused !== (schedule.status === "paused") ||
          (schedule.run_at !== undefined &&
            schedule.next_due_at !== null &&
            canonicalSchedulerOccurrence(schedule.run_at) !== canonicalSchedulerOccurrence(schedule.next_due_at))
        )
          return { kind: "transport", errorCode: "scheduler_response_invalid" }
        return { kind: "response", status, body: result.data }
      }
      if (!zErrorResponse.safeParse(result.error).success || !isRecord(result.error)) {
        return { kind: "transport", errorCode: "scheduler_response_invalid" }
      }
      return { kind: "response", status, body: result.error }
    } catch {
      return { kind: "transport", errorCode: signal?.aborted ? "scheduler_request_cancelled" : "scheduler_transport_error" }
    }
  }

  private async boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const signals = [controller.signal]
      if (input instanceof Request) signals.push(input.signal)
      if (init?.signal != null) signals.push(init.signal)
      const response = await fetch(input, { ...init, signal: AbortSignal.any(signals), redirect: "error" })
      const declaredLength = Number(response.headers.get("content-length"))
      if (Number.isFinite(declaredLength) && declaredLength > this.maxResponseBytes) {
        controller.abort()
        throw new Error("Scheduler response exceeds the hard cap")
      }
      if (response.body === null) return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let consumedBytes = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          consumedBytes += chunk.value.byteLength
          if (consumedBytes > this.maxResponseBytes) {
            await reader.cancel("Scheduler response exceeds the hard cap").catch(() => undefined)
            controller.abort()
            throw new Error("Scheduler response exceeds the hard cap")
          }
          chunks.push(chunk.value)
        }
      } finally {
        reader.releaseLock()
      }
      const bytes = new Uint8Array(consumedBytes)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
    } finally {
      clearTimeout(timer)
    }
  }

  private async request(
    operation: "create" | "replace" | "delete",
    name: string,
    body: SchedulerScheduleInput | undefined,
    lineage: SchedulerControlLineage,
  ): Promise<SchedulerControlAttempt> {
    const client = createClient({ baseUrl: this.baseUrl, auth: this.serviceToken, fetch: this.boundedFetch.bind(this) })
    const options = {
      client,
      headers: {
        "X-Kokoro-Tenant-Id": lineage.tenantId,
        "X-Request-Id": lineage.requestId,
        "Idempotency-Key": lineage.idempotencyKey,
        "x-kokoro-service": "web-bff",
      },
      path: { name },
    }
    try {
      const result =
        operation === "delete"
          ? await deleteSchedule(options)
          : operation === "create"
            ? await createSchedule({ ...options, body: body as SchedulerScheduleInput })
            : await replaceSchedule({ ...options, body: body as SchedulerScheduleInput })
      const status = result.response?.status
      if (status === undefined) return { kind: "transport", errorCode: "scheduler_response_invalid" }
      if (status >= 200 && status < 300 && result.data !== undefined) return { kind: "response", status, body: result.data }
      if (!zErrorResponse.safeParse(result.error).success) return { kind: "transport", errorCode: "scheduler_response_invalid" }
      return { kind: "response", status, body: result.error }
    } catch {
      return { kind: "transport", errorCode: "scheduler_transport_error" }
    }
  }
}
