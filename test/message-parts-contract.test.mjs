import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { load } from "js-yaml";
import { projectResourceParentBaseline, restorePublic28ProjectResourceContract } from "../scripts/project-resource-access-public-contract.mjs";
import { restorePublic27ToolDisplayContract, toolDisplayParentSha256 } from "../scripts/tool-display-public-contract.mjs";

const contractUrl = new URL(
  "../contract/openapi/v1/openapi.yaml",
  import.meta.url,
);
// Historical Public28/27 assertions operate on the exact frozen Public28 parent.
// Current Project-resource deltas and inventory are independently checked before this inverse.
const readPublic28Source = async () => restorePublic28ProjectResourceContract(await readFile(contractUrl, "utf8"));
const read = async () => load(await readPublic28Source());

test("ordered assistant read is separate from the original Message command and shared representation", async () => {
  const api = await read();
  assert.equal(api.info.version, "28.0.0");
  for (const name of [
    "PrivateSessionSnapshotResponse",
    "SessionMessageListResponse",
  ]) {
    assert.equal(
      api.components.schemas[name].properties.data.properties.messages.items
        .$ref,
      "#/components/schemas/ChatMessageRead",
    );
  }
  const schemas = api.components.schemas;
  assert.deepEqual(schemas.ChatMessageRead.oneOf, [
    { $ref: "#/components/schemas/ChatMessage" },
    { $ref: "#/components/schemas/OrderedAssistantMessageRead" },
  ]);
  assert.equal(schemas.ChatMessage.properties.content.type, "string");
  assert.equal(
    Object.hasOwn(schemas.ChatMessage.properties, "rendering"),
    false,
  );
  const ordered = schemas.OrderedAssistantMessageRead;
  assert.equal(ordered.additionalProperties, false);
  assert.equal(ordered.properties.role.const, "assistant");
  assert.equal(ordered.properties.content.type, "null");
  assert.ok(ordered.required.includes("run_id"));
  assert.ok(ordered.required.includes("rendering"));
  assert.deepEqual(schemas.MessageReceipt.required, [
    "run_id",
    "user_message_id",
    "assistant_message_id",
  ]);
  assert.equal(
    api.paths["/v1/sessions/{id}"].get.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/PrivateSessionSnapshotResponse",
  );
  assert.equal(
    api.paths["/v1/shared/{shareId}"].get.responses["200"].content[
      "application/json"
    ].schema.$ref,
    "#/components/schemas/SessionSnapshotResponse",
  );
  assert.equal(
    schemas.SessionSnapshotResponse.properties.data.properties.messages.items
      .$ref,
    "#/components/schemas/ChatMessage",
  );
});

test("message parts is one authorized bounded read, with no write body or second stream", async () => {
  const api = await read();
  const path = api.paths["/v1/sessions/{id}/messages/{messageId}/parts"];
  assert.ok(path);
  assert.deepEqual(Object.keys(path).sort(), ["get", "parameters"]);
  const operation = path.get;
  assert.equal(operation.operationId, "getSessionMessageParts");
  assert.equal(operation["x-kokoro-permission"], "chat.session.read");
  assert.equal(operation["x-kokoro-idempotency"], "none");
  assert.equal(Object.hasOwn(operation, "requestBody"), false);
  assert.deepEqual(operation.parameters.slice(0, 2), [
    { $ref: "#/components/parameters/DirectScopeQuery" },
    { $ref: "#/components/parameters/ProjectRefQuery" },
  ]);
  const limit = operation.parameters.find((item) => item.name === "limit");
  assert.deepEqual(limit.schema, {
    type: "integer",
    minimum: 1,
    maximum: 32,
    default: 16,
  });
  assert.deepEqual(Object.keys(operation.responses["200"].content), [
    "application/json",
  ]);
  assert.equal(
    operation.responses["200"].headers["Cache-Control"].schema.const,
    "no-store",
  );
  assert.equal(operation["x-kokoro-max-response-bytes"], 1048576);
  for (const status of ["400", "401", "403", "404", "409", "410", "429", "503"])
    assert.ok(operation.responses[status]);
});

