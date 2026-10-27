import type { BffBusinessStore } from "../application/ports/bff-business-store.js"
import { ProjectResourceError } from "../application/project-resource.error.js"

/** Fresh private Project ownership; cancellation also bounds a late store response. */
export async function currentResourceProject(
  store: BffBusinessStore | null,
  scope: Readonly<{ tenantId: string; subjectId: string }>,
  projectRef: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  if (store === null) throw new ProjectResourceError("business_store_unavailable", 503, true)
  let cancel: () => void = () => {}
  const interruption = new Promise<never>((_, reject) => {
    cancel = () => reject(new ProjectResourceError("storage_unavailable", 503, true))
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
  })
  try {
    const project = await Promise.race([store.services.projects.find(scope, projectRef), interruption])
    signal.throwIfAborted()
    if (project === null) throw new ProjectResourceError("project_not_found", 404)
    return project.id
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}
