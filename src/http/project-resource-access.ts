import { ProjectResourceError } from "../application/project-resource.error.js"

export type ProjectResourceProjectReader = Readonly<{
  find(scope: Readonly<{ tenantId: string; subjectId: string }>, idOrSlug: string): Promise<unknown | null>
}>

/** Fresh private Project ownership; cancellation also bounds a late store response. */
export async function currentResourceProject(
  store: ProjectResourceProjectReader | null,
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
    const project = await Promise.race([store.find(scope, projectRef), interruption])
    signal.throwIfAborted()
    if (project === null) throw new ProjectResourceError("project_not_found", 404)
    if (typeof project !== "object" || project === null || !("id" in project) || typeof project.id !== "string")
      throw new ProjectResourceError("storage_unavailable", 503, true)
    return project.id
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}
