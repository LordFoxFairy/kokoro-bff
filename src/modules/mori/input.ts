import type { IncomingMessage } from "node:http"

import type { MoriGenerationInput, MoriSongPlan } from "../../adapters/mori.js"
import { queryOf } from "../../http/request.js"

export function moriGenerationInput(json: Record<string, unknown>): MoriGenerationInput | null {
  const mode = json.mode
  const prompt = json.prompt
  const lyricsMode = json.lyrics_mode
  const songPlanRef = json.song_plan_ref
  const lyrics = json.lyrics
  const style = json.style
  const references = json.reference_asset_refs
  const voiceRef = json.voice_ref
  const duration = json.duration_seconds
  const durationSeconds = duration === null ? null : typeof duration === "number" ? duration : undefined
  if (
    (mode !== "smart" && mode !== "custom")
    || typeof prompt !== "string" || prompt.trim() === ""
    || (lyricsMode !== "lyrics" && lyricsMode !== "instrumental")
    || (songPlanRef !== null && typeof songPlanRef !== "string")
    || (lyrics !== null && typeof lyrics !== "string")
    || (style !== null && typeof style !== "string")
    || !Array.isArray(references) || !references.every((item): item is string => typeof item === "string")
    || (voiceRef !== null && typeof voiceRef !== "string")
    || durationSeconds === undefined
    || (durationSeconds !== null && (!Number.isSafeInteger(durationSeconds) || durationSeconds < 30 || durationSeconds > 600))
    || (lyricsMode === "instrumental" && lyrics !== null)
  ) return null
  return {
    mode,
    prompt: prompt.trim(),
    song_plan_ref: songPlanRef === null ? null : songPlanRef.trim() || null,
    lyrics: lyricsMode === "lyrics" && typeof lyrics === "string" ? lyrics.trim() || null : null,
    style: style === null ? null : style.trim() || null,
    reference_asset_refs: [...references],
    voice_ref: voiceRef === null ? null : voiceRef.trim() || null,
    duration_seconds: durationSeconds,
    lyrics_mode: lyricsMode,
  }
}

export function moriProjectInput(json: Record<string, unknown>): { title: string; description: string } | null {
  const title = typeof json.title === "string" ? json.title.trim() : ""
  const description = typeof json.description === "string" ? json.description.trim() : ""
  if (title === "" || title.length > 160 || description.length > 2000) return null
  return { title, description }
}

export function moriSongPlanInput(json: Record<string, unknown>): Omit<MoriSongPlan, "song_plan_ref" | "project_ref" | "created_at"> | null {
  const prompt = typeof json.prompt === "string" ? json.prompt.trim() : ""
  const mood = typeof json.mood === "string" ? json.mood.trim() : ""
  const tempo = json.tempo_bpm
  const structure = json.structure
  const instruments = json.instruments
  const vocalDirection = typeof json.vocal_direction === "string" ? json.vocal_direction.trim() : ""
  const lyricsIntent = typeof json.lyrics_intent === "string" ? json.lyrics_intent.trim() : ""
  if (
    prompt === ""
    || mood === ""
    || typeof tempo !== "number" || !Number.isSafeInteger(tempo) || tempo < 40 || tempo > 240
    || !Array.isArray(structure) || structure.length === 0 || !structure.every((item): item is string => typeof item === "string" && item.trim() !== "")
    || !Array.isArray(instruments) || !instruments.every((item): item is string => typeof item === "string" && item.trim() !== "")
    || vocalDirection === ""
    || lyricsIntent === ""
  ) return null
  return {
    prompt,
    mood,
    tempo_bpm: tempo,
    structure: structure.map((item) => item.trim()),
    instruments: instruments.map((item) => item.trim()),
    vocal_direction: vocalDirection,
    lyrics_intent: lyricsIntent,
  }
}

export function moriPageInput(request: IncomingMessage): { cursor: string | null; limit: number } | null {
  const query = queryOf(request)
  const limitValue = query.get("limit")
  const limit = limitValue === null || limitValue.trim() === "" ? 20 : Number(limitValue)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null
  return { cursor: query.get("cursor")?.trim() || null, limit }
}

export function moriExportInput(json: Record<string, unknown>): "mp3" | "wav" | null {
  if (json.format === undefined || json.format === "mp3") return "mp3"
  return json.format === "wav" ? "wav" : null
}
