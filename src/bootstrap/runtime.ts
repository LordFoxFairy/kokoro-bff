import { McpProjectPublicationConnectClient } from "../infrastructure/clients/platform/mcp-project-publication-connect.js"
import type { McpProjectPublicationClient } from "../infrastructure/clients/platform/mcp-project-publication.js"
import { AppSkillBindingConnectClient } from "../infrastructure/clients/platform/app-skill-binding-connect.js"
import type { AppSkillBindingClient } from "../application/app-skill-bindings.types.js"
import { OpenAppManagementAdmissionClient, type OpenAppManagementAdmission } from "../auth/open-app-management-admission.client.js"
import { SkillListAdmissionClient, type SkillListAdmission } from "../auth/skill-list-admission.client.js"
import { McpPackageAdminConnectClient } from "../infrastructure/clients/platform/mcp-package-admin-connect.js"
import { ScheduledTaskReadService } from "../application/scheduled-task-read-service.js"
import { SchedulerTaskStateReader } from "../infrastructure/clients/scheduler/task-state-reader.js"
import { SchedulerControlClient } from "../infrastructure/clients/scheduler/control-client.js"
import { McpPersonalConnectClient } from "../infrastructure/clients/platform/mcp-personal-connect.js"
import { McpProviderAdminConnectClient } from "../infrastructure/clients/platform/mcp-provider-admin-connect.js"
import { CustomApiConnectClient } from "../infrastructure/clients/platform/custom-api-connect.js"
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
import type { IncomingMessage, ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"

import type { BffConfig } from "../config/runtime.js"
import { AgUiSessionRuntime } from "../application/agui/session-runtime.js"
import { AgUiProjectorRunner } from "../application/agui/projector.js"
import type { IdempotencyEntry, MutationTicket } from "../application/idempotency.js"
import type { BffBusinessStore } from "../application/ports/bff-business-store.js"
import type { PersonalKnowledgeRepository } from "../application/ports/personal-knowledge-repository.js"
import type { SkillUsageReader } from "../application/agui/skill-usage.js"
import type { SkillAiAssociation } from "../application/skill-ai-handoff.js"
import type { SkillShareRepository } from "../application/ports/skill-share-repository.js"
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
import type { PersonalizationProvider } from "../modules/account/personalization.provider.js"
import type { ChatApplicationService } from "../application/chat-service.js"
import type { ChatTurnApplicationService } from "../application/chat-turn-service.js"
import type { ProjectService } from "../application/project-service.js"
import type { PublicShareApplicationService } from "../application/public-share-service.js"
import type { ScheduledTaskService } from "../application/scheduled-task-service.js"
import { SessionAdmissionClient } from "../auth/session-admission.client.js"
import type { SessionAdmission } from "../auth/session-admission.types.js"
import { CatalogConnectClient } from "../infrastructure/clients/platform/catalog-connect.js"
import { SkillInstallationConnectClient } from "../infrastructure/clients/platform/skill-installation-connect.js"
import { PlatformServiceCredentialSource } from "../infrastructure/clients/platform/platform-service-credential.js"
import { ProjectScopeReleaseOutboxDispatcher } from "../application/project-scope-release-outbox-dispatcher.js"
import { StorageScopeReleaseClient } from "../infrastructure/clients/storage/scope-release-client.js"
import type { LocalSkillImportClient } from "../http/routes/local-skill-import.js"
import { skillShareRepositoryFromStore } from "../http/routes/skill-share-native.js"
import type { ProjectSkillSelectionProvider } from "../http/routes/project-skill-selection.js"
import type { ProjectMcpRecommendationsProvider } from "../http/routes/project-mcp-recommendations.js"
import { LocalSkillImportConnectClient } from "../infrastructure/clients/platform/local-skill-import-connect.js"
import { ExactSkillDownloadService, exactInstallationRecord, exactManagedRecord, type ExactSkillDownloadSource } from "../application/exact-skill-download.js"
import { projectInstallation } from "../infrastructure/clients/platform/skill-installation-response.js"
import { SkillPackageInspectionConnectClient } from "../infrastructure/clients/platform/skill-package-inspection-connect.js"
import { projectSkillPackageInspectionResponse } from "../infrastructure/clients/platform/skill-package-inspection-response.js"
import { assertSkillWireKnown, skillTimestamp } from "../infrastructure/clients/platform/skill-product-response.js"

type ScheduledWorkerErrorEvent = {
  operation: string
  result: "error"
  errorCode: string
  attempt: number
  backoffMs: number
}
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
  mcpProjectPublicationClient: McpProjectPublicationClient | null
  mcpPersonalClient:
    | (Pick<McpPersonalConnectClient, "read"> &
        Partial<Pick<McpPersonalConnectClient, "close" | "command" | "authorization" | "server" | "importJson" | "icon" | "prepareReceipt">>)
    | null
  mcpPackageAdminClient: (Pick<McpPackageAdminConnectClient, "execute"> & Partial<Pick<McpPackageAdminConnectClient, "close">>) | null
  mcpProviderAdminClient: (Pick<McpProviderAdminConnectClient, "execute"> & Partial<Pick<McpProviderAdminConnectClient, "close">>) | null
  customApiClient: (Pick<CustomApiConnectClient, "execute"> & Partial<Pick<CustomApiConnectClient, "close">>) | null
  localSkillImportClient?: LocalSkillImportClient
  skillSpecificationSource: SkillSpecificationSource | null
  skillDownloadHandles: SkillDownloadHandles
  exactSkillDownloadSource: ExactSkillDownloadSource | null
  mcpAuthorization: Pick<McpAuthorizationClient, "check">
  skillAuthorization: Pick<SkillAuthorizationClient, "check">
  skillProductClient: SkillProductConnectClient | null
  skillAdminClient: SkillAdminConnectClient | null
  skillDraftClient: CatalogConnectClient | null
  installationClient: SkillInstallationConnectClient | null
  businessStore: BffBusinessStore | null
  /** Feature-owned account personalization provider; legacy composition is only a test/runtime fallback. */
  personalizationProvider: PersonalizationProvider | null
  personalKnowledgeRepository: PersonalKnowledgeRepository | null
  skillUsageReader: SkillUsageReader | null
  skillAiAssociation: ((tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>) | null
  skillShareRepository: SkillShareRepository | null
  /** Chat-owned archive/share provider; global store fallback is transitional. */
  chatService: ChatApplicationService | null
  /** Chat-turn provider owned by AgentDispatchModule; global aggregate fallback is transitional. */
  chatTurnService: ChatTurnApplicationService | null
  /** Project-owned pin provider; global store fallback is transitional. */
  projectService: ProjectService | null
  /** ScheduledTask-owned mutation provider; global store fallback is transitional. */
  scheduledTaskService: ScheduledTaskService | null
  projectSkillSelectionProvider: ProjectSkillSelectionProvider | null
  projectMcpRecommendationsProvider: ProjectMcpRecommendationsProvider | null
  publicShareService: PublicShareApplicationService | null
  scheduledTaskReader: ScheduledTaskReadService | null
  sessionAdmission: SessionAdmission
  skillListAdmission: SkillListAdmission
  openAppManagementAdmission: OpenAppManagementAdmission
  appSkillBindingClient: AppSkillBindingClient | null
  idempotency: Map<string, IdempotencyEntry>
  agUiRuntime: AgUiSessionRuntime
  agUiProjector?: AgUiProjectorRunner
  scheduledTaskDispatcher?: ScheduledTaskOutboxDispatcher
  agentDispatchDispatcher?: AgentDispatchOutboxDispatcher
  agentCancellationDispatcher?: AgentCancellationOutboxDispatcher
  scheduledAgentDispatcher?: ScheduledAgentDispatcher
  scheduledAgentTerminalConsumer?: ScheduledAgentTerminalConsumer
  projectScopeReleaseDispatcher?: ProjectScopeReleaseOutboxDispatcher | null
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
  mcpProjectPublicationClient?: McpProjectPublicationClient | null
  mcpPersonalClient?:
    | (Pick<McpPersonalConnectClient, "read"> &
        Partial<Pick<McpPersonalConnectClient, "close" | "command" | "authorization" | "server" | "importJson" | "icon" | "prepareReceipt">>)
    | null
  mcpPackageAdminClient?: (Pick<McpPackageAdminConnectClient, "execute"> & Partial<Pick<McpPackageAdminConnectClient, "close">>) | null
  mcpProviderAdminClient?: (Pick<McpProviderAdminConnectClient, "execute"> & Partial<Pick<McpProviderAdminConnectClient, "close">>) | null
  customApiClient?: (Pick<CustomApiConnectClient, "execute"> & Partial<Pick<CustomApiConnectClient, "close">>) | null
  localSkillImportClient?: LocalSkillImportClient
  skillSpecificationSource?: SkillSpecificationSource | null
  exactSkillDownloadSource?: ExactSkillDownloadSource | null
  mcpAuthorization?: Pick<McpAuthorizationClient, "check">
  skillAuthorization?: Pick<SkillAuthorizationClient, "check">
  skillProductClient?: SkillProductConnectClient | null
  skillAdminClient?: SkillAdminConnectClient | null
  skillDraftClient?: CatalogConnectClient | null
  installationClient?: SkillInstallationConnectClient | null
  /** Supplying null is an explicit test composition; omitted means real persistence. */
  businessStore?: BffBusinessStore | null
  personalizationProvider?: PersonalizationProvider | null
  personalKnowledgeRepository?: PersonalKnowledgeRepository | null
  skillUsageReader?: SkillUsageReader | null
  skillAiAssociation?: ((tenant: string, subject: string, conversation: string, artifact: string) => Promise<SkillAiAssociation | null>) | null
  skillShareRepository?: SkillShareRepository | null
  chatService?: ChatApplicationService | null
  projectService?: ProjectService | null
  scheduledTaskService?: ScheduledTaskService | null
  projectSkillSelectionProvider?: ProjectSkillSelectionProvider | null
  projectMcpRecommendationsProvider?: ProjectMcpRecommendationsProvider | null
  publicShareService?: PublicShareApplicationService | null
  scheduledTaskReader?: ScheduledTaskReadService | null
  chatTurnService?: ChatTurnApplicationService | null
  sessionAdmission?: SessionAdmission
  skillListAdmission?: SkillListAdmission
  openAppManagementAdmission?: OpenAppManagementAdmission
  appSkillBindingClient?: AppSkillBindingClient | null
  idempotency?: Map<string, IdempotencyEntry>
  agUiRuntime?: AgUiSessionRuntime
  agUiProjector?: AgUiProjectorRunner | null
  scheduledTaskDispatcher?: ScheduledTaskOutboxDispatcher | null
  agentDispatchDispatcher?: AgentDispatchOutboxDispatcher | null
  agentCancellationDispatcher?: AgentCancellationOutboxDispatcher | null
  scheduledAgentDispatcher?: ScheduledAgentDispatcher | null
  scheduledAgentTerminalConsumer?: ScheduledAgentTerminalConsumer | null
  projectScopeReleaseDispatcher?: ProjectScopeReleaseOutboxDispatcher | null
  readiness?: () => Promise<void>
  close?: () => Promise<void>
  routeHandler?: BffRouteHandler
  sharedSessionReader?: {
    findSharedSession(shareId: string, scope?: string, projectRef?: string): { session_id: string } | undefined
    readSession(sessionId: string, scope?: string, projectRef?: string): unknown | undefined
  }
}

/**
 * The live PostgreSQL store exposes named owner services while the legacy
 * aggregate view is retained only by integration fixtures. Keeping this
 * seam local to bootstrap prevents the aggregate from becoming a runtime
 * application port again.
 */
type BffOwnerServiceStore = BffBusinessStore & {
  readonly chatService?: ChatApplicationService
  readonly chatTurnService?: ChatTurnApplicationService
  readonly projectService?: ProjectService
  readonly scheduledTaskService?: ScheduledTaskService
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
      credentialFile: config.iamSessionAdmissionCredentialFile,
      webOrigin: config.iamWebOrigin ?? config.iamRelay?.webOrigin,
      tenantId: config.tenantId,
      timeoutMs: config.upstreamTimeoutMs,
      maxResponseBytes: config.upstreamMaxResponseBytes,
    })
  const mcpAuthorization =
    options.mcpAuthorization ??
    new McpAuthorizationClient({
      baseUrl: config.iamBaseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 65_536,
    })
  const skillAuthorization =
    options.skillAuthorization ??
    new SkillAuthorizationClient({
      baseUrl: config.iamBaseUrl,
      timeoutMs: 5000,
      maxResponseBytes: 65_536,
    })
  const appSkillBindingClient =
    options.appSkillBindingClient !== undefined
      ? options.appSkillBindingClient
      : config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile
        ? new AppSkillBindingConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
            new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
            config.skillDraft.timeoutMs,
          )
        : null
  const skillProductClient =
    options.skillProductClient !== undefined
      ? options.skillProductClient
      : config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile
        ? new SkillProductConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
            new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
            config.skillDraft.timeoutMs,
          )
        : null
  const skillAdminClient =
    options.skillAdminClient !== undefined
      ? options.skillAdminClient
      : config.skillDraft?.platformBaseUrl && config.skillAdminCredentialFile
        ? new SkillAdminConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillAdminCredentialFile, "skills_admin"),
            config.skillDraft.timeoutMs,
          )
        : null
  const skillDraftClient =
    options.skillDraftClient !== undefined
      ? options.skillDraftClient
      : config.skillDraft && config.skillDraft.platformBaseUrl !== null && config.skillDraft.credentialFile !== null
        ? new CatalogConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
            config.skillDraft.timeoutMs,
          )
        : null
  const installationClient =
    options.installationClient !== undefined
      ? options.installationClient
      : config.skillDraft &&
          config.skillDraft.platformBaseUrl !== null &&
          config.skillDraft.credentialFile !== null &&
          config.platformProjection?.credentialFile !== null &&
          config.platformProjection?.credentialFile !== undefined
        ? new SkillInstallationConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
            new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
            config.skillDraft.timeoutMs,
          )
        : null
  const projectContentClient =
    config.platformProjection?.baseUrl && config.platformProjection.credentialFile
      ? new SkillPackageInspectionConnectClient(
          config.platformProjection.baseUrl,
          config.platformProjection.credentialFile,
          config.platformProjection.timeoutMs,
        )
      : null
  const localSkillImportClient =
    options.localSkillImportClient !== undefined
      ? options.localSkillImportClient
      : config.skillDraft?.platformBaseUrl && config.skillDraft.credentialFile && config.platformProjection?.credentialFile
        ? new LocalSkillImportConnectClient(
            config.skillDraft.platformBaseUrl,
            new PlatformServiceCredentialSource(config.skillDraft.credentialFile, "catalog"),
            new PlatformServiceCredentialSource(config.platformProjection.credentialFile, "projection"),
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
  const ownerServiceStore = businessStore as BffOwnerServiceStore | null
  const personalizationProvider =
    options.personalizationProvider !== undefined ? options.personalizationProvider : null
  const personalKnowledgeRepository =
    options.personalKnowledgeRepository !== undefined ? options.personalKnowledgeRepository : (businessStore?.personalKnowledge ?? null)
  const skillUsageReader = options.skillUsageReader !== undefined ? options.skillUsageReader : (businessStore?.skillUsage ?? null)
  const skillAiAssociation = options.skillAiAssociation !== undefined ? options.skillAiAssociation : (businessStore?.skillAiAssociation ?? null)
  const skillShareRepository =
    options.skillShareRepository !== undefined
      ? options.skillShareRepository
      : (skillShareRepositoryFromStore(businessStore) ?? null)
  const chatService = options.chatService !== undefined ? options.chatService : (ownerServiceStore?.chatService ?? null)
  const chatTurnService = options.chatTurnService !== undefined ? options.chatTurnService : (ownerServiceStore?.chatTurnService ?? null)
  const projectService = options.projectService !== undefined ? options.projectService : (ownerServiceStore?.projectService ?? null)
  const scheduledTaskService = options.scheduledTaskService !== undefined ? options.scheduledTaskService : (ownerServiceStore?.scheduledTaskService ?? null)
  const publicShareService =
    options.publicShareService !== undefined
      ? options.publicShareService
      : (businessStore?.publicShareService ?? null)
  const scheduledTaskReader =
    options.scheduledTaskReader !== undefined
      ? options.scheduledTaskReader
      : businessStore === null || scheduledTaskService === null
        ? null
        : new ScheduledTaskReadService(
            {
              snapshots: (scope, signal, taskId) => scheduledTaskService.snapshots(scope, signal, taskId),
            },
            new SchedulerTaskStateReader(
              config.upstreams.scheduler == null || config.schedulerServiceToken === null
                ? null
                : new SchedulerControlClient(config.upstreams.scheduler, config.schedulerServiceToken, config.upstreamTimeoutMs, config.upstreamMaxResponseBytes),
              config.schedulerTargetUrl,
            ),
          )
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
  const explicitlySuppliedScheduledTaskDispatcher = Object.prototype.hasOwnProperty.call(options, "scheduledTaskDispatcher")
  const scheduledTaskDispatcher = explicitlySuppliedScheduledTaskDispatcher
    ? (options.scheduledTaskDispatcher ?? undefined)
    : businessStore?.scheduledTaskOutbox === undefined
      ? undefined
      : new ScheduledTaskOutboxDispatcher(businessStore.scheduledTaskOutbox, new SchedulerOutboxDelivery(config), {
          workerId: `bff-scheduled-outbox-${process.pid}-${randomUUID()}`,
        })
  const explicitlySuppliedAgentDispatchDispatcher = Object.prototype.hasOwnProperty.call(options, "agentDispatchDispatcher")
  const agentDispatchDispatcher = explicitlySuppliedAgentDispatchDispatcher
    ? (options.agentDispatchDispatcher ?? undefined)
    : !config.agentEnabled || config.upstreams.agents === null || businessStore?.agentDispatchOutbox === undefined
      ? undefined
      : new AgentDispatchOutboxDispatcher(businessStore.agentDispatchOutbox, new AgentOutboxDelivery(config), {
          workerId: `bff-agent-outbox-${process.pid}-${randomUUID()}`,
        })
  const explicitlySuppliedAgentCancellationDispatcher = Object.prototype.hasOwnProperty.call(options, "agentCancellationDispatcher")
  const agentCancellationDispatcher = explicitlySuppliedAgentCancellationDispatcher
    ? (options.agentCancellationDispatcher ?? undefined)
    : !config.agentEnabled || config.upstreams.agents === null || businessStore?.agentCancellationOutbox === undefined
      ? undefined
      : new AgentCancellationOutboxDispatcher(businessStore.agentCancellationOutbox, new AgentCancellationDelivery(config), {
          workerId: `bff-agent-cancellation-${process.pid}-${randomUUID()}`,
        })
  const explicitlySuppliedScheduledAgentDispatcher = Object.prototype.hasOwnProperty.call(options, "scheduledAgentDispatcher")
  const scheduledAgentDispatcher = explicitlySuppliedScheduledAgentDispatcher
    ? (options.scheduledAgentDispatcher ?? undefined)
    : !config.agentEnabled || config.upstreams.agents === null || businessStore?.scheduledAgentDispatch === undefined
      ? undefined
      : new ScheduledAgentDispatcher(businessStore.scheduledAgentDispatch, new ScheduledAgentDispatchDelivery(config), {
          workerId: `bff-scheduled-agent-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        })
  const explicitlySuppliedScheduledAgentTerminalConsumer = Object.prototype.hasOwnProperty.call(options, "scheduledAgentTerminalConsumer")
  const scheduledAgentTerminalConsumer = explicitlySuppliedScheduledAgentTerminalConsumer
    ? (options.scheduledAgentTerminalConsumer ?? undefined)
    : !config.agentEnabled || config.upstreams.agents === null || businessStore?.scheduledAgentDispatch === undefined
      ? undefined
      : new ScheduledAgentTerminalConsumer(businessStore.scheduledAgentDispatch, new ScheduledAgentTerminalSource(config, config.upstreams.agents as string), {
          workerId: `bff-scheduled-terminal-${process.pid}-${randomUUID()}`,
          concurrency: 4,
          settlementReserveMs: 500,
          onError: scheduledWorkerLog,
        })
  const agentBaseUrl = config.upstreams.agents ?? null
  const explicitlySuppliedAgUiProjector = Object.prototype.hasOwnProperty.call(options, "agUiProjector")
  const agUiProjector = explicitlySuppliedAgUiProjector
    ? (options.agUiProjector ?? undefined)
    : config.agentEnabled && agentBaseUrl !== null && businessStore?.agUiConsumers !== undefined
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
      : undefined
  const explicitlySuppliedProjectScopeReleaseDispatcher = Object.prototype.hasOwnProperty.call(options, "projectScopeReleaseDispatcher")
  const projectScopeReleaseDispatcher = explicitlySuppliedProjectScopeReleaseDispatcher
    ? (options.projectScopeReleaseDispatcher ?? undefined)
    : config.storage === undefined || businessStore?.projectScopeReleaseOutbox === undefined
      ? undefined
      : new ProjectScopeReleaseOutboxDispatcher(
          businessStore.projectScopeReleaseOutbox,
          new StorageScopeReleaseClient(config.storage.baseUrl, config.storage.secret),
          {
            workerId: `bff-project-scope-release-${process.pid}-${randomUUID()}`,
          },
        )
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
    config.platformProjection?.baseUrl && config.platformProjection.credentialFile
      ? new PlatformProjectionHttpClient(config.platformProjection.baseUrl, config.platformProjection.credentialFile, config.platformProjection.timeoutMs)
      : null
  const mcpProjectPublicationClient =
    options.mcpProjectPublicationClient !== undefined
      ? options.mcpProjectPublicationClient
      : config.mcpPersonal
        ? new McpProjectPublicationConnectClient(
            config.mcpPersonal.baseUrl,
            new PlatformServiceCredentialSource(config.mcpPersonal.credentialFile, "mcp_personal"),
          )
        : null
  const mcpPersonalClient =
    options.mcpPersonalClient !== undefined
      ? options.mcpPersonalClient
      : config.mcpPersonal
        ? new McpPersonalConnectClient(config.mcpPersonal.baseUrl, new PlatformServiceCredentialSource(config.mcpPersonal.credentialFile, "mcp_personal"))
        : null
  const mcpProviderAdminClient =
    options.mcpProviderAdminClient !== undefined
      ? options.mcpProviderAdminClient
      : config.mcpProviderAdmin
        ? new McpProviderAdminConnectClient(
            config.mcpProviderAdmin.baseUrl,
            new PlatformServiceCredentialSource(config.mcpProviderAdmin.credentialFile, "mcp_admin"),
          )
        : null
  const mcpPackageAdminClient =
    options.mcpPackageAdminClient !== undefined
      ? options.mcpPackageAdminClient
      : config.mcpProviderAdmin
        ? new McpPackageAdminConnectClient(
            config.mcpProviderAdmin.baseUrl,
            new PlatformServiceCredentialSource(config.mcpProviderAdmin.credentialFile, "mcp_admin"),
          )
        : null
  const customApiClient =
    options.customApiClient !== undefined
      ? options.customApiClient
      : config.customApi
        ? new CustomApiConnectClient(config.customApi.baseUrl, new PlatformServiceCredentialSource(config.customApi.credentialFile, "custom_api_personal"))
        : null
  let closePromise: Promise<void> | null = null
  const close = (): Promise<void> => {
    if (closePromise !== null) return closePromise
    closePromise = (async (): Promise<void> => {
      mcpProjectPublicationClient?.close?.()
      mcpPersonalClient?.close?.()
      mcpProviderAdminClient?.close?.()
      mcpPackageAdminClient?.close?.()
      customApiClient?.close?.()
      await stopWorkers()
      skillDownloadHandles.clear()
      await closeStore()
    })()
    return closePromise
  }
  return {
    mcpProjectPublicationClient,
    mcpPersonalClient,
    mcpProviderAdminClient,
    mcpPackageAdminClient,
    customApiClient,
    ...(localSkillImportClient === undefined ? {} : { localSkillImportClient }),
    skillSpecificationSource:
      options.skillSpecificationSource !== undefined
        ? options.skillSpecificationSource
        : skillProductClient && installationClient && config.platformProjection?.baseUrl && config.platformProjection.credentialFile && config.iamBaseUrl
          ? new SkillSpecificationService({
              ...(appSkillBindingClient === null ? {} : { appBindings: appSkillBindingClient }),
              owner: new PlatformSkillSpecificationFacade({
                product: skillProductClient,
                installations: installationClient,
                projection: projectionClient!,
              }),
              ...(projectService === null ? {} : { projects: projectService }),
              profiles: new IamPublisherProfileClient(config.iamBaseUrl, config.upstreamTimeoutMs),
              ...(businessStore?.skillUsage === undefined ? {} : { usage: businessStore.skillUsage }),
              objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
            })
          : null,
    skillDownloadHandles,
    exactSkillDownloadSource:
      options.exactSkillDownloadSource !== undefined
        ? options.exactSkillDownloadSource
        : businessStore !== null && skillProductClient && installationClient && projectionClient && skillShareRepository !== null
          ? new ExactSkillDownloadService({
              handles: skillDownloadHandles,
              objectOrigin: config.storageObjectOrigin ?? config.storage?.objectOrigin ?? null,
              ...(projectContentClient
                ? {
                    projectInstallation: {
                      resolve: async (
                        projectId: string,
                        installationId: string,
                        context: import("../application/skill-specification.types.js").SkillSpecificationContext,
                        signal: AbortSignal,
                      ) => {
                        signal.throwIfAborted()
                        if (projectService === null) return null
                        const project = await projectService.find(
                          {
                            tenantId: context.identity.namespace,
                            subjectId: context.identity.userId,
                          },
                          projectId,
                        )
                        signal.throwIfAborted()
                        if (!project || project.id !== projectId) return null
                        const owner = await installationClient.get(
                          {
                            requestId: context.requestId,
                            tenant: context.identity.namespace,
                            subject: context.identity.userId,
                            projectRef: projectId,
                            installationId,
                          },
                          signal,
                        )
                        if (!("projectRef" in owner) || owner.projectRef !== projectId) throw new Error("skill_response_invalid")
                        const record = exactInstallationRecord(installationId, projectInstallation(owner.installation))
                        const current = await projectService.find(
                          {
                            tenantId: context.identity.namespace,
                            subjectId: context.identity.userId,
                          },
                          projectId,
                        )
                        signal.throwIfAborted()
                        return current?.id === projectId ? record : null
                      },
                      download: async (
                        projectId: string,
                        installationId: string,
                        context: import("../application/skill-specification.types.js").SkillSpecificationContext,
                        signal: AbortSignal,
                        deadlineAt: number,
                      ) => {
                        const value = await projectContentClient.downloadProject(
                          {
                            projectId,
                            installationId,
                            requestId: context.requestId,
                            tenant: context.identity.namespace,
                            subject: context.identity.userId,
                          },
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
                    },
                  }
                : {}),
              download: async (sourceRef, context, signal, deadlineAt) => {
                const value = await skillProductClient.download(
                  {
                    requestId: context.requestId,
                    tenant: context.identity.namespace,
                    subject: context.identity.userId,
                    sourceRef,
                  },
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
                    await installationClient.get(
                      {
                        requestId: context.requestId,
                        tenant: context.identity.namespace,
                        subject: context.identity.userId,
                        installationId: id,
                      },
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
                const share = await skillShareRepository.findActive(context.identity.namespace, id)
                if (!share) return null
                signal.throwIfAborted()
                const raw = await skillProductClient.inspect(
                  {
                    requestId: context.requestId,
                    tenant: context.identity.namespace,
                    subject: context.identity.userId,
                    sourceRef: share.sourceRef,
                  },
                  signal,
                  deadlineAt,
                )
                assertSkillWireKnown(raw)
                const value = projectSkillPackageInspectionResponse(raw, {
                  sourceRef: share.sourceRef,
                })
                return {
                  sourceRef: value.source_ref,
                  revision: value.revision,
                }
              },
            })
          : null,
    skillDraftClient,
    mcpAuthorization,
    skillAuthorization,
    skillProductClient,
    skillAdminClient,
    installationClient,
    businessStore,
    personalizationProvider,
    personalKnowledgeRepository,
    skillUsageReader,
    skillAiAssociation,
    skillShareRepository,
    chatService,
    projectService,
    scheduledTaskService,
    projectSkillSelectionProvider: options.projectSkillSelectionProvider ?? null,
    projectMcpRecommendationsProvider: options.projectMcpRecommendationsProvider ?? null,
    publicShareService,
    chatTurnService,
    scheduledTaskReader,
    sessionAdmission,
    appSkillBindingClient,
    openAppManagementAdmission:
      options.openAppManagementAdmission ??
      new OpenAppManagementAdmissionClient({
        baseUrl: config.iamBaseUrl,
        timeoutMs: config.upstreamTimeoutMs,
        maxResponseBytes: config.upstreamMaxResponseBytes,
      }),
    skillListAdmission:
      options.skillListAdmission ??
      new SkillListAdmissionClient({
        baseUrl: config.iamBaseUrl,
        timeoutMs: config.upstreamTimeoutMs,
        maxResponseBytes: config.upstreamMaxResponseBytes,
      }),
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
