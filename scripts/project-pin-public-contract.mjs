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
export function restorePublic284ProjectPinContract(source) {
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
