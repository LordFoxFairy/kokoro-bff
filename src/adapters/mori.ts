export type MoriGenerationStatus = "queued" | "preparing" | "generating" | "post_processing" | "succeeded" | "failed" | "cancelled" | "expired"

export type MoriGenerationInput = {
  mode: "smart" | "custom"
  prompt: string
  song_plan_ref: string | null
  lyrics: string | null
  style: string | null
  reference_asset_refs: string[]
  voice_ref: string | null
  duration_seconds: number | null
  lyrics_mode: "lyrics" | "instrumental"
}

export type MoriProject = {
  project_ref: string
  title: string
  description: string
  current_version_ref: string | null
  candidate_count: number
  last_activity_at: string
}

export type MoriGeneration = {
  generation_ref: string
  project_ref: string
  song_plan_ref: string | null
  mode: MoriGenerationInput["mode"]
  status: MoriGenerationStatus
  progress: number
  candidate_refs: string[]
  created_at: string
}

export type MoriCandidate = {
  candidate_ref: string
  generation_ref: string
  version_ref: string
  project_ref: string
  title: string
  duration_seconds: number
  audio_asset_ref: string
  waveform_asset_ref: string
  style_tags: string[]
  created_at: string
}

export type MoriGenerationEvent = {
  id: string
  event: string
  data: {
    generation_ref: string
    project_ref: string
    status: MoriGenerationStatus
    progress: number
    candidate_refs: string[]
  }
}

type MoriGenerationRecord = MoriGeneration & {
  input: MoriGenerationInput
  events: MoriGenerationEvent[]
}

const previewProject: MoriProject = {
  project_ref: "project_preview_first_light",
  title: "First Light",
  description: "A bright, patient song about finding your way home.",
  current_version_ref: "version_preview_first_light_a",
  candidate_count: 2,
  last_activity_at: "2026-09-02T12:00:00.000Z",
}

const previewCandidates: MoriCandidate[] = [{
  candidate_ref: "candidate_preview_first_light_a",
  generation_ref: "generation_preview_first_light",
  version_ref: "version_preview_first_light_a",
  project_ref: previewProject.project_ref,
  title: "First Light",
  duration_seconds: 182,
  audio_asset_ref: "asset_preview_first_light_a",
  waveform_asset_ref: "waveform_preview_first_light_a",
  style_tags: ["dream pop", "intimate", "organic"],
  created_at: "2026-09-02T11:58:00.000Z",
}, {
  candidate_ref: "candidate_preview_first_light_b",
  generation_ref: "generation_preview_first_light",
  version_ref: "version_preview_first_light_b",
  project_ref: previewProject.project_ref,
  title: "First Light · Afterglow",
  duration_seconds: 196,
  audio_asset_ref: "asset_preview_first_light_b",
  waveform_asset_ref: "waveform_preview_first_light_b",
  style_tags: ["open horizon", "layered chorus"],
  created_at: "2026-09-02T11:59:00.000Z",
}]

export class MoriMockStore {
  readonly projects = [structuredClone(previewProject)]
  readonly candidates = previewCandidates.map((candidate) => structuredClone(candidate))
  private readonly generations = new Map<string, MoriGenerationRecord>()
  private nextGenerationNumber = 1

  constructor() {
    const generation: MoriGenerationRecord = {
      generation_ref: "generation_preview_first_light",
      project_ref: previewProject.project_ref,
      song_plan_ref: "song_plan_preview_first_light",
      mode: "smart",
      status: "succeeded",
      progress: 100,
      candidate_refs: this.candidates.map((candidate) => candidate.candidate_ref),
      created_at: "2026-09-02T11:57:00.000Z",
      input: {
        mode: "smart",
        prompt: "A warm, late-night track for the drive home, slowly opening into sunrise.",
        song_plan_ref: "song_plan_preview_first_light",
        lyrics: null,
        style: "dream pop intimate organic",
        reference_asset_refs: [],
        voice_ref: null,
        duration_seconds: 180,
        lyrics_mode: "instrumental",
      },
      events: [],
    }
    this.generations.set(generation.generation_ref, generation)
    this.appendEvent(generation)
  }

  listProjects(): MoriProject[] {
    return this.projects.map((project) => ({ ...project }))
  }

  findProject(projectRef: string): MoriProject | undefined {
    const project = this.projects.find((item) => item.project_ref === projectRef)
    return project === undefined ? undefined : { ...project }
  }

