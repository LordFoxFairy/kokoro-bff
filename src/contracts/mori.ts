export type MoriGenerationStatus =
  | "queued"
  | "preparing"
  | "generating"
  | "post_processing"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"

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
