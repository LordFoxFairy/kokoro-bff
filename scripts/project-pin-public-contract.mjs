// Build/test-only complete Public28.5→28.4 inverse. Never imported by production.
import { createHash } from "node:crypto"
const hash = (value) => createHash("sha256").update(value).digest("hex")
const current = "109a2ae063b10699ae52776b09533c5622d906679c093d65730a289206043b1a"
const parent = "48aa9638d133223c9f78655e9398ddbb44159963f92a2db891a09212f3aa2726"
const blocks = {
  PATHS: "d7d11a69700816e64e26ef1070a701e5220c917139e52453a6935af0cde069ac",
  SCHEMAS: "e87990d51977c1313ba84a81e7403b8a3facecddfb4adb6ff3aa4c1295f0e03a",
  RESPONSES: "d66d6252ac572eec3ae241aa433aa7810fd51e4f7e17d6f2325d4fb5081ca549",
}
// S13 build/test-only inverse; closed to this exact two-field/version delta.
export const hubPublisherCurrentSha256 = "a020e849f740165fa20099f5ab041b76bc480c70a9bbc067955e57f5ec22ae02"
const hubPublisherDelta =
  '              product:\n                $ref: "#/components/schemas/Public9SkillProductFacts"\n                description: Same authorized current version owner product; absence is only the coordinated predecessor-reader transition, not an inferred publisher.\n              publisher_profile:\n                $ref: "#/components/schemas/SkillPublisherProfile"\n                description: Required exactly when product.publisher.kind is iam; kind and id match its iam ref. Omitted for unknown or verified GitHub publisher. Missing never substitutes a creator or default name.\n'
// S10 build/test-only inverse: exactly the discovery paths bound and version.
export const githubDiscoveryCurrentSha256 = "818dfe54d5eb50a72725983be136211c63bb17fa7392f94c5c1d46234db3ebd1"
const githubDiscoveryDelta = "                paths:\n                  type: array\n                  maxItems: 512\n"
export function restorePublic286GithubDiscoveryContract(source) {
  if (!/^  version: 28\.7\.0$/mu.test(source)) {
    if (source.includes(githubDiscoveryDelta)) throw Error("GitHub discovery version drift")
    return source
  }
  if (hash(source) !== githubDiscoveryCurrentSha256 || source.split(githubDiscoveryDelta).length !== 2) throw Error("GitHub discovery exact current drift")
  const restored = source.replace(githubDiscoveryDelta, githubDiscoveryDelta.replace("512", "128")).replace(/^  version: 28\.7\.0$/mu, "  version: 28.6.0")
  if (hash(restored) !== hubPublisherCurrentSha256) throw Error("GitHub discovery complete Public28.6 drift")
  return restored
}

export function restorePublic285HubPublisherContract(source) {
  source = restorePublic286GithubDiscoveryContract(source)
  if (!/^  version: 28\.6\.0$/mu.test(source)) {
    if (source.includes(hubPublisherDelta)) throw Error("Hub publisher version drift")
    return source
  }
  if (hash(source) !== hubPublisherCurrentSha256 || source.split(hubPublisherDelta).length !== 2) throw Error("Hub publisher exact current drift")
  const restored = source.replace(hubPublisherDelta, "").replace(/^  version: 28\.6\.0$/mu, "  version: 28.5.0")
  if (hash(restored) !== current) throw Error("Hub publisher complete Public28.5 drift")
  return restored
}

export function restorePublic284ProjectPinContract(source) {
  source = restorePublic285HubPublisherContract(source)
  if (!/^  version: 28\.5\.0$/mu.test(source)) return source
  if (hash(source) !== current) throw Error("Project pin full current drift")
  let restored = source
  for (const [kind, digest] of Object.entries(blocks)) {
    const indent = kind === "PATHS" ? "  " : "    "
    const pattern = new RegExp(`^${indent}# PROJECT-PIN-${kind}-BEGIN\n[\\s\\S]*?^${indent}# PROJECT-PIN-${kind}-END\n`, "mu")
    const block = restored.match(pattern)?.[0]
    if (!block || hash(block) !== digest) throw Error("Project pin exact delta drift")
    restored = restored.replace(block, "")
  }
  restored = restored.replace(/^  version: 28\.5\.0$/mu, "  version: 28.4.0")
  if (hash(restored) !== parent) throw Error("Project pin complete Public28.4 drift")
  return restored
}
export function projectPinParentInventory(inventory) {
  const hasPin = inventory.some((item) => ["listSelfProjectPins", "setProjectPin"].includes(item.operation_id))
  if (inventory.length !== 194) {
    if (hasPin) throw Error("Project pin inventory drift")
    return inventory
  }
  if (hash(JSON.stringify(inventory)) !== "2dcd50ad0f38b76904c2c4b8b478a12b74ee78395bc741b74ada8ad482ff6d61")
    throw Error("Project pin complete current inventory drift")
  const restored = inventory.filter((item) => !["listSelfProjectPins", "setProjectPin"].includes(item.operation_id))
  if (hash(JSON.stringify(restored)) !== "804e1bf56c3b66fb7da55024031aac235aab789c7aac21509eca37ed3e433180")
    throw Error("Project pin complete parent inventory drift")
  return restored
}

export function restoreProjectPinSchema(source) {
  if (!source.includes("-- PROJECT-PIN-SQL-BEGIN")) return source
  if (hash(source) !== "82b67bc5f8bb18deaa78821c9c4f59962f3d8ca5c986120544b84f9e9c8d13d0") throw Error("Project pin complete current SQL drift")
  const block = source.match(/^-- PROJECT-PIN-SQL-BEGIN\n[\s\S]*?^-- PROJECT-PIN-SQL-END\n\n/mu)?.[0]
  if (!block || hash(block) !== "4e76d896282166ae587e3d443a8448d560b72aa926f23c50b0e66b5114ac5eae") throw Error("Project pin SQL exact delta drift")
  const restored = source.replace(block, "")
  if (hash(restored) !== "70f6933f3bf0542d4c8babc6ced7ab7f4c128c0cc0a570ab195309850373e993") throw Error("Project pin complete SQL parent drift")
  return restored
}
