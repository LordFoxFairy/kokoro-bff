import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { load } from "js-yaml"
import { restorePublic2815ComposerSelectionContract, restorePublic2816CustomApiSelectionContract } from "../scripts/composer-selection-public-contract.mjs"

test("composer selection is private-only and preserves the exact parent contract and submission semantics", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.equal(
    createHash("sha256").update(restorePublic2815ComposerSelectionContract(raw)).digest("hex"),
    "8a56966d2d9a4a380b29dadeb9f79f5db8ef9975e8e2bbac4b1748ef03a70234",
  )
  const {
    components: { schemas },
  } = load(raw)
  const field = schemas.PrivateSessionSnapshotResponse.properties.data.properties.composer_selection
  assert.equal(field.additionalProperties, false)
  assert.deepEqual(field.required, ["source_message_id", "selected_mcp_connection_ids"])
  assert.deepEqual(field.properties.selected_mcp_connection_ids, schemas.MessageCreateRequest.properties.selected_mcp_connection_ids)
  assert.equal(Object.hasOwn(schemas.SessionSnapshotResponse.properties.data.properties, "composer_selection"), false)
  for (const wrong of [raw + "\n", raw.replace("composer_selection:", "other_selection:"), raw.replace("getMessageFeedback", "changedFeedback")])
    assert.throws(() => restorePublic2815ComposerSelectionContract(wrong), /drift/)
})

test("Custom API safe refs are optional, closed, versioned and private, with exact Public28.16 parent preservation", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  assert.equal(
    createHash("sha256").update(restorePublic2816CustomApiSelectionContract(raw)).digest("hex"),
    "82485c2b7be17ad04f56d3656a58b42ea8d308c9dc22db5807a09ab706418a77",
  )
  const {
    components: { schemas },
  } = load(raw)
  const request = schemas.MessageCreateRequest
  const selection = schemas.PrivateSessionSnapshotResponse.properties.data.properties.composer_selection
  const field = request.properties.selected_custom_api_profiles
  assert.equal(field.maxItems, 32)
  assert.equal(field["x-kokoro-unique-by"], "profile_id")
  assert.equal(field.items.additionalProperties, false)
  assert.deepEqual(field.items.required, ["profile_id", "expected_state_version"])
  assert.deepEqual(field.items.properties.expected_state_version, { type: "integer", minimum: 1, maximum: 2147483647 })
  assert.equal(request.required.includes("selected_custom_api_profiles"), false)
  assert.equal(selection.required.includes("selected_custom_api_profiles"), false)
  assert.deepEqual(selection.properties.selected_custom_api_profiles, field)
  assert.equal(JSON.stringify(schemas.SessionSnapshotResponse).includes("selected_custom_api_profiles"), false)
  for (const wrong of [
    raw + "\n",
    raw.replace("x-kokoro-unique-by: profile_id", "x-kokoro-unique-by: version"),
    raw.replace("getMessageFeedback", "changedFeedback"),
  ])
    assert.throws(() => restorePublic2816CustomApiSelectionContract(wrong), /drift/)
})
