import { projectResourceParentBaseline } from "./project-resource-access-public-contract.mjs";
// Build/test-only exact Public27→26 inverse. Never imported by production runtime.
import { createHash } from "node:crypto";
import { restorePublic27ToolDisplayContract } from "./tool-display-public-contract.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
export const messagePartsParentSha256 =
  "20d26736cf23da32c242c2c7cf75c45affb62c5d27696dcecb0bc6193bc39a09";
const delta = [
  {
    kind: "path",
    name: "/v1/sessions/{id}",
    before:
      "  /v1/sessions/{id}:\n    parameters:\n      - $ref: '#/components/parameters/SessionId'\n    get:\n      tags: [Chat]\n      operationId: getSessionSnapshot\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: none\n      x-kokoro-permission: chat.session.read\n      summary: Get a session snapshot\n      description: >-\n        Returns the owner-scoped session, the latest 100 durable Message facts in chronological\n        order, up to 100 most recent durable Artifact deliveries in delivered_at descending and\n        artifact_id ascending order, and AG-UI event watermark from one PostgreSQL read snapshot.\n        deliveries_has_more indicates older deliveries; use the owner's paginated Artifact Library\n        for complete history. The watermark is the latest committed public ledger cursor visible\n        with these facts, not an Agent execution cursor.\n      parameters:\n        - $ref: '#/components/parameters/DirectScopeQuery'\n        - $ref: '#/components/parameters/ProjectRefQuery'\n      responses:\n        '200':\n          description: Session snapshot\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/SessionSnapshotResponse'\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '404': { $ref: '#/components/responses/NotFound' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n    delete:\n      tags: [Chat]\n      operationId: deleteSession\n      x-kokoro-owner: kokoro-bff\n      x-kokoro-visibility: public\n      x-kokoro-stability: beta\n      x-kokoro-idempotency: required\n      x-kokoro-permission: chat.session.delete\n      summary: Delete a chat session\n      parameters:\n        - $ref: '#/components/parameters/IdempotencyKey'\n        - $ref: '#/components/parameters/DirectScopeQuery'\n        - $ref: '#/components/parameters/ProjectRefQuery'\n      responses:\n        '200':\n          description: Delete receipt\n          content:\n            application/json:\n              schema:\n                $ref: '#/components/schemas/DeleteSessionResponse'\n        '401': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '403': { $ref: '#/components/responses/ServiceAuthFailed' }\n        '404': { $ref: '#/components/responses/NotFound' }\n        '409': { $ref: '#/components/responses/Conflict' }\n        '429':\n          description: IAM session admission is rate limited\n          headers:\n            Retry-After:\n              description: Bounded delay in seconds before retrying admission\n              schema: { type: string, pattern: '^[1-9][0-9]{0,4}$' }\n          content:\n            application/json:\n              schema: { $ref: '#/components/schemas/ErrorEnvelope' }\n        '503': { $ref: '#/components/responses/ServiceUnavailable' }\n",
    after_sha256:
      "5ea4183b1a7ca1b9911ae8c421990dcf6b56f6d512e1b6c0f1c687fd32245c32",
  },
  {
    kind: "schema",
    name: "SessionMessageListResponse",
    before:
      "    SessionMessageListResponse:\n      type: object\n      required: [data, meta]\n      additionalProperties: false\n      properties:\n        data:\n          type: object\n          required: [messages, next_cursor]\n          additionalProperties: false\n          properties:\n            messages:\n              type: array\n              items: { $ref: '#/components/schemas/ChatMessage' }\n            next_cursor:\n              type: [string, 'null']\n              description: Opaque cursor for the next page; null means there is no next page.\n              example: null\n        meta: { $ref: '#/components/schemas/RequestMeta' }\n      example:\n        data:\n          messages: []\n          next_cursor: null\n        meta:\n          request_id: req_01JASYNC000000000000000000\n",
    after_sha256:
      "cabd532934575d6dc1de2e5dd3f09de054435a9c116bc7656ff815be874b7cb3",
  },
  {
    kind: "path",
    name: "/v1/sessions/{id}/messages/{messageId}/parts",
    before: "",
    after_sha256:
      "b5a96d761911ab77a181f5a8422f1d1db91f71736a441a3931d6f100c38d247d",
  },
  {
    kind: "schema",
    name: "MessagePartsDecimal",
    before: "",
    after_sha256:
      "663b6e8e823e790f570cffae5bd721944d05024980218df9925e175a7f1dd5e4",
  },
  {
    kind: "schema",
    name: "ChatMessageRead",
    before: "",
    after_sha256:
      "c36b4409432af593f44bda97b266f74729ae4f7cd2898375348dbcc3af5ea47f",
  },
  {
    kind: "schema",
    name: "OrderedAssistantMessageRead",
    before: "",
    after_sha256:
      "6bf4643e793d529c97ef401239c19ca23f58abd723ec68113f7b1a1bd2a6802f",
  },
  {
    kind: "schema",
    name: "OrderedMessageRendering",
    before: "",
    after_sha256:
      "8a227f1bb8ad4a4289716a60795a4e30144d4e7da7d27dfd36608e99d8c3ab0b",
  },
  {
    kind: "schema",
    name: "MessageTextPartSlice",
    before: "",
    after_sha256:
      "84f420a64daa5358d2adb74233492da1ac55f9f64c163217083e14b7e262e91e",
  },
  {
    kind: "schema",
    name: "MessageActivityPart",
    before: "",
    after_sha256:
      "9735271f046351ced57d394455b8c75457c1e11f8edcd8fda3876a26652e73ec",
  },
  {
    kind: "schema",
    name: "MessagePartsPage",
    before: "",
    after_sha256:
      "a9de813aa9c21d907cf5bcd43688727c7032ecc7c4320be322772666d4ebdb2b",
  },
  {
    kind: "schema",
    name: "MessagePartsPageResponse",
    before: "",
    after_sha256:
      "8164c12d573595653c2327c22e545a07eaa0f2e7ac96ebd70e94fffed8836e44",
  },
  {
    kind: "schema",
    name: "PrivateSessionSnapshotResponse",
    before: "",
    after_sha256:
      "6059c4f16d1e3f194ce41d8d632a050e009258c99994554d91d85b5238e412af",
  },
  {
    kind: "schema",
    name: "SessionEventStream",
    before:
      '    SessionEventStream:\n      type: string\n      description: AG-UI server-sent event frames read from the BFF PostgreSQL ledger. Each id is a distinct opaque resume cursor. CUSTOM kokoro.interaction.state carries one complete ChatInteractionState in value; HTTP control admission does not resolve it.\n      x-kokoro-custom-event-values:\n        kokoro.interaction.state:\n          $ref: \'#/components/schemas/ChatInteractionState\'\n      example: |-\n        id: agui_0123456789abcdef0123456789abcdef\n        data: {"type":"CUSTOM","name":"kokoro.interaction.state","timestamp":1767225604000,"value":{"interaction_revision":1,"pause_revision":1,"pause_ref":"pause_01J","phase":"waiting","groups":[{"group_id":"group_01J","items":[{"item_id":"item_01J","request_id":"request_01J","kind":"tool_approval","allowed_decisions":["approve","reject"],"display":{"name":"Review","description":"Approve this action","editable":false,"input_schema":{"type":"object"}}}]}],"action_result":null},"metadata":{"kokoro":{"event_id":"agent_event_4","seq":4,"session_id":"session_kokoro","run_id":"run_01JASYNC","timestamp":"2026-01-01T00:00:04.000Z"}}}\n\n        id: agui_abcdef0123456789abcdef0123456789ab\n        data: {"type":"RUN_FINISHED","timestamp":1767225605000,"threadId":"session_kokoro","runId":"run_01JASYNC","metadata":{"kokoro":{"event_id":"agent_event_5","seq":5,"session_id":"session_kokoro","run_id":"run_01JASYNC","timestamp":"2026-01-01T00:00:05.000Z"}}}\n',
    after_sha256:
      "431a0c857d7470bc9a0a33363665a630b340ab1de5d63594193bf9100a9b21d9",
  },
  {
    kind: "schema",
    name: "KokoroAgUiReplayMetadata",
    before: "",
    after_sha256:
      "a914e53aee60217f884be6e14fd1375fd9d6cf4b2fd49c83c1d8b34a9a5cf7ba",
  },
];
function namedBlock(source, kind, name) {
  const indent = kind === "path" ? "  " : "    ";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const next =
    kind === "path"
      ? "(?=^  /|^components:|\\Z)"
      : "(?=^    [A-Za-z0-9_]+:\\n|\\Z)";
  // JavaScript has no \Z anchor. The final alternative is the true end of input.
  const ending = next.replace("\\Z", "(?![\\s\\S])");
  return (
    source.match(
      new RegExp(`^${indent}${escaped}:\\n[\\s\\S]*?${ending}`, "mu"),
    )?.[0] ?? null
  );
}
export function restorePublic26MessagePartsContract(source) {
  source = restorePublic27ToolDisplayContract(source);
  if (!/^  version: 27\.0\.0$/mu.test(source)) return source;
  let parent = source;
  for (const entry of delta) {
    const current = namedBlock(parent, entry.kind, entry.name);
    if (current === null || hash(current) !== entry.after_sha256)
      throw Error(`Message parts Public27 exact delta drift: ${entry.name}`);
    parent = parent.replace(current, () => entry.before);
  }
  parent = parent.replace(/^  version: 27\.0\.0$/mu, "  version: 26.0.0");
  if (hash(parent) !== messagePartsParentSha256)
    throw Error("Message parts complete Public26 parent drift");
  return parent;
}

export function messagePartsParentBaseline(inventory) {
  inventory = projectResourceParentBaseline(inventory);
  if (inventory.length !== 187) return inventory;
  if (
    hash(JSON.stringify(inventory)) !==
    "4f58ddbc0dd6fe72c457651948fa5ac281c4057fbf98ae618dc7e5f1358c2d01"
  )
    throw Error("Message parts current operation inventory drift");
  const parent = inventory.filter(
    (item) => item.operation_id !== "getSessionMessageParts",
  );
  if (
    parent.length !== 186 ||
    hash(JSON.stringify(parent)) !==
      "3060e579e18f28e618189426a441efaee98e10be5c110fa0a2aaff60d2cbf3ad"
  )
    throw Error("Message parts complete Public26 inventory drift");
  return parent;
}
