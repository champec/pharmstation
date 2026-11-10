/** Message from an Error or a Supabase error (a plain object with `message`). */
export function errorText(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = (error as { message: unknown }).message
    if (msg) return String(msg)
  }
  return fallback
}