  createGeneration(projectRef: string, input: MoriGenerationInput): MoriGeneration {
    const generationRef = `generation_mori_${this.nextGenerationNumber++}`
    const generation: MoriGenerationRecord = {
      generation_ref: generationRef,
      project_ref: projectRef,
      song_plan_ref: input.song_plan_ref,
      mode: input.mode,
      status: "queued",
      progress: 0,
      candidate_refs: [],
      created_at: new Date().toISOString(),
      input: structuredClone(input),
      events: [],
    }
    this.generations.set(generationRef, generation)
    this.appendEvent(generation)
    this.scheduleProgress(generationRef)
    return this.snapshot(generation)
  }

  findGeneration(generationRef: string): MoriGeneration | undefined {
    const generation = this.generations.get(generationRef)
    return generation === undefined ? undefined : this.snapshot(generation)
  }

  cancelGeneration(generationRef: string): MoriGeneration | null {
    const generation = this.generations.get(generationRef)
    if (generation === undefined) return null
    if (["succeeded", "failed", "cancelled", "expired"].includes(generation.status)) return this.snapshot(generation)
    generation.status = "cancelled"
    generation.progress = Math.min(generation.progress, 99)
    this.appendEvent(generation)
    return this.snapshot(generation)
  }

  eventsSince(generationRef: string, lastEventId: string | null): { events: MoriGenerationEvent[]; invalid: boolean } | null {
    const generation = this.generations.get(generationRef)
    if (generation === undefined) return null
    const cursorValue = lastEventId === null || lastEventId.trim() === "" ? "0" : lastEventId.startsWith(`${generationRef}:`) ? lastEventId.split(":").at(-1) : undefined
    const cursor = cursorValue === undefined ? Number.NaN : Number(cursorValue)
    if (!Number.isSafeInteger(cursor) || cursor < 0) return { events: [], invalid: true }
    return { events: generation.events.filter((event) => Number(event.id.split(":").at(-1)) > cursor).map((event) => structuredClone(event)), invalid: false }
  }

  private scheduleProgress(generationRef: string): void {
    const stages: Array<{ status: MoriGenerationStatus; progress: number; delay: number }> = [
      { status: "preparing", progress: 12, delay: 20 },
      { status: "generating", progress: 58, delay: 45 },
      { status: "post_processing", progress: 88, delay: 70 },
      { status: "succeeded", progress: 100, delay: 95 },
    ]
    for (const stage of stages) {
      setTimeout(() => this.advanceGeneration(generationRef, stage.status, stage.progress), stage.delay)
    }
  }

  private advanceGeneration(generationRef: string, status: MoriGenerationStatus, progress: number): void {
    const generation = this.generations.get(generationRef)
    if (generation === undefined || generation.status === "cancelled" || generation.status === "failed" || generation.status === "expired") return
    generation.status = status
    generation.progress = progress
    if (status === "succeeded" && generation.candidate_refs.length === 0) {
      const base = generationRef.replace(/^generation_/u, "")
      const createdAt = new Date().toISOString()
      const newCandidates = [0, 1].map((index) => ({
        candidate_ref: `${generationRef}_candidate_${index + 1}`,
        generation_ref: generationRef,
        version_ref: `${generationRef}_version_${index + 1}`,
        project_ref: generation.project_ref,
        title: index === 0 ? "New direction" : "New direction · Open sky",
        duration_seconds: generation.input.duration_seconds ?? (180 + index * 14),
        audio_asset_ref: `asset_${base}_${index + 1}`,
        waveform_asset_ref: `waveform_${base}_${index + 1}`,
        style_tags: generation.input.style?.split(/\s*[·,]\s*|\s+/u).filter(Boolean).slice(0, 4) ?? [],
        created_at: createdAt,
      }))
      this.candidates.push(...newCandidates)
      generation.candidate_refs = newCandidates.map((candidate) => candidate.candidate_ref)
      const project = this.projects.find((item) => item.project_ref === generation.project_ref)
      if (project !== undefined) {
        project.candidate_count += newCandidates.length
        project.last_activity_at = createdAt
      }
    }
    this.appendEvent(generation)
  }

  private appendEvent(generation: MoriGenerationRecord): void {
    const sequence = generation.events.length + 1
    generation.events.push({
      id: `${generation.generation_ref}:${sequence}`,
      event: `generation.${generation.status}`,
      data: {
        generation_ref: generation.generation_ref,
        project_ref: generation.project_ref,
        status: generation.status,
        progress: generation.progress,
        candidate_refs: [...generation.candidate_refs],
      },
    })
  }

  private snapshot(generation: MoriGenerationRecord): MoriGeneration {
    const { input: _input, events: _events, ...snapshot } = generation
    return { ...snapshot, candidate_refs: [...snapshot.candidate_refs] }
  }
}
