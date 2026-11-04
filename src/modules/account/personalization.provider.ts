import type { PostgresPersonalizationRepository } from "../../infrastructure/postgres/personalization-repository.js"

export type PersonalizationProvider = Pick<PostgresPersonalizationRepository, "read" | "replace">
export const PERSONALIZATION_PROVIDER = Symbol("PERSONALIZATION_PROVIDER")
