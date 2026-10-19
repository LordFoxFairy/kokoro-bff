import { assertSkillWireKnown } from "./skill-product-response.js"
import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import { CommandIdentitySchema } from "../../../generated/platform-connect/kokoro/common/v1/common_pb.js"
import {
  ProductProjectSkillInstallationService,
  InstallProjectSkillRequestSchema,
  UpdateProjectSkillInstallationRequestSchema,
  SetProjectSkillInstallationEnabledRequestSchema,
  RemoveProjectSkillInstallationRequestSchema,
  GetProjectSkillInstallationRequestSchema,
  ListProjectSkillInstallationsRequestSchema,
  GetPersonalSkillInstallationRequestSchema,
  InstallPersonalSkillRequestSchema,
  UpdatePersonalSkillInstallationRequestSchema,
  ListPersonalSkillInstallationsRequestSchema,
  ProductSkillInstallationPageRequestSchema,
  ProductSkillInstallationService,
  RemovePersonalSkillInstallationRequestSchema,
  SetPersonalSkillInstallationEnabledRequestSchema,
  SkillInstallationIdSchema,
  SkillSourceRefSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import type { PlatformServiceCredentialSource } from "./platform-service-credential.js"

type Common = { requestId: string; tenant: string; subject: string; projectRef?: string }
type ServiceCredentialSource = Pick<PlatformServiceCredentialSource, "get">
export class SkillInstallationConnectClient {
  readonly #projectClient
  readonly #client
  constructor(
    baseUrl: string,
    private readonly writes: Pick<PlatformServiceCredentialSource, "get">,
    private readonly reads: PlatformServiceCredentialSource,
    private readonly timeoutMs: number,
  ) {
    this.#projectClient = createClient(
      ProductProjectSkillInstallationService,
      createConnectTransport({ baseUrl, httpVersion: "1.1", useBinaryFormat: true, readMaxBytes: 1024 * 1024, writeMaxBytes: 1024 * 1024 }),
    )
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
        "x-kokoro-tenant": input.tenant,
        "x-kokoro-subject": input.subject,
        ...(input.projectRef === undefined ? {} : { "x-kokoro-project-ref": input.projectRef }),
      },
      timeoutMs,
    }
  }
  async #invoke<T>(
    source: ServiceCredentialSource,
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
      const response = await rpc(token, signal, remaining)
      if (input.projectRef !== undefined) {
        if (typeof response !== "object" || response === null || !("projectRef" in response) || response.projectRef !== input.projectRef)
          throw new Error("skill_installation_response_invalid")
        try {
          assertSkillWireKnown(response)
        } catch (cause) {
          throw new Error("skill_installation_response_invalid", { cause })
        }
      }
      return response
    } catch (error) {
      if (deadlineSignal.aborted && !callerSignal?.aborted) throw new ConnectError("skill installation deadline exceeded", Code.DeadlineExceeded)
      throw error
    }
  }
  async install(input: Common & { commandId: string; digest: string; sourceRef: string }, signal?: AbortSignal) {
    return this.#invoke(this.writes, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        sourceRef: create(SkillSourceRefSchema, { value: input.sourceRef }),
      }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.installPersonalSkill(create(InstallPersonalSkillRequestSchema, payload), options)
        : this.#projectClient.installProjectSkill(create(InstallProjectSkillRequestSchema, payload), options)
    })
  }
  async update(
    input: Common & { commandId: string; digest: string; installationId: string; expectedSourceRef: string; sourceRef: string },
    signal?: AbortSignal,
  ) {
    return this.#invoke(this.writes, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
        expectedSourceRef: create(SkillSourceRefSchema, { value: input.expectedSourceRef }),
        sourceRef: create(SkillSourceRefSchema, { value: input.sourceRef }),
      }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.updatePersonalSkillInstallation(create(UpdatePersonalSkillInstallationRequestSchema, payload), options)
        : this.#projectClient.updateProjectSkillInstallation(create(UpdateProjectSkillInstallationRequestSchema, payload), options)
    })
  }
  async setEnabled(input: Common & { commandId: string; digest: string; installationId: string; enabled: boolean }, signal?: AbortSignal) {
    return this.#invoke(this.writes, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
        enabled: input.enabled,
      }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.setPersonalSkillInstallationEnabled(create(SetPersonalSkillInstallationEnabledRequestSchema, payload), options)
        : this.#projectClient.setProjectSkillInstallationEnabled(create(SetProjectSkillInstallationEnabledRequestSchema, payload), options)
    })
  }
  async remove(input: Common & { commandId: string; digest: string; installationId: string }, signal?: AbortSignal) {
    return this.#invoke(this.writes, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = {
        requestId: input.requestId,
        command: create(CommandIdentitySchema, { commandId: input.commandId, requestDigest: input.digest }),
        installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
      }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.removePersonalSkillInstallation(create(RemovePersonalSkillInstallationRequestSchema, payload), options)
        : this.#projectClient.removeProjectSkillInstallation(create(RemoveProjectSkillInstallationRequestSchema, payload), options)
    })
  }
  async get(input: Common & { installationId: string }, signal?: AbortSignal) {
    return this.#invoke(this.reads, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = { requestId: input.requestId, installationId: create(SkillInstallationIdSchema, { value: input.installationId }) }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.getPersonalSkillInstallation(create(GetPersonalSkillInstallationRequestSchema, payload), options)
        : this.#projectClient.getProjectSkillInstallation(create(GetProjectSkillInstallationRequestSchema, payload), options)
    })
  }
  async list(
    input: Common & {
      enabled?: boolean
      installed?: boolean
      limit?: number
      cursor?: string
      query?: string
      sourceKind?: "personal" | "official" | "third_party"
    },
    signal?: AbortSignal,
  ) {
    return this.#invoke(this.reads, input, signal, async (token, operationSignal, timeoutMs) => {
      const payload = {
        requestId: input.requestId,
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.installed === undefined ? {} : { installed: input.installed }),
        ...(input.sourceKind === undefined ? {} : { sourceKind: input.sourceKind }),
        ...(input.query === undefined ? {} : { query: input.query }),
        page: create(ProductSkillInstallationPageRequestSchema, {
          ...(input.limit === undefined ? {} : { limit: input.limit }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        }),
      }
      const options = this.#options(token, input, operationSignal, timeoutMs)
      return input.projectRef === undefined
        ? this.#client.listPersonalSkillInstallations(create(ListPersonalSkillInstallationsRequestSchema, payload), options)
        : this.#projectClient.listProjectSkillInstallations(create(ListProjectSkillInstallationsRequestSchema, payload), options)
    })
  }
}
