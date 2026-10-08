// Files from the user's computer for `listspace attach`: which ones may go up,
// with what type, read from disk with the size checked first. The API takes
// the bytes as base64 (POST /items/:id/attachments), so an agent never has to
// encode a file itself.

import { readFile, stat } from 'node:fs/promises'

/** The most the API takes per file, decoded (MAX_ATTACH_BYTES on the server). */
export const MAX_FILE_BYTES = 8 * 1024 * 1024

/**
 * The file types the app lets people attach (fileUploadService.validateFile),
 * by extension. Markdown goes up as text/plain, which the app accepts. The
 * server stores HTML, SVG and scripts as plain-text downloads.
 */
const TYPES: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/plain',
  markdown: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  mov: 'video/quicktime',
  json: 'application/json',
  js: 'application/javascript',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
}

export const ATTACHABLE_EXTENSIONS: readonly string[] = Object.keys(TYPES)

/** The name shown on the item: the last part of the path (either slash). */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).filter((part) => part !== '').pop() ?? path
}

/** The type for a file name by its extension, or null when it is not on the list. */
export function mimeTypeFor(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0 || dot === fileName.length - 1) return null
  return TYPES[fileName.slice(dot + 1).toLowerCase()] ?? null
}

/** A file read from disk, or why it could not be. */
export type LocalFile =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'missing' }
  | { readonly kind: 'not_a_file' }
  | { readonly kind: 'too_large'; readonly sizeBytes: number }
  | { readonly kind: 'unreadable'; readonly reason: string }

/** Reads a file after checking its size, so a large file is never loaded. */
export async function readLocalFile(path: string, maxBytes: number): Promise<LocalFile> {
  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { kind: 'not_a_file' }
    size = info.size
  } catch (error) {
    if (isErrnoCode(error, 'ENOENT')) return { kind: 'missing' }
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) }
  }
  if (size > maxBytes) return { kind: 'too_large', sizeBytes: size }
  try {
    const bytes = await readFile(path)
    // The file may have grown between stat and read
    if (bytes.length > maxBytes) return { kind: 'too_large', sizeBytes: bytes.length }
    return { kind: 'ok', bytes }
  } catch (error) {
    return { kind: 'unreadable', reason: error instanceof Error ? error.message : String(error) }
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

/** A size for people: 512 bytes, 340 KB, 2.4 MB. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
