import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { restorePublic2814FinalDisplayContract } from "../scripts/final-answer-public-contract.mjs"
test("private final adjunct preserves exact Public28.14, including all historical final and Share semantics", async () => {
  const raw = await readFile(new URL("../contract/openapi/v1/openapi.yaml", import.meta.url), "utf8")
  const hash = (s) => createHash("sha256").update(s).digest("hex")
  assert.equal(hash(restorePublic2814FinalDisplayContract(raw)), "921be666a3bd570eb984503528d9ee713e3739cc8525e2e1c2f46c96fa161a05")
  for (const wrong of [raw + "\n", raw.replace("final_answer:", "unbound_answer:"), raw.replace("getMessageFeedback", "changedFeedback")])
    assert.throws(() => restorePublic2814FinalDisplayContract(wrong), /drift/)
})