test("ordered parts use safe typed items, exact decimal positions and the original opaque event watermark", async () => {
  const schemas = (await read()).components.schemas;
  const rendering = schemas.OrderedMessageRendering;
  assert.ok(rendering);
  assert.equal(rendering.additionalProperties, false);
  assert.deepEqual(rendering.required, [
    "mode",
    "format_version",
    "revision",
    "event_watermark",
    "parts_cursor",
  ]);
  assert.equal(
    rendering.properties.event_watermark.$ref,
    "#/components/schemas/EventWatermark",
  );
  assert.equal(rendering.properties.mode.const, "ordered");
  const text = schemas.MessageTextPartSlice;
  const activity = schemas.MessageActivityPart;
  for (const item of [text, activity]) {
    assert.equal(item.additionalProperties, false);
    for (const name of ["part_id", "first_sequence", "latest_sequence"])
      assert.ok(item.required.includes(name));
  }
  assert.equal(text.properties.text.maxLength, 4096);
  assert.ok(
    text.required.includes("segment_id"),
    "explicit public AG-UI messageId binds later live updates without decoding opaque part_id",
  );
  for (const name of ["offset", "end", "total_scalars"])
    assert.equal(
      text.properties[name].$ref,
      "#/components/schemas/MessagePartsDecimal",
    );
  assert.equal(
    activity.properties.activity.$ref,
    "#/components/schemas/RunProcessActivity",
  );
  assert.equal(Object.hasOwn(text.properties, "final"), false);
  assert.equal(Object.hasOwn(activity.properties, "raw"), false);
  const decimal = new RegExp(schemas.MessagePartsDecimal.pattern, "u");
  for (const value of ["0", "1", "9007199254740993", "9223372036854775807"])
    assert.equal(decimal.test(value), true, value);
  for (const value of ["-1", "01", "1.0", "1\n", "9223372036854775808"])
    assert.equal(decimal.test(value), false, value);
});

test("Public27 restores the complete exact Public26 parent and rejects new or unrelated contract drift", async () => {
  const { restorePublic26MessagePartsContract, messagePartsParentSha256 } =
    await import("../scripts/message-parts-public-contract.mjs");
  const { restorePublic25McpPersonalSseContract } =
    await import("../scripts/mcp-personal-sse-public-contract.mjs");
  const source = restorePublic27ToolDisplayContract(await readPublic28Source());
  const parent = restorePublic26MessagePartsContract(source);
  assert.equal(
    createHash("sha256").update(parent).digest("hex"),
    messagePartsParentSha256,
  );
  assert.equal(
    createHash("sha256")
      .update(restorePublic25McpPersonalSseContract(source))
      .digest("hex"),
    "7261ac9ce2140555ba97ebff2bf0359533cc49dda014b08dcd6a6054a8d38b1c",
  );
  for (const changed of [
    source + "\n",
    source.replace("maximum: 32, default: 16", "maximum: 64, default: 16"),
    source.replace("maxLength: 4096", "maxLength: 4097"),
    source.replace(
      "text, offset, end, total_scalars",
      "text, offset, total_scalars",
    ),
    source.replace(
      "x-kokoro-permission: capability.skill.read",
      "x-kokoro-permission: forged.read",
    ),
    source.replace(
      "Opaque chat session identifier.",
      "tampered unrelated identifier",
    ),
  ]) {
    assert.notEqual(changed, source);
    assert.throws(
      () => restorePublic26MessagePartsContract(changed),
      /Message parts .*drift/u,
    );
  }
});

