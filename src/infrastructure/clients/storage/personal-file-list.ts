import { createClient, ConnectError, Code, type Client, type Transport } from "@connectrpc/connect"
import { createConnectTransport } from "@connectrpc/connect-node"
import type { ProjectResourcePageInput } from "../../../application/project-resource-list.types.js"
import { ProjectResourceError } from "../../../application/project-resource.error.js"
import { StorageService } from "../../../generated/storage-connect/kokoro/storage/v2/storage_pb.js"
import { parseCleanAssetPage } from "./client.js"

export type PersonalFileContext = Readonly<{ tenantId: string; subjectId: string; requestId: string }>

export class PersonalFileListClient {
  private readonly client: Client<typeof StorageService>
  private readonly headers: Record<string, string>

  constructor(config: { baseUrl: string; secret: string }, context: PersonalFileContext, transport?: Transport) {
    this.client = createClient(
      StorageService,
      transport ??
        createConnectTransport({
          baseUrl: config.baseUrl,
          httpVersion: "1.1",
          defaultTimeoutMs: 10_000,
          readMaxBytes: 1024 * 1024,
          writeMaxBytes: 1024 * 1024,
        }),
    )
    this.headers = {
      "x-kokoro-service": "web-bff",
      "x-kokoro-internal-secret": config.secret,
      "x-kokoro-tenant-id": context.tenantId,
      "x-kokoro-subject-id": context.subjectId,
      "x-kokoro-request-id": context.requestId,
      "x-kokoro-scope-kind": "personal",
      "x-kokoro-scope-id": context.subjectId,
    }
  }

  async listAssets(input: ProjectResourcePageInput, signal: AbortSignal) {
    try {
      const page = await this.client.listAssets(input, { headers: this.headers, signal })
      const validated = parseCleanAssetPage(page, input)
      return { items: validated.items.map((item) => ({ kind: "file" as const, ...item })), next_cursor: validated.next_cursor }
    } catch (error) {
      if (error instanceof ProjectResourceError) throw error
      if (error instanceof ConnectError && error.code === Code.InvalidArgument) throw new ProjectResourceError("invalid_library_page", 400)
      if (
        signal.aborted ||
        (error instanceof ConnectError &&
          [Code.Unavailable, Code.DeadlineExceeded, Code.Canceled, Code.Unauthenticated, Code.PermissionDenied, Code.ResourceExhausted].includes(error.code))
      )
        throw new ProjectResourceError("storage_unavailable", 503, true)
      throw new ProjectResourceError("storage_response_invalid", 502)
    }
  }
}
