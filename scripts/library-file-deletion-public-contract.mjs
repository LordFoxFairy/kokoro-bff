import { createHash } from "node:crypto"

// Build-time proof only; production serves only the current operation.
const hash = (source) => createHash("sha256").update(source).digest("hex")

export function restorePublic2827LibraryArtifactSourceContract(source) {
  if (!/^  version: 28\.28\.0$/mu.test(source)) return source
  if (hash(source) !== "495afa65989a1308194910b0b5ece62b4f9db0c84f8dc34e7e0f3b00f7c5294f") throw Error("Library artifact source Public28.28 child drift")
  const parent = source
    .replace("        project_ref:\n          description: Detail-only canonical source Project ID, null for a direct Conversation, or absent when the canonical destination is not established.\n          type: [string, 'null']\n          pattern: '^project_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\\s\\S])'\n    LibraryArtifactResponse:\n", "    LibraryArtifactResponse:\n")
    .replace("      summary: Read one delivered Artifact from the current subject's active Conversation\n      description: The detail identifies the source Conversation's canonical Project ID, or null only for a direct Conversation. If the canonical source destination is not established, project_ref is omitted. The project reference is not an access grant.\n", "      summary: Read one delivered Artifact from the current subject's active Conversation\n")
    .replace("  version: 28.28.0\n", "  version: 28.27.0\n")
  if (hash(parent) !== "52b59b49be42bc3c1126b6fc94b1d88c440b7ac911c2631e8a0305f43f96bd08") throw Error("Library artifact source complete Public28.27 parent drift")
  return parent
}

export function restorePublic2826LibraryFileSearchContract(source) {
  source = restorePublic2827LibraryArtifactSourceContract(source)
  if (!/^  version: 28\.27\.0$/mu.test(source)) return source
  if (hash(source) !== "52b59b49be42bc3c1126b6fc94b1d88c440b7ac911c2631e8a0305f43f96bd08") throw Error("Library file search Public28.27 child drift")
  const parent = source
    .replace("enum: [all, slides, documents, spreadsheets, images, video, audio, other, media]", "enum: [all, slides, documents, spreadsheets, images, video, audio, other]")
    .replace("Kind-specific type. Files accept all, documents, images, media (audio/video), and other based on MIME. Artifacts retain all, slides, documents, spreadsheets, images, video, audio, and other based on current FINAL MIME/title. Other combinations are invalid.", "Artifact-only product type, matched against current FINAL MIME/title according to the Library API taxonomy; file queries reject this parameter.")
    .replace("Literal text search, at most 200 Unicode code points before normalization. C0 controls and DEL are rejected; empty after trim means no text filter. Files match filename or MIME using NFC and case-insensitive PostgreSQL text semantics. Artifacts match title or filename with trim, NFC and locale-independent lowercase.", "Artifact-only search, at most 200 Unicode code points before normalization; trim, NFC and locale-independent lowercase are applied. C0 control characters and DEL are rejected. Empty means no text filter; file queries reject this parameter.")
    .replace("Each Artifact request scans at most min(500, limit * 5) authorized candidates", "Each request scans at most min(500, limit * 5) authorized candidates")
    .replace("File search filters current authorized Storage files before the stable keyset and limit; only a matching file may occupy a page slot. Artifact search matches current authorized FINAL metadata", "Artifact search matches current authorized FINAL metadata")
    .replace("  version: 28.27.0\n", "  version: 28.26.0\n")
  if (hash(parent) !== "c80d5aaba1732eca0fb7bc8f32f500adef99e7d884f579cfb7944b8b11e8901a")
    throw Error("Library file search complete Public28.26 parent drift")
  return parent
}

export function restorePublic2825LibraryFileDeletionContract(source) {
  source = restorePublic2826LibraryFileSearchContract(source)
  if (!/^  version: 28\.26\.0$/mu.test(source)) return source
  if (hash(source) !== "c80d5aaba1732eca0fb7bc8f32f500adef99e7d884f579cfb7944b8b11e8901a") throw Error("Library file deletion Public28.26 child drift")
  const parent = source
    .replace(/^  \/v1\/library\/files\/\{asset_id\}:\n[\s\S]*?(?=^  \/v1\/library\/files\/\{asset_id\}\/content:)/mu, "")
    .replace(/^    LibraryFileDeletionResponse:\n[\s\S]*?(?=^    LibraryFileItem:)/mu, "")
    .replace("  version: 28.26.0\n", "  version: 28.25.0\n")
  if (hash(parent) !== "008667f501044dc186e615b83370f96a7401de8027f25e7635248724fb165759")
    throw Error("Library file deletion complete Public28.25 parent drift")
  return parent
}

export function libraryFileDeletionParentInventory(inventory) {
  if (!inventory.some((item) => item.operation_id === "deleteLibraryFile")) return inventory
  if (hash(JSON.stringify(inventory)) !== "c802b2b89eda5f1b9b7128e5ed9305cdbf648d71a549f08afeb7e90ef71fd97a")
    throw Error("Library file deletion Public28.26 inventory drift")
  const parent = inventory.filter((item) => item.operation_id !== "deleteLibraryFile")
  if (hash(JSON.stringify(parent)) !== "9d872bd30fe5a063ec2600d2e5beb59ae30c896fd607ee3eb1a278c95fbb7731")
    throw Error("Library file deletion Public28.25 inventory drift")
  return parent
}
