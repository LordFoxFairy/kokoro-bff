import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { test } from "node:test"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const featureModules = [
  "authentication",
  "account",
  "chat",
  "agent-runs",
  "projects",
  "agui",
  "scheduled-tasks",
  "skills",
  "mcp",
  "billing",
  "system",
  "music",
] as const

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

test("AuthenticationModule alone owns SessionAdmission and AccountModule retains only its real feature providers", async () => {
  const [accountModule, middleware, nativeRoute] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/account/account.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/admin-identity-native.ts"), "utf8"),
  ])
  await import("reflect-metadata")
  const { AuthenticationModule } = await import("../dist/modules/authentication/authentication.module.js")
  const { AccountModule } = await import("../dist/modules/account/account.module.js")
  const { SESSION_ADMISSION, PERSONAL_KNOWLEDGE_REPOSITORY } = await import("../dist/common/tokens.js")
  const providers = (owner: Function): Array<Function | { provide: unknown }> => Reflect.getMetadata("providers", owner) ?? []
  const authenticationProviders = providers(AuthenticationModule).filter((provider) => typeof provider !== "function" && provider.provide === SESSION_ADMISSION)
  assert.equal(authenticationProviders.length, 1)
  assert.deepEqual(Reflect.getMetadata("exports", AuthenticationModule), [SESSION_ADMISSION])
  assert.notEqual(Reflect.getMetadata("__module:global__", AuthenticationModule), true)
  assert.equal(
    providers(AccountModule).some((provider) => typeof provider !== "function" && provider.provide === SESSION_ADMISSION),
    false,
  )
  assert.equal(
    providers(AccountModule).some((provider) => typeof provider !== "function" && provider.provide === PERSONAL_KNOWLEDGE_REPOSITORY),
    true,
  )
  assert.equal(Reflect.getMetadata("imports", AccountModule).includes(AuthenticationModule), true)
  assert.equal(Reflect.getMetadata("exports", AccountModule).includes(SESSION_ADMISSION), false)
  assert.doesNotMatch(accountModule, /provide: SESSION_ADMISSION/u)
  assert.match(middleware, /handleAdminIdentityRequest/u)
  assert.match(nativeRoute, /handleAdminIdentityRequest/u)
})

test("IamRelayModule owns the native protocol relay before the transitional dispatcher", async () => {
  const [moduleSource, middleware] = await Promise.all([
    readFile(path.join(root, "src/modules/iam-relay/iam-relay.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/iam-relay/iam-relay.middleware.ts"), "utf8"),
  ])
  assert.match(moduleSource, /IamRelayMiddleware/u)
  assert.match(middleware, /iamProtocolRelay/u)
})

