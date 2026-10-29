import assert from "node:assert/strict"
import { test } from "node:test"
import { ChatApplicationService } from "../src/application/chat-service.js"

const snapshot = {
  conversation: {
    conversationId: "session",
    tenantId: "tenant",
    ownerId: "owner",
    title: "test",
    projectRef: null,
    status: "active",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  },
  messages: [],
  deliveries: [],
  deliveriesHasMore: false,
  eventWatermark: null,
  executionProcess: null,
}
test("private snapshot exposes the admitted composer selection including an explicit empty latest selection", async () => {
  for (const ids of [["connection-one"], []]) {
    const composerSelection = {
      source_message_id: "message-latest",
      selected_mcp_connection_ids: ids,
      selected_custom_api_profiles: [],
    }
    const service = new ChatApplicationService({
      readSnapshot: async () => ({ ...snapshot, composerSelection }),
    } as never)
    assert.deepEqual((await service.snapshot("tenant", "owner", "session", undefined))?.composer_selection, composerSelection)
  }
})
test("private snapshot leaves the composer baseline absent when its owner has no proven source", async () => {
  const service = new ChatApplicationService({
    readSnapshot: async () => snapshot,
  } as never)
  assert.equal(Object.hasOwn((await service.snapshot("tenant", "owner", "session", undefined))!, "composer_selection"), false)
})

import { readChatComposerSelection } from "../src/infrastructure/postgres/chat-composer-selection.js"
const source = {
  message_id: "latest",
  source_matches: true,
  has_selection: true,
  has_custom_api_selection: false,
  selected_custom_api_profiles: null,
  selected_mcp_connection_ids: ["connection-one"],
}
const read = (rows: unknown[]) => readChatComposerSelection({ query: async () => ({ rows }) } as never, "tenant", "owner", "session")
test("composer read uses only the identity-bound bounded MCP projection, including original omission as empty", async () => {
  assert.deepEqual(await read([source]), {
    source_message_id: "latest",
    selected_mcp_connection_ids: ["connection-one"],
    selected_custom_api_profiles: [],
  })
  assert.deepEqual(await read([{ ...source, has_selection: false, selected_mcp_connection_ids: null }]), {
    source_message_id: "latest",
    selected_mcp_connection_ids: [],
    selected_custom_api_profiles: [],
  })
  assert.deepEqual(await read([{ ...source, selected_mcp_connection_ids: [] }]), {
    source_message_id: "latest",
    selected_mcp_connection_ids: [],
    selected_custom_api_profiles: [],
  })
})
test("missing, foreign, legacy, malformed and over-budget selection never become a restored grant", async () => {
  for (const rows of [
    [],
    [source, source],
    ...[
      { ...source, source_matches: false },
      { ...source, source_matches: null },
      { ...source, source_matches: "true" },
      { ...source, has_selection: null },
      { ...source, selected_mcp_connection_ids: null },
      { ...source, selected_mcp_connection_ids: ["bad/id"] },
      { ...source, selected_mcp_connection_ids: ["same", "same"] },
      {
        ...source,
        selected_mcp_connection_ids: Array.from({ length: 17 }, (_, index) => `connection-${index}`),
      },
    ].map((row) => [row]),
  ])
    assert.equal(await read(rows), undefined)
})
test("composer read preserves database failure instead of manufacturing an empty choice", async () => {
  await assert.rejects(
    readChatComposerSelection(
      {
        query: async () => {
          throw Error("read failed")
        },
      } as never,
      "tenant",
      "owner",
      "session",
    ),
    /read failed/,
  )
})

test("Custom API restoration retains exact versions, clears empty intent and rejects the whole malformed latest baseline", async () => {
  const profiles = [{ profile_id: "api-one", expected_state_version: 3 }]
  assert.deepEqual(await read([{ ...source, has_custom_api_selection: true, selected_custom_api_profiles: profiles }]), {
    source_message_id: "latest",
    selected_mcp_connection_ids: ["connection-one"],
    selected_custom_api_profiles: profiles,
  })
  assert.deepEqual(await read([{ ...source, has_custom_api_selection: true, selected_custom_api_profiles: [] }]), {
    source_message_id: "latest",
    selected_mcp_connection_ids: ["connection-one"],
    selected_custom_api_profiles: [],
  })
  for (const invalid of [
    null,
    ["api-one"],
    [...profiles, { profile_id: "api-one", expected_state_version: 4 }],
    [{ profile_id: "p", expected_state_version: 0 }],
    [{ profile_id: "p", expected_state_version: 1, secret: "x" }],
  ])
    assert.equal(await read([{ ...source, has_custom_api_selection: true, selected_custom_api_profiles: invalid }]), undefined)
  assert.equal(await read([{ ...source, has_custom_api_selection: null }]), undefined)
})
