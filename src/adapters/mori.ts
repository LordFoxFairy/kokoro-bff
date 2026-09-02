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

export type MoriSongPlan = {
  song_plan_ref: string
  project_ref: string
  prompt: string
  mood: string
  tempo_bpm: number
  structure: string[]
  instruments: string[]
  vocal_direction: string
  lyrics_intent: string
  created_at: string
}

export type MoriVersion = {
  version_ref: string
  project_ref: string
  source_candidate_ref: string
  status: "current" | "draft" | "archived"
  title: string
  duration_seconds: number
  audio_asset_ref: string
  waveform_asset_ref: string
  style_tags: string[]
  created_at: string
}

export type MoriLibraryItem = {
  library_item_ref: string
  kind: "version"
  project_ref: string
  project_title: string
  version_ref: string
  title: string
  duration_seconds: number
  audio_asset_ref: string
  waveform_asset_ref: string
  created_at: string
}

export type MoriExport = {
  export_ref: string
  project_ref: string
  version_ref: string
  format: "mp3" | "wav"
  status: "queued" | "processing" | "succeeded" | "failed"
  download_url: string | null
  created_at: string
}

export type MoriPage<T> = {
  items: T[]
  next_cursor: string | null
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

const previewSongPlan: MoriSongPlan = {
  song_plan_ref: "song_plan_preview_first_light",
  project_ref: previewProject.project_ref,
  prompt: "A warm late-night track for the drive home.",
  mood: "warm hopeful",
  tempo_bpm: 102,
  structure: ["intro", "verse", "lift", "chorus", "outro"],
  instruments: ["soft_synth", "muted_guitar", "brush_drums"],
  vocal_direction: "intimate lead vocal with a gentle lift in the chorus",
  lyrics_intent: "small moments becoming a reason to keep going",
  created_at: "2026-09-02T11:56:00.000Z",
}

function page<T>(items: T[], cursor: string | null, limit: number, prefix: string): MoriPage<T> | null {
  let offset = 0
  if (cursor !== null && cursor.trim() !== "") {
    const match = new RegExp(`^mori_${prefix}_(\\d+)$`, "u").exec(cursor)
    if (match === null) return null
    offset = Number(match[1])
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length) return null
  }
  const nextOffset = Math.min(offset + limit, items.length)
  return {
    items: items.slice(offset, nextOffset).map((item) => structuredClone(item)),
    next_cursor: nextOffset < items.length ? `mori_${prefix}_${nextOffset}` : null,
  }
}

export class MoriMockBffStore {
  readonly projects = [structuredClone(previewProject)]
  readonly candidates = previewCandidates.map((candidate) => structuredClone(candidate))
  readonly songPlans = [structuredClone(previewSongPlan)]
  readonly versions: MoriVersion[] = [{
    version_ref: "version_preview_first_light_a",
    project_ref: previewProject.project_ref,
    source_candidate_ref: "candidate_preview_first_light_a",
    status: "current",
    title: "First Light",
    duration_seconds: 182,
    audio_asset_ref: "asset_preview_first_light_a",
    waveform_asset_ref: "waveform_preview_first_light_a",
    style_tags: ["dream pop", "intimate", "organic"],
    created_at: "2026-09-02T11:58:00.000Z",
  }]
  readonly exports: MoriExport[] = []
  private readonly generations = new Map<string, MoriGenerationRecord>()
  private nextGenerationNumber = 1
  private nextProjectNumber = 1
  private nextSongPlanNumber = 1
  private nextVersionNumber = 1
  private nextExportNumber = 1

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

  listProjectsPage(cursor: string | null, limit: number): MoriPage<MoriProject> | null {
    const result = page(this.projects, cursor, limit, "projects")
    return result === null ? null : { items: result.items.map((item) => ({ ...item })), next_cursor: result.next_cursor }
  }

  createProject(title: string, description: string): MoriProject {
    const now = new Date().toISOString()
    const project: MoriProject = {
      project_ref: `project_mori_${this.nextProjectNumber++}`,
      title,
      description,
      current_version_ref: null,
      candidate_count: 0,
      last_activity_at: now,
    }
    this.projects.unshift(project)
    return { ...project }
  }

  findProject(projectRef: string): MoriProject | undefined {
    const project = this.projects.find((item) => item.project_ref === projectRef)
    return project === undefined ? undefined : { ...project }
  }

  createSongPlan(projectRef: string, input: Omit<MoriSongPlan, "song_plan_ref" | "project_ref" | "created_at">): MoriSongPlan {
    const plan: MoriSongPlan = {
      ...input,
      song_plan_ref: `song_plan_mori_${this.nextSongPlanNumber++}`,
      project_ref: projectRef,
      created_at: new Date().toISOString(),
    }
    this.songPlans.push(plan)
    return structuredClone(plan)
  }

