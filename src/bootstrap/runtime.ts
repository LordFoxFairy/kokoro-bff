import type { IncomingMessage, ServerResponse } from "node:http"

import type { BffConfig } from "../config/runtime.js"
import { AgUiSessionRuntime } from "../application/agui/session-runtime.js"
import type { IdempotencyEntry, MutationTicket } from "../application/idempotency.js"
import type { BffBusinessStore } from "../application/ports/bff-business-store.js"
import { PostgresBffRepositories } from "../infrastructure/postgres/repositories.js"
import type { RequestContext } from "../domain/request-context.js"

export type BffRouteInput = {
  request: IncomingMessage
  response: ServerResponse
  businessPath: string[]
  context: RequestContext
  body: Buffer | undefined
  json: Record<string, unknown>
  mutation: MutationTicket | null
  idempotency: Map<string, IdempotencyEntry>
}

/** A deliberately explicit test seam; production composition leaves it unset. */
export type BffRouteHandler = (input: BffRouteInput) => Promise<boolean | void>

export type BffServerComposition = {
  businessStore: BffBusinessStore | null
  idempotency: Map<string, IdempotencyEntry>
  agUiRuntime: AgUiSessionRuntime
  readiness: () => Promise<void>
  close: () => Promise<void>
  routeHandler?: BffRouteHandler
  sharedSessionReader?: {
    findSharedSession(shareId: string, scope?: string, projectRef?: string): { session_id: string } | undefined
    readSession(sessionId: string, scope?: string, projectRef?: string): unknown | undefined
  }
}

export type BffCompositionOptions = {
  /** Supplying null is an explicit test composition; omitted means real persistence. */
  businessStore?: BffBusinessStore | null
  idempotency?: Map<string, IdempotencyEntry>
  agUiRuntime?: AgUiSessionRuntime
  readiness?: () => Promise<void>
  close?: () => Promise<void>
  routeHandler?: BffRouteHandler
  sharedSessionReader?: {
    findSharedSession(shareId: string, scope?: string, projectRef?: string): { session_id: string } | undefined
    readSession(sessionId: string, scope?: string, projectRef?: string): unknown | undefined
  }
}

function createAgUiRuntime(config: BffConfig): AgUiSessionRuntime {
  return new AgUiSessionRuntime({
    connections: {
      global: config.agUi.maxConnectionsGlobal,
      perTenant: config.agUi.maxConnectionsPerTenant,
      perSession: config.agUi.maxConnectionsPerSession,
    },
    poll: {
      baseDelayMs: config.agUi.pollBaseDelayMs,
      maxDelayMs: config.agUi.pollMaxDelayMs,
      jitterRatio: config.agUi.pollJitterPercent / 100,
    },
    replayCacheTtlMs: config.agUi.replayCacheTtlMs,
  })
}

/** Compose production infrastructure or an explicitly supplied test seam. */
export function createBffComposition(config: BffConfig, options: BffCompositionOptions = {}): BffServerComposition {
  const explicitlySuppliedStore = Object.prototype.hasOwnProperty.call(options, "businessStore")
  const businessStore = explicitlySuppliedStore
    ? (options.businessStore ?? null)
    : config.postgresUrl !== null && config.redisUrl !== null
      ? new PostgresBffRepositories(config.postgresUrl, config.redisUrl)
      : (() => { throw new Error("KOKORO_BFF_POSTGRES_URL and KOKORO_BFF_REDIS_URL are required for the live BFF runtime") })()
  const readiness = options.readiness ?? (businessStore === null
    ? async (): Promise<void> => { throw new Error("BFF business store is not configured") }
    : (): Promise<void> => businessStore.ready())
  const ownsStore = !explicitlySuppliedStore
  const close = options.close ?? (ownsStore && businessStore !== null
    ? (): Promise<void> => businessStore.close()
    : async (): Promise<void> => undefined)
  return {
    businessStore,
    idempotency: options.idempotency ?? new Map<string, IdempotencyEntry>(),
    agUiRuntime: options.agUiRuntime ?? createAgUiRuntime(config),
    readiness,
    close,
    ...(options.routeHandler === undefined ? {} : { routeHandler: options.routeHandler }),
    ...(options.sharedSessionReader === undefined ? {} : { sharedSessionReader: options.sharedSessionReader }),
  }
}
