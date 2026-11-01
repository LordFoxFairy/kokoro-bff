/** Narrow port for deterministic identifiers derived from canonical domain material. */
export interface StableIdGenerator {
  generate(material: string): string
}
