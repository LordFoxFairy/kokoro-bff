import { randomUUID } from "node:crypto"
import type { ReplaySessionEventsData } from "../../../generated/agent-http/types.gen.js"
import type { BffConfig } from "../../../config/runtime.js"
import type { ScheduledAgentConsumerLease } from "../../../application/ports/scheduled-agent-dispatch-repository.js"
import type { ScheduledAgentSourcePage, ScheduledAgentSourceReader } from "../../../application/scheduled-agent-terminal-consumer.js"
import { proxyUpstream } from "../../../upstream.js"
import { parseAgentHttpJson, parseReplayPage } from "./http-wire.js"
import { classifyAgentEventPage } from "./projection.js"
import { agentIdentityHeaders } from "./identity.js"
import { scheduledSourceEventDigest } from "../../../application/scheduled-source-event-digest.js"

export class ScheduledAgentTerminalSource implements ScheduledAgentSourceReader {
  public constructor(
    private readonly config: BffConfig,
    private readonly baseUrl: string,
  ) {}
  public async read(lease: ScheduledAgentConsumerLease, limit: number): Promise<ScheduledAgentSourcePage> {
    const request: Pick<ReplaySessionEventsData, "path" | "query"> = {
      path: { session_id: lease.sessionId },
      query: { after_seq: lease.sourceHighWatermark, limit },
    }
    const upstream = await proxyUpstream(
      this.config,
      this.baseUrl,
      `/v1/sessions/${encodeURIComponent(lease.sessionId)}/events?after_seq=${lease.sourceHighWatermark}&limit=${limit}`,
      "GET",
      `scheduled-terminal-${randomUUID()}`,
      new Headers({ accept: "application/json" }),
      undefined,
      agentIdentityHeaders({ namespace: lease.tenantId, userId: lease.subjectId }, `bff:scheduled-terminal:${lease.tenantId}:${lease.taskId}`),
      "kokoro-bff-scheduled-terminal",
      this.config.upstreamSecret,
      lease.leaseRemainingMs,
    )
    if (upstream.status >= 400) throw new Error(`SCHEDULED_AGENT_SOURCE_HTTP_${upstream.status}`)
    const envelope = parseReplayPage(upstream.status, parseAgentHttpJson(upstream.body))
    if (!envelope) throw new Error("SCHEDULED_AGENT_SOURCE_CONTRACT")
    const parsed = classifyAgentEventPage(envelope.data, request.path.session_id, lease.sourceHighWatermark, limit)
    if (parsed.kind !== "page") throw new Error(parsed.kind === "gap" ? "SCHEDULED_AGENT_SOURCE_GAP" : "SCHEDULED_AGENT_SOURCE_CONTRACT")
    return {
      events: parsed.page.events.map((event) => {
        const payload = {
          chat_event_id: event.chat_event_id,
          session_id: event.session_id,
          run_id: event.run_id,
          source_index: event.source_index,
          chat_message_id: event.chat_message_id,
          event_type: event.event_type,
          payload_json: event.payload_json,
          seq: event.seq,
          created_at: event.created_at,
        }
        return {
          sourceSequence: event.seq,
          sourceEventId: event.chat_event_id,
          sourceRunId: event.run_id,
          sourceDigest: scheduledSourceEventDigest(payload),
          sourceOccurredAt: new Date(event.created_at).toISOString(),
          eventType: event.event_type,
          sourcePayload: payload,
        }
      }),
      nextSequence: parsed.page.nextSequence,
      exhausted: parsed.page.exhausted,
    }
  }
}