test("BillingModule owns personal and administrator billing routes", async () => {
  const [moduleSource, middleware, personalMiddleware, personalRoute, nativeRoute, owner] = await Promise.all([
    readFile(path.join(root, "src/modules/billing/billing.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/billing/billing-admin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/billing/billing-personal.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/billing-personal-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/billing-admin-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  assert.match(moduleSource, /BillingAdminMiddleware/u)
  assert.match(moduleSource, /BillingPersonalMiddleware/u)
  assert.match(moduleSource, /BILLING_IDEMPOTENCY/u)
  assert.match(middleware, /handleBillingAdminRequest/u)
  assert.match(personalMiddleware, /BillingPersonalMiddleware/u)
  assert.match(personalRoute, /handleBillingPersonalBusiness/u)
  assert.match(nativeRoute, /handleBillingAdminRequest/u)
  assert.doesNotMatch(owner, /billingPersonalRead|readBillingCatalog|initializeBillingCreditAccount/u)
})

test("SystemModule owns model catalog and administrator configuration/routing routes", async () => {
  const [moduleSource, middleware, modelMiddleware, modelRoute, nativeRoute, owner] = await Promise.all([
    readFile(path.join(root, "src/modules/system/system.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/system/system.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/system/system-model-catalog.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/system-model-catalog-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/system-admin-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  await import("reflect-metadata")
  const { SystemModule } = await import("../dist/modules/system/system.module.js")
  const { AuthenticationModule } = await import("../dist/modules/authentication/authentication.module.js")
  const { AccountModule } = await import("../dist/modules/account/account.module.js")
  const imports = Reflect.getMetadata("imports", SystemModule)
  assert.equal(imports.includes(AuthenticationModule), true)
  assert.equal(imports.includes(AccountModule), false)
  assert.match(moduleSource, /SystemModelCatalogMiddleware/u)
  assert.match(middleware, /handleSystemAdminRequest/u)
  assert.match(modelMiddleware, /SystemModelCatalogMiddleware/u)
  assert.match(modelRoute, /handleSystemModelCatalogBusiness/u)
  assert.match(nativeRoute, /handleSystemAdminRequest/u)
  assert.doesNotMatch(owner, /modelCatalogData|businessPath\.length === 1 && businessPath\[0\] === "models"/u)
})

test("MusicModule owns the Mori owner adapter and idempotency seam", async () => {
  const [moduleSource, middleware, nativeRoute] = await Promise.all([
    readFile(path.join(root, "src/modules/music/music.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/music/music.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/music-native.ts"), "utf8"),
  ])
  assert.match(moduleSource, /MUSIC_IDEMPOTENCY/u)
  assert.match(moduleSource, /MusicMiddleware/u)
  assert.match(middleware, /handleMoriRequest/u)
  assert.match(nativeRoute, /liveMoriBusiness/u)
})

test("ChatModule owns the archive/share adapters and chat provider", async () => {
  const [chatModule, middleware, nativeRoute, sharedNativeRoute, feedbackRoute, regenerationNativeRoute, mutationRoute, eventsRoute, messageRoute, aguiModule] =
    await Promise.all([
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
    ])
  assert.match(chatModule, /imports: \[[^\]]*AgentDispatchModule/u)
  assert.match(await readFile(path.join(root, "src/modules/agent-dispatch/agent-dispatch.module.ts"), "utf8"), /provide: CHAT_TURN_SERVICE/u)
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
  assert.match(mutationRoute, /writeChatBusiness/u)
  assert.match(mutationRoute, /mutationTicket/u)
  assert.match(chatModule, /CHAT_IDEMPOTENCY/u)
  assert.match(chatModule, /ProjectAccessModule/u)
  assert.match(chatModule, /SkillInstallationAccessModule/u)
  assert.match(eventsRoute, /liveAgentSession/u)
  assert.match(eventsRoute, /registerConsumer/u)
  const importsLegacyChat = (source: string): boolean =>
    ts
      .createSourceFile("chat-message-native.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
      .statements.some((node) => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "./chat.js")
  assert.equal(importsLegacyChat(messageRoute), false, "native Message must not depend on the legacy Chat dispatcher")
  assert.equal(importsLegacyChat('import { handler } from "./chat-message.js"'), false)
  assert.equal(importsLegacyChat('import { handler } from "./chat.js"'), true)
  assert.equal(importsLegacyChat('// import { handler } from "./chat.js"\nconst example = \'import { handler } from "./chat.js"\''), false)
  // Canonical submission/replay and transaction semantics are covered by the HTTP/service suites and real chat-facts.integration.mjs,
  // rather than private helper names in the native HTTP adapter.
  assert.match(aguiModule, /AGUI_PROJECTION/u)
  assert.match(aguiModule, /AGUI_RUNTIME/u)
  assert.match(chatModule, /PUBLIC_SHARE_SERVICE/u)
  assert.match(chatModule, /SKILL_AI_ASSOCIATION/u)
  assert.match(middleware, /handleSharedPublicRequest/u)
  assert.match(sharedNativeRoute, /publicShareSnapshot/u)
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

test("Chat no longer exposes a shared service or repository port", async () => {
  for (const file of ["src/application/chat-service.ts", "src/application/chat/chat-repository.ts", "src/application/ports/chat-repository.ts"])
    assert.equal(await fileExists(file), false, `${file} must remain retired`)
  const tokens = await readFile(path.join(root, "src/common/tokens.ts"), "utf8")
  assert.doesNotMatch(tokens, /\bCHAT_SERVICE\b/u)
})

test("Skills share capability port is feature-local", async () => {
  assert.equal(await fileExists("src/application/skills/skill-share-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/skill-share-repository.ts"), false)
  const [middleware, moduleSource, route, repository] = await Promise.all([
    readFile(path.join(root, "src/modules/skills/skills.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/skills/skills.module.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-share.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/skill-share-repository.ts"), "utf8"),
  ])
  assert.match(middleware, /application\/skills\/skill-share-repository\.js/u)
  assert.match(moduleSource, /SKILL_SHARE_REPOSITORY/u)
  assert.match(route, /application\/skills\/skill-share-repository\.js/u)
  assert.match(repository, /application\/skills\/skill-share-repository\.js/u)
})

test("Account personal-knowledge repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/account/personal-knowledge-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/personal-knowledge-repository.ts"), false)
  const [middleware, route, repository] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/personal-knowledge-native.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/personal-knowledge-repository.ts"), "utf8"),
  ])
  assert.match(middleware, /application\/account\/personal-knowledge-repository\.js/u)
  assert.match(route, /application\/account\/personal-knowledge-repository\.js/u)
  assert.match(repository, /application\/account\/personal-knowledge-repository\.js/u)
})

test("Account library artifact repository port is feature-local", async () => {
  assert.equal(await fileExists("src/application/account/artifact-library-repository.ts"), true)
  assert.equal(await fileExists("src/application/ports/artifact-library-repository.ts"), false)
  const [moduleSource, middleware, route, repository] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/account/library.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/library-native.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/conversation-artifact-library.ts"), "utf8"),
  ])
  assert.match(moduleSource, /application\/account\/artifact-library-repository\.js/u)
  assert.match(middleware, /application\/account\/artifact-library-repository\.js/u)
  assert.match(route, /application\/account\/artifact-library-repository\.js/u)
  assert.match(repository, /application\/account\/artifact-library-repository\.js/u)
})

test("Projects no longer exposes the shared Project service or repository port", async () => {
  for (const file of ["src/application/project-service.ts", "src/application/projects/project-repository.ts", "src/application/ports/project-repository.ts"])
    assert.equal(await fileExists(file), false, `${file} must remain retired`)
  const tokens = await readFile(path.join(root, "src/common/tokens.ts"), "utf8")
  assert.doesNotMatch(tokens, /\bPROJECT_SERVICE\b/u)
})

test("Projects scope-release outbox port is feature-local", async () => {
  assert.equal(await fileExists("src/application/projects/project-scope-release-outbox.ts"), true)
  assert.equal(await fileExists("src/application/ports/project-scope-release-outbox.ts"), false)
  const [moduleSource, client, repository] = await Promise.all([
    readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/storage/scope-release-client.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/project-scope-release-outbox-repository.ts"), "utf8"),
  ])
  assert.match(moduleSource, /application\/projects\/project-scope-release-outbox\.js/u)
  assert.match(client, /application\/projects\/project-scope-release-outbox\.js/u)
  assert.match(repository, /application\/projects\/project-scope-release-outbox\.js/u)
})

test("ProjectsModule owns the project command/read adapters and provider", async () => {
  const [projectsModule, accessModule, middleware, mutationMiddleware, nativeRoute, packageMiddleware, downloadMiddleware] = await Promise.all([
    readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-access.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-pin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-mutation.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-native.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-skill-package-inspection.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-skill-download.middleware.ts"), "utf8"),
  ])
  assert.match(projectsModule, /ProjectAccessModule/u)
  assert.match(accessModule, /provide: PROJECT_LOOKUP/u)
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
  assert.match(middleware, /handleProjectSkillSelectionRequest/u)
  assert.match(middleware, /handleProjectSkillInstallationRequest/u)
  assert.match(accessModule, /provide: PROJECT_SKILL_SELECTION_PROVIDER/u)
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
})

test("ProjectsModule owns project-scope release worker lifecycle", async () => {
  const projectsModule = await readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8")
  assert.match(projectsModule, /provide: PROJECT_SCOPE_RELEASE_OUTBOX/u)
  assert.match(projectsModule, /provide: PROJECT_SCOPE_RELEASE_DISPATCHER/u)
  assert.match(projectsModule, /ProjectScopeReleaseWorkerLifecycle/u)
})

test("ScheduledTask consumers use distinct feature-owned capabilities", async () => {
  for (const file of ["src/application/scheduled/scheduled-task-outbox-repository.ts", "src/application/scheduled/scheduled-task-outbox-delivery.ts"])
    assert.equal(await fileExists(file), true, `${file} must exist`)
  for (const file of [
    "src/application/ports/scheduled-task-repository.ts",
    "src/application/scheduled/scheduled-task-repository.ts",
    "src/application/ports/scheduled-task-outbox-repository.ts",
    "src/application/ports/scheduled-task-outbox-delivery.ts",
  ])
    assert.equal(await fileExists(file), false, `${file} must stay deleted`)
  const [moduleSource, service, dispatcher, repository, delivery, callback] = await Promise.all([
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-task-service.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-task-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/scheduled-task-repository.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/scheduler/outbox-delivery.ts"), "utf8"),
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduler-dispatch.middleware.ts"), "utf8"),
  ])
  assert.match(moduleSource, /application\/scheduled\/scheduled-task-outbox-repository\.js/u)
  assert.doesNotMatch(service, /public (?:snapshots|list|findRecord)\(/u)
  assert.match(callback, /@Inject\(SCHEDULED_TASK_CALLBACK_LOOKUP\)/u)
  assert.doesNotMatch(callback, /SCHEDULED_TASK_SERVICE/u)
  assert.match(dispatcher, /scheduled\/scheduled-task-outbox-(?:repository|delivery)\.js/u)
  assert.match(repository, /application\/scheduled\/scheduled-task-(?:repository|outbox-repository)\.js/u)
  assert.match(delivery, /application\/scheduled\/scheduled-task-outbox-delivery\.js/u)
})

test("Scheduled Agent and Scheduler receipt ports are feature-local", async () => {
  for (const file of [
    "src/application/scheduled/scheduled-agent-dispatch-delivery.ts",
    "src/application/scheduled/scheduled-agent-dispatch-repository.ts",
    "src/application/scheduled/scheduler-dispatch-receipt-repository.ts",
  ])
    assert.equal(await fileExists(file), true, `${file} must exist`)
  for (const file of [
    "src/application/ports/scheduled-agent-dispatch-delivery.ts",
    "src/application/ports/scheduled-agent-dispatch-repository.ts",
    "src/application/ports/scheduler-dispatch-receipt-repository.ts",
    "src/application/ports/stable-id-generator.ts",
    "src/application/scheduled/stable-id-generator.ts",
  ])
    assert.equal(await fileExists(file), false, `${file} must stay deleted`)
  const [moduleSource, dispatcher, terminal, schedulerRoute, delivery, chatTurn] = await Promise.all([
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-agent-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/application/scheduled-agent-terminal-consumer.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/scheduler.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/clients/agent/scheduled-dispatch-delivery.ts"), "utf8"),
    readFile(path.join(root, "src/application/chat-turn-service.ts"), "utf8"),
  ])
  assert.match(moduleSource, /application\/scheduled\/(?:scheduled-agent-dispatch|scheduler-dispatch-receipt)-repository\.js/u)
  assert.match(dispatcher, /scheduled\/scheduled-agent-dispatch-(?:delivery|repository)\.js/u)
  assert.match(terminal, /scheduled\/scheduled-agent-dispatch-repository\.js/u)
  assert.match(schedulerRoute, /application\/scheduled\/(?:scheduled-agent-dispatch|scheduler-dispatch-receipt)-repository\.js/u)
  assert.match(delivery, /application\/scheduled\/scheduled-agent-dispatch-delivery\.js/u)
  assert.doesNotMatch(chatTurn, /from\s+["']\.\/scheduled\//u, "ChatTurn must not depend on ScheduledTask application ports")
})

test("ScheduledTasksModule owns the current-state read adapter and provider", async () => {
  const [scheduledModule, middleware, nativeRoute] = await Promise.all([
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-task-read.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/scheduled-task-native.ts"), "utf8"),
  ])
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_READ_SERVICE/u)
  assert.match(scheduledModule, /ScheduledTaskReadMiddleware/u)
  assert.match(middleware, /handleScheduledTaskReadRequest/u)
  assert.match(nativeRoute, /scheduledTaskReadRoute/u)
})

test("ScheduledTasksModule owns the scheduled outbox worker lifecycle", async () => {
  const scheduledModule = await readFile(path.join(root, "src/modules/scheduled-tasks/scheduled-tasks.module.ts"), "utf8")
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_OUTBOX/u)
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_DISPATCHER/u)
  assert.doesNotMatch(scheduledModule, /SCHEDULED_TASK_REPOSITORY/u)
  assert.match(scheduledModule, /provide: SCHEDULED_TASK_SERVICE/u)
  assert.match(scheduledModule, /provide: SCHEDULER_DISPATCH_RECEIPTS/u)
  assert.match(scheduledModule, /SchedulerDispatchMiddleware/u)
  assert.match(scheduledModule, /ScheduledTaskWorkerLifecycle/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_DISPATCH_REPOSITORY/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_DISPATCHER/u)
  assert.match(scheduledModule, /provide: SCHEDULED_AGENT_TERMINAL_CONSUMER/u)
})

test("Scheduler dispatch shares the feature-owned entrypoint with the raw compatibility chain", async () => {
  const [route, middleware] = await Promise.all([
    readFile(path.join(root, "src/http/routes/scheduler.ts"), "utf8"),
    readFile(path.join(root, "src/modules/scheduled-tasks/scheduler-dispatch.middleware.ts"), "utf8"),
  ])
  assert.match(route, /isSchedulerDispatchRequest/u)
  assert.match(route, /response\.setHeader\("x-request-id", fallbackRequestId\)/u)
  assert.match(middleware, /schedulerDispatch\(request, response, this\.config/u)
})

test("AgentRuns does not retain standalone execution-binding or submitted-run ports", async () => {
  for (const directory of ["agent-runs", "ports"])
    for (const reader of ["project-execution-binding-reader", "submitted-agent-run-reader"])
      assert.equal(await fileExists(`src/application/${directory}/${reader}.ts`), false, `${reader} must be consolidated`)
})

test("AgentRunsModule owns internal admission and execution-binding adapters", async () => {
  const [agentModule, middleware, nativeRoute, controlRoute] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent-runs-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent-control-native.ts"), "utf8"),
  ])
  assert.match(agentModule, /provide: AGENT_RUNS_READER/u)
  assert.match(agentModule, /AgentRunsMiddleware/u)
  assert.match(middleware, /handleAgentRunsInternalRequest/u)
  assert.match(middleware, /handleAgentControlRequest/u)
  assert.match(nativeRoute, /agentModelAdmissionRoute/u)
  assert.match(nativeRoute, /projectExecutionBindingRoute/u)
  assert.match(controlRoute, /runAgentControl/u)
  assert.doesNotMatch(middleware, /CHAT_SERVICE/u)
})

test("AgentRunsModule owns the run-display adapter and provider seam", async () => {
  const [agentModule, middleware, nativeRoute] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/run-display.ts"), "utf8"),
  ])
  assert.match(agentModule, /provide: RUN_DISPLAY_PROVIDER/u)
  assert.match(middleware, /handleRunDisplayRequest/u)
  assert.match(nativeRoute, /runDisplayRoute/u)
})

test("Agent dispatch and cancellation outbox ports are feature-local", async () => {
  for (const file of [
    "src/application/agent-dispatch/agent-dispatch-delivery.ts",
    "src/application/agent-dispatch/agent-dispatch-outbox-repository.ts",
    "src/application/agent-dispatch/agent-cancellation-delivery.ts",
    "src/application/agent-dispatch/agent-cancellation-outbox-repository.ts",
  ])
    assert.equal(await fileExists(file), true, `${file} must exist`)
  for (const file of [
    "src/application/ports/agent-dispatch-delivery.ts",
    "src/application/ports/agent-dispatch-outbox-repository.ts",
    "src/application/ports/agent-cancellation-delivery.ts",
    "src/application/ports/agent-cancellation-outbox-repository.ts",
  ])
    assert.equal(await fileExists(file), false, `${file} must stay deleted`)
  const [dispatch, cancellation, chatTurn, repository] = await Promise.all([
    readFile(path.join(root, "src/application/agent-dispatch-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/application/agent-cancellation-outbox-dispatcher.ts"), "utf8"),
    readFile(path.join(root, "src/application/chat-turn-service.ts"), "utf8"),
    readFile(path.join(root, "src/infrastructure/postgres/agent-dispatch-outbox-repository.ts"), "utf8"),
  ])
  assert.match(dispatch, /agent-dispatch\/agent-dispatch-(?:delivery|outbox-repository)\.js/u)
  assert.match(cancellation, /agent-dispatch\/agent-cancellation-(?:delivery|outbox-repository)\.js/u)
  assert.match(chatTurn, /agent-dispatch\/agent-dispatch-outbox-repository\.js/u)
  assert.match(repository, /application\/agent-dispatch\/agent-dispatch-outbox-repository\.js/u)
})

test("AgentDispatchModule owns Agent outbox worker lifecycle", async () => {
  const dispatchModule = await readFile(path.join(root, "src/modules/agent-dispatch/agent-dispatch.module.ts"), "utf8")
  assert.match(dispatchModule, /provide: AGENT_DISPATCH_DISPATCHER/u)
  assert.match(dispatchModule, /provide: AGENT_CANCELLATION_DISPATCHER/u)
  assert.match(dispatchModule, /AgentDispatchWorkerLifecycle/u)
  assert.match(dispatchModule, /onModuleInit/u)
})

test("AguiModule owns the projector lifecycle", async () => {
  const aguiModule = await readFile(path.join(root, "src/modules/agui/agui.module.ts"), "utf8")
  assert.match(aguiModule, /provide: AGUI_PROJECTOR/u)
  assert.match(aguiModule, /AguiProjectorLifecycle/u)
  assert.match(aguiModule, /AgentAgUiSourceReader/u)
})

test("McpModule owns MCP projections, custom API route admission and candidate clients", async () => {
  const [
    mcpModule,
    middleware,
    route,
    connectorRoute,
    projectionMiddleware,
    projectionRoute,
    adminMiddleware,
    adminRoute,
    publicationMiddleware,
    publicationRoute,
    customMiddleware,
    customRoute,
    owner,
  ] = await Promise.all([
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
    readFile(path.join(root, "src/http/routes/owner-request.ts"), "utf8"),
  ])
  assert.match(mcpModule, /PROJECT_MCP_RECOMMENDATIONS_PROVIDER/u)
  assert.match(mcpModule, /MCP_AUTHORIZATION/u)
  assert.match(middleware, /handleProjectMcpRecommendationsRequest/u)
  assert.match(mcpModule, /MCP_PERSONAL_CLIENT/u)
  assert.match(mcpModule, /PlatformProjectionMiddleware/u)
  assert.match(projectionMiddleware, /livePlatformProjectionRead/u)
  assert.match(projectionRoute, /platformProjectionRequest/u)
  assert.match(mcpModule, /ConnectorListMiddleware/u)
  assert.match(connectorRoute, /handleConnectorListRequest/u)
  assert.match(mcpModule, /MCP_PROVIDER_ADMIN_CLIENT/u)
  assert.match(mcpModule, /MCP_PACKAGE_ADMIN_CLIENT/u)
  assert.match(mcpModule, /McpAdminMiddleware/u)
  assert.match(adminMiddleware, /handleMcpAdminRequest/u)
  assert.match(adminRoute, /mcpProviderAdminRoute/u)
  assert.match(adminRoute, /mcpPackageAdminRoute/u)
  assert.match(mcpModule, /MCP_PROJECT_PUBLICATION_CLIENT/u)
  assert.match(mcpModule, /McpProjectPublicationMiddleware/u)
  assert.match(publicationMiddleware, /handleMcpProjectPublicationRequest/u)
  assert.match(publicationRoute, /mcpProjectPublicationRoute/u)
  assert.match(mcpModule, /CUSTOM_API_CLIENT/u)
  assert.match(mcpModule, /CustomApiMiddleware/u)
  assert.match(customMiddleware, /handleCustomApiRequest/u)
  assert.match(customRoute, /customApiOperation/u)
  assert.match(route, /handleProjectMcpRecommendationsRequest/u)
  assert.doesNotMatch(owner, /livePlatformProjectionRead/u)
})

test("SkillsModule owns personal skill-installation admission and client", async () => {
  const [
    skillsModule,
    middleware,
    route,
    managedRoute,
    enabledRoute,
    usageRoute,
    lifecycleRoute,
    draftRoute,
    draftMutationsRoute,
    catalogCommandRoute,
    importRoute,
    aiImportRoute,
    shareRoute,
    appBindingsRoute,
    appBindingsNativeRoute,
    specificationNativeRoute,
    packageInspectionNativeRoute,
  ] = await Promise.all([
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
