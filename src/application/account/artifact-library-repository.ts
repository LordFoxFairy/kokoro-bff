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
export type ArtifactLibraryCandidate = ArtifactAssociation & Readonly<{ favorited: boolean }>

/** Omitted means no verified navigation target; explicit null is a direct Conversation. */
export type ArtifactDetailCandidate = ArtifactLibraryCandidate & Readonly<{ projectRef?: string | null }>

export type SetArtifactFavorite = Pick<ArtifactAssociation, "conversationId" | "artifactId" | "runId" | "sourceAssetId" | "sourceContentSha256"> &
  Readonly<{ tenantId: string; subjectId: string; favorited: boolean; signal: AbortSignal }>

export interface ArtifactLibraryRepository {
  listCandidates(
    tenantId: string,
    subjectId: string,
    position: ArtifactPosition | null,
    limit: number,
    favoritesOnly?: boolean,
  ): Promise<readonly ArtifactLibraryCandidate[]>
  findCandidate(tenantId: string, subjectId: string, conversationId: string, artifactId: string): Promise<ArtifactDetailCandidate | null>
  setFavorite(input: SetArtifactFavorite): Promise<boolean | null>
}
