/**
 * Build a PostgREST .or() filter for looking up an organisation by slug or id.
 *
 * The `id` column is a UUID — passing a non-UUID string (e.g. "test-pharmacy")
 * to `id.eq.` makes Postgres throw a cast error and the whole query fails.
 * So we only include the id branch when the param actually looks like a UUID.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function orgSlugOrIdFilter(slugOrId: string): string {
  return UUID_RE.test(slugOrId)
    ? `slug.eq.${slugOrId},id.eq.${slugOrId}`
    : `slug.eq.${slugOrId}`
}
