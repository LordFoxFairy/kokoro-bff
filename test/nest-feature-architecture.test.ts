import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const featureModules = ["account", "chat", "agent-runs", "projects", "agui", "scheduled-tasks", "skills", "mcp", "billing", "system", "music"] as const

test("AppModule registers the canonical feature graph", async () => {
  const appModule = await readFile(path.join(root, "src/app.module.ts"), "utf8")
  for (const feature of featureModules) {
    assert.equal(appModule.includes(`./modules/${feature}/${feature}.module.js`), true, `${feature} must be registered by AppModule`)
    assert.equal(await fileExists(`src/modules/${feature}/${feature}.module.ts`), true, `${feature} module must exist`)
  }
})

test("feature controllers do not receive transport or database primitives", async () => {
  const controllers = await readTypeScriptFiles("src/modules")
  for (const { relativePath, source } of controllers.filter(({ relativePath }) => relativePath.endsWith(".controller.ts"))) {
    assert.doesNotMatch(source, /node:(?:http|pg)/u, `${relativePath} must not import node:http or pg`)
    assert.doesNotMatch(source, /from ["']redis["']/u, `${relativePath} must not import redis`)
    assert.doesNotMatch(source, /IncomingMessage|ServerResponse|PoolClient|RedisClient/u, `${relativePath} must not receive raw transport/database clients`)
  }
})

test("scheduled-task state reader port is owned by its feature module", async () => {
  assert.equal(await fileExists("src/modules/scheduled-tasks/scheduled-task-state-reader.ts"), true)
  assert.equal(await fileExists("src/application/ports/scheduled-task-state-reader.ts"), false)
})

test("AccountModule owns the SessionAdmission provider", async () => {
  const [accountModule, middleware, nativeRoute, server, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/account/account.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/admin-identity-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(accountModule, /provide: SESSION_ADMISSION/u)
  assert.match(accountModule, /PERSONAL_KNOWLEDGE_REPOSITORY/u)
  assert.match(accountModule, /exports: \[[^\]]*SESSION_ADMISSION/u)
  assert.match(runtime, /sessionAdmission/u)
  assert.match(middleware, /handleAdminIdentityRequest/u)
  assert.match(nativeRoute, /handleAdminIdentityRequest/u)
  assert.match(server, /handleAdminIdentityRequest/u)
  assert.doesNotMatch(server, /await liveAdminIdentityRead\(/u)
})

test("IamRelayModule owns the native protocol relay before the transitional dispatcher", async () => {
  const [moduleSource, middleware, server] = await Promise.all([
    readFile(path.join(root, "src/modules/iam-relay/iam-relay.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/iam-relay/iam-relay.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(moduleSource, /IamRelayMiddleware/u)
  assert.match(middleware, /iamProtocolRelay/u)
  assert.doesNotMatch(server, /startsWith\("\/iam"\)/u)
})

test("BillingModule owns personal and administrator billing routes", async () => {
  const [moduleSource, middleware, personalMiddleware, personalRoute, nativeRoute, server, owner] = await Promise.all([
    readFile(path.join(root, "src/modules/billing/billing.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/billing/billing-admin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/billing/billing-personal.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/billing-personal-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/billing-admin-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  assert.match(moduleSource, /BillingAdminMiddleware/u)
  assert.match(moduleSource, /BillingPersonalMiddleware/u)
  assert.match(moduleSource, /BILLING_IDEMPOTENCY/u)
  assert.match(middleware, /handleBillingAdminRequest/u)
  assert.match(personalMiddleware, /BillingPersonalMiddleware/u)
  assert.match(personalRoute, /handleBillingPersonalBusiness/u)
  assert.match(nativeRoute, /handleBillingAdminRequest/u)
  assert.match(server, /handleBillingAdminRequest/u)
  assert.match(server, /handleBillingPersonalBusiness/u)
  assert.doesNotMatch(owner, /billingPersonalRead|readBillingCatalog|initializeBillingCreditAccount/u)
  assert.doesNotMatch(server, /await liveAdminCreditGrant\(/u)
  assert.doesNotMatch(server, /await liveAdminMetering\(/u)
})

test("SystemModule owns model catalog and administrator configuration/routing routes", async () => {
  const [moduleSource, middleware, modelMiddleware, modelRoute, nativeRoute, server, owner] = await Promise.all([
    readFile(path.join(root, "src/modules/system/system.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/system/system.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/system/system-model-catalog.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/system-model-catalog-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/system-admin-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  assert.match(moduleSource, /AccountModule/u)
  assert.match(moduleSource, /SystemModelCatalogMiddleware/u)
  assert.match(middleware, /handleSystemAdminRequest/u)
  assert.match(modelMiddleware, /SystemModelCatalogMiddleware/u)
  assert.match(modelRoute, /handleSystemModelCatalogBusiness/u)
  assert.match(nativeRoute, /handleSystemAdminRequest/u)
  assert.match(server, /handleSystemAdminRequest/u)
  assert.match(server, /handleSystemModelCatalogBusiness/u)
  assert.doesNotMatch(owner, /modelCatalogData|businessPath\.length === 1 && businessPath\[0\] === "models"/u)
  assert.doesNotMatch(server, /await liveModelConfigurationAdmin\(/u)
  assert.doesNotMatch(server, /await liveModelRoutingAdmin\(/u)
})

test("MusicModule owns the Mori owner adapter and idempotency seam", async () => {
  const [moduleSource, middleware, nativeRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/music/music.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/music/music.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/music-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(moduleSource, /MUSIC_IDEMPOTENCY/u)
  assert.match(moduleSource, /MusicMiddleware/u)
  assert.match(middleware, /handleMoriRequest/u)
  assert.match(nativeRoute, /liveMoriBusiness/u)
  assert.match(server, /handleMoriRequest/u)
  assert.doesNotMatch(server, /isMoriBusinessPath|liveMoriBusiness/u)
})

test("ChatModule owns the archive/share adapters and chat provider", async () => {
  const [chatModule, middleware, nativeRoute, sharedNativeRoute, feedbackRoute, regenerationNativeRoute, mutationRoute, eventsRoute, messageRoute, aguiModule, server] = await Promise.all([
    readFile(path.join(root, "src/modules/chat/chat.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/chat/chat.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/shared-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/message-feedback-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/message-regeneration-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-mutation-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-events-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-message-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agui/agui.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(chatModule, /provide: CHAT_SERVICE/u)
  assert.match(chatModule, /CHAT_TURN_SERVICE/u)
  assert.match(chatModule, /ChatMiddleware/u)
  assert.match(chatModule, /forRoutes\(\{ path: "\*", method: RequestMethod\.ALL \}\)/u)
  assert.match(middleware, /handleChatNativeRequest/u)
  assert.match(middleware, /handleMessageFeedbackRequest/u)
  assert.match(middleware, /handleMessageRegenerationRequest/u)
  assert.match(middleware, /handleChatBusinessReadRequest/u)
  assert.match(middleware, /handleMoveSessionRequest/u)
  assert.match(middleware, /handleChatMutationRequest/u)
  assert.match(middleware, /handleChatEventsRequest/u)
  assert.match(nativeRoute, /archivedTasksRoute/u)
  assert.match(nativeRoute, /sharedTasksRoute/u)
  assert.match(feedbackRoute, /messageFeedbackRoute/u)
  assert.match(regenerationNativeRoute, /messageRegenerationRoute/u)
  assert.match(mutationRoute, /liveChatBusiness/u)
  assert.match(mutationRoute, /mutationTicket/u)
  assert.match(chatModule, /CHAT_IDEMPOTENCY/u)
  assert.match(chatModule, /ProjectAccessModule/u)
  assert.match(chatModule, /SkillInstallationAccessModule/u)
  assert.match(eventsRoute, /liveAgentSession/u)
  assert.match(eventsRoute, /registerConsumer/u)
  assert.match(messageRoute, /liveChatBusiness/u)
  assert.match(messageRoute, /commitChatTurn|chatTurns/u)
  assert.match(aguiModule, /AGUI_PROJECTION/u)
  assert.match(aguiModule, /AGUI_RUNTIME/u)
  assert.match(server, /handleChatNativeRequest/u)
  assert.match(server, /handleMessageFeedbackRequest/u)
  assert.doesNotMatch(server, /await archivedTasksRoute\(/u)
  assert.doesNotMatch(server, /await sharedTasksRoute\(/u)
  assert.doesNotMatch(server, /await messageFeedbackRoute\(/u)
  assert.match(server, /handleMoveSessionRequest/u)
  assert.doesNotMatch(server, /await moveSessionRoute\(/u)
  assert.match(chatModule, /PUBLIC_SHARE_SERVICE/u)
  assert.match(chatModule, /SKILL_AI_ASSOCIATION/u)
  assert.match(middleware, /handleSharedPublicRequest/u)
  assert.match(sharedNativeRoute, /publicShareSnapshot/u)
  assert.doesNotMatch(server, /segments\[1\] === "shared"/u)
})

test("Chat public-share capability port is feature-local", async () => {
  assert.equal(await fileExists("src/application/chat/public-share-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/public-share-repository.ts"), false)
  const [service, repository] = await Promise.all([
    readFile(path.join(root, "src/application/public-share-service.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/public-share-repository.ts"), "utf8"),
  ])
  assert.match(service, /chat\/public-share-repository\.js/u)
  assert.match(repository, /application\/chat\/public-share-repository\.js/u)
})

test("Chat repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/chat/chat-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/chat-repository.ts"), false)
  const [service, route, repository, publicShare] = await Promise.all([
    readFile(path.join(root, "src/application/chat-service.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/chat-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/public-share-repository.ts"), "utf8"),
  ])
  assert.match(service, /chat\/chat-repository\.js/u)
  assert.match(route, /application\/chat\/chat-repository\.js/u)
  assert.match(repository, /application\/chat\/chat-repository\.js/u)
  assert.match(publicShare, /application\/chat\/chat-repository\.js/u)
})

test("Skills share capability port is feature-local", async () => {
  assert.equal(await fileExists("src/application/skills/skill-share-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/skill-share-repository.ts"), false)
  const [middleware, moduleSource, route, repository, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/skills/skills.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/skills/skills.module.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-share.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/skill-share-repository.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(middleware, /application\/skills\/skill-share-repository\.js/u)
  assert.match(moduleSource, /SKILL_SHARE_REPOSITORY/u)
  assert.match(route, /application\/skills\/skill-share-repository\.js/u)
  assert.match(repository, /application\/skills\/skill-share-repository\.js/u)
  assert.match(runtime, /application\/skills\/skill-share-repository\.js/u)
})

test("Account personal-knowledge repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/account/personal-knowledge-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/personal-knowledge-repository.ts"), false)
  const [middleware, route, repository, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/personal-knowledge-native.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/personal-knowledge-repository.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(middleware, /application\/account\/personal-knowledge-repository\.js/u)
  assert.match(route, /application\/account\/personal-knowledge-repository\.js/u)
  assert.match(repository, /application\/account\/personal-knowledge-repository\.js/u)
  assert.match(runtime, /application\/account\/personal-knowledge-repository\.js/u)
})

test("Account library artifact repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/account/artifact-library-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/artifact-library-repository.ts"), false)
  const [moduleSource, middleware, route, repository, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/account/library.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/library-native.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/conversation-artifact-library.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(moduleSource, /application\/account\/artifact-library-repository\.js/u)
  assert.match(middleware, /application\/account\/artifact-library-repository\.js/u)
  assert.match(route, /application\/account\/artifact-library-repository\.js/u)
  assert.match(repository, /application\/account\/artifact-library-repository\.js/u)
  assert.match(runtime, /application\/account\/artifact-library-repository\.js/u)
})

test("Projects repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/projects/project-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/project-repository.ts"), false)
  const [service, specification, route, repository, runtime] = await Promise.all([
    readFile(path.join(root, "src/application/project-service.ts"), "utf8"),
    readFile(path.join(root, "src/application/skill-specification.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-native.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/project-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/repositories.ts"), "utf8"),
  ])
  assert.match(service, /projects\/project-repository\.js/u)
  assert.match(specification, /projects\/project-repository\.js/u)
  assert.match(route, /application\/projects\/project-repository\.js/u)
  assert.match(repository, /application\/projects\/project-repository\.js/u)
  assert.match(runtime, /application\/projects\/project-repository\.js/u)
})

test("ProjectsModule owns the project command/read adapters and provider", async () => {
  const [projectsModule, accessModule, middleware, mutationMiddleware, nativeRoute, packageMiddleware, downloadMiddleware, server] = await Promise.all([
    readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-access.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-pin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-mutation.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-skill-package-inspection.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-skill-download.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(projectsModule, /ProjectAccessModule/u)
  assert.match(accessModule, /provide: PROJECT_SERVICE/u)
  assert.match(projectsModule, /ProjectPinMiddleware/u)
  assert.match(projectsModule, /ProjectMutationMiddleware/u)
  assert.match(projectsModule, /PROJECT_IDEMPOTENCY/u)
  assert.match(projectsModule, /ProjectSkillPackageInspectionMiddleware/u)
  assert.match(projectsModule, /PROJECT_EXACT_DOWNLOAD_SOURCE/u)
  assert.match(projectsModule, /ProjectSkillDownloadMiddleware/u)
  assert.match(packageMiddleware, /handleSkillPackageInspectionRequest/u)
  assert.match(downloadMiddleware, /handleSkillDownloadRequest/u)
  assert.match(downloadMiddleware, /SKILL_EXACT_DOWNLOAD_SOURCE/u)
  assert.match(downloadMiddleware, /SKILL_SPECIFICATION_SOURCE/u)
  assert.match(middleware, /handleProjectPinRequest/u)
  assert.match(middleware, /handleProjectDeletionStatusRequest/u)
  assert.match(middleware, /handleProjectRenameRequest/u)
  assert.match(middleware, /handleProjectDeleteRequest/u)
  assert.match(middleware, /handleProjectResourceListRequest/u)
  assert.match(middleware, /handleProjectResourceDeleteRequest/u)
  assert.match(middleware, /handleProjectResourceUploadRequest/u)
  assert.match(middleware, /handleProjectResourceReadRequest/u)
  assert.match(middleware, /handleProjectCoreReadRequest/u)
  assert.match(mutationMiddleware, /ProjectMutationMiddleware/u)
  assert.match(mutationMiddleware, /PROJECT_IDEMPOTENCY/u)
  assert.match(mutationMiddleware, /handleProjectMutationBusiness/u)
  assert.match(nativeRoute, /tasks\(scope/u)
  assert.match(middleware, /handleProjectSkillSelectionRequest/u)
  assert.match(middleware, /handleProjectSkillInstallationRequest/u)
  assert.match(projectsModule, /PROJECT_SKILL_SELECTION_PROVIDER/u)
  assert.match(middleware, /SKILL_AUTHORIZATION/u)
  assert.match(nativeRoute, /projectPinRoute/u)
  assert.match(nativeRoute, /handleProjectDeletionStatusRequest/u)
  assert.match(nativeRoute, /handleProjectRenameRequest/u)
  assert.match(nativeRoute, /handleProjectDeleteRequest/u)
  assert.match(nativeRoute, /handleProjectResourceListRequest/u)
  assert.match(nativeRoute, /handleProjectResourceDeleteRequest/u)
  assert.match(nativeRoute, /handleProjectResourceUploadRequest/u)
  assert.match(nativeRoute, /handleProjectResourceReadRequest/u)
  assert.match(nativeRoute, /handleProjectCoreReadRequest/u)
  assert.match(server, /handleProjectPinRequest/u)
  assert.match(server, /handleProjectDeletionStatusRequest/u)
  assert.match(server, /handleProjectRenameRequest/u)
  assert.match(server, /handleProjectDeleteRequest/u)
  assert.match(server, /handleProjectResourceListRequest/u)
  assert.match(server, /handleProjectResourceDeleteRequest/u)
  assert.match(server, /handleProjectResourceUploadRequest/u)
  assert.match(server, /handleProjectResourceReadRequest/u)
  assert.match(server, /handleProjectSkillSelectionRequest/u)
  assert.doesNotMatch(server, /await projectPinRoute\(/u)
  assert.doesNotMatch(server, /await projectDeletionStatusRoute\(/u)
  assert.doesNotMatch(server, /await projectRenameRoute\(/u)
  assert.doesNotMatch(server, /await projectDeleteRoute\(/u)
  assert.doesNotMatch(server, /await projectResourceListRoute\(/u)
  assert.doesNotMatch(server, /await projectResourceDeleteRoute\(/u)
  assert.doesNotMatch(server, /await projectResourceReadRoute\(/u)
  assert.doesNotMatch(server, /await projectResourceRoute\(/u)
  assert.doesNotMatch(server, /await projectSkillSelectionRoute\(/u)
  assert.doesNotMatch(server, /isProjectInstallationPath \? .*skillInstallationRoute/u)
})

test("ProjectsModule owns project-scope release worker lifecycle", async () => {
  const [projectsModule, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(projectsModule, /provide: PROJECT_SCOPE_RELEASE_OUTBOX/u)
  assert.match(projectsModule, /provide: PROJECT_SCOPE_RELEASE_DISPATCHER/u)
  assert.match(projectsModule, /ProjectScopeReleaseWorkerLifecycle/u)
  assert.match(runtime, /explicitlySuppliedProjectScopeReleaseDispatcher/u)
})

test("ScheduledTasksModule owns the current-state read adapter and provider", async () => {
  const [scheduledModule, middleware, nativeRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-task-read.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/scheduled-task-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_READ_SERVICE/u)
  assert.match(scheduledModule, /ScheduledTaskReadMiddleware/u)
  assert.match(middleware, /handleScheduledTaskReadRequest/u)
  assert.match(nativeRoute, /scheduledTaskReadRoute/u)
  assert.match(server, /handleScheduledTaskReadRequest/u)
  assert.doesNotMatch(server, /await scheduledTaskReadRoute\(/u)
})

test("ScheduledTasksModule owns the scheduled outbox worker lifecycle", async () => {
  const [scheduledModule, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_OUTBOX/u)
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_DISPATCHER/u)
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_REPOSITORY/u)
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_SERVICE/u)
  assert.match(scheduledModule, /provide: SCHEDULER_DISPATCH_RECEIPTS/u)
  assert.match(scheduledModule, /SchedulerDispatchMiddleware/u)
  assert.match(scheduledModule, /ScheduledTaskWorkerLifecycle/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_DISPATCH_REPOSITORY/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_DISPATCHER/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_TERMINAL_CONSUMER/u)
  assert.match(runtime, /explicitlySuppliedScheduledTaskDispatcher/u)
  assert.match(runtime, /explicitlySuppliedScheduledAgentDispatcher/u)
  assert.match(runtime, /explicitlySuppliedScheduledAgentTerminalConsumer/u)
})

test("AgentRunsModule owns internal admission and execution-binding adapters", async () => {
  const [agentModule, middleware, nativeRoute, controlRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent-runs-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent-control-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(agentModule, /provide: AGENT_RUNS_READER/u)
  assert.match(agentModule, /AgentRunsMiddleware/u)
  assert.match(middleware, /handleAgentRunsInternalRequest/u)
  assert.match(middleware, /handleAgentControlRequest/u)
  assert.match(nativeRoute, /agentModelAdmissionRoute/u)
  assert.match(nativeRoute, /projectExecutionBindingRoute/u)
  assert.match(controlRoute, /liveAgentSession/u)
  assert.match(server, /handleAgentRunsInternalRequest/u)
  assert.doesNotMatch(server, /await agentModelAdmissionRoute\(/u)
  assert.doesNotMatch(server, /await projectExecutionBindingRoute\(/u)
})

test("AgentRunsModule owns the run-display adapter and provider seam", async () => {
  const [agentModule, middleware, nativeRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/run-display.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(agentModule, /provide: RUN_DISPLAY_PROVIDER/u)
  assert.match(middleware, /handleRunDisplayRequest/u)
  assert.match(nativeRoute, /runDisplayRoute/u)
  assert.match(server, /handleRunDisplayRequest/u)
  assert.doesNotMatch(server, /await runDisplayRoute\(/u)
})

test("AgentDispatchModule owns Agent outbox worker lifecycle", async () => {
  const [dispatchModule, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-dispatch/agent-dispatch.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(dispatchModule, /provide: AGENT_DISPATCH_DISPATCHER/u)
  assert.match(dispatchModule, /provide: AGENT_CANCELLATION_DISPATCHER/u)
  assert.match(dispatchModule, /AgentDispatchWorkerLifecycle/u)
  assert.match(dispatchModule, /onModuleInit/u)
  assert.match(dispatchModule, /onApplicationShutdown/u)
  assert.match(runtime, /explicitlySuppliedAgentDispatchDispatcher/u)
  assert.match(runtime, /explicitlySuppliedAgentCancellationDispatcher/u)
})

test("AguiModule owns the projector lifecycle", async () => {
  const [aguiModule, runtime] = await Promise.all([
    readFile(path.join(root, "src/modules/agui/agui.module.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/runtime.ts"), "utf8"),
  ])
  assert.match(aguiModule, /provide: AGUI_PROJECTOR/u)
  assert.match(aguiModule, /AguiProjectorLifecycle/u)
  assert.match(aguiModule, /AgentAgUiSourceReader/u)
  assert.match(runtime, /explicitlySuppliedAgUiProjector/u)
})

test("McpModule owns MCP projections, custom API route admission and candidate clients", async () => {
  const [mcpModule, middleware, route, connectorRoute, projectionMiddleware, projectionRoute, adminMiddleware, adminRoute, publicationMiddleware, publicationRoute, customMiddleware, customRoute, server, owner] = await Promise.all([
    readFile(path.join(root, "src/modules/mcp/mcp.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/project-mcp-recommendations.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-mcp-recommendations.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/connector-list-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/platform-projection.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/platform-projection.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/mcp-admin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/mcp-admin-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/mcp-project-publication.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/mcp-project-publication-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/custom-api.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/custom-api.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  assert.match(mcpModule, /PROJECT_MCP_RECOMMENDATIONS_PROVIDER/u)
  assert.match(mcpModule, /MCP_AUTHORIZATION/u)
  assert.match(middleware, /handleProjectMcpRecommendationsRequest/u)
  assert.match(mcpModule, /MCP_PERSONAL_CLIENT/u)
  assert.match(mcpModule, /PlatformProjectionMiddleware/u)
  assert.match(projectionMiddleware, /livePlatformProjectionRead/u)
  assert.match(projectionRoute, /platformProjectionRequest/u)
  assert.match(server, /livePlatformProjectionRead/u)
  assert.match(mcpModule, /ConnectorListMiddleware/u)
  assert.match(connectorRoute, /handleConnectorListRequest/u)
  assert.match(server, /handleConnectorListRequest/u)
  assert.match(mcpModule, /MCP_PROVIDER_ADMIN_CLIENT/u)
  assert.match(mcpModule, /MCP_PACKAGE_ADMIN_CLIENT/u)
  assert.match(mcpModule, /McpAdminMiddleware/u)
  assert.match(adminMiddleware, /handleMcpAdminRequest/u)
  assert.match(adminRoute, /mcpProviderAdminRoute/u)
  assert.match(adminRoute, /mcpPackageAdminRoute/u)
  assert.match(server, /handleMcpAdminRequest/u)
  assert.match(mcpModule, /MCP_PROJECT_PUBLICATION_CLIENT/u)
  assert.match(mcpModule, /McpProjectPublicationMiddleware/u)
  assert.match(publicationMiddleware, /handleMcpProjectPublicationRequest/u)
  assert.match(publicationRoute, /mcpProjectPublicationRoute/u)
  assert.match(server, /handleMcpProjectPublicationRequest/u)
  assert.match(mcpModule, /CUSTOM_API_CLIENT/u)
  assert.match(mcpModule, /CustomApiMiddleware/u)
  assert.match(customMiddleware, /customApiRoute/u)
  assert.match(customRoute, /customApiOperation/u)
  assert.match(server, /customApiRoute\(request, response, composition\.customApiClient/u)
  assert.match(route, /handleProjectMcpRecommendationsRequest/u)
  assert.match(server, /handleProjectMcpRecommendationsRequest/u)
  assert.doesNotMatch(server, /await projectMcpRecommendationsRoute\(/u)
  assert.doesNotMatch(server, /await mcp(?:Provider|Package)AdminRoute\(/u)
  assert.doesNotMatch(server, /await mcpProjectPublicationRoute\(/u)
  assert.doesNotMatch(owner, /livePlatformProjectionRead/u)
})

test("SkillsModule owns personal skill-installation admission and client", async () => {
  const [skillsModule, middleware, route, managedRoute, enabledRoute, usageRoute, lifecycleRoute, draftRoute, draftMutationsRoute, catalogCommandRoute, importRoute, aiImportRoute, shareRoute, appBindingsRoute, appBindingsNativeRoute, specificationNativeRoute, packageInspectionNativeRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/skills/skills.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/skills/skills.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-installations.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/managed-personal-skills.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-specification-enabled.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-usage.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/personal-skill-lifecycle-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-draft-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-draft-mutations-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-catalog-command-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-import-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-ai-import-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-share-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/app-skill-bindings.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/app-skill-bindings-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-specification-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-package-inspection-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(skillsModule, /SKILL_INSTALLATION_CLIENT/u)
  assert.match(skillsModule, /SKILL_DRAFT_CLIENT/u)
  assert.match(skillsModule, /SKILL_PRODUCT_CLIENT/u)
  assert.match(skillsModule, /SKILL_AUTHORIZATION/u)
  assert.match(skillsModule, /SKILL_IMPORT_RECEIPTS/u)
  assert.match(skillsModule, /SKILL_SHARE_REPOSITORY/u)
  assert.match(skillsModule, /SKILL_SPECIFICATION_SOURCE/u)
  assert.match(skillsModule, /APP_SKILL_BINDING_CLIENT/u)
  assert.match(skillsModule, /OPEN_APP_MANAGEMENT_ADMISSION/u)
  assert.match(middleware, /handleAppSkillBindingsRequest/u)
  assert.match(appBindingsNativeRoute, /appSkillBindingsRoute/u)
  assert.match(appBindingsRoute, /AppSkillBindingProvider/u)
  assert.match(skillsModule, /SKILL_LIST_ADMISSION/u)
  assert.match(skillsModule, /SKILL_DOWNLOAD_HANDLES/u)
  assert.match(middleware, /handleSkillSpecificationRequest/u)
  assert.match(specificationNativeRoute, /skillSpecificationReadRoute/u)
  assert.match(skillsModule, /SKILL_PACKAGE_INSPECTION_CLIENT/u)
  assert.match(skillsModule, /SKILL_EXACT_DOWNLOAD_SOURCE/u)
  assert.match(middleware, /handleSkillDownloadRequest/u)
  assert.match(middleware, /handleSkillPackageInspectionRequest/u)
  assert.match(packageInspectionNativeRoute, /skillPackageInspectionRoute/u)
  assert.match(server, /handleSkillPackageInspectionRequest/u)
  assert.match(server, /projectContentAccessForRequest/u)
  assert.doesNotMatch(server, /exactSkillDownloadRoute/u)
  assert.match(server, /handleAppSkillBindingsRequest/u)
  assert.match(middleware, /handlePersonalSkillInstallationRequest/u)
  assert.match(middleware, /handleManagedPersonalSkillsRequest/u)
  assert.match(middleware, /handleSkillSpecificationEnabledRequest/u)
  assert.match(middleware, /handleSkillUsageRequest/u)
  assert.match(middleware, /handlePersonalSkillLifecycleRequest/u)
  assert.match(middleware, /handleSkillDraftRequest/u)
  assert.match(lifecycleRoute, /handlePersonalSkillLifecycleRequest/u)
  assert.match(draftRoute, /handleSkillDraftRequest/u)
  assert.match(draftMutationsRoute, /handleSkillDraftMutationRequest/u)
  assert.match(catalogCommandRoute, /handleSkillCatalogCommandRequest/u)
  assert.match(catalogCommandRoute, /handleSkillPackageUploadReadRequest/u)
  assert.match(catalogCommandRoute, /handleSkillCoverRequest/u)
  assert.match(middleware, /handlePublishedSkillPackageRequest/u)
  assert.match(middleware, /handleSkillAdminRequest/u)
  assert.match(catalogCommandRoute, /handleSkillGithubPreviewRequest/u)
  assert.match(middleware, /handleSkillGithubImportRequest/u)
  assert.match(importRoute, /handleSkillGithubImportRequest/u)
  assert.match(middleware, /handleSkillAiImportRequest/u)
  assert.match(aiImportRoute, /handleSkillAiImportRequest/u)
  assert.match(middleware, /handleSkillShareRequest/u)
  assert.match(shareRoute, /handleSkillShareRequest/u)
  assert.match(middleware, /handleSkillLocalImportRequest/u)
  assert.match(route, /handlePersonalSkillInstallationRequest/u)
  assert.match(usageRoute, /handleSkillUsageRequest/u)
  assert.match(managedRoute, /handleManagedPersonalSkillsRequest/u)
  assert.match(enabledRoute, /handleSkillSpecificationEnabledRequest/u)
  assert.match(server, /handlePersonalSkillInstallationRequest/u)
  assert.match(server, /handleManagedPersonalSkillsRequest/u)
  assert.match(server, /handleSkillSpecificationEnabledRequest/u)
  assert.match(server, /handleSkillGithubImportRequest/u)
  assert.match(server, /handleSkillAiImportRequest/u)
  assert.match(server, /handleSkillShareRequest/u)
  assert.doesNotMatch(server, /await skillGithubImportRoute\(/u)
  assert.doesNotMatch(server, /await skillAiImportRoute\(/u)
  assert.doesNotMatch(server, /await skillShareRoute\(/u)
  assert.doesNotMatch(server, /await skillInstallationRoute\(/u)
})

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await readFile(path.join(root, relativePath))
    return true
  } catch {
    return false
  }
}

async function readTypeScriptFiles(relativeDirectory: string): Promise<Array<{ relativePath: string; source: string }>> {
  const entries = await readdir(path.join(root, relativeDirectory), { recursive: true })
  const files: Array<{ relativePath: string; source: string }> = []
  for (const entry of entries) {
    if (!entry.endsWith(".ts")) continue
    const relativePath = path.join(relativeDirectory, entry)
    files.push({ relativePath, source: await readFile(path.join(root, relativePath), "utf8") })
  }
  return files
}
