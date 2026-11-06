import { performance } from "node:perf_hooks"
import type { PoolClient } from "pg"

import type { BffConfig } from "../../config/runtime.js"
import { deliverRunSteer, type SteerDeliveryCommand, type SteerDeliveryResult } from "../clients/agent/steer-delivery.js"
import { acquireChatClient, startWithinChatDeadline } from "./chat-turn-commit.js"
import type { PostgresBffDatabase } from "./client.js"

type SteerLease = SteerDeliveryCommand & { lease_token: string; attempt_count: number }

const pollMs = 250
const queryBudgetMs = 1000
const ownerBudgetMs = 2000

/** Independent bounded tick: waiting for a steer never queues behind or blocks cancel. */
export class RunSteerDispatcher {
  private timer: ReturnType<typeof setInterval> | undefined
  private active: Promise<void> | undefined
  private controller: AbortController | undefined

  public constructor(private readonly database: PostgresBffDatabase, private readonly config: BffConfig) {}

  public start(): void {
    if (this.controller !== undefined) return
    const controller = new AbortController()
    this.controller = controller
    const tick = (): void => {
      if (controller.signal.aborted || this.active !== undefined) return
      this.active = this.dispatchOne(controller.signal).catch(() => undefined).finally(() => { this.active = undefined })
    }
    this.timer = setInterval(tick, pollMs)
    this.timer.unref?.()
    tick()
  }

  public async stop(): Promise<void> {
    clearInterval(this.timer)
    this.controller?.abort()
    await this.active
    this.controller = undefined
  }

  private async dispatchOne(signal: AbortSignal): Promise<void> {
    const command = await this.query(signal, async (client) => (await client.query<SteerLease>(
      `WITH candidate AS (
         SELECT steer.agent_command_id
           FROM bff_run_steer AS steer
           JOIN bff_conversation AS conversation ON conversation.tenant_id=steer.tenant_id
             AND conversation.conversation_id=steer.conversation_id AND conversation.owner_id=steer.subject_id AND conversation.status='active'
           JOIN bff_message AS message ON message.message_id=steer.message_id AND message.tenant_id=steer.tenant_id
             AND message.conversation_id=steer.conversation_id AND message.run_id=steer.run_id AND message.role='user' AND message.status='pending'
          WHERE steer.settled_at IS NULL AND steer.available_at<=CURRENT_TIMESTAMP
            AND (steer.lease_until IS NULL OR steer.lease_until<=CURRENT_TIMESTAMP)
          ORDER BY steer.available_at,steer.created_at,steer.agent_command_id LIMIT 1 FOR UPDATE OF steer SKIP LOCKED
       ), leased AS (
         UPDATE bff_run_steer AS steer SET lease_token=gen_random_uuid()::text,lease_until=clock_timestamp()+INTERVAL '6 seconds',
           attempt_count=LEAST(8,steer.attempt_count+1)
         FROM candidate WHERE steer.agent_command_id=candidate.agent_command_id
         RETURNING steer.tenant_id,steer.subject_id,steer.actor_id,steer.request_id,steer.identity_assertion_ref,
                   steer.agent_command_id,steer.run_id,steer.conversation_id,steer.message_id,steer.lease_token,steer.attempt_count
       )
       SELECT leased.tenant_id,leased.subject_id,leased.actor_id,leased.request_id,leased.identity_assertion_ref,
              leased.agent_command_id,leased.run_id,leased.conversation_id,leased.message_id,leased.lease_token,leased.attempt_count,message.content
         FROM leased JOIN bff_message AS message ON message.message_id=leased.message_id AND message.tenant_id=leased.tenant_id
           AND message.conversation_id=leased.conversation_id AND message.run_id=leased.run_id AND message.role='user'`,
    )).rows[0])
    if (command === undefined || signal.aborted) return
    const result = await deliverRunSteer(this.config, command, ownerBudgetMs)
    if (signal.aborted) return // Leave the bounded lease recoverable across shutdown.
    await this.settle(command, result, signal)
  }

  private async settle(command: SteerLease, result: SteerDeliveryResult, signal: AbortSignal): Promise<void> {
    const messageStatus = result.status === "succeeded" ? "completed" : result.status === "failed" ? "failed" : null
    const delay = result.status === "pending" ? 500 : Math.min(15_000, 250 * 2 ** command.attempt_count)
    await this.query(signal, (client) => client.query(
      `WITH claim AS MATERIALIZED (
         SELECT steer.tenant_id,steer.conversation_id,steer.run_id,steer.message_id
           FROM bff_run_steer AS steer
          WHERE steer.agent_command_id=$1 AND steer.lease_token=$2 AND steer.settled_at IS NULL AND steer.lease_until>clock_timestamp()
          FOR UPDATE
       ), settled_message AS (
         UPDATE bff_message AS message SET status=$3,updated_at=CURRENT_TIMESTAMP(3)
           FROM claim WHERE $3::text IS NOT NULL AND message.message_id=claim.message_id AND message.tenant_id=claim.tenant_id
            AND message.conversation_id=claim.conversation_id AND message.run_id=claim.run_id AND message.role='user' AND message.status='pending'
         RETURNING message.message_id
       )
       UPDATE bff_run_steer AS steer SET lease_token=NULL,lease_until=NULL,
              available_at=clock_timestamp()+($5::int*INTERVAL '1 millisecond'),
              settled_at=CASE WHEN $3::text IS NULL THEN NULL ELSE clock_timestamp() END,error_code=$4
         FROM claim WHERE steer.agent_command_id=$1 AND steer.message_id=claim.message_id
          AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM settled_message))`,
      [command.agent_command_id, command.lease_token, messageStatus, result.status === "failed" ? result.errorCode ?? null : null, delay],
    ))
  }

  private async query<T>(signal: AbortSignal, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const deadline = performance.now() + queryBudgetMs
    const client = await acquireChatClient(this.database, deadline, signal)
    let discard = false
    const onError = (): void => { discard = true }
    client.on("error", onError)
    try {
      return await startWithinChatDeadline(deadline, "RUN_STEER_WORKER_TIMEOUT", () => run(client), onError, undefined, signal)
    } finally {
      client.release(discard)
      client.removeListener("error", onError)
    }
  }
}
