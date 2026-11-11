import { createHash } from "node:crypto"

// Build-time proof only; production serves only the current operation.
const hash = (source) => createHash("sha256").update(source).digest("hex")

export function restorePublic2834SlackConnectionContract(source) {
  if (!/^  version: 28\.35\.0$/mu.test(source)) return source
  if (hash(source) !== "a26431d45ad96c4e80e6751d61e66a14b3933ae7c2ffb6f9e7df57fcc7e6808f") throw Error("Slack Public28.35 child drift")
  const parent = source
    .replace(/^  \/v1\/agents\/connections\/slack\/complete:\n[\s\S]*?(?=^  \/v1\/library:)/mu, "")
    .replace(/^        - type: object\n          required: \[platform, status, state_version, setup_id, expires_at, continue_url\]\n          additionalProperties: false\n          properties:\n            platform: \{ type: string, const: slack \}[\s\S]*?(?=^    AgentConnectionSetupResponse:)/mu, "")
    .replace(/^    SlackConnectionCompleteRequest:\n[\s\S]*?(?=^    RuntimeManifest:)/mu, "")
    .replaceAll("            platform: { type: string, enum: [telegram, line, slack] }\n", "            platform: { type: string, enum: [telegram, line] }\n")
    .replace("This read never starts setup or calls a provider. Established personal bindings can still be read after provider configuration is removed. Slack returns an authorization URL only before that exact attempt has claimed a completion.", "This read never starts setup or calls a provider. Telegram and LINE bindings can still be read after bot configuration is removed. Slack is not available through this operation yet.")
    .replace("Cancel with the same setup ID also accepts the immediately previous revision when a Telegram private callback or Slack completion has only claimed that exact setup; it never cancels a binding. The confirm command is Telegram-only and requires the secret received in private chat, not merely opening the link. LINE uses the dedicated admitted continuation and signed account-link callback. Slack uses the admitted completion; disconnect removes only the personal binding, not the workspace installation.", "Cancel with the same setup ID also accepts the immediately previous revision when a Telegram callback has only advanced that exact setup to awaiting_confirmation; it never cancels a binding. The confirm command is Telegram-only and requires the secret received in private chat, not merely opening the link. LINE uses the dedicated admitted continuation and signed account-link callback. Slack is not available through this operation yet.")
    .replace("  version: 28.35.0\n", "  version: 28.34.0\n")
  if (hash(parent) !== "ea0b6ff7b4ea4a0348a4dd579c2440dca32e58c5958b2374e8555e02b74382a6") throw Error("Slack complete Public28.34 parent drift")
  return parent
}

export function restorePublic2833LineConnectionContract(source) {
  source = restorePublic2834SlackConnectionContract(source)
  if (!/^  version: 28\.34\.0$/mu.test(source)) return source
  if (hash(source) !== "ea0b6ff7b4ea4a0348a4dd579c2440dca32e58c5958b2374e8555e02b74382a6") throw Error("LINE Public28.34 child drift")
  const parent = source
    .replace(/^  \/v1\/agents\/connections\/line\/webhook:\n[\s\S]*?(?=^  \/v1\/library:)/mu, "")
    .replace(/^    LineWebhookSignature:\n[\s\S]*?(?=^    TelegramWebhookSecret:)/mu, "")
    .replace(/^        - type: object\n          required: \[platform, status, state_version, setup_id, expires_at, continue_url\]\n          additionalProperties: false\n          properties:\n            platform: \{ type: string, const: line \}[\s\S]*?(?=^    AgentConnectionSetupResponse:)/mu, "")
    .replace(/^    LineConnectionContinueRequest:\n[\s\S]*?(?=^    RuntimeManifest:)/mu, "")
    .replaceAll("            platform: { type: string, enum: [telegram, line] }\n", "            platform: { type: string, const: telegram }\n")
    .replace("This read never starts setup or calls a provider. Telegram and LINE bindings can still be read after bot configuration is removed. Slack is not available through this operation yet.", "This read never starts setup or calls Telegram. A binding can still be read after bot configuration is removed. LINE and Slack are not available through this operation yet.")
    .replace("The confirm command is Telegram-only and requires the secret received in private chat, not merely opening the link. LINE uses the dedicated admitted continuation and signed account-link callback. Slack is not available through this operation yet.", "Confirm requires the secret received in private Telegram chat, not merely opening the link. LINE and Slack are not available through this operation yet.")
    .replace("  version: 28.34.0\n", "  version: 28.33.0\n")
  if (hash(parent) !== "03d4add75d31c6c4dd22e7fcb3b4269556ad3ced87d29a5640976bc74f39810f") throw Error("LINE complete Public28.33 parent drift")
  return parent
}

