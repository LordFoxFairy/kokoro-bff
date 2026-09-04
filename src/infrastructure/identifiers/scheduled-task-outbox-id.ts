import { createHash } from "node:crypto"

import type { StableIdGenerator } from "../../application/ports/stable-id-generator.js"
import {
  scheduledTaskOutboxIdentityMaterial,
  type ScheduledTaskOutboxOperation,
} from "../../domain/scheduled-task/outbox.js"

/** Infrastructure implementation of the stable ID port. */
export class Sha256StableIdGenerator implements StableIdGenerator {
  public generate(material: string): string {
    return createHash("sha256").update(material).digest("hex")
  }
}

const defaultStableIdGenerator = new Sha256StableIdGenerator()

export function scheduledTaskOutboxId(
  tenantId: string,
  taskId: string,
  operation: ScheduledTaskOutboxOperation,
  idempotencyKey: string,
  stableIdGenerator: StableIdGenerator = defaultStableIdGenerator,
): string {
  return `scheduled_outbox_${stableIdGenerator.generate(scheduledTaskOutboxIdentityMaterial(tenantId, taskId, operation, idempotencyKey)).slice(0, 32)}`
}
