// Readable URL segments for products and services. Pure functions: also used by the sitemap build.

/** Same rules as pharmacy slugs: lower case words joined by hyphens. */
export function slugify(text: string) {
  return text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'item'
}

// Words the web app already uses as path segments under /shop/:org and /book/:org.
const RESERVED = new Set(['payment-result', 'confirm', 'order', 'terms'])

/**
 * Readable URL segments for a pharmacy's products or services, made from their names.
 * A stored slug wins. Duplicate names get -2, -3 in order of creation, so links stay stable
 * as long as the item keeps its name; ids still open the page too.
 */
export function slugMap<T extends { id: string; name: string; slug?: string | null; created_at?: string }>(items: T[]) {
  const byId = new Map<string, string>()
  const taken = new Set<string>()
  const ordered = [...items].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id))
  for (const item of ordered) {
    if (item.slug) { byId.set(item.id, item.slug); taken.add(item.slug) }
  }
  for (const item of ordered) {
    if (byId.has(item.id)) continue
    let base = slugify(item.name)
    if (RESERVED.has(base)) base = `${base}-1`
    let candidate = base
    for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`
    taken.add(candidate)
    byId.set(item.id, candidate)
  }
  return byId
}

/** Finds the item a URL segment points at: by slug, or by id for older links. */
export function findBySlug<T extends { id: string }>(items: T[], slugs: Map<string, string>, segment: string | undefined) {
  if (!segment) return undefined
  return items.find((item) => slugs.get(item.id) === segment) ?? items.find((item) => item.id === segment)
}

