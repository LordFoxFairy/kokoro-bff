import assert from "node:assert/strict"
import { test } from "node:test"
import { zLaunchRequest } from "../src/generated/agent-http/zod.gen.js"
import { parseAgentDispatchPayload } from "../src/application/chat/agent-dispatch-payload.js"

const knowledgeId = "01234567-89ab-4cde-8fab-0123456789ab"
const item = {
  knowledge_id: knowledgeId,
  revision: 1,
  name: "知识",
  when_to_use: "相关时",
  content: "多语言😀",
}
const context = {
  schema_version: 1,
  owner: { tenant_ref: "tenant", user_ref: "actor" },
  profile: {
    revision: 1,
    nickname: "",
    occupation: "",
    about: "",
    instructions: "请简洁回答😀",
  },
  knowledge: { usage_revision: 1, enabled: true, items: [item] },
}
const payload = {
  schema_version: 3,
  launch: {
    request_id: "request",
    run_id: "run",
    session_id: "session",
    feature_key: "chat",
    message_id: "message",
    content: "question",
    project_ref: "project",
    selected_skill_source_refs: [],
    trace: { source: "kokoro-bff", project_ref: "project" },
  },
}

test("B08 owner generated personal context is closed and enforces its conditional knowledge semantics", () => {
  const schema = zLaunchRequest.shape.personal_context
  assert.equal(schema.safeParse(context).success, true)
  for (const invalid of [
    { ...context, secret: "unexpected" },
    { ...context, owner: { ...context.owner, subject_ref: "project" } },
    { ...context, profile: { ...context.profile, secret: "unexpected" } },
    { ...context, knowledge: { ...context.knowledge, secret: "unexpected" } },
    {
      ...context,
      knowledge: {
        ...context.knowledge,
        items: [{ ...item, secret: "unexpected" }],
      },
    },
    { ...context, knowledge: { ...context.knowledge, enabled: false } },
    { ...context, knowledge: { ...context.knowledge, usage_revision: 0 } },
    {
      ...context,
      knowledge: {
        ...context.knowledge,
        items: [item, { ...item, content: "different body, same identity" }],
      },
    },
  ])
    assert.equal(schema.safeParse(invalid).success, false, "owner constraints must reject, never strip unknown material")
})

test("B08 personal text limits count Unicode scalars and preserve owner text restrictions", () => {
  const schema = zLaunchRequest.shape.personal_context
  const max = {
    ...context,
    profile: {
      ...context.profile,
      nickname: "😀".repeat(128),
      instructions: "雪".repeat(8000),
    },
  }
  assert.deepEqual(schema.parse(max), max)
  for (const nickname of ["😀".repeat(129), "bad\u0000", "bad\ud800"])
    assert.equal(
      schema.safeParse({
        ...context,
        profile: { ...context.profile, nickname },
      }).success,
      false,
    )
})

test("B08 durable parser preserves a private snapshot without changing the old no-feature payload", () => {
  assert.deepEqual(parseAgentDispatchPayload(payload), payload)
  const material = {
    ...payload,
    launch: { ...payload.launch, personal_context: context },
  }
  assert.deepEqual(parseAgentDispatchPayload(material), material)
  assert.equal(Object.hasOwn(parseAgentDispatchPayload(payload).launch, "personal_context"), false)
})

test("B08 snapshot distinguishes absent facts, existing empty profile and explicit disabled usage", async () => {
  const { readChatTurnPersonalContext } = await import("../src/infrastructure/postgres/chat-turn-personal-context.js")
  const reads: unknown[][] = []
  const read = async (row: { profile: unknown; usage: unknown; items: unknown }) =>
    readChatTurnPersonalContext(
      (async (_sql, values) => {
        reads.push(values!)
        return { rows: [row] }
      }) as never,
      { tenantId: "tenant", actorId: "actor" },
    )
  assert.equal(await read({ profile: null, usage: null, items: [] }), undefined)
  const emptyProfile = { ...context.profile, instructions: "" }
  assert.deepEqual(await read({ profile: emptyProfile, usage: null, items: [] }), {
    ...context,
    profile: emptyProfile,
    knowledge: { usage_revision: 0, enabled: false, items: [] },
  })
  assert.deepEqual(
    await read({
      profile: null,
      usage: { usage_revision: 7, enabled: false },
      items: [],
    }),
    {
      ...context,
      profile: null,
      knowledge: { usage_revision: 7, enabled: false, items: [] },
    },
  )
  assert.deepEqual(reads, [
    ["tenant", "actor"],
    ["tenant", "actor"],
    ["tenant", "actor"],
  ])
})

test("B08 snapshot fails closed on owner read failures, malformed material and 100-plus-one items", async () => {
  const { readChatTurnPersonalContext } = await import("../src/infrastructure/postgres/chat-turn-personal-context.js")
  await assert.rejects(
    readChatTurnPersonalContext(
      async () => {
        throw Error("PG read failed")
      },
      { tenantId: "tenant", actorId: "actor" },
    ),
    /PG read failed/,
  )
  for (const row of [
    undefined,
    { profile: { ...context.profile, revision: 0 }, usage: null, items: [] },
    {
      profile: null,
      usage: { usage_revision: 1, enabled: true },
      items: Array.from({ length: 101 }, (_, index) => ({
        ...item,
        knowledge_id: `01234567-89ab-4cde-8fab-${String(index).padStart(12, "0")}`,
      })),
    },
  ])
    await assert.rejects(
      readChatTurnPersonalContext((async () => ({ rows: row === undefined ? [] : [row] })) as never, { tenantId: "tenant", actorId: "actor" }),
      /CHAT_PERSONAL_CONTEXT_INVALID/,
    )
})

test("B08 saved HTTP projection keeps private material only as top-level input, not a trace or public text copy", async () => {
  const { projectSavedAgentLaunch } = await import("../src/infrastructure/clients/agent/http-wire.js")
  const { project_ref: _project, ...saved } = payload.launch
  const projected = projectSavedAgentLaunch({
    ...saved,
    personal_context: context,
  })!
  assert.deepEqual(projected.personal_context, context)
  assert.equal(projected.content, "question")
  assert.equal(Object.hasOwn(projected.trace!, "personal_context"), false)
  assert.equal(
    projectSavedAgentLaunch({
      ...saved,
      personal_context: { ...context, secret: true },
    }),
    null,
  )
})