test("the sole new read operation restores the exact frozen Public26 operation inventory", async () => {
  const { messagePartsParentBaseline } =
    await import("../scripts/message-parts-public-contract.mjs");
  const inventory = projectResourceParentBaseline(JSON.parse(
    await readFile(
      new URL("../contract/tests/v1-operations.json", import.meta.url),
      "utf8",
    ),
  ).operations);
  const parent = messagePartsParentBaseline(inventory);
  assert.equal(inventory.length, 187);
  assert.equal(parent.length, 186);
  assert.equal(
    parent.some((item) => item.operation_id === "getSessionMessageParts"),
    false,
  );
  for (const key of ["path", "method", "operation_id"]) {
    const changed = inventory.map((item) =>
      item.operation_id === "getSessionMessageParts"
        ? { ...item, [key]: "forged" }
        : item,
    );
    assert.throws(
      () => messagePartsParentBaseline(changed),
      /Message parts .*inventory drift/u,
    );
  }
});

test("all durable AG-UI replay metadata requires a separate positive decimal public position without changing either source shape", async () => {
  const api = await read();
  const schemas = api.components.schemas;
  assert.deepEqual(schemas.SessionEventStream["x-kokoro-owner-metadata"], {
    $ref: "#/components/schemas/KokoroAgUiReplayMetadata",
  });
  const metadata = schemas.KokoroAgUiReplayMetadata;
  assert.deepEqual(metadata.required, ["kokoro"]);
  assert.equal(metadata.additionalProperties, false);
  const [agent, bff] = metadata.properties.kokoro.oneOf;
  for (const shape of [agent, bff]) {
    assert.ok(shape.required.includes("public_sequence"));
    assert.equal(shape.additionalProperties, false);
    assert.equal(
      shape.properties.public_sequence.$ref,
      "#/components/schemas/MessagePartsDecimal",
    );
    assert.deepEqual(shape.properties.public_sequence.not, { const: "0" });
  }
  assert.equal(agent.properties.seq.type, "integer");
  assert.equal(agent.properties.seq.maximum, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(agent.properties.failure, {
    $ref: "#/components/schemas/ChatMessage/properties/failure",
  });
  assert.equal(Object.hasOwn(agent.properties, "source_owner"), false);
  assert.equal(bff.properties.source_owner.const, "kokoro-bff");
  assert.ok(bff.required.includes("source_owner"));
  assert.equal(
    bff.properties.seq.$ref,
    "#/components/schemas/MessagePartsDecimal",
  );
  assert.equal(Object.hasOwn(bff.properties, "failure"), false);
  const frames = schemas.SessionEventStream.example
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  assert.deepEqual(
    frames.map((frame) => frame.metadata.kokoro.seq),
    [4, 5],
  );
  assert.deepEqual(
    frames.map((frame) => frame.metadata.kokoro.public_sequence),
    ["7", "8"],
  );
  const { restorePublic26MessagePartsContract } =
    await import("../scripts/message-parts-public-contract.mjs");
  const source = restorePublic27ToolDisplayContract(await readPublic28Source());
  for (const changed of [
    source.replace("timestamp, public_sequence]", "timestamp]"),
    source.replace(
      "x-kokoro-owner-metadata:",
      "x-kokoro-owner-metadata-forged:",
    ),
    source.replace('"public_sequence":"7"', '"public_sequence":"4"'),
  ]) {
    assert.notEqual(changed, source);
    assert.throws(
      () => restorePublic26MessagePartsContract(changed),
      /Message parts .*drift/u,
    );
  }
});

test("Public28 publishes only the seven Agent tool display classes and preserves the separate subagent branch", async () => {
  const api = await read();
  assert.equal(api.info.version, "28.0.0");
  assert.deepEqual(api.components.schemas.RunToolActivity.properties.display_code, {
    type: "string", enum: ["tool.execution", "tool.file.read", "tool.mcp.discover", "tool.mcp.describe", "tool.mcp.call", "tool.web.search", "tool.web.fetch"],
  });
  assert.deepEqual(api.components.schemas.RunSubagentActivity.properties.display_code, { const: "subagent.execution" });
});

test("Public28 restores the full frozen Public27 before every unchanged historical parent and rejects unrelated drift", async () => {
  const source = await readPublic28Source();
  const parent = restorePublic27ToolDisplayContract(source);
  assert.equal(createHash("sha256").update(parent).digest("hex"), toolDisplayParentSha256);
  assert.equal(toolDisplayParentSha256, "d2b3d546164cadc9655616fc44daf1511a6f7d4a2e5d172f1415552af8942ed1");
  for (const changed of [
    source + "\n",
    source.replace("tool.web.fetch]", "tool.web.fetch, tool.file.write]"),
    source.replace("tool.web.search, ", ""),
    source.replace("const: subagent.execution", "const: tool.execution"),
    source.replace("Opaque chat session identifier.", "tampered unrelated identifier"),
  ]) {
    assert.notEqual(changed, source);
    assert.throws(() => restorePublic27ToolDisplayContract(changed), /Tool display .*drift/u);
  }
});


test("Public28.3 publishes exactly the two additional file display codes, no new fields or operations", async () => {
  const api = load(await readFile(contractUrl, "utf8"));
  assert.equal(api.info.version, "28.3.0");
  assert.deepEqual(api.components.schemas.RunToolActivity.required, ["activity", "activity_id", "segment_id", "status", "display_code"]);
  assert.deepEqual(Object.keys(api.components.schemas.RunToolActivity.properties), api.components.schemas.RunToolActivity.required);
  assert.equal(api.components.schemas.RunToolActivity.additionalProperties, false);
  assert.deepEqual(api.components.schemas.RunToolActivity.properties.display_code, { type: "string", enum: ["tool.execution", "tool.file.read", "tool.mcp.discover", "tool.mcp.describe", "tool.mcp.call", "tool.web.search", "tool.web.fetch", "tool.file.write", "tool.file.deliver"] });
  assert.deepEqual(api.components.schemas.RunSubagentActivity.properties.display_code, { const: "subagent.execution" });
  const methods = new Set(["get", "put", "post", "delete", "patch", "head", "options", "trace"]);
  assert.equal(Object.values(api.paths).flatMap(item => Object.keys(item).filter(method => methods.has(method))).length, 192);
});


test("Public28.3 restores complete frozen Public28.2 before the original inverse chain and rejects either-side tampering", async () => {
  const { restorePublic282FileToolDisplayContract, fileToolDisplayCurrentSha256, fileToolDisplayParentSha256 } = await import("../scripts/file-tool-display-public-contract.mjs");
  const source = await readFile(contractUrl, "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), fileToolDisplayCurrentSha256);
  const parent = restorePublic282FileToolDisplayContract(source);
  assert.equal(createHash("sha256").update(parent).digest("hex"), fileToolDisplayParentSha256);
  assert.equal(fileToolDisplayParentSha256, "e0bb74069c65fb8d414a6a3cb0d6f4c8d9bcb40bb693c2409a9cbe051b8bac53");
  assert.equal(load(parent).info.version, "28.2.0");
  for (const changed of [
    source + "\n",
    source.replace("tool.file.write, ", ""),
    source.replace("tool.file.deliver]", "tool.file.unreviewed]"),
    source.replace("version: 28.3.0", "version: 28.2.0"),
    source.replace("const: subagent.execution", "const: tool.file.write"),
    source.replace("Opaque chat session identifier.", "tampered unrelated identifier"),
  ]) {
    assert.notEqual(changed, source);
    assert.throws(() => restorePublic282FileToolDisplayContract(changed), /Tool display file .*drift/u);
  }
  for (const changed of [parent + "\n", parent.replace("tool.web.search, ", ""), parent.replace("Opaque chat session identifier.", "tampered old identifier")]) {
    assert.notEqual(changed, parent);
    assert.throws(() => restorePublic28ProjectResourceContract(changed), /Project MCP recommendations .*drift/u);
  }
});