export function restorePublic2832WorkspaceOutputsContract(source) {
  source = restorePublic2833LineConnectionContract(source)
  if (!/^  version: 28\.33\.0$/mu.test(source)) return source
  if (hash(source) !== "03d4add75d31c6c4dd22e7fcb3b4269556ad3ced87d29a5640976bc74f39810f") throw Error("Workspace outputs Public28.33 child drift")
  const parent = source
    .replace(/^  \/v1\/sessions\/\{id\}\/runs\/\{runId\}\/workspace-outputs\/\{versionId\}\/content:\n[\s\S]*?(?=^  # AGENT-DISPLAY-PATHS-END)/mu, "")
    .replace(/^    RunWorkspaceOutputVersion:\n[\s\S]*?(?=^    RunDisplay:)/mu, "")
    .replace(/(^    RunDisplay:\n[\s\S]*?)^        workspace_outputs:\n[\s\S]*?(?=^        final_answer:)/mu, "$1")
    .replace("  version: 28.33.0\n", "  version: 28.32.0\n")
  if (hash(parent) !== "e12a8078f5ecaa741c255a3bcec032d398d35309d845d3cf736dc764a0287d33") throw Error("Workspace outputs complete Public28.32 parent drift")
  return parent
}

export function restorePublic2831AgentConnectionContract(source) {
  source = restorePublic2832WorkspaceOutputsContract(source)
  if (!/^  version: 28\.32\.0$/mu.test(source)) return source
  if (hash(source) !== "e12a8078f5ecaa741c255a3bcec032d398d35309d845d3cf736dc764a0287d33") throw Error("Telegram Public28.32 child drift")
  const parent = source
    .replace(/^    post:\n(?=      tags: \[Agents\]\n      operationId: changeAgentConnection\n)[\s\S]*?(?=^  \/v1\/library:)/mu, "")
    .replace("      summary: Read the admitted user’s external connection or setup state\n      description: This read never starts setup or calls Telegram. A binding can still be read after bot configuration is removed. LINE and Slack are not available through this operation yet.\n", "      summary: Get agent connection setup\n")
    .replace(/^    TelegramWebhookSecret:\n[\s\S]*?(?=^    [A-Za-z]+:)/mu, "")
    .replace(/^    AgentConnectionStateVersion:\n[\s\S]*?(?=^    RuntimeManifest:)/mu, `    AgentConnectionSetup:
      type: object
      required: [platform, status, qr_value, continue_url, expires_at]
      properties:
        platform:
          type: string
          enum: [telegram, line, slack]
        status:
          type: string
          enum: [disconnected, pending, connected, expired]
        qr_value: { type: string }
        continue_url: { type: string }
        expires_at: { type: string, format: date-time }
    AgentConnectionSetupResponse:
      type: object
      required: [data, meta]
      properties:
        data: { $ref: '#/components/schemas/AgentConnectionSetup' }
        meta: { $ref: '#/components/schemas/RequestMeta' }
`)
    .replace("  version: 28.32.0\n", "  version: 28.31.0\n")
  if (hash(parent) !== "9fea8041e3eac479e5ea008e120729fb37637636bb6bf3ad8b94ac161ac8a88c") throw Error("Telegram complete Public28.31 parent drift")
  return parent
}

export function restorePublic2830ProjectWebsitesContract(source) {
  source = restorePublic2831AgentConnectionContract(source)
  if (!/^  version: 28\.31\.0$/mu.test(source)) return source
  if (hash(source) !== "9fea8041e3eac479e5ea008e120729fb37637636bb6bf3ad8b94ac161ac8a88c") throw Error("Project websites Public28.31 child drift")
  const parent = source
    .replace(/^  \/v1\/projects\/\{project_id\}\/websites:\n[\s\S]*?(?=^  \/v1\/projects\/\{projectId\}:)/mu, "")
    .replace(/^    ProjectWebsitesProjectId:\n[\s\S]*?(?=^    Project:)/mu, "")
    .replace(/^    ProjectWebsitesSuccess:\n[\s\S]*?(?=^    PersonalizationReadSuccess:)/mu, "")
    .replace("  version: 28.31.0\n", "  version: 28.30.0\n")
  if (hash(parent) !== "2e459bd39f73686ac6d458011b777f08ea17b79a1467e563cdbb299e044a3cf9") throw Error("Project websites complete Public28.30 parent drift")
  return parent
}

export function restorePublic2829DeliveryDisplayPathContract(source) {
  source = restorePublic2830ProjectWebsitesContract(source)
  if (!/^  version: 28\.30\.0$/mu.test(source)) return source
  if (hash(source) !== "2e459bd39f73686ac6d458011b777f08ea17b79a1467e563cdbb299e044a3cf9") throw Error("Artifact display path Public28.30 child drift")
  const parent = source
    .replace(/(^    PrivateSessionSnapshotResponse:[\s\S]*?items: \{ \$ref: '#\/components\/schemas\/)PrivateDelivery/mu, "$1Delivery")
    .replace(/^    PrivateDelivery:\n[\s\S]*?(?=^    MessageCreateRequest:)/mu, "")
    .replace("        kokoro.delivery.created:\n          $ref: '#/components/schemas/ChatDeliveryCreated'\n", "")
    .replace(/^    ChatDeliveryCreated:\n[\s\S]*?(?=^    FinalAnswerResult:)/mu, "")
    .replace("  version: 28.30.0\n", "  version: 28.29.0\n")
  if (hash(parent) !== "be6473bfa58332dee9f0417a10f6b21c8320efa79802151fe5b13f93753d4504") throw Error("Artifact display path complete Public28.29 parent drift")
  return parent
}

export function restorePublic2828LibraryArtifactCommandsContract(source) {
  source = restorePublic2829DeliveryDisplayPathContract(source)
  if (!/^  version: 28\.29\.0$/mu.test(source)) return source
  if (hash(source) !== "be6473bfa58332dee9f0417a10f6b21c8320efa79802151fe5b13f93753d4504") throw Error("Library Artifact commands Public28.29 child drift")
  const parent = source
    .replace(/^    delete:\n(?=      tags: \[Library\]\n      operationId: deleteLibraryArtifact\n)[\s\S]*?(?=^  \/v1\/library\/artifacts\/\{conversation_id\}\/\{artifact_id\}\/content:)/mu, "")
    .replace(/^    LibraryArtifactDeletionResponse:\n[\s\S]*?(?=^    LibraryArtifactItem:)/mu, "")
    .replace("      description: A required kind selects either the admitted subject's CLEAN personal ASSET files or FINAL CLEAN Artifacts linked to their active Conversations. File search filters current authorized Storage files before the stable keyset and limit; only a matching file may occupy a page slot. Artifact favorites-only filtering runs on the owned BFF relationship before its keyset; it never grants visibility. Artifact search matches current authorized FINAL metadata, not unverified delivery claims. Artifact-only q is a case-insensitive NFC substring over title or filename; type uses the documented product taxonomy. Cursors bind kind, tenant, subject, limit and the normalized complete filter tuple. Each Artifact request scans at most min(500, limit * 5) authorized candidates within the existing 30-second deadline; a sparse page may be empty and still have next_cursor. Only next_cursor=null means exhausted. Delivery keyset order is preserved, without relevance ranking or snapshot isolation. Public18 invalidates prior Artifact cursors; clients must restart the query. A cursor never grants access.", "      description: A required kind selects either the admitted subject's CLEAN personal ASSET files or FINAL CLEAN Artifacts linked to their active Conversations. File search filters current authorized Storage files before the stable keyset and limit; only a matching file may occupy a page slot. Artifact search matches current authorized FINAL metadata, not unverified delivery claims. Artifact-only q is a case-insensitive NFC substring over title or filename; type uses the documented product taxonomy. Cursors bind kind, tenant, subject, limit and the normalized complete filter tuple. Each Artifact request scans at most min(500, limit * 5) authorized candidates within the existing 30-second deadline; a sparse page may be empty and still have next_cursor. Only next_cursor=null means exhausted. Delivery keyset order is preserved, without relevance ranking or snapshot isolation. Public18 invalidates prior Artifact cursors; clients must restart the query. A cursor never grants access.")
    .replace("        - name: favorites_only\n          in: query\n          description: Artifact only. True selects only the current subject's favorited Artifacts; false or absent keeps the ordinary cursor shape. File requests reject this parameter.\n          schema: { type: boolean, default: false }\n", "")
    .replace("required: [kind, conversation_id, artifact_id, asset_id, artifact_kind, title, filename, mime_type, size_bytes, content_sha256, source_run_id, delivered_at, favorited]", "required: [kind, conversation_id, artifact_id, asset_id, artifact_kind, title, filename, mime_type, size_bytes, content_sha256, source_run_id, delivered_at]")
    .replace("        favorited: { type: boolean }\n        project_ref:\n          description: Detail-only canonical source Project ID", "        project_ref:\n          description: Detail-only canonical source Project ID")
    .replace("  version: 28.29.0\n", "  version: 28.28.0\n")
  if (hash(parent) !== "495afa65989a1308194910b0b5ece62b4f9db0c84f8dc34e7e0f3b00f7c5294f") throw Error("Library Artifact commands complete Public28.28 parent drift")
  return parent
}

export function restorePublic2827LibraryArtifactSourceContract(source) {
  source = restorePublic2828LibraryArtifactCommandsContract(source)
  if (!/^  version: 28\.28\.0$/mu.test(source)) return source
  if (hash(source) !== "495afa65989a1308194910b0b5ece62b4f9db0c84f8dc34e7e0f3b00f7c5294f") throw Error("Library artifact source Public28.28 child drift")
  const parent = source
    .replace("        project_ref:\n          description: Detail-only canonical source Project ID, null for a direct Conversation, or absent when the canonical destination is not established.\n          type: [string, 'null']\n          pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\\s\\S])'\n    LibraryArtifactResponse:\n", "    LibraryArtifactResponse:\n")
    .replace("      summary: Read one delivered Artifact from the current subject's active Conversation\n      description: The detail identifies the source Conversation's canonical Project ID, or null only for a direct Conversation. If the canonical source destination is not established, project_ref is omitted. The project reference is not an access grant.\n", "      summary: Read one delivered Artifact from the current subject's active Conversation\n")
    .replace("  version: 28.28.0\n", "  version: 28.27.0\n")
  if (hash(parent) !== "52b59b49be42bc3c1126b6fc94b1d88c440b7ac911c2631e8a0305f43f96bd08") throw Error("Library artifact source complete Public28.27 parent drift")
  return parent
}

export function restorePublic2826LibraryFileSearchContract(source) {
  source = restorePublic2827LibraryArtifactSourceContract(source)
  if (!/^  version: 28\.27\.0$/mu.test(source)) return source
  if (hash(source) !== "52b59b49be42bc3c1126b6fc94b1d88c440b7ac911c2631e8a0305f43f96bd08") throw Error("Library file search Public28.27 child drift")
  const parent = source
    .replace("enum: [all, slides, documents, spreadsheets, images, video, audio, other, media]", "enum: [all, slides, documents, spreadsheets, images, video, audio, other]")
    .replace("Kind-specific type. Files accept all, documents, images, media (audio/video), and other based on MIME. Artifacts retain all, slides, documents, spreadsheets, images, video, audio, and other based on current FINAL MIME/title. Other combinations are invalid.", "Artifact-only product type, matched against current FINAL MIME/title according to the Library API taxonomy; file queries reject this parameter.")
    .replace("Literal text search, at most 200 Unicode code points before normalization. C0 controls and DEL are rejected; empty after trim means no text filter. Files match filename or MIME using NFC and case-insensitive PostgreSQL text semantics. Artifacts match title or filename with trim, NFC and locale-independent lowercase.", "Artifact-only search, at most 200 Unicode code points before normalization; trim, NFC and locale-independent lowercase are applied. C0 control characters and DEL are rejected. Empty means no text filter; file queries reject this parameter.")
    .replace("Each Artifact request scans at most min(500, limit * 5) authorized candidates", "Each request scans at most min(500, limit * 5) authorized candidates")
    .replace("File search filters current authorized Storage files before the stable keyset and limit; only a matching file may occupy a page slot. Artifact search matches current authorized FINAL metadata", "Artifact search matches current authorized FINAL metadata")
    .replace("  version: 28.27.0\n", "  version: 28.26.0\n")
  if (hash(parent) !== "c80d5aaba1732eca0fb7bc8f32f500adef99e7d884f579cfb7944b8b11e8901a")
    throw Error("Library file search complete Public28.26 parent drift")
  return parent
}

export function restorePublic2825LibraryFileDeletionContract(source) {
  source = restorePublic2826LibraryFileSearchContract(source)
  if (!/^  version: 28\.26\.0$/mu.test(source)) return source
  if (hash(source) !== "c80d5aaba1732eca0fb7bc8f32f500adef99e7d884f579cfb7944b8b11e8901a") throw Error("Library file deletion Public28.26 child drift")
  const parent = source
    .replace(/^  \/v1\/library\/files\/\{asset_id\}:\n[\s\S]*?(?=^  \/v1\/library\/files\/\{asset_id\}\/content:)/mu, "")
    .replace(/^    LibraryFileDeletionResponse:\n[\s\S]*?(?=^    LibraryFileItem:)/mu, "")
    .replace("  version: 28.26.0\n", "  version: 28.25.0\n")
  if (hash(parent) !== "008667f501044dc186e615b83370f96a7401de8027f25e7635248724fb165759")
    throw Error("Library file deletion complete Public28.25 parent drift")
  return parent
}

export function libraryFileDeletionParentInventory(inventory) {
  const slack = inventory.filter((item) => item.operation_id === "completeSlackConnection")
  if (slack.length) {
    const expected = { method: "POST", path: "/v1/agents/connections/slack/complete", operation_id: "completeSlackConnection" }
    if (JSON.stringify(slack) !== JSON.stringify([expected])) throw Error("Slack Public28.35 inventory drift")
    inventory = inventory.filter((item) => !slack.includes(item))
  }
  const lineOperations = [
    { method: "POST", path: "/v1/agents/connections/line/webhook", operation_id: "acceptLineConnectionEvent" },
    { method: "POST", path: "/v1/agents/connections/line/continue", operation_id: "continueLineConnection" },
  ]
  const line = inventory.filter((item) => lineOperations.some((expected) => expected.operation_id === item.operation_id))
  if (line.length) {
    if (JSON.stringify(line) !== JSON.stringify(lineOperations)) throw Error("LINE Public28.34 inventory drift")
    inventory = inventory.filter((item) => !line.includes(item))
  }
  const workspaceOperations = inventory.filter((item) => item.operation_id === "getSessionRunWorkspaceOutputContent")
  if (workspaceOperations.length) {
    const expected = { method: "GET", path: "/v1/sessions/{id}/runs/{runId}/workspace-outputs/{versionId}/content", operation_id: "getSessionRunWorkspaceOutputContent" }
    if (JSON.stringify(workspaceOperations) !== JSON.stringify([expected])) throw Error("Workspace outputs Public28.33 inventory drift")
    inventory = inventory.filter((item) => !workspaceOperations.includes(item))
  }
  const agentOperations = [
    { method: "POST", path: "/v1/agents/connections/setup", operation_id: "changeAgentConnection" },
    { method: "POST", path: "/v1/agents/connections/telegram/webhook", operation_id: "acceptTelegramConnectionUpdate" },
  ]
  const present = inventory.filter((item) => agentOperations.some((expected) => expected.operation_id === item.operation_id))
  if (present.length) {
    if (JSON.stringify(present) !== JSON.stringify(agentOperations)) throw Error("Telegram Public28.32 inventory drift")
    inventory = inventory.filter((item) => !present.includes(item))
  }
  const websiteOperations = [
    { method: "GET", path: "/v1/projects/{project_id}/websites", operation_id: "getProjectWebsites" },
    { method: "PUT", path: "/v1/projects/{project_id}/websites", operation_id: "replaceProjectWebsites" },
  ]
  if (inventory.some((item) => websiteOperations.some((expected) => item.operation_id === expected.operation_id))) {
    if (JSON.stringify(inventory.slice(-2)) !== JSON.stringify(websiteOperations)) throw Error("Project websites Public28.31 inventory drift")
    inventory = inventory.slice(0, -2)
    if (hash(JSON.stringify(inventory)) !== "01ca0295d4bd270fe39ba2dbc87608fe42bb6bfe8dc162d2c32b15723546fbe0")
      throw Error("Project websites Public28.30 inventory drift")
  }
  const artifactCommands = new Set(["deleteLibraryArtifact", "setLibraryArtifactFavorite"])
  if (inventory.some((item) => artifactCommands.has(item.operation_id))) {
    if (hash(JSON.stringify(inventory)) !== "01ca0295d4bd270fe39ba2dbc87608fe42bb6bfe8dc162d2c32b15723546fbe0")
      throw Error("Library Artifact commands Public28.29 inventory drift")
    inventory = inventory.filter((item) => !artifactCommands.has(item.operation_id))
    if (hash(JSON.stringify(inventory)) !== "c802b2b89eda5f1b9b7128e5ed9305cdbf648d71a549f08afeb7e90ef71fd97a")
      throw Error("Library Artifact commands Public28.28 inventory drift")
  }
  if (!inventory.some((item) => item.operation_id === "deleteLibraryFile")) return inventory
  if (hash(JSON.stringify(inventory)) !== "c802b2b89eda5f1b9b7128e5ed9305cdbf648d71a549f08afeb7e90ef71fd97a")
    throw Error("Library file deletion Public28.26 inventory drift")
  const parent = inventory.filter((item) => item.operation_id !== "deleteLibraryFile")
  if (hash(JSON.stringify(parent)) !== "9d872bd30fe5a063ec2600d2e5beb59ae30c896fd607ee3eb1a278c95fbb7731")
    throw Error("Library file deletion Public28.25 inventory drift")
  return parent
}
