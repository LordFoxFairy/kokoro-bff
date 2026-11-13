import { createHash } from "node:crypto"

import { scheduledTaskOutboxIdentityMaterial, type ScheduledTaskOutboxOperation } from "../../domain/scheduled-task/outbox.js"

export class Sha256StableIdGenerator {
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
  actorId: string,
): string {
  return `scheduled_outbox_${defaultStableIdGenerator.generate(scheduledTaskOutboxIdentityMaterial(tenantId, taskId, operation, idempotencyKey, actorId)).slice(0, 32)}`
}