  listCandidates(projectRef: string, cursor: string | null, limit: number): MoriPage<MoriCandidate> | null {
    const projectCandidates = this.candidates.filter((candidate) => candidate.project_ref === projectRef)
    const result = page(projectCandidates, cursor, limit, `candidates_${projectRef}`)
    return result === null ? null : { items: result.items, next_cursor: result.next_cursor }
  }

  findCandidate(candidateRef: string): MoriCandidate | undefined {
    const candidate = this.candidates.find((item) => item.candidate_ref === candidateRef)
    return candidate === undefined ? undefined : structuredClone(candidate)
  }

  findVersion(versionRef: string): MoriVersion | undefined {
    const version = this.versions.find((item) => item.version_ref === versionRef)
    return version === undefined ? undefined : structuredClone(version)
  }

  generationInputForVersion(versionRef: string): MoriGenerationInput | null {
    const version = this.versions.find((item) => item.version_ref === versionRef)
    if (version === undefined) return null
    const candidate = this.candidates.find((item) => item.candidate_ref === version.source_candidate_ref)
    if (candidate === undefined) return null
    const generation = this.generations.get(candidate.generation_ref)
    return generation === undefined ? null : structuredClone(generation.input)
  }

  promoteCandidate(candidateRef: string): MoriVersion | null {
    const candidate = this.candidates.find((item) => item.candidate_ref === candidateRef)
    if (candidate === undefined) return null
    const project = this.projects.find((item) => item.project_ref === candidate.project_ref)
    if (project === undefined) return null
    let version = this.versions.find((item) => item.version_ref === candidate.version_ref)
    const now = new Date().toISOString()
    if (version === undefined) {
      version = {
        version_ref: candidate.version_ref || `version_mori_${this.nextVersionNumber++}`,
        project_ref: candidate.project_ref,
        source_candidate_ref: candidate.candidate_ref,
        status: "draft",
        title: candidate.title,
        duration_seconds: candidate.duration_seconds,
        audio_asset_ref: candidate.audio_asset_ref,
        waveform_asset_ref: candidate.waveform_asset_ref,
        style_tags: [...candidate.style_tags],
        created_at: now,
      }
      this.versions.push(version)
    }
    for (const item of this.versions) {
      if (item.project_ref === project.project_ref && item.version_ref !== version.version_ref && item.status === "current") item.status = "archived"
    }
    version.status = "current"
    project.current_version_ref = version.version_ref
    project.last_activity_at = now
    return structuredClone(version)
  }

  listLibrary(kind: string, cursor: string | null, limit: number): MoriPage<MoriLibraryItem> | null {
    if (kind !== "all" && kind !== "version") return null
    const items = this.versions.map((version) => {
      const project = this.projects.find((item) => item.project_ref === version.project_ref)
      return {
        library_item_ref: `library_${version.version_ref}`,
        kind: "version" as const,
        project_ref: version.project_ref,
        project_title: project?.title ?? "Untitled project",
        version_ref: version.version_ref,
        title: version.title,
        duration_seconds: version.duration_seconds,
        audio_asset_ref: version.audio_asset_ref,
        waveform_asset_ref: version.waveform_asset_ref,
        created_at: version.created_at,
      }
    })
    const result = page(items, cursor, limit, "library")
    return result === null ? null : { items: result.items, next_cursor: result.next_cursor }
  }

  createExport(versionRef: string, format: "mp3" | "wav"): MoriExport | null {
    const version = this.versions.find((item) => item.version_ref === versionRef)
    if (version === undefined) return null
    const exportRef = `export_mori_${this.nextExportNumber++}`
    const exportRecord: MoriExport = {
      export_ref: exportRef,
      project_ref: version.project_ref,
      version_ref: version.version_ref,
      format,
      status: "queued",
      download_url: null,
      created_at: new Date().toISOString(),
    }
    this.exports.push(exportRecord)
    setTimeout(() => {
      const current = this.exports.find((item) => item.export_ref === exportRef)
      if (current === undefined || current.status !== "queued") return
      current.status = "processing"
      setTimeout(() => {
        const finished = this.exports.find((item) => item.export_ref === exportRef)
        if (finished === undefined || finished.status !== "processing") return
        finished.status = "succeeded"
        finished.download_url = `https://download.kokoro.invalid/mori/${finished.export_ref}.${finished.format}`
      }, 35)
    }, 20)
    return structuredClone(exportRecord)
  }

  findExport(exportRef: string): MoriExport | undefined {
    const exportRecord = this.exports.find((item) => item.export_ref === exportRef)
    return exportRecord === undefined ? undefined : structuredClone(exportRecord)
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
