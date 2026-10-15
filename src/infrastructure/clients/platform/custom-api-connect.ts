import { create } from "@bufbuild/protobuf";
import { createClient, type CallOptions } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  CreatePersonalCustomApiRequestSchema,
  DeletePersonalCustomApiRequestSchema,
  GetPersonalCustomApiRequestSchema,
  ListPersonalCustomApisRequestSchema,
  ProductCustomApiService,
  UpdatePersonalCustomApiRequestSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js";
import {
  bindCustomApiCommand,
  type CustomApiInput,
  type CustomApiOperation,
} from "./custom-api-binding.js";
import { projectCustomApiResponse } from "./custom-api-response.js";
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js";

export class CustomApiConnectClient {
  readonly #client;
  readonly #active = new Set<AbortController>();
  #closed = false;
  constructor(
    baseUrl: string,
    private readonly credentials: Pick<PlatformServiceCredentialSource, "get">,
  ) {
    this.#client = createClient(
      ProductCustomApiService,
      createConnectTransport({
        baseUrl,
        httpVersion: "1.1",
        useBinaryFormat: true,
        readMaxBytes: 1_048_576,
        writeMaxBytes: 1_048_576,
      }),
    );
  }
  close(): void {
    this.#closed = true;
    for (const controller of this.#active) controller.abort();
    this.#active.clear();
  }
  async execute(
    operation: CustomApiOperation,
    input: CustomApiInput,
    outer: AbortSignal,
    deadlineAt: number,
  ): Promise<unknown> {
    return this.#call(input, outer, deadlineAt, async (options) => {
      const page = {
        limit: input.limit ?? 50,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      };
      const command =
        operation === "create" ||
        operation === "update" ||
        operation === "remove"
          ? bindCustomApiCommand(operation, input)
          : undefined;
      let value: unknown;
      if (operation === "create")
        value = await this.#client.createPersonalCustomApi(
          create(CreatePersonalCustomApiRequestSchema, {
            requestId: input.requestId,
            command,
            name: input.name!,
            ...(input.instructions === undefined
              ? {}
              : { instructions: input.instructions }),
            environment: [...(input.environment ?? [])],
          }),
          options,
        );
      else if (operation === "get")
        value = await this.#client.getPersonalCustomApi(
          create(GetPersonalCustomApiRequestSchema, {
            requestId: input.requestId,
            profileId: { value: input.profileId! },
          }),
          options,
        );
      else if (operation === "list")
        value = await this.#client.listPersonalCustomApis(
          create(ListPersonalCustomApisRequestSchema, {
            requestId: input.requestId,
            page,
          }),
          options,
        );
      else if (operation === "update")
        value = await this.#client.updatePersonalCustomApi(
          create(UpdatePersonalCustomApiRequestSchema, {
            requestId: input.requestId,
            command,
            profileId: { value: input.profileId! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.instructions === undefined
              ? {}
              : { instructions: input.instructions }),
            clearInstructions: input.clearInstructions ?? false,
            environmentUpserts: [...(input.environmentUpserts ?? [])],
            environmentRemovals: [...(input.environmentRemovals ?? [])],
          }),
          options,
        );
      else
        value = await this.#client.deletePersonalCustomApi(
          create(DeletePersonalCustomApiRequestSchema, {
            requestId: input.requestId,
            command,
            profileId: { value: input.profileId! },
            expectedStateVersion: BigInt(input.expectedStateVersion!),
          }),
          options,
        );
      return projectCustomApiResponse(operation, value);
    });
  }
  async #call<T>(
    input: CustomApiInput,
    outer: AbortSignal,
    deadlineAt: number,
    action: (options: CallOptions) => Promise<T>,
  ): Promise<T> {
    if (this.#closed) throw new Error("custom_api_closed");
    const controller = new AbortController();
    this.#active.add(controller);
    const remaining = () =>
      Math.max(0, Math.floor(deadlineAt - performance.now()));
    const timer = setTimeout(() => controller.abort(), remaining());
    const signal = AbortSignal.any([outer, controller.signal]);
    try {
      signal.throwIfAborted();
      const token = await this.credentials.get(
        input.tenant,
        signal,
        deadlineAt,
      );
      signal.throwIfAborted();
      let responseRequestId: string | null = null;
      let responseCache: string | null = null;
      const value = await action({
        onHeader: (headers) => {
          responseRequestId = headers.get("x-kokoro-request-id");
          responseCache = headers.get("cache-control");
        },
        signal,
        timeoutMs: remaining(),
        headers: {
          authorization: `Bearer ${token}`,
          "x-kokoro-tenant": input.tenant,
          "x-kokoro-subject": input.subject,
          "x-kokoro-request-id": input.requestId,
        },
      });
      signal.throwIfAborted();
      if (responseRequestId !== input.requestId || responseCache !== "no-store")
        throw new Error("custom_api_response_invalid");
      return value;
    } finally {
      clearTimeout(timer);
      this.#active.delete(controller);
    }
  }
}
