import assert from "node:assert/strict"
import test from "node:test"

import { bindMcpProviderAdminCommand } from "../src/infrastructure/clients/platform/mcp-provider-admin-command-binding.js"

const base = {
  commandId: "command-1",
  tenantId: "tenant-1",
  subjectId: "admin-1",
  providerKey: "github",
  expectedStateVersion: "1",
  provider: {
    provider_key: "github",
    display_name: "GitHub",
    directory_type: "app",
    category_keys: ["development"],
    example_prompts: ["Review a pull request"],
    connector_types: ["mcp"],
    default_scopes: [],
    authorization_required: true,
    allowed_mcp_origins: [],
  },
} as const

test("provider-admin update digest binds the optional cover image field", () => {
  const withoutCover = bindMcpProviderAdminCommand("update", base)
  const withCover = bindMcpProviderAdminCommand("update", {
    ...base,
    provider: { ...base.provider, cover_image_url: "https://github.githubassets.com/assets/GitHub-Mark-ea2971cee799.png" },
  })

  assert.notEqual(withCover.requestDigest, withoutCover.requestDigest)
})
