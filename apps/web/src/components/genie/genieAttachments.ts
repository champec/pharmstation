// Genie attachments (web): shrink big photos, upload to the private
// genie-attachments bucket under the signed-in user's own folder.
import { getUserClient } from '@pharmstation/supabase-client'
import type { ChatAttachment } from '@pharmstation/types'

export const GENIE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf'
export const GENIE_MAX_FILES = 4
const MAX_BYTES = 10 * 1024 * 1024
const MAX_SIDE = 2000

export class AttachmentError extends Error {}

/** Big photos are resized to at most 2000px on the long side and saved as JPEG. */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || file.size < 1.5 * 1024 * 1024) return file
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  return blob && blob.size < file.size ? blob : file
}

export async function uploadGenieAttachment(file: File, userId: string): Promise<ChatAttachment> {
  if (!GENIE_ACCEPT.split(',').includes(file.type)) {
    throw new AttachmentError(`"${file.name}" can't be attached. Use a photo (JPEG, PNG, WebP or GIF) or a PDF.`)
  }
  const isPdf = file.type === 'application/pdf'
  const body = isPdf ? file : await shrinkImage(file)
  if (body.size > MAX_BYTES) throw new AttachmentError(`"${file.name}" is over 10 MB. Attach a smaller file.`)
  const mime = body === file ? file.type : 'image/jpeg'
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60) || 'file'
  const ext = isPdf ? 'pdf' : mime.split('/')[1].replace('jpeg', 'jpg')
  const path = `${userId}/${crypto.randomUUID()}-${base}.${ext}`
  const { error } = await getUserClient().storage.from('genie-attachments').upload(path, body, { contentType: mime, upsert: false })
  if (error) throw new AttachmentError(`"${file.name}" could not be uploaded. Please try again.`)
  return { type: isPdf ? 'pdf' : 'image', url: path, name: file.name.slice(0, 120), size: body.size, mime_type: mime }
}

/** A short-lived link to view an attachment (only the uploader can get one). */
export async function genieAttachmentLink(path: string): Promise<string | null> {
  const { data } = await getUserClient().storage.from('genie-attachments').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}
