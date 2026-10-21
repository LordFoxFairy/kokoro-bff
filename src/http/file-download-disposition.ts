export function fileDownloadDisposition(filename: string): string {
  const cleaned =
    filename
      .replace(/[\u0000-\u001f\u007f/\\]/gu, "_")
      .replace(/^\.+/u, "_")
      .slice(0, 255) || "download"
  const fallback = cleaned.replace(/[^\x20-\x7e]/gu, "_").replace(/[";]/gu, "_")
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
