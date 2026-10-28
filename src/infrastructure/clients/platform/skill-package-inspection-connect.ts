import { create } from "@bufbuild/protobuf"
import { createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"

import {
  InspectPersonalSkillInstallationPackageRequestSchema,
  InspectPersonalSkillPackageRequestSchema,
  InspectProjectSkillInstallationPackageRequestSchema,
  GetProjectSkillInstallationPackageDownloadRequestSchema,
  ProductProjectSkillInstallationContentService,
  ProductSkillInstallationPackageInspectionService,
  ProductSkillPackageInspectionService,
  SkillIdSchema,
  SkillInstallationIdSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { PlatformServiceCredentialSource } from "./platform-service-credential.js"

type ProjectContent = Readonly<{ projectId: string; installationId: string }>
type Common = Readonly<{ requestId: string; tenant: string; subject: string; filePath?: string }>
export type SkillPackageInspectionInput =
  | (Common & Readonly<{ operation: "managed"; skillId: string }>)
  | (Common & Readonly<{ operation: "installation"; installationId: string }>)
  | (Common & ProjectContent & Readonly<{ operation: "project" }>)

export class SkillPackageInspectionHeaderError extends Error {
  constructor() {
    super("skill_package_response_invalid")
  }
}

export class SkillPackageInspectionDependencyError extends Error {
  constructor() {
    super("skill_package_dependency_unavailable")
  }
}

export class SkillPackageInspectionConnectClient {
  readonly #managed
  readonly #installation
  readonly #project
  readonly #tokens: PlatformServiceCredentialSource

  constructor(
    baseUrl: string,
    credentialFile: string,
    private readonly timeoutMs: number,
  ) {
    const transport = createConnectTransport({
      baseUrl,
      httpVersion: "1.1",
      useBinaryFormat: true,
      readMaxBytes: 1024 * 1024,
      writeMaxBytes: 1024 * 1024,
    })
    this.#managed = createClient(ProductSkillPackageInspectionService, transport)
    this.#installation = createClient(ProductSkillInstallationPackageInspectionService, transport)
    this.#project = createClient(ProductProjectSkillInstallationContentService, transport)
    this.#tokens = new PlatformServiceCredentialSource(credentialFile, "projection")
  }

  private async options(input: Common & Readonly<{ projectId?: string }>, signal: AbortSignal, deadlineAt: number) {
    signal.throwIfAborted()
    let token: string
    try {
      token = await this.#tokens.get(input.tenant, signal, deadlineAt)
    } catch {
      throw new SkillPackageInspectionDependencyError()
    }
    signal.throwIfAborted()
    const remaining = Math.min(this.timeoutMs, Math.floor(deadlineAt - performance.now()))
    if (remaining <= 0) throw signal.reason ?? new Error("skill_package_deadline")
    let responseRequestId: string | null = null
    let responseCacheControl: string | null = null
    const options = {
      signal,
      timeoutMs: remaining,
      headers: {
        authorization: `Bearer ${token}`,
        "x-kokoro-subject": input.subject,
        ...(input.projectId === undefined ? { "x-tenant-ref": input.tenant } : { "x-kokoro-tenant": input.tenant, "x-kokoro-project-ref": input.projectId }),
      },
      onHeader: (headers: Headers): void => {
        responseRequestId = headers.get("x-kokoro-request-id")
        responseCacheControl = headers.get("cache-control")
      },
    }
    return {
      options,
      validate: () => {
        if (responseRequestId !== input.requestId || responseCacheControl !== "no-store") throw new SkillPackageInspectionHeaderError()
      },
    }
  }

  async inspect(input: SkillPackageInspectionInput, signal: AbortSignal, deadlineAt: number) {
    const { options, validate } = await this.options(input, signal, deadlineAt)
    const response =
      input.operation === "managed"
        ? await this.#managed.inspectPersonalSkillPackage(
            create(InspectPersonalSkillPackageRequestSchema, {
              requestId: input.requestId,
              skillId: create(SkillIdSchema, { value: input.skillId }),
              ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
            }),
            options,
          )
        : input.operation === "project"
          ? await this.#project.inspectProjectSkillInstallationPackage(
              create(InspectProjectSkillInstallationPackageRequestSchema, {
                requestId: input.requestId,
                installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
                ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
              }),
              options,
            )
          : await this.#installation.inspectPersonalSkillInstallationPackage(
              create(InspectPersonalSkillInstallationPackageRequestSchema, {
                requestId: input.requestId,
                installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
                ...(input.filePath === undefined ? {} : { filePath: input.filePath }),
              }),
              options,
            )
    validate()
    return response
  }

  async downloadProject(input: Common & ProjectContent, signal: AbortSignal, deadlineAt: number) {
    const { options, validate } = await this.options(input, signal, deadlineAt)
    const response = await this.#project.getProjectSkillInstallationPackageDownload(
      create(GetProjectSkillInstallationPackageDownloadRequestSchema, {
        requestId: input.requestId,
        installationId: create(SkillInstallationIdSchema, { value: input.installationId }),
      }),
      options,
    )
    validate()
    return response
  }
}
