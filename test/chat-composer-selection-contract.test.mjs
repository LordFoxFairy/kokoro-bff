import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { load } from "js-yaml"
import { restorePublic2815ComposerSelectionContract } from "../scripts/composer-selection-public-contract.mjs"

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
