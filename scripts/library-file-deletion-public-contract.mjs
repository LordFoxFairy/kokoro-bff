import { createHash } from "node:crypto"

// Build-time proof only; production serves only the current operation.
const hash = (source) => createHash("sha256").update(source).digest("hex")

export function restorePublic2825LibraryFileDeletionContract(source) {
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
