import { McpPersonalConnectClient } from "../infrastructure/clients/platform/mcp-personal-connect.js"
import { McpPersonalCredentialSource } from "../infrastructure/clients/platform/mcp-personal-credential.js"
import { McpPersonalTokenSource } from "../infrastructure/clients/platform/mcp-personal-token.js"
import { McpProviderAdminConnectClient } from "../infrastructure/clients/platform/mcp-provider-admin-connect.js"
import { McpProviderAdminCredentialSource } from "../infrastructure/clients/platform/mcp-provider-admin-credential.js"
import { McpProviderAdminTokenSource } from "../infrastructure/clients/platform/mcp-provider-admin-token.js"
import { SkillSpecificationService } from "../application/skill-specification.js"
import { PlatformSkillSpecificationFacade } from "../infrastructure/clients/platform/skill-specification-facade.js"
import { PlatformProjectionHttpClient } from "../infrastructure/clients/platform/projection-http.js"
import { IamPublisherProfileClient } from "../infrastructure/clients/iam-publisher-profile.js"
import { SkillDownloadHandles } from "../application/skill-download-handles.js"
import type { SkillSpecificationSource } from "../application/skill-specification.types.js"
import { McpAuthorizationClient } from "../auth/mcp-authorization.client.js"
import { SkillAuthorizationClient } from "../auth/skill-authorization.client.js"
import { SkillProductConnectClient } from "../infrastructure/clients/platform/skill-product-connect.js"
import { SkillAdminConnectClient } from "../infrastructure/clients/platform/skill-admin-connect.js"
import { SkillAdminCredentialSource } from "../infrastructure/clients/platform/skill-admin-credential.js"
import { SkillAdminTokenSource } from "../infrastructure/clients/platform/skill-admin-token.js"
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

import type { BffConfig } from "../config/runtime.js"
import { AgUiSessionRuntime } from "../application/agui/session-runtime.js"
import { AgUiProjectorRunner } from "../application/agui/projector.js"
import type { IdempotencyEntry, MutationTicket } from "../application/idempotency.js"
import type { BffBusinessStore } from "../application/ports/bff-business-store.js"
import { ScheduledTaskOutboxDispatcher } from "../application/scheduled-task-outbox-dispatcher.js"
import { AgentDispatchOutboxDispatcher } from "../application/agent-dispatch-outbox-dispatcher.js"
import { AgentCancellationOutboxDispatcher } from "../application/agent-cancellation-outbox-dispatcher.js"
import { SchedulerOutboxDelivery } from "../infrastructure/clients/scheduler/outbox-delivery.js"
import { AgentOutboxDelivery } from "../infrastructure/clients/agent/outbox-delivery.js"
import { AgentCancellationDelivery } from "../infrastructure/clients/agent/cancellation-delivery.js"
import { AgentAgUiSourceReader } from "../infrastructure/clients/agent/projector-source.js"
import { ScheduledAgentDispatcher } from "../application/scheduled-agent-dispatcher.js"
import { ScheduledAgentTerminalConsumer } from "../application/scheduled-agent-terminal-consumer.js"
import { ScheduledAgentDispatchDelivery } from "../infrastructure/clients/agent/scheduled-dispatch-delivery.js"
import { ScheduledAgentTerminalSource } from "../infrastructure/clients/agent/scheduled-terminal-source.js"
import { PostgresBffRepositories } from "../infrastructure/postgres/repositories.js"
import type { RequestContext } from "../domain/request-context.js"
import { SessionAdmissionClient } from "../auth/session-admission.client.js"
import type { SessionAdmission } from "../auth/session-admission.types.js"
import { CatalogCredentialSource } from "../infrastructure/clients/platform/catalog-credential.js"
import { CatalogTokenSource } from "../infrastructure/clients/platform/catalog-token.js"
import { CatalogConnectClient } from "../infrastructure/clients/platform/catalog-connect.js"
import { PersonalInstallationConnectClient } from "../infrastructure/clients/platform/personal-installation-connect.js"
import { ProjectionCredentialSource } from "../infrastructure/clients/platform/projection-credential.js"
import { ProjectionTokenSource } from "../infrastructure/clients/platform/projection-token.js"
import { ProjectScopeReleaseOutboxDispatcher } from "../application/project-scope-release-outbox-dispatcher.js"
import { StorageScopeReleaseClient } from "../infrastructure/clients/storage/scope-release-client.js"
import type { LocalSkillImportClient } from "../http/routes/local-skill-import.js"
import { LocalSkillImportConnectClient } from "../infrastructure/clients/platform/local-skill-import-connect.js"
import { ExactSkillDownloadService, exactInstallationRecord, exactManagedRecord, type ExactSkillDownloadSource } from "../application/exact-skill-download.js"
import { projectInstallation } from "../infrastructure/clients/platform/personal-installation-response.js"
import { projectSkillPackageInspectionResponse } from "../infrastructure/clients/platform/skill-package-inspection-response.js"
import { assertSkillWireKnown, skillTimestamp } from "../infrastructure/clients/platform/skill-product-response.js"

