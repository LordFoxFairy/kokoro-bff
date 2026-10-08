import { create } from "@bufbuild/protobuf"
import { Code, ConnectError, createClient } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"

import {
  InspectPersonalSkillInstallationPackageRequestSchema,
  InspectPersonalSkillPackageRequestSchema,
  ProductSkillInstallationPackageInspectionService,
  ProductSkillPackageInspectionService,
  SkillIdSchema,
  SkillInstallationIdSchema,
} from "../../../generated/platform-connect/kokoro/platform/v1/platform_runtime_pb.js"
import { ProjectionCredentialSource } from "./projection-credential.js"
import { ProjectionTokenSource } from "./projection-token.js"

type Common = Readonly<{ requestId: string; tenant: string; subject: string; filePath?: string }>
export type SkillPackageInspectionInput =
  (Common & Readonly<{ operation: "managed"; skillId: string }>) | (Common & Readonly<{ operation: "installation"; installationId: string }>)

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
  readonly #tokens: ProjectionTokenSource

  constructor(
    baseUrl: string,
    iamBaseUrl: string,
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
    this.#tokens = new ProjectionTokenSource(iamBaseUrl, new ProjectionCredentialSource(credentialFile), timeoutMs)
  }

  async inspect(input: SkillPackageInspectionInput, signal: AbortSignal, deadlineAt: number) {
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
        "x-tenant-ref": input.tenant,
        "x-kokoro-subject": input.subject,
      },
      onHeader: (headers: Headers): void => {
        responseRequestId = headers.get("x-kokoro-request-id")
        responseCacheControl = headers.get("cache-control")
      },
    }
    let response
    try {
      response =
        input.operation === "managed"
          ? await this.#managed.inspectPersonalSkillPackage(
              create(InspectPersonalSkillPackageRequestSchema, {
                requestId: input.requestId,
                skillId: create(SkillIdSchema, { value: input.skillId }),
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
    } catch (error) {
      if (error instanceof ConnectError && (error.code === Code.Unauthenticated || error.code === Code.PermissionDenied)) this.#tokens.retire(token)
      throw error
    }
    if (responseRequestId !== input.requestId || responseCacheControl !== "no-store") throw new SkillPackageInspectionHeaderError()
    return response
  }
}
