export type ArtifactAssociation = Readonly<{
  conversationId: string
  artifactId: string
  runId: string
  sourceAssetId: string
  sourceArtifactKind: "document" | "code" | "image" | "audio" | "video" | "data" | "archive" | "other"
  sourceContentSha256: string
  deliveredAt: string
}>

export type ArtifactPosition = Readonly<{ deliveredAt: string; conversationId: string; artifactId: string }>

/** Omitted means no verified navigation target; explicit null is a direct Conversation. */
export type ArtifactDetailCandidate = ArtifactAssociation & Readonly<{ projectRef?: string | null }>

export interface ArtifactLibraryRepository {
  listCandidates(tenantId: string, subjectId: string, position: ArtifactPosition | null, limit: number): Promise<readonly ArtifactAssociation[]>
  findCandidate(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<ArtifactDetailCandidate | null>
}
