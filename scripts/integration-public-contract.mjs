// SET49 reconciles immutable settings 53f222ec41500d7a608da0c221a4695c402ff678
// with origin/main f9d7519520208fca64f339270f3ef4f7f8b28db5 (public14.7 SHA256 3ac3760f1bed9562b2b4973d0eb922934a5218953b5d50aa39a24faa773ae2d9).
// Approved main delta is fixed below byte-for-byte, including four retired MCP public writes.
import { createHash } from "node:crypto"
const sha = (value) => createHash("sha256").update(value).digest("hex")
export const integrationPublicDigest = "b4e91483e425fdcc9547eac8bcda554273cbee0863ccb0ddfb185fae18e4e267"
const approvedChanges = [
  {
    at: 3,
    current: "  version: 16.0.0\n",
    previous: "  version: 15.4.0\n",
  },
  {
    at: 39,
    current: "    description: MCP discovery projections; browser-private connector lifecycle is separately scoped.\n",
    previous: "    description: MCP server projections and lifecycle operations.\n",
  },
  {
    at: 4324,
    current: "",
    previous:
      "    post:\n      tags: [MCP]\n      operationId: registerMcpServer\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: capability.mcp.manage\n      summary: Register an MCP server\n      parameters:\n        - $ref: '#/components/parameters/IdempotencyKey'\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema:\n              $ref: '#/components/schemas/McpServerRequest'\n      responses:\n        '200':\n          description: MCP server registered\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/McpServerResponse'\n        '400': { $ref: '#/components/responses/BadRequest' }\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '409': { $ref: '#/components/responses/Conflict' }\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n  /v1/mcp/servers/{name}/enable:\n    parameters:\n      - $ref: '#/components/parameters/McpServerName'\n    post:\n      tags: [MCP]\n      operationId: enableMcpServer\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: capability.mcp.manage\n      summary: Enable an MCP server\n      parameters:\n        - $ref: '#/components/parameters/IdempotencyKey'\n      responses:\n        '200':\n          description: MCP server enabled\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/OkResponse'\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '404': { $ref: '#/components/responses/NotFound' }\n        '409': { $ref: '#/components/responses/Conflict' }\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n  /v1/mcp/servers/{name}/disable:\n    parameters:\n      - $ref: '#/components/parameters/McpServerName'\n    post:\n      tags: [MCP]\n      operationId: disableMcpServer\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: capability.mcp.manage\n      summary: Disable an MCP server\n      parameters:\n        - $ref: '#/components/parameters/IdempotencyKey'\n      responses:\n        '200':\n          description: MCP server disabled\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/OkResponse'\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '404': { $ref: '#/components/responses/NotFound' }\n        '409': { $ref: '#/components/responses/Conflict' }\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n  /v1/mcp/servers/{name}:\n    parameters:\n      - $ref: '#/components/parameters/McpServerName'\n    delete:\n      tags: [MCP]\n      operationId: deleteMcpServer\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: capability.mcp.manage\n      summary: Delete an MCP server\n      parameters:\n        - $ref: '#/components/parameters/IdempotencyKey'\n      responses:\n        '200':\n          description: MCP server deleted\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/OkResponse'\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '404': { $ref: '#/components/responses/NotFound' }\n        '409': { $ref: '#/components/responses/Conflict' }\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n",
  },
  {
    at: 12158,
    current: "",
    previous: "    McpServerName:\n      name: name\n      in: path\n      required: true\n      schema:\n        type: string\n",
  },
  {
    at: 17894,
    current: "",
    previous:
      "    McpServer:\n      type: object\n      required: [scope, name, revision, transport, url, allowed_tools, secret_ref, enabled]\n      properties:\n        scope: { type: string }\n        name: { type: string }\n        revision: { type: integer }\n        transport:\n          type: string\n          enum: [http, streamable_http]\n        url: { type: string }\n        allowed_tools:\n          type: array\n          items: { type: string }\n        secret_ref:\n          type: [string, 'null']\n        enabled: { type: boolean }\n",
  },
  {
    at: 17907,
    current: "",
    previous:
      "    McpServerRequest:\n      type: object\n      required: [name, transport, url, allowed_tools]\n      additionalProperties: false\n      properties:\n        name: { type: string }\n        transport:\n          type: string\n          enum: [http, streamable_http]\n        url: { type: string }\n        allowed_tools:\n          type: array\n          items: { type: string }\n        secret_ref:\n          type: [string, 'null']\n",
  },
  {
    at: 17922,
    current: "",
    previous:
      "    McpServerResponse:\n      type: object\n      required: [data, meta]\n      properties:\n        data:\n          type: object\n          required: [server]\n          properties:\n            server: { $ref: '#/components/schemas/McpServer' }\n        meta: { $ref: '#/components/schemas/RequestMeta' }\n",
  },
]
const parentInventory = [
  {
    method: "GET",
    path: "/v1/account/archived-tasks",
    operation_id: "listOwnedArchivedTasks",
  },
  {
    method: "GET",
    path: "/v1/sessions/{session_id}/archive",
    operation_id: "getSessionArchiveState",
  },
  {
    method: "POST",
    path: "/v1/sessions/{session_id}/archive",
    operation_id: "archiveSession",
  },
  {
    method: "POST",
    path: "/v1/sessions/{session_id}/restore",
    operation_id: "restoreSession",
  },
  {
    method: "GET",
    path: "/v1/account/shared-tasks",
    operation_id: "listOwnedSharedTasks",
  },
  {
    method: "GET",
    path: "/v1/preferences/personalization",
    operation_id: "getSelfPersonalization",
  },
  {
    method: "PUT",
    path: "/v1/preferences/personalization",
    operation_id: "replaceSelfPersonalization",
  },
  {
    method: "GET",
    path: "/healthz",
    operation_id: "healthz",
  },
  {
    method: "GET",
    path: "/readyz",
    operation_id: "readyz",
  },
  {
    method: "GET",
    path: "/v1/system/runtime-manifest",
    operation_id: "getRuntimeManifest",
  },
  {
    method: "GET",
    path: "/v1/me",
    operation_id: "getCurrentUser",
  },
  {
    method: "GET",
    path: "/v1/team/members",
    operation_id: "listTeamMembers",
  },
  {
    method: "GET",
    path: "/v1/team/invitations",
    operation_id: "listTeamInvitations",
  },
  {
    method: "POST",
    path: "/v1/team/invitations",
    operation_id: "createTeamInvitation",
  },
  {
    method: "GET",
    path: "/v1/team/roles",
    operation_id: "listTeamRoles",
  },
  {
    method: "POST",
    path: "/v1/team/invitations/{invitation_id}/resend",
    operation_id: "resendTeamInvitation",
  },
  {
    method: "DELETE",
    path: "/v1/team/invitations/{invitation_id}",
    operation_id: "cancelTeamInvitation",
  },
  {
    method: "DELETE",
    path: "/v1/team/members/me",
    operation_id: "leaveTeam",
  },
  {
    method: "PUT",
    path: "/v1/team/members/{member_id}/roles",
    operation_id: "replaceTeamMemberRoles",
  },
  {
    method: "DELETE",
    path: "/v1/team/members/{member_id}",
    operation_id: "removeTeamMember",
  },
  {
    method: "GET",
    path: "/v1/sessions",
    operation_id: "listSessions",
  },
  {
    method: "GET",
    path: "/v1/admin/identity/members",
    operation_id: "listAdminIdentityMembers",
  },
  {
    method: "GET",
    path: "/v1/admin/identity/invitations",
    operation_id: "listAdminIdentityInvitations",
  },
  {
    method: "GET",
    path: "/v1/admin/identity/roles",
    operation_id: "listAdminIdentityRoles",
  },
  {
    method: "GET",
    path: "/v1/admin/model-routing",
    operation_id: "listAdminModelRouting",
  },
  {
    method: "GET",
    path: "/v1/admin/model-labels",
    operation_id: "listAdminModelLabels",
  },
  {
    method: "GET",
    path: "/v1/admin/model-revisions",
    operation_id: "listAdminModelRevisions",
  },
  {
    method: "PUT",
    path: "/v1/admin/model-routing/{label_id}",
    operation_id: "replaceAdminModelRouting",
  },
  {
    method: "GET",
    path: "/v1/models",
    operation_id: "listModels",
  },
  {
    method: "GET",
    path: "/v1/sessions/{id}",
    operation_id: "getSessionSnapshot",
  },
  {
    method: "DELETE",
    path: "/v1/sessions/{id}",
    operation_id: "deleteSession",
  },
  {
    method: "GET",
    path: "/v1/sessions/{id}/runs/{runId}/process",
    operation_id: "getRunProcess",
  },
  {
    method: "GET",
    path: "/v1/sessions/{id}/messages",
    operation_id: "listSessionMessages",
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/messages",
    operation_id: "createMessage",
  },
  {
    method: "GET",
    path: "/v1/sessions/{id}/events",
    operation_id: "streamSessionEvents",
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/runs/{runId}/control",
    operation_id: "controlRun",
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/move",
    operation_id: "moveSession",
  },
  {
    method: "PATCH",
    path: "/v1/sessions/{id}/title",
    operation_id: "renameSession",
  },
  {
    method: "POST",
    path: "/v1/sessions/{id}/share",
    operation_id: "createShare",
  },
  {
    method: "DELETE",
    path: "/v1/sessions/{id}/share",
    operation_id: "revokeShare",
  },
  {
    method: "GET",
    path: "/v1/shared/{shareId}",
    operation_id: "getSharedSessionSnapshot",
  },
  {
    method: "GET",
    path: "/v1/projects",
    operation_id: "listProjects",
  },
  {
    method: "POST",
    path: "/v1/projects",
    operation_id: "createProject",
  },
  {
    method: "PATCH",
    path: "/v1/projects/{projectId}/name",
    operation_id: "renameProject",
  },
  {
    method: "GET",
    path: "/v1/projects/{projectId}",
    operation_id: "getProject",
  },
  {
    method: "PATCH",
    path: "/v1/projects/{projectId}",
    operation_id: "updateProjectInstruction",
  },
  {
    method: "DELETE",
    path: "/v1/projects/{projectId}",
    operation_id: "deleteProject",
  },
  {
    method: "GET",
    path: "/v1/projects/{projectId}/deletion",
    operation_id: "getProjectDeletion",
  },
  {
    method: "GET",
    path: "/v1/mori/projects",
    operation_id: "listMoriProjects",
  },
  {
    method: "POST",
    path: "/v1/mori/projects",
    operation_id: "createMoriProject",
  },
  {
    method: "GET",
    path: "/v1/mori/projects/{projectRef}",
    operation_id: "getMoriProject",
  },
  {
    method: "POST",
    path: "/v1/mori/projects/{projectRef}/song_plans",
    operation_id: "createMoriSongPlan",
  },
  {
    method: "POST",
    path: "/v1/mori/projects/{projectRef}/generations",
    operation_id: "createMoriGeneration",
  },
  {
    method: "GET",
    path: "/v1/mori/generations/{generationRef}",
    operation_id: "getMoriGeneration",
  },
  {
    method: "GET",
    path: "/v1/mori/generations/{generationRef}/events",
    operation_id: "streamMoriGenerationEvents",
  },
  {
    method: "POST",
    path: "/v1/mori/generations/{generationRef}/cancel",
    operation_id: "cancelMoriGeneration",
  },
  {
    method: "GET",
    path: "/v1/mori/projects/{projectRef}/candidates",
    operation_id: "listMoriCandidates",
  },
  {
    method: "POST",
    path: "/v1/mori/candidates/{candidateRef}/promote",
    operation_id: "promoteMoriCandidate",
  },
  {
    method: "POST",
    path: "/v1/mori/versions/{versionRef}/remix",
    operation_id: "remixMoriVersion",
  },
  {
    method: "GET",
    path: "/v1/mori/library",
    operation_id: "listMoriLibrary",
  },
  {
    method: "POST",
    path: "/v1/mori/versions/{versionRef}/exports",
    operation_id: "createMoriExport",
  },
  {
    method: "GET",
    path: "/v1/mori/exports/{exportRef}",
    operation_id: "getMoriExport",
  },
  {
    method: "GET",
    path: "/v1/projects/{projectId}/tasks",
    operation_id: "listProjectTasks",
  },
  {
    method: "GET",
    path: "/v1/projects/{projectId}/instruction-revisions",
    operation_id: "listProjectInstructionRevisions",
  },
  {
    method: "GET",
    path: "/v1/projects/{projectId}/resources",
    operation_id: "listProjectResources",
  },
  {
    method: "POST",
    path: "/v1/projects/{projectId}/resources",
    operation_id: "uploadProjectResources",
  },
  {
    method: "PATCH",
    path: "/v1/projects/{projectId}/skills/{skill}",
    operation_id: "updateProjectSkill",
  },
  {
    method: "POST",
    path: "/v1/projects/{projectId}/scheduled-tasks",
    operation_id: "createProjectScheduledTask",
  },
  {
    method: "GET",
    path: "/v1/self/skills",
    operation_id: "listManagedPersonalSkills",
  },
  {
    method: "GET",
    path: "/v1/self/skills/{skill_id}",
    operation_id: "getManagedPersonalSkill",
  },
  {
    method: "GET",
    path: "/v1/self/skills/{skill_id}/package",
    operation_id: "getManagedPersonalSkillPackage",
  },
  {
    method: "POST",
    path: "/v1/skills/drafts",
    operation_id: "createSkillDraft",
  },
  {
    method: "GET",
    path: "/v1/skills/{skill_id}/package-upload",
    operation_id: "getSkillPackageUpload",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/package-upload",
    operation_id: "beginSkillPackageUpload",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/package-upload/complete",
    operation_id: "completeSkillPackageUpload",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/validate",
    operation_id: "validateSkillDraft",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/publish",
    operation_id: "publishSkill",
  },
  {
    method: "POST",
    path: "/v1/skill-installations",
    operation_id: "installPersonalSkill",
  },
  {
    method: "GET",
    path: "/v1/skill-installations",
    operation_id: "listPersonalSkillInstallations",
  },
  {
    method: "GET",
    path: "/v1/skill-installations/{installation_id}",
    operation_id: "getPersonalSkillInstallation",
  },
  {
    method: "DELETE",
    path: "/v1/skill-installations/{installation_id}",
    operation_id: "removePersonalSkillInstallation",
  },
  {
    method: "GET",
    path: "/v1/skill-installations/{installation_id}/package",
    operation_id: "getPersonalSkillInstallationPackage",
  },
  {
    method: "PUT",
    path: "/v1/skill-installations/{installation_id}/enabled",
    operation_id: "setPersonalSkillInstallationEnabled",
  },
  {
    method: "POST",
    path: "/v1/skills/github/preview",
    operation_id: "previewGithubSkill",
  },
  {
    method: "POST",
    path: "/v1/skills/github/import",
    operation_id: "importGithubSkill",
  },
  {
    method: "GET",
    path: "/v1/connector.list",
    operation_id: "listConnectors",
  },
  {
    method: "GET",
    path: "/v1/mcp/connections",
    operation_id: "listSelfMcpConnections",
  },
  {
    method: "GET",
    path: "/v1/mcp/servers",
    operation_id: "listMcpServers",
  },
  {
    method: "POST",
    path: "/v1/mcp/servers",
    operation_id: "registerMcpServer",
  },
  {
    method: "POST",
    path: "/v1/mcp/servers/{name}/enable",
    operation_id: "enableMcpServer",
  },
  {
    method: "POST",
    path: "/v1/mcp/servers/{name}/disable",
    operation_id: "disableMcpServer",
  },
  {
    method: "DELETE",
    path: "/v1/mcp/servers/{name}",
    operation_id: "deleteMcpServer",
  },
  {
    method: "GET",
    path: "/v1/scheduled-tasks",
    operation_id: "listScheduledTasks",
  },
  {
    method: "POST",
    path: "/v1/scheduled-tasks",
    operation_id: "createScheduledTask",
  },
  {
    method: "GET",
    path: "/v1/scheduled-tasks/{id}",
    operation_id: "getScheduledTask",
  },
  {
    method: "PATCH",
    path: "/v1/scheduled-tasks/{id}",
    operation_id: "updateScheduledTask",
  },
  {
    method: "DELETE",
    path: "/v1/scheduled-tasks/{id}",
    operation_id: "deleteScheduledTask",
  },
  {
    method: "POST",
    path: "/v1/scheduled-tasks/{id}/retry",
    operation_id: "retryScheduledTask",
  },
  {
    method: "GET",
    path: "/v1/agents/connections/setup",
    operation_id: "getAgentConnectionSetup",
  },
  {
    method: "GET",
    path: "/v1/library",
    operation_id: "listLibrary",
  },
  {
    method: "POST",
    path: "/v1/library/files",
    operation_id: "uploadLibraryFile",
  },
  {
    method: "GET",
    path: "/v1/library/files/{asset_id}/content",
    operation_id: "downloadLibraryFile",
  },
  {
    method: "GET",
    path: "/v1/library/artifacts/{conversation_id}/{artifact_id}",
    operation_id: "getLibraryArtifact",
  },
  {
    method: "GET",
    path: "/v1/library/artifacts/{conversation_id}/{artifact_id}/content",
    operation_id: "downloadLibraryArtifact",
  },
  {
    method: "GET",
    path: "/v1/billing/plans",
    operation_id: "listBillingPlans",
  },
  {
    method: "GET",
    path: "/v1/billing/summary",
    operation_id: "getBillingSummary",
  },
  {
    method: "GET",
    path: "/v1/billing/ledger",
    operation_id: "getBillingLedger",
  },
  {
    method: "POST",
    path: "/v1/billing/checkout",
    operation_id: "createBillingCheckout",
  },
  {
    method: "POST",
    path: "/v1/self/skills/{skill_id}/versions",
    operation_id: "createPersonalSkillVersion",
  },
  {
    method: "POST",
    path: "/v1/self/skills/{skill_id}/withdraw",
    operation_id: "withdrawPersonalSkill",
  },
  {
    method: "PATCH",
    path: "/v1/skills/{skill_id}/draft",
    operation_id: "updateSkillDraft",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/discard",
    operation_id: "discardSkillDraft",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/audience",
    operation_id: "setSkillPublicationAudience",
  },
  {
    method: "GET",
    path: "/v1/skills/{skill_id}/cover-upload",
    operation_id: "getSkillCoverUpload",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/cover-upload",
    operation_id: "beginSkillCoverUpload",
  },
  {
    method: "POST",
    path: "/v1/skills/{skill_id}/cover-upload/complete",
    operation_id: "completeSkillCoverUpload",
  },
  {
    method: "GET",
    path: "/v1/skills/{skill_id}/cover",
    operation_id: "getSkillCover",
  },
  {
    method: "GET",
    path: "/v1/skills/{skill_id}/package",
    operation_id: "getSkillPackageDirectory",
  },
  {
    method: "GET",
    path: "/v1/admin/mcp/providers",
    operation_id: "listAdminMcpProviders",
  },
  {
    method: "POST",
    path: "/v1/admin/mcp/providers",
    operation_id: "createAdminMcpProvider",
  },
  {
    method: "GET",
    path: "/v1/admin/mcp/providers/{provider_key}",
    operation_id: "getAdminMcpProvider",
  },
  {
    method: "PATCH",
    path: "/v1/admin/mcp/providers/{provider_key}",
    operation_id: "updateAdminMcpProvider",
  },
  {
    method: "DELETE",
    path: "/v1/admin/mcp/providers/{provider_key}",
    operation_id: "removeAdminMcpProvider",
  },
  {
    method: "PUT",
    path: "/v1/admin/mcp/providers/{provider_key}/enabled",
    operation_id: "setAdminMcpProviderEnabled",
  },
  {
    method: "GET",
    path: "/v1/admin/skills",
    operation_id: "listAdminSkills",
  },
  {
    method: "POST",
    path: "/v1/admin/skills",
    operation_id: "createAdminSkillDraft",
  },
  {
    method: "GET",
    path: "/v1/admin/skills/{skill_id}",
    operation_id: "getAdminSkill",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/versions",
    operation_id: "createAdminSkillVersion",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/publish",
    operation_id: "publishOfficialSkill",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/withdraw",
    operation_id: "withdrawAdminSkill",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/quarantine",
    operation_id: "quarantineSkill",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/restore",
    operation_id: "restoreSkill",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/audience",
    operation_id: "setAdminSkillPublicationAudience",
  },
  {
    method: "POST",
    path: "/v1/admin/skills/{skill_id}/discard",
    operation_id: "discardAdminSkillDraft",
  },
  {
    method: "POST",
    path: "/v1/skill-shares",
    operation_id: "createSkillShare",
  },
  {
    method: "GET",
    path: "/v1/skill-shares/{share_id}/skill",
    operation_id: "getSharedSkillRevision",
  },
  {
    method: "GET",
    path: "/v1/skill-shares/{share_id}",
    operation_id: "resolveSkillShare",
  },
  {
    method: "DELETE",
    path: "/v1/skill-shares/{share_id}",
    operation_id: "revokeSkillShare",
  },
  {
    method: "POST",
    path: "/v1/skills/usage",
    operation_id: "getSkillUsage",
  },
  {
    method: "POST",
    path: "/v1/skills/ai-import",
    operation_id: "createAiSkillDraft",
  },
  {
    method: "GET",
    path: "/v1/skill.list",
    operation_id: "listSkills",
  },
  {
    method: "POST",
    path: "/skill.v1.SkillOptionalService/ListSkills",
    operation_id: "websiteListSkills",
  },
  {
    method: "POST",
    path: "/skill.v1.SkillOptionalService/SetSkillInstallationEnabled",
    operation_id: "websiteSetSkillInstallationEnabled",
  },
  {
    method: "POST",
    path: "/skill.v1.SkillOptionalService/ListHubSkills",
    operation_id: "websiteListHubSkills",
  },
  {
    method: "POST",
    path: "/skill.v1.SkillOptionalService/GetSkill",
    operation_id: "websiteGetSkill",
  },
  {
    method: "POST",
    path: "/skill.v1.SkillService/DownloadSkill",
    operation_id: "websiteDownloadSkill",
  },
  {
    method: "GET",
    path: "/skill-downloads/{handle}",
    operation_id: "downloadSkillBytes",
  },
  {
    method: "GET",
    path: "/v1/account/sessions",
    operation_id: "listAccountSessions",
  },
  {
    method: "DELETE",
    path: "/v1/account/sessions/{session_id}",
    operation_id: "revokeAccountSession",
  },
  {
    method: "PATCH",
    path: "/v1/account/profile",
    operation_id: "updateAccountProfile",
  },
]
export function restorePublic154IntegrationContract(source) {
  if (sha(source) !== integrationPublicDigest) throw new Error("SET49 complete16.0 approved main delta drift")
  const lines = source.split(/(?<=\n)/u)
  for (const change of [...approvedChanges].reverse()) {
    const count = change.current === "" ? 0 : change.current.split(/(?<=\n)/u).length
    if (lines.slice(change.at, change.at + count).join("") !== change.current) throw new Error("SET49 exact integration hunk drift")
    lines.splice(change.at, count, change.previous)
  }
  const parent = lines.join("")
  if (sha(parent) !== "87186311e67eeebcd5f27d7974326186e1912de49d18d4d524a0bcbc940a0817") throw new Error("SET49 complete15.4 inverse drift")
  return parent
}
export function integrationParentBaseline(baseline) {
  if (!Array.isArray(baseline) || sha(JSON.stringify(baseline)) !== "039f5dcf79a848bbdc580abedb5946ef09a4eb097e4ed9373ec7fa4090cd514e")
    throw new Error("SET49 exact146 ordered inventory drift")
  if (sha(JSON.stringify(parentInventory)) !== "03987dd80b1375e7f54f6ae8cce4dcb52b12c2bf2e8348a4cde9261d3804b19b")
    throw new Error("SET49 complete150 parent inventory drift")
  return structuredClone(parentInventory)
}
