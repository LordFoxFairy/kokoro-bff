export type RssFeedEntry = Readonly<{
  identity: string
  title: string
  summary: string
  content: string
  authors: readonly string[]
  categories: readonly string[]
  link: string | null
  domain: string | null
  publishedAt: string | null
  updatedAt: string | null
  enclosures: readonly Readonly<{ url: string; type: string | null; length: string | null }>[]
}>
