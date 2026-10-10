import { isDeepStrictEqual } from "node:util"
import type { IdempotencyRepository, PersistentReceipt } from "./ports/idempotency-repository.js"

/** Immutable BFF delivery association plus successful terminal, never a browser-supplied provenance. */
export type SkillAiAssociation = {
  conversationId: string
  artifactId: string
  runId: string
  sourceAssetId: string
  sourceArtifactKind: "archive"
  sourceContentSha256: string
  deliveredAt: string
  sourceEventId: string
  sourceEventSeq: string
  sourceEventDigest: string
  sizeBytes: string
  mimeType: "application/zip"
}

type BeginAdmission = { skillId: string; attemptId: string; uploadId: string; attemptEpoch: string; stateVersion: string }
type Admission = BeginAdmission & { initialStateVersion: string }
type Creation = { skillId: string; initialStateVersion: string }
type Selection = { sourceVersionId: string; commandId: string; requestDigest: string }
/** Persist a complete, keep-first selected locator before any owner Complete. CAS losers perform no owner mutation. */
export async function handoffSkillPackage<T>(
  input: { scope: string; fingerprint: string; frozen: Record<string, unknown>; commandId: string; adoptFrozen?: (value: unknown) => Record<string, unknown> },
  receipts: Pick<IdempotencyRepository, "getReceipt" | "claimReceipt" | "compareAndSetReceipt">,
  steps: {
    create(commandId: string, frozen: Record<string, unknown>): Promise<{ skillId: string; stateVersion: string }>
    begin(commandId: string, skillId: string, stateVersion: string): Promise<BeginAdmission>
    status(skillId: string): Promise<Omit<BeginAdmission, "stateVersion"> & { sourceVersionId: string | null }>
    put(admission: Admission, frozen: Record<string, unknown>): Promise<string>
    completion(admission: Admission, sourceVersionId: string): Selection
    complete(admission: Admission, selection: Selection): Promise<{ stateVersion: string }>
    validate(commandId: string, admission: Admission, stateVersion: string): Promise<T>
  },
  signal: AbortSignal,
): Promise<T> {
  const checkpoint = async (operation: () => Promise<PersistentReceipt | null>): Promise<PersistentReceipt | null> => {
    try {
      return await operation()
    } catch {
      throw new Error("skill_checkpoint_unavailable")
    }
  }
  let receipt = await checkpoint(() => receipts.getReceipt(input.scope))
  if (receipt && receipt.fingerprint !== input.fingerprint) throw new Error("skill_idempotency_conflict")
  if (receipt?.status === 201) return receipt.body as T
  const advance = async (expected: PersistentReceipt, body: unknown): Promise<PersistentReceipt> => {
    signal.throwIfAborted()
    const replacement = { fingerprint: input.fingerprint, status: 200, body }
    try {
      const result = await receipts.compareAndSetReceipt(input.scope, input.fingerprint, expected, replacement)
      if (result.updated) return replacement
    } catch {
      /* ACK uncertainty is resolved only by exact readback. */
    }
    const actual = await checkpoint(() => receipts.getReceipt(input.scope))
    if (!isDeepStrictEqual(actual, replacement)) throw new Error("skill_checkpoint_unavailable")
    return replacement
  }
  if (!receipt) {
    signal.throwIfAborted()
    const claim = await receipts.claimReceipt(input.scope, input.fingerprint)
    if (!claim.claimed) throw new Error(claim.receipt?.fingerprint !== input.fingerprint ? "skill_idempotency_conflict" : "skill_command_in_progress")
    receipt = await checkpoint(() => receipts.getReceipt(input.scope))
    if (!receipt || receipt.fingerprint !== input.fingerprint || receipt.status !== 102 || JSON.stringify(receipt.body) !== "{}")
      throw new Error("skill_checkpoint_unavailable")
  }
  if (receipt?.status === 102 && receipt.fingerprint === input.fingerprint && JSON.stringify(receipt.body) === "{}") {
    receipt = await advance(receipt, { proofVersion: 2, stage: "frozen", frozen: input.frozen })
  }
  if (receipt.status !== 200 || typeof receipt.body !== "object" || receipt.body === null || Array.isArray(receipt.body))
    throw new Error("skill_checkpoint_unavailable")
  let body = receipt.body as {
    stage: string
    proofVersion?: number
    frozen: unknown
    creation?: Creation
    admission?: Admission
    selected?: Selection
    completed?: { stateVersion: string }
  }
  if (input.adoptFrozen) input.frozen = input.adoptFrozen(body.frozen)
  if (
    body.proofVersion !== 2 ||
    !["frozen", "created", "admitted", "selected", "completed"].includes(body.stage) ||
    !isDeepStrictEqual(body.frozen, input.frozen) ||
    Object.keys(body).sort().join(",") !==
      (
        {
          frozen: "frozen,proofVersion,stage",
          created: "creation,frozen,proofVersion,stage",
          admitted: "admission,frozen,proofVersion,stage",
          selected: "admission,frozen,proofVersion,selected,stage",
          completed: "admission,completed,frozen,proofVersion,selected,stage",
        } as Record<string, string>
      )[body.stage]
  )
    throw new Error("skill_checkpoint_unavailable")
  const positiveVersion = (value: unknown): value is string =>
    typeof value === "string" && /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n
  const identity = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(value)
  if (body.stage === "frozen") {
    signal.throwIfAborted()
    const created = await steps.create(`${input.commandId}.create`, input.frozen)
    if (!identity(created.skillId) || !positiveVersion(created.stateVersion)) throw new Error("skill_response_invalid")
    receipt = await advance(receipt, {
      proofVersion: 2,
      stage: "created",
      frozen: input.frozen,
      creation: { skillId: created.skillId, initialStateVersion: created.stateVersion },
    })
    body = receipt.body as typeof body
  }
  if (body.stage === "created") {
    const creation = body.creation
    if (
      !creation ||
      Object.keys(creation).sort().join(",") !== "initialStateVersion,skillId" ||
      !identity(creation.skillId) ||
      !positiveVersion(creation.initialStateVersion)
    )
      throw new Error("skill_checkpoint_unavailable")
    signal.throwIfAborted()
    const begun = await steps.begin(`${input.commandId}.begin`, creation.skillId, creation.initialStateVersion)
    if (
      Object.keys(begun).sort().join(",") !== "attemptEpoch,attemptId,skillId,stateVersion,uploadId" ||
      begun.skillId !== creation.skillId ||
      !identity(begun.attemptId) ||
      !identity(begun.uploadId) ||
      !positiveVersion(begun.attemptEpoch) ||
      !positiveVersion(begun.stateVersion) ||
      BigInt(begun.stateVersion) <= BigInt(creation.initialStateVersion)
    )
      throw new Error("skill_response_invalid")
    const admission = { ...begun, initialStateVersion: creation.initialStateVersion }
    receipt = await advance(receipt, { proofVersion: 2, stage: "admitted", frozen: input.frozen, admission })
    body = receipt.body as typeof body
  }
  const admission = body.admission
  if (
    !admission ||
    Object.keys(admission).sort().join(",") !== "attemptEpoch,attemptId,initialStateVersion,skillId,stateVersion,uploadId" ||
    !identity(admission.skillId) ||
    !identity(admission.attemptId) ||
    !identity(admission.uploadId) ||
    !positiveVersion(admission.attemptEpoch) ||
    !positiveVersion(admission.stateVersion) ||
    !positiveVersion(admission.initialStateVersion) ||
    BigInt(admission.stateVersion) <= BigInt(admission.initialStateVersion)
  )
    throw new Error("skill_checkpoint_unavailable")
  if (
    body.stage === "completed" &&
    (!body.completed ||
      Object.keys(body.completed).join(",") !== "stateVersion" ||
      !positiveVersion(body.completed.stateVersion) ||
      BigInt(body.completed.stateVersion) <= BigInt(admission.stateVersion))
  )
    throw new Error("skill_checkpoint_unavailable")
  signal.throwIfAborted()
  const owner = await steps.status(admission.skillId)
  if (
    owner.skillId !== admission.skillId ||
    owner.attemptId !== admission.attemptId ||
    owner.uploadId !== admission.uploadId ||
    owner.attemptEpoch !== admission.attemptEpoch
  )
    throw new Error("skill_response_invalid")
  if (body.stage === "admitted") {
    if (owner.sourceVersionId !== null) throw new Error("skill_checkpoint_unavailable")
    signal.throwIfAborted()
    const version = await steps.put(admission, input.frozen)
    const selected = steps.completion(admission, version)
    if (selected.sourceVersionId !== version) throw new Error("skill_response_invalid")
    receipt = await advance(receipt, { proofVersion: 2, stage: "selected", frozen: input.frozen, admission, selected })
    body = receipt.body as typeof body
  }
  const selected = body.selected
  if (
    !selected ||
    Object.keys(selected).sort().join(",") !== "commandId,requestDigest,sourceVersionId" ||
    !/^[a-f0-9]{64}$/u.test(selected.requestDigest) ||
    selected.sourceVersionId === "null" ||
    !/^[\x21-\x7e]{1,1024}$/u.test(selected.sourceVersionId) ||
    !selected.commandId ||
    (owner.sourceVersionId !== null && owner.sourceVersionId !== selected.sourceVersionId) ||
    !isDeepStrictEqual(steps.completion(admission, selected.sourceVersionId), selected)
  )
    throw new Error("skill_checkpoint_unavailable")
  signal.throwIfAborted()
  if (body.stage === "selected") {
    const completed = await steps.complete(admission, selected)
    if (
      Object.keys(completed).join(",") !== "stateVersion" ||
      !positiveVersion(completed.stateVersion) ||
      BigInt(completed.stateVersion) <= BigInt(admission.stateVersion)
    )
      throw new Error("skill_response_invalid")
    receipt = await advance(receipt, { proofVersion: 2, stage: "completed", frozen: input.frozen, admission, selected, completed })
    body = receipt.body as typeof body
  }
  signal.throwIfAborted()
  const result = await steps.validate(`${input.commandId}.validate`, admission, body.completed!.stateVersion)
  signal.throwIfAborted()
  const replacement = { fingerprint: input.fingerprint, status: 201, body: result }
  try {
    const final = await receipts.compareAndSetReceipt(input.scope, input.fingerprint, receipt, replacement)
    if (final.updated) return result
  } catch {
    /* Same exact-readback rule as selected. */
  }
  if (!isDeepStrictEqual(await checkpoint(() => receipts.getReceipt(input.scope)), replacement)) throw new Error("skill_checkpoint_unavailable")
  return result
}
