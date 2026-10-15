import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { bindCustomApiCommand } from "../src/infrastructure/clients/platform/custom-api-binding.js";
import { projectCustomApiResponse } from "../src/infrastructure/clients/platform/custom-api-response.js";
import {
  CreatePersonalCustomApiResponseSchema,
  PersonalCustomApiSchema,
} from "../src/generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js";

const identity = {
  requestId: "request",
  tenant: "tenant",
  subject: "user",
  commandId: "key",
  name: "API",
  environment: [{ name: "API_TOKEN", value: "secret-a" }],
};
test("Custom API create wire binds owner identity and secret name, but never serializes the secret in its public digest", () => {
  const first = bindCustomApiCommand("create", identity);
  const changedSecret = bindCustomApiCommand("create", {
    ...identity,
    environment: [{ name: "API_TOKEN", value: "secret-b" }],
  });
  assert.equal(first.requestDigest, changedSecret.requestDigest);
  assert.notEqual(
    first.requestDigest,
    bindCustomApiCommand("create", { ...identity, tenant: "other" })
      .requestDigest,
  );
  assert.equal(
    first.requestDigest,
    createHash("sha256")
      .update(
        '{"input":{"environment":["API_TOKEN"],"instructions":null,"name":"API"},"method":"kokoro.platform.v1.ProductCustomApiService/CreatePersonalCustomApi","subject_id":"user","tenant_id":"tenant"}',
      )
      .digest("hex"),
  );
});
test("Custom API update binds environment names as the owner command contract requires", () => {
  const first = bindCustomApiCommand("update", {
    ...identity,
    profileId: "profile",
    expectedStateVersion: "1",
    name: "API 2",
    environmentUpserts: [
      { name: "Z_TOKEN", value: "secret-z" },
      { name: "A_TOKEN", value: "secret-a" },
    ],
  });
  const changedSecret = bindCustomApiCommand("update", {
    ...identity,
    profileId: "profile",
    expectedStateVersion: "1",
    name: "API 2",
    environmentUpserts: [
      { name: "Z_TOKEN", value: "different-z" },
      { name: "A_TOKEN", value: "different-a" },
    ],
  });
  assert.equal(first.requestDigest, changedSecret.requestDigest);
  assert.equal(
    first.requestDigest,
    "3dc9e81429085235f5548da32e70c1242a8c87a38892a017774e7bc2415d434d",
  );
});
test("Custom API response projection exposes descriptors only", () => {
  const profile = create(PersonalCustomApiSchema, {
    profileId: { value: "profile" },
    name: "API",
    stateVersion: 1n,
    createdAt: timestampFromDate(new Date("2026-01-01T00:00:00.000Z")),
    updatedAt: timestampFromDate(new Date("2026-01-01T00:00:00.000Z")),
    environment: [
      {
        name: "API_TOKEN",
        configured: true,
        stateVersion: 1n,
        status: "active",
      },
    ],
  });
  const result = projectCustomApiResponse(
    "create",
    create(CreatePersonalCustomApiResponseSchema, { profile, replayed: false }),
  );
  assert.deepEqual(result, {
    custom_api: {
      profile_id: "profile",
      name: "API",
      state_version: "1",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      environment: [
        {
          name: "API_TOKEN",
          configured: true,
          state_version: "1",
          status: "active",
        },
      ],
    },
    replayed: false,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|value/i);
});
