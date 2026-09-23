import type { Server } from "node:http"

import { createBffServer } from "../../dist/bootstrap/server.js"
import type { BffConfig } from "../../src/config/runtime.ts"
import type { BffServerOptions } from "../../src/bootstrap/server.ts"
import { MockBffStore } from "./bff-store.ts"
import { MoriMockBffStore } from "./mori-store.ts"
import { mockBusiness } from "./mock-route.ts"
import { SessionAdmissionDouble } from "./session-admission.ts"

export type TestBffServer = {
  server: Server
  store: MockBffStore
  mori: MoriMockBffStore
}

/** Explicit fixture composition for contract tests; never imported by production. */
export function createTestBffServer(config: BffConfig, options: { moriAutoProgress?: boolean } = {}): TestBffServer {
  const store = new MockBffStore()
  const mori = new MoriMockBffStore(options.moriAutoProgress ?? true)
  const serverOptions: BffServerOptions = {
    sessionAdmission: new SessionAdmissionDouble({
      "test-session": { namespace: "ns_test", userId: "user_test" },
      "control-session": { namespace: "tenant_control", userId: "user_control" },
    }),
    businessStore: null,
    readiness: async (): Promise<void> => undefined,
    routeHandler: async ({ request, response, businessPath, context, json, mutation, idempotency }): Promise<void> => {
      await mockBusiness(request, response, businessPath, context, store, mori, idempotency, mutation, json)
    },
    sharedSessionReader: store,
  }
  return { server: createBffServer({ ...config, mode: "live" }, serverOptions), store, mori }
}

/** Explicit no-database composition for owner/upstream unit tests. */
export function createLiveTestBffServer(
  config: BffConfig,
  options: Omit<BffServerOptions, "businessStore" | "readiness"> & { readiness?: () => Promise<void> } = {},
): Server {
  const { readiness, ...otherOptions } = options
  return createBffServer(config, {
    ...otherOptions,
    sessionAdmission: otherOptions.sessionAdmission ?? new SessionAdmissionDouble({
      "test-session": { namespace: "ns_test", userId: "user_test" },
      "control-session": { namespace: "tenant_control", userId: "user_control" },
    }),
    businessStore: null,
    readiness: readiness ?? (async (): Promise<void> => undefined),
  })
}