type ScheduledWorkerErrorEvent = { operation: string; result: "error"; errorCode: string; attempt: number; backoffMs: number }
function scheduledWorkerLog(event: ScheduledWorkerErrorEvent): void {
  process.stderr.write(`${JSON.stringify({ service: "kokoro-bff", ...event })}\n`)
}

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
  mcpPersonalClient: (Pick<McpPersonalConnectClient, "read"> & Partial<Pick<McpPersonalConnectClient, "close" | "command" | "authorization" | "server">>) | null
  mcpProviderAdminClient: (Pick<McpProviderAdminConnectClient, "execute"> & Partial<Pick<McpProviderAdminConnectClient, "close">>) | null
  localSkillImportClient?: LocalSkillImportClient
  skillSpecificationSource: SkillSpecificationSource | null
  skillDownloadHandles: SkillDownloadHandles
  exactSkillDownloadSource: ExactSkillDownloadSource | null
  mcpAuthorization: Pick<McpAuthorizationClient, "check">
  skillAuthorization: Pick<SkillAuthorizationClient, "check">
  skillProductClient: SkillProductConnectClient | null
  skillAdminClient: SkillAdminConnectClient | null
  skillDraftClient: CatalogConnectClient | null
  personalInstallationClient: PersonalInstallationConnectClient | null
  businessStore: BffBusinessStore | null
  sessionAdmission: SessionAdmission
  idempotency: Map<string, IdempotencyEntry>
  agUiRuntime: AgUiSessionRuntime
  agUiProjector?: AgUiProjectorRunner
  scheduledTaskDispatcher?: ScheduledTaskOutboxDispatcher
  agentDispatchDispatcher?: AgentDispatchOutboxDispatcher
  agentCancellationDispatcher?: AgentCancellationOutboxDispatcher
  scheduledAgentDispatcher?: ScheduledAgentDispatcher
  scheduledAgentTerminalConsumer?: ScheduledAgentTerminalConsumer
  projectScopeReleaseDispatcher?: ProjectScopeReleaseOutboxDispatcher
  readiness: () => Promise<void>
  stopWorkers: () => Promise<void>
  close: () => Promise<void>
  routeHandler?: BffRouteHandler
  sharedSessionReader?: {
    findSharedSession(shareId: string, scope?: string, projectRef?: string): { session_id: string } | undefined
    readSession(sessionId: string, scope?: string, projectRef?: string): unknown | undefined
  }
}

export type BffCompositionOptions = {
  mcpPersonalClient?:
    (Pick<McpPersonalConnectClient, "read"> & Partial<Pick<McpPersonalConnectClient, "close" | "command" | "authorization" | "server">>) | null
  mcpProviderAdminClient?: (Pick<McpProviderAdminConnectClient, "execute"> & Partial<Pick<McpProviderAdminConnectClient, "close">>) | null
  localSkillImportClient?: LocalSkillImportClient
  skillSpecificationSource?: SkillSpecificationSource | null
  exactSkillDownloadSource?: ExactSkillDownloadSource | null
  mcpAuthorization?: Pick<McpAuthorizationClient, "check">
  skillAuthorization?: Pick<SkillAuthorizationClient, "check">
  skillProductClient?: SkillProductConnectClient | null
  skillAdminClient?: SkillAdminConnectClient | null
  skillDraftClient?: CatalogConnectClient | null
  personalInstallationClient?: PersonalInstallationConnectClient | null
  /** Supplying null is an explicit test composition; omitted means real persistence. */
  businessStore?: BffBusinessStore | null
  sessionAdmission?: SessionAdmission
  idempotency?: Map<string, IdempotencyEntry>
  agUiRuntime?: AgUiSessionRuntime
  agUiProjector?: AgUiProjectorRunner
  scheduledTaskDispatcher?: ScheduledTaskOutboxDispatcher
  agentDispatchDispatcher?: AgentDispatchOutboxDispatcher
  agentCancellationDispatcher?: AgentCancellationOutboxDispatcher
  scheduledAgentDispatcher?: ScheduledAgentDispatcher
  scheduledAgentTerminalConsumer?: ScheduledAgentTerminalConsumer
  projectScopeReleaseDispatcher?: ProjectScopeReleaseOutboxDispatcher
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
    ledgerWait: {
      baseDelayMs: config.agUi.ledgerPollBaseDelayMs,
      maxDelayMs: config.agUi.ledgerPollMaxDelayMs,
      jitterRatio: config.agUi.ledgerPollJitterPercent / 100,
    },
    replayCacheTtlMs: config.agUi.replayCacheTtlMs,
  })
}

