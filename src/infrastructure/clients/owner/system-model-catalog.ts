import { isDeepStrictEqual } from "node:util"

import { zGetModelCatalogResponse } from "../../../generated/system-http/zod.gen.js"

/** Project only the owner's effective tenant/feature selection, never infer provider from a label. */
export function modelCatalogData(body: unknown) {
  const parsed = zGetModelCatalogResponse.safeParse(body)
  if (!parsed.success || !isDeepStrictEqual(body, parsed.data)) return null
  const items = parsed.data.data.items
  if (
    items.some(
      (item) =>
        item.key.length < 1 ||
        item.key.length > 128 ||
        item.display_name.length < 1 ||
        item.display_name.length > 255 ||
        item.feature_key.length < 1 ||
        item.feature_key.length > 128,
    )
  )
    return null
  return {
    models: items.map((item) => ({
      provider: item.provider,
      name: item.key,
      is_default: item.is_default,
      display_name: item.display_name,
      model_id: item.model_id,
      revision_id: item.revision_id,
      provider_id: item.provider_id,
      feature_key: item.feature_key,
      request_model: item.request_model,
    })),
    next_cursor: parsed.data.data.next_cursor,
  }
}
