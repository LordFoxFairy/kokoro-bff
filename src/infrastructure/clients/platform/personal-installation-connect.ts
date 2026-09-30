import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { CommandIdentitySchema } from "../../../generated/platform-connect/kokoro/common/v1/common_pb.js"
import {
  GetPersonalSkillInstallationRequestSchema,
  InstallPersonalSkillRequestSchema,
  ListPersonalSkillInstallationsRequestSchema,
  ProductSkillInstallationPageRequestSchema,
  ProductSkillInstallationService,
  RemovePersonalSkillInstallationRequestSchema,
  SetPersonalSkillInstallationEnabledRequestSchema,
  SkillInstallationIdSchema,
  SkillSourceRefSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { CatalogTokenSource } from "./catalog-token.js"
import type { ProjectionTokenSource } from "./projection-token.js"

type Common = { requestId: string; tenant: string; subject: string }
type TokenSource = {
  get(tenant: string, signal?: AbortSignal): Promise<string>
}
export class PersonalInstallationConnectClient {
  readonly #client
  constructor(
    baseUrl: string,
    private readonly writes: CatalogTokenSource,
    private readonly reads: ProjectionTokenSource,
    private readonly timeoutMs: number,
  ) {
    this.#client = createClient(
      ProductSkillInstallationService,
      createConnectTransport({
        baseUrl,
        httpVersion: "1.1",
        useBinaryFormat: true,
        readMaxBytes: 1024 * 1024,
        writeMaxBytes: 1024 * 1024,
      }),
    )
  }
  #options(token: string, input: Common, signal: AbortSignal, timeoutMs: number) {
    return {
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        "x-tenant-ref": input.tenant,
        "x-kokoro-subject": input.subject,
      },
      timeoutMs,
    }
  }
  async #invoke<T>(
    source: TokenSource,
    input: Common,
    callerSignal: AbortSignal | undefined,
    rpc: (token: string, signal: AbortSignal, timeoutMs: number) => Promise<T>,
  ) {
    const budget = Math.min(this.timeoutMs, 20_000)
    const started = Date.now()
    const deadlineSignal = AbortSignal.timeout(budget)
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadlineSignal]) : deadlineSignal
    try {
      const token = await source.get(input.tenant, signal)
      const remaining = budget - (Date.now() - started)
      if (remaining <= 0 || signal.aborted) throw signal.reason
      return await rpc(token, signal, remaining)
    } catch (error) {
      if (deadlineSignal.aborted && !callerSignal?.aborted) throw new ConnectError("personal installation deadline exceeded", Code.DeadlineExceeded)
      throw error
    }
  }
  async install(input: Common & { commandId: string; digest: string; sourceRef: string }, signal?: AbortSignal) {
    return this.#invoke(this.writes, input, signal, (token, operationSignal, timeoutMs) =>
      this.#client.installPersonalSkill(
        create(InstallPersonalSkillRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, {
            commandId: input.commandId,
            requestDigest: input.digest,
          }),
          sourceRef: create(SkillSourceRefSchema, { value: input.sourceRef }),
        }),
        this.#options(token, input, operationSignal, timeoutMs),
      ),
    )
  }
  async setEnabled(
    input: Common & {
      commandId: string
      digest: string
      installationId: string
      enabled: boolean
    },
    signal?: AbortSignal,
  ) {
    return this.#invoke(this.writes, input, signal, (token, operationSignal, timeoutMs) =>
      this.#client.setPersonalSkillInstallationEnabled(
        create(SetPersonalSkillInstallationEnabledRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, {
            commandId: input.commandId,
            requestDigest: input.digest,
          }),
          installationId: create(SkillInstallationIdSchema, {
            value: input.installationId,
          }),
          enabled: input.enabled,
        }),
        this.#options(token, input, operationSignal, timeoutMs),
      ),
    )
  }
  async remove(
    input: Common & {
      commandId: string
      digest: string
      installationId: string
    },
    signal?: AbortSignal,
  ) {
    return this.#invoke(this.writes, input, signal, (token, operationSignal, timeoutMs) =>
      this.#client.removePersonalSkillInstallation(
        create(RemovePersonalSkillInstallationRequestSchema, {
          requestId: input.requestId,
          command: create(CommandIdentitySchema, {
            commandId: input.commandId,
            requestDigest: input.digest,
          }),
          installationId: create(SkillInstallationIdSchema, {
            value: input.installationId,
          }),
        }),
        this.#options(token, input, operationSignal, timeoutMs),
      ),
    )
  }
  async get(input: Common & { installationId: string }, signal?: AbortSignal) {
    return this.#invoke(this.reads, input, signal, (token, operationSignal, timeoutMs) =>
      this.#client.getPersonalSkillInstallation(
        create(GetPersonalSkillInstallationRequestSchema, {
          requestId: input.requestId,
          installationId: create(SkillInstallationIdSchema, {
            value: input.installationId,
          }),
        }),
        this.#options(token, input, operationSignal, timeoutMs),
      ),
    )
  }
  async list(
    input: Common & {
      enabled?: boolean
      installed?: boolean
      limit?: number
      cursor?: string
    },
    signal?: AbortSignal,
  ) {
    return this.#invoke(this.reads, input, signal, (token, operationSignal, timeoutMs) =>
      this.#client.listPersonalSkillInstallations(
        create(ListPersonalSkillInstallationsRequestSchema, {
          requestId: input.requestId,
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.installed === undefined ? {} : { installed: input.installed }),
          page: create(ProductSkillInstallationPageRequestSchema, {
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          }),
        }),
        this.#options(token, input, operationSignal, timeoutMs),
      ),
    )
  }
}
