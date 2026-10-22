import type { SkillProductFact } from "./skill-specification.types.js"

/** Exact Platform binding, not an installation, owner scope or execution permission. */
export type AppSkillBindingFact = Readonly<{
  binding_id: string
  series_id: string
  skill_id: string
  revision: string
  state_version: string
  source_status: string
  created_at: string
  updated_at: string
  removed_at: string | null
  metadata: Readonly<{ name: string; summary: string; created_at: string; updated_at: string; product: SkillProductFact }> | null
}>
export type AppSkillBindingContext = Readonly<{ requestId: string; tenant: string; subject: string; appId: string }>
export type AppSkillBindingPage = Readonly<{ limit: number; cursor?: string }>
export type AppSkillBindingAck = Readonly<{ binding: AppSkillBindingFact; event_id: string; replayed: boolean }>
export type AppSkillBindingClient = Readonly<{
  list(
    context: AppSkillBindingContext,
    page: AppSkillBindingPage,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<Readonly<{ items: AppSkillBindingFact[]; nextCursor?: string }>>
  command(
    operation: "put" | "remove",
    context: AppSkillBindingContext & Readonly<{ commandId: string }>,
    input: Readonly<{ target: string; expectedBindingVersion: string }>,
    signal: AbortSignal,
    deadlineAt: number,
  ): Promise<AppSkillBindingAck>
}>
