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

test("AccountModule owns the SessionAdmission provider consumed by the transitional runtime", async () => {
  const [accountModule, runtime, legacyModule] = await Promise.all([
    readFile(path.join(root, "src/modules/account/account.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.runtime.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.module.ts"), "utf8"),
  ])
  assert.match(accountModule, /provide: SESSION_ADMISSION/u)
  assert.match(accountModule, /exports: \[[^\]]*SESSION_ADMISSION/u)
  assert.match(runtime, /Inject\(SESSION_ADMISSION\)/u)
  assert.match(runtime, /sessionAdmission/u)
  assert.match(legacyModule, /imports: \[AccountModule\]/u)
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

test("ChatModule owns the archive/share adapters and chat provider", async () => {
  const [chatModule, middleware, nativeRoute, sharedNativeRoute, feedbackRoute, server, legacyModule] = await Promise.all([
    readFile(path.join(root, "src/modules/chat/chat.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/chat/chat.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/chat-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/shared-native.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/message-feedback-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/modules/legacy-routes/legacy-routes.module.ts"), "utf8"),
  ])
  assert.match(chatModule, /provide: CHAT_SERVICE/u)
  assert.match(chatModule, /ChatMiddleware/u)
  assert.match(chatModule, /forRoutes\(\{ path: "\*", method: RequestMethod\.ALL \}\)/u)
  assert.match(middleware, /handleChatNativeRequest/u)
  assert.match(middleware, /handleMessageFeedbackRequest/u)
  assert.match(nativeRoute, /archivedTasksRoute/u)
  assert.match(nativeRoute, /sharedTasksRoute/u)
  assert.match(feedbackRoute, /messageFeedbackRoute/u)
  assert.match(server, /handleChatNativeRequest/u)
  assert.match(server, /handleMessageFeedbackRequest/u)
  assert.doesNotMatch(server, /await archivedTasksRoute\(/u)
  assert.doesNotMatch(server, /await sharedTasksRoute\(/u)
  assert.doesNotMatch(server, /await messageFeedbackRoute\(/u)
  assert.doesNotMatch(legacyModule, /v1\/account\/(?:archived-tasks|shared-tasks)/u)
  assert.match(chatModule, /PUBLIC_SHARE_SERVICE/u)
  assert.match(middleware, /handleSharedPublicRequest/u)
  assert.match(sharedNativeRoute, /publicShareSnapshot/u)
  assert.doesNotMatch(server, /segments\[1\] === "shared"/u)
})

test("ProjectsModule owns the project-pin adapter and provider", async () => {
  const [projectsModule, middleware, nativeRoute, server, liveBff] = await Promise.all([
    readFile(path.join(root, "src/modules/projects/projects.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/projects/project-pin.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/live-bff.ts"), "utf8"),
  ])
  assert.match(projectsModule, /provide: PROJECT_SERVICE/u)
  assert.match(projectsModule, /ProjectPinMiddleware/u)
  assert.match(middleware, /handleProjectPinRequest/u)
  assert.match(middleware, /handleProjectDeletionStatusRequest/u)
  assert.match(middleware, /handleProjectRenameRequest/u)
  assert.match(middleware, /handleProjectDeleteRequest/u)
  assert.match(middleware, /handleProjectResourceListRequest/u)
  assert.match(middleware, /handleProjectResourceDeleteRequest/u)
  assert.match(middleware, /handleProjectResourceUploadRequest/u)
  assert.match(middleware, /handleProjectResourceReadRequest/u)
  assert.match(middleware, /handleProjectCoreReadRequest/u)
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
  assert.doesNotMatch(liveBff, /businessPath\[0\] === "projects"[\s\S]{0,200}method === "GET"/u)
  assert.doesNotMatch(liveBff, /businessPath\.length === 2[\s\S]{0,120}projectId !== undefined && method === "GET"/u)
  assert.doesNotMatch(liveBff, /instruction-revisions[\s\S]{0,120}method === "GET"/u)
  assert.doesNotMatch(liveBff, /projectDeletionStatus/u)
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

test("AgentRunsModule owns internal admission and execution-binding adapters", async () => {
  const [agentModule, middleware, nativeRoute, server] = await Promise.all([
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/agent-runs/agent-runs.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/agent-runs-native.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(agentModule, /provide: AGENT_RUNS_READER/u)
  assert.match(agentModule, /AgentRunsMiddleware/u)
  assert.match(middleware, /handleAgentRunsInternalRequest/u)
  assert.match(nativeRoute, /agentModelAdmissionRoute/u)
  assert.match(nativeRoute, /projectExecutionBindingRoute/u)
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

test("McpModule owns project MCP recommendation admission and candidate clients", async () => {
  const [mcpModule, middleware, route, server] = await Promise.all([
    readFile(path.join(root, "src/modules/mcp/mcp.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/mcp/project-mcp-recommendations.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/project-mcp-recommendations.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(mcpModule, /PROJECT_MCP_RECOMMENDATIONS_PROVIDER/u)
  assert.match(mcpModule, /MCP_AUTHORIZATION/u)
  assert.match(middleware, /handleProjectMcpRecommendationsRequest/u)
  assert.match(route, /handleProjectMcpRecommendationsRequest/u)
  assert.match(server, /handleProjectMcpRecommendationsRequest/u)
  assert.doesNotMatch(server, /await projectMcpRecommendationsRoute\(/u)
})

test("SkillsModule owns personal skill-installation admission and client", async () => {
  const [skillsModule, middleware, route, server] = await Promise.all([
    readFile(path.join(root, "src/modules/skills/skills.module.ts"), "utf8"),
    readFile(path.join(root, "src/modules/skills/skills.middleware.ts"), "utf8"),
    readFile(path.join(root, "src/http/routes/skill-installations.ts"), "utf8"),
    readFile(path.join(root, "src/bootstrap/server.ts"), "utf8"),
  ])
  assert.match(skillsModule, /SKILL_INSTALLATION_CLIENT/u)
  assert.match(skillsModule, /SKILL_AUTHORIZATION/u)
  assert.match(middleware, /handlePersonalSkillInstallationRequest/u)
  assert.match(route, /handlePersonalSkillInstallationRequest/u)
  assert.match(server, /handlePersonalSkillInstallationRequest/u)
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
