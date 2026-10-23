import type { RssFeedEntry } from "./rss-feed.js"

type Field = "title" | "summary" | "content" | "author" | "category" | "link" | "domain"
type Operator =
  "contains" | "not_contains" | "equals" | "not_equals" | "starts_with" | "not_starts_with" | "ends_with" | "not_ends_with" | "is_empty" | "is_not_empty"
export type RssCondition = Readonly<{ field: Field; operator: Operator; value?: string }>
export type RssConditionGroups = readonly (readonly RssCondition[])[]
const FIELDS: readonly string[] = ["title", "summary", "content", "author", "category", "link", "domain"]
const OPERATORS: readonly string[] = [
  "contains",
  "not_contains",
  "equals",
  "not_equals",
  "starts_with",
  "not_starts_with",
  "ends_with",
  "not_ends_with",
  "is_empty",
  "is_not_empty",
]
function invalid(): never {
  throw new Error("rss_conditions_invalid")
}

export function parseRssConditions(value: unknown): RssConditionGroups {
  if (!Array.isArray(value) || value.length > 8) invalid()
  return Object.freeze(
    value.map((group: unknown) => {
      if (!Array.isArray(group) || group.length < 1 || group.length > 16) invalid()
      return Object.freeze(
        group.map((rule: unknown) => {
          if (rule === null || typeof rule !== "object" || Array.isArray(rule)) invalid()
          const r = rule as Record<string, unknown>
          if (
            Object.keys(r).some((k) => !["field", "operator", "value"].includes(k)) ||
            !Object.hasOwn(r, "field") ||
            !Object.hasOwn(r, "operator") ||
            typeof r.field !== "string" ||
            !FIELDS.includes(r.field) ||
            typeof r.operator !== "string" ||
            !OPERATORS.includes(r.operator)
          )
            invalid()
          const empty = r.operator === "is_empty" || r.operator === "is_not_empty"
          if (
            empty
              ? Object.hasOwn(r, "value")
              : !Object.hasOwn(r, "value") || typeof r.value !== "string" || r.value.length === 0 || Buffer.byteLength(r.value, "utf8") > 1024
          )
            invalid()
          return Object.freeze({ field: r.field as Field, operator: r.operator as Operator, ...(empty ? {} : { value: r.value as string }) })
        }),
      )
    }),
  )
}
function match(entry: RssFeedEntry, rule: RssCondition): boolean {
  const s = rule.field === "author" ? entry.authors.join("\n") : rule.field === "category" ? entry.categories.join("\n") : (entry[rule.field] ?? "")
  const value = rule.value ?? ""
  switch (rule.operator) {
    case "contains":
      return s.includes(value)
    case "not_contains":
      return !s.includes(value)
    case "equals":
      return s === value
    case "not_equals":
      return s !== value
    case "starts_with":
      return s.startsWith(value)
    case "not_starts_with":
      return !s.startsWith(value)
    case "ends_with":
      return s.endsWith(value)
    case "not_ends_with":
      return !s.endsWith(value)
    case "is_empty":
      return s === ""
    case "is_not_empty":
      return s !== ""
  }
}
export function matchesRssConditions(entry: RssFeedEntry, groups: RssConditionGroups): boolean {
  const validated = parseRssConditions(groups)
  return validated.length === 0 || validated.some((group) => group.every((rule) => match(entry, rule)))
}
