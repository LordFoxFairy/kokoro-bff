export type Skill = {
  name: string
  description: string
  content_hash: string
  scope: string
  source_url?: string
  enabled?: boolean
  installed?: boolean
  categories?: string[]
  updated_at?: number
}

export type SkillQuota = {
  namespace: string
  package_count: number
  package_bytes: number
  max_packages: number
  max_bytes: number
}

export type SkillRevision = {
  scope: string
  name: string
  revision: number
  content_hash: string
  package_size: number
  source: string
  created_at: number
}