/** Compose production infrastructure or an explicitly supplied test seam. */
export function createBffComposition(config: BffConfig, options: BffCompositionOptions = {}): BffServerComposition {
  const sessionAdmission =
    options.sessionAdmission ??
    new SessionAdmissionClient({
      baseUrl: config.iamBaseUrl,
      timeoutMs: config.upstreamTimeoutMs,
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
  const mcpAuthorization = options.mcpAuthorization ?? new McpAuthorizationClient({ baseUrl: config.iamBaseUrl, timeoutMs: 5000, maxResponseBytes: 65_536 })
  const skillAuthorization =
    options.skillAuthorization ?? new SkillAuthorizationClient({ baseUrl: config.iamBaseUrl, timeoutMs: 5000, maxResponseBytes: 65_536 })
  const skillProductClient =
    options.skillProductClient !== undefined
      ? options.skillProductClient
      : config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile && config.iamBaseUrl
        ? new SkillProductConnectClient(
            config.skillDraft.platformBaseUrl,
            new CatalogTokenSource(config.iamBaseUrl, new CatalogCredentialSource(config.skillDraft.credentialFile), config.skillDraft.timeoutMs),
            new ProjectionTokenSource(
              config.iamBaseUrl,
              new ProjectionCredentialSource(config.platformProjection.credentialFile),
              config.platformProjection.timeoutMs,
            ),
            config.skillDraft.timeoutMs,
          )
        : null
  const skillAdminClient =
    options.skillAdminClient !== undefined
      ? options.skillAdminClient
      : config.skillDraft?.platformBaseUrl && config.skillAdminCredentialFile && config.iamBaseUrl
        ? new SkillAdminConnectClient(
            config.skillDraft.platformBaseUrl,
            new SkillAdminTokenSource(config.iamBaseUrl, new SkillAdminCredentialSource(config.skillAdminCredentialFile), config.skillDraft.timeoutMs),
            config.skillDraft.timeoutMs,
          )
        : null
  const skillDraftClient =
    options.skillDraftClient !== undefined
      ? options.skillDraftClient
      : config.skillDraft && config.skillDraft.platformBaseUrl !== null && config.skillDraft.credentialFile !== null && config.iamBaseUrl !== null
        ? new CatalogConnectClient(
            config.skillDraft.platformBaseUrl,
            new CatalogTokenSource(config.iamBaseUrl, new CatalogCredentialSource(config.skillDraft.credentialFile), config.skillDraft.timeoutMs),
            config.skillDraft.timeoutMs,
          )
        : null
  const personalInstallationClient =
    options.personalInstallationClient !== undefined
      ? options.personalInstallationClient
      : config.skillDraft &&
          config.skillDraft.platformBaseUrl !== null &&
          config.skillDraft.credentialFile !== null &&
          config.platformProjection?.credentialFile !== null &&
          config.platformProjection?.credentialFile !== undefined &&
          config.iamBaseUrl !== null
        ? new PersonalInstallationConnectClient(
            config.skillDraft.platformBaseUrl,
            new CatalogTokenSource(config.iamBaseUrl, new CatalogCredentialSource(config.skillDraft.credentialFile), config.skillDraft.timeoutMs),
            new ProjectionTokenSource(
              config.iamBaseUrl,
              new ProjectionCredentialSource(config.platformProjection.credentialFile),
              config.platformProjection.timeoutMs,
            ),
            config.skillDraft.timeoutMs,
          )
        : null
  const localSkillImportClient =
    options.localSkillImportClient !== undefined
      ? options.localSkillImportClient
      : config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile && config.iamBaseUrl
        ? new LocalSkillImportConnectClient(
            config.skillDraft.platformBaseUrl,
            new CatalogTokenSource(config.iamBaseUrl, new CatalogCredentialSource(config.skillDraft.credentialFile), config.skillDraft.timeoutMs),
            new ProjectionTokenSource(
              config.iamBaseUrl,
              new ProjectionCredentialSource(config.platformProjection.credentialFile),
              config.platformProjection.timeoutMs,
            ),
          )
        : undefined
  const explicitlySuppliedStore = Object.prototype.hasOwnProperty.call(options, "businessStore")
  const businessStore = explicitlySuppliedStore
    ? (options.businessStore ?? null)
    : config.postgresUrl !== null && config.redisUrl !== null
      ? new PostgresBffRepositories(config.postgresUrl, config.redisUrl)
      : (() => {
          throw new Error("KOKORO_BFF_POSTGRES_URL and KOKORO_BFF_REDIS_URL are required for the live BFF runtime")
        })()
  const storeReadiness =
    options.readiness ??
    (businessStore === null
      ? async (): Promise<void> => {
          throw new Error("BFF business store is not configured")
        }
      : (): Promise<void> => businessStore.ready())
  const readiness = async (): Promise<void> => {
    if (options.sessionAdmission === undefined && config.iamBaseUrl === null) throw new Error("KOKORO_IAM_BASE_URL is not configured")
    await storeReadiness()
  }
  const ownsStore = !explicitlySuppliedStore
  const scheduledTaskDispatcher =
    options.scheduledTaskDispatcher ??
    (businessStore?.scheduledTaskOutbox === undefined
      ? undefined
      : new ScheduledTaskOutboxDispatcher(businessStore.scheduledTaskOutbox, new SchedulerOutboxDelivery(config), {
          workerId: `bff-scheduled-outbox-${process.pid}-${randomUUID()}`,
        }))
  const agentDispatchDispatcher =
    options.agentDispatchDispatcher ??
    (!config.agentEnabled || config.upstreams.agents === null || businessStore?.agentDispatchOutbox === undefined
      ? undefined
      : new AgentDispatchOutboxDispatcher(businessStore.agentDispatchOutbox, new AgentOutboxDelivery(config), {
          workerId: `bff-agent-outbox-${process.pid}-${randomUUID()}`,
        }))
  const agentCancellationDispatcher =
    options.agentCancellationDispatcher ??
    (!config.agentEnabled || config.upstreams.agents === null || businessStore?.agentCancellationOutbox === undefined
      ? undefined
      : new AgentCancellationOutboxDispatcher(businessStore.agentCancellationOutbox, new AgentCancellationDelivery(config), {
          workerId: `bff-agent-cancellation-${process.pid}-${randomUUID()}`,
        }))
  const scheduledAgentDispatcher =
    options.scheduledAgentDispatcher ??
    (!config.agentEnabled || config.upstreams.agents === null || businessStore?.scheduledAgentDispatch === undefined
      ? undefined
      : new ScheduledAgentDispatcher(businessStore.scheduledAgentDispatch, new ScheduledAgentDispatchDelivery(config), {
          workerId: `bff-scheduled-agent-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        }))
  const scheduledAgentTerminalConsumer =
    options.scheduledAgentTerminalConsumer ??
    (!config.agentEnabled || config.upstreams.agents === null || businessStore?.scheduledAgentDispatch === undefined
      ? undefined
      : new ScheduledAgentTerminalConsumer(businessStore.scheduledAgentDispatch, new ScheduledAgentTerminalSource(config, config.upstreams.agents as string), {
          workerId: `bff-scheduled-terminal-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        }))
  const agentBaseUrl = config.upstreams.agents ?? null
  const agUiProjector =
    options.agUiProjector ??
    (config.agentEnabled && agentBaseUrl !== null && businessStore?.agUiConsumers !== undefined
      ? new AgUiProjectorRunner(
          businessStore.agUi,
          businessStore.agUiConsumers,
          new AgentAgUiSourceReader(config, agentBaseUrl, {
            maxAttempts: config.agUi.projectorSourceMaxAttempts,
            leaseSettlementReserveMs: config.agUi.projectorLeaseSettlementReserveMs,
          }),
          {
            workerId: `bff-agui-projector-${process.pid}-${randomUUID()}`,
            maxConsumersPerCycle: config.agUi.projectorMaxConsumersPerCycle,
            sourcePageSize: config.agUi.projectorSourcePageSize,
            maxPagesPerConsumer: config.agUi.projectorMaxPagesPerConsumer,
            leaseDurationMs: config.agUi.projectorLeaseDurationMs,
            pollIntervalMs: config.agUi.projectorPollIntervalMs,
            errorBackoffMs: config.agUi.projectorErrorBackoffMs,
            errorBackoffMaxMs: config.agUi.projectorErrorBackoffMaxMs,
            errorBackoffJitterPercent: config.agUi.projectorErrorBackoffJitterPercent,
            retentionMs: config.agUi.retentionMs,
            gcIntervalMs: config.agUi.gcIntervalMs,
            gcBatchSize: config.agUi.gcBatchSize,
            cursorTombstoneRetentionMs: config.agUi.cursorTombstoneRetentionMs,
          },
        )
      : undefined)
  const projectScopeReleaseDispatcher =
    options.projectScopeReleaseDispatcher ??
    (config.storage === undefined || businessStore?.projectScopeReleaseOutbox === undefined
      ? undefined
      : new ProjectScopeReleaseOutboxDispatcher(
          businessStore.projectScopeReleaseOutbox,
          new StorageScopeReleaseClient(config.storage.baseUrl, config.storage.secret),
          { workerId: `bff-project-scope-release-${process.pid}-${randomUUID()}` },
        ))
  const closeStore = options.close ?? (ownsStore && businessStore !== null ? (): Promise<void> => businessStore.close() : async (): Promise<void> => undefined)
  let stopWorkersPromise: Promise<void> | null = null
  const stopWorkers = (): Promise<void> => {
    if (stopWorkersPromise !== null) return stopWorkersPromise
    stopWorkersPromise = (async (): Promise<void> => {
      const projectScopeReleaseStop = projectScopeReleaseDispatcher?.stop()
      // Stop claimers first; stop() drains in-flight source reads and outbox
      // deliveries before their shared persistence connections are closed.
      await agUiProjector?.stop()
      await scheduledAgentTerminalConsumer?.stop()
      await scheduledAgentDispatcher?.stop()
      await agentCancellationDispatcher?.stop()
      await agentDispatchDispatcher?.stop()
      await scheduledTaskDispatcher?.stop()
      await projectScopeReleaseStop
    })()
    return stopWorkersPromise
  }
  const skillDownloadHandles = new SkillDownloadHandles()
  const projectionClient =
    config.platformProjection?.baseUrl && config.platformProjection.credentialFile && config.iamBaseUrl
      ? new PlatformProjectionHttpClient(
          config.platformProjection.baseUrl,
          config.iamBaseUrl,
          config.platformProjection.credentialFile,
          config.platformProjection.timeoutMs,
        )
      : null
  const mcpPersonalClient =
    options.mcpPersonalClient !== undefined
      ? options.mcpPersonalClient
      : config.mcpPersonal && config.iamBaseUrl
        ? new McpPersonalConnectClient(
            config.mcpPersonal.baseUrl,
            new McpPersonalTokenSource(config.iamBaseUrl, new McpPersonalCredentialSource(config.mcpPersonal.credentialFile), 10_000),
          )
        : null
  const mcpProviderAdminClient =
    options.mcpProviderAdminClient !== undefined
      ? options.mcpProviderAdminClient
      : config.mcpProviderAdmin && config.iamBaseUrl
        ? new McpProviderAdminConnectClient(
            config.mcpProviderAdmin.baseUrl,
            new McpProviderAdminTokenSource(
              config.iamBaseUrl,
              new McpProviderAdminCredentialSource(config.mcpProviderAdmin.credentialFile),
              config.mcpProviderAdmin.timeoutMs,
            ),
          )
        : null
  let closePromise: Promise<void> | null = null
  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise
    closePromise = (async (): Promise<void> => {
      mcpPersonalClient?.close?.()
      mcpProviderAdminClient?.close?.()
      await stopWorkers()
      skillDownloadHandles.clear()
      await closeStore()
    })()
    return closePromise
  }
  return {
    mcpPersonalClient,
    mcpProviderAdminClient,
    ...(localSkillImportClient === undefined ? {} : { localSkillImportClient }),
    skillSpecificationSource:
      options.skillSpecificationSource !== undefined
        ? options.skillSpecificationSource
        : skillProductClient &&
            personalInstallationClient &&
            config.platformProjection?.baseUrl &&
            config.platformProjection.credentialFile &&
            config.iamBaseUrl
          ? new SkillSpecificationService({
              owner: new PlatformSkillSpecificationFacade({
                product: skillProductClient,
                installations: personalInstallationClient,
                projection: projectionClient!,
              }),
              ...(businessStore?.services.projects === undefined ? {} : { projects: businessStore.services.projects }),
              profiles: new IamPublisherProfileClient(config.iamBaseUrl, config.upstreamTimeoutMs),
              ...(businessStore?.services.skillUsage === undefined ? {} : { usage: businessStore.services.skillUsage }),
              objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
            })
          : null,
    skillDownloadHandles,
    exactSkillDownloadSource:
      options.exactSkillDownloadSource !== undefined
        ? options.exactSkillDownloadSource
        : skillProductClient && personalInstallationClient && projectionClient && businessStore?.services.skillShares
          ? new ExactSkillDownloadService({
              handles: skillDownloadHandles,
              objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
              download: async (sourceRef, context, signal, deadlineAt) => {
                const value = await skillProductClient.download(
                  { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId, sourceRef },
                  signal,
                  deadlineAt,
                )
                assertSkillWireKnown(value)
                return {
                  sourceRef: value.sourceRef?.value ?? "",
                  revision: value.revision.toString(),
                  filename: value.filename,
                  sizeBytes: value.sizeBytes,
                  contentSha256: value.contentSha256,
                  transfer: {
                    url: value.transferReference?.url ?? "",
                    method: value.transferReference?.method ?? "",
                    requiredHeaders: value.transferReference?.requiredHeaders ?? {},
                    expiresAt: skillTimestamp(value.transferReference?.expiresAt),
                  },
                }
              },
              installation: async (id, context, signal) => {
                const value = projectInstallation(
                  (
                    await personalInstallationClient.get(
                      { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId, installationId: id },
                      signal,
                    )
                  ).installation,
                )
                return exactInstallationRecord(id, value)
              },
              managed: async (id, context, signal, deadlineAt) => {
                const result = await projectionClient.readManagedPersonalSkill(
                  "managedSkill",
                  context.identity.namespace,
                  context.identity.userId,
                  context.requestId,
                  { skillId: id },
                  signal,
                  deadlineAt,
                )
                if (!result.ok) {
                  if (result.status === 404) return null
                  if (result.status === 502) throw new Error("skill_response_invalid")
                  throw new Error("skill_dependency_unavailable")
                }
                return exactManagedRecord(id, result.data)
              },
              share: async (id, context, signal, deadlineAt) => {
                const share = await businessStore.services.skillShares!.findActive(context.identity.namespace, id)
                if (!share) return null
                signal.throwIfAborted()
                const raw = await skillProductClient.inspect(
                  { requestId: context.requestId, tenant: context.identity.namespace, subject: context.identity.userId, sourceRef: share.sourceRef },
                  signal,
                  deadlineAt,
                )
                assertSkillWireKnown(raw)
                const value = projectSkillPackageInspectionResponse(raw, { sourceRef: share.sourceRef })
                return { sourceRef: value.source_ref, revision: value.revision }
              },
            })
          : null,
    skillDraftClient,
    mcpAuthorization,
    skillAuthorization,
    skillProductClient,
    skillAdminClient,
    personalInstallationClient,
    businessStore,
    sessionAdmission,
    idempotency: options.idempotency ?? new Map<string, IdempotencyEntry>(),
    agUiRuntime: options.agUiRuntime ?? createAgUiRuntime(config),
    ...(agUiProjector === undefined ? {} : { agUiProjector }),
    ...(scheduledTaskDispatcher === undefined ? {} : { scheduledTaskDispatcher }),
    ...(agentDispatchDispatcher === undefined ? {} : { agentDispatchDispatcher }),
    ...(agentCancellationDispatcher === undefined ? {} : { agentCancellationDispatcher }),
    ...(scheduledAgentDispatcher === undefined ? {} : { scheduledAgentDispatcher }),
    ...(scheduledAgentTerminalConsumer === undefined ? {} : { scheduledAgentTerminalConsumer }),
    ...(projectScopeReleaseDispatcher === undefined ? {} : { projectScopeReleaseDispatcher }),
    readiness,
    stopWorkers,
    close,
    ...(options.routeHandler === undefined ? {} : { routeHandler: options.routeHandler }),
    ...(options.sharedSessionReader === undefined ? {} : { sharedSessionReader: options.sharedSessionReader }),
  }
}
