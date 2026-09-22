import { createClient } from "../../../generated/scheduler/client/client.gen.js"
import { createSchedule, deleteSchedule, replaceSchedule } from "../../../generated/scheduler/sdk.gen.js"
import { zErrorResponse } from "../../../generated/scheduler/zod.gen.js"
import type { SchedulerScheduleInput } from "./schedule.js"

export type SchedulerControlAttempt = { kind: "response"; status: number; body: unknown } | { kind: "transport"; errorCode: string }

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

  private async boundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(input, { ...init, signal: controller.signal, redirect: "error" })
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
