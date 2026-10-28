import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { test } from "node:test"
import { load } from "js-yaml"

test("Public28.9 only adds a private exact cancelled terminal fact; original public Message and commands stay byte-equivalent", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8"),
    spec = load(raw)
  assert.equal(spec.info.version, "28.9.0")
  const { restorePublic288CancelledMessageContract } = await import("../scripts/project-pin-public-contract.mjs")
  const parent = restorePublic288CancelledMessageContract(raw)
  assert.equal(createHash("sha256").update(parent).digest("hex"), "6376e2d2a5fa9efd8e6ce4d9d4aa3686ad73dda8babffd9ac5b7097073538498")
  const previous = load(parent),
    schemas = spec.components.schemas
  assert.deepEqual(schemas.ChatMessage, previous.components.schemas.ChatMessage)
  assert.deepEqual(spec.paths, previous.paths)
  assert.equal(schemas.CancelledAssistantMessageRead.additionalProperties, false)
  assert.deepEqual(schemas.CancelledAssistantMessageRead.properties.terminal_status, { type: "string", const: "cancelled" })
  assert.ok(schemas.CancelledAssistantMessageRead.required.includes("terminal_status"))
  assert.ok(schemas.CancelledAssistantMessageRead.required.includes("run_id"))
  assert.equal(schemas.CancelledAssistantMessageRead.properties.role.const, "assistant")
  assert.equal(schemas.CancelledAssistantMessageRead.properties.status.const, "failed")
  assert.equal(Object.hasOwn(schemas.CancelledAssistantMessageRead.properties, "failure"), false)
  assert.deepEqual(schemas.OrderedAssistantMessageRead.properties.terminal_status, { type: "string", const: "cancelled" })
  for (const bad of [
    raw + "\n",
    raw.replace("listProjects", "otherOperation"),
    raw.replace("const: cancelled", "const: completed"),
    raw.replace("28.9.0", "28.10.0"),
  ])
    assert.throws(() => restorePublic288CancelledMessageContract(bad), /drift/u)
})
