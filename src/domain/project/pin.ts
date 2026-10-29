export type ProjectPin = Readonly<{ projectId: string; pinnedAt: Date }>
export type ProjectPinPosition = Readonly<{ projectId: string; pinnedAt: string }>
export type ProjectPinList = Readonly<{ items: readonly ProjectPin[]; nextPosition: ProjectPinPosition | null }>
export type ProjectPinState = Readonly<{ projectId: string; isPinned: boolean; pinnedAt: Date | null }>
export const projectPinId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}(?![\s\S])/u.test(value)
export const projectPinInstant = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value
