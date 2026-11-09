// Groups the service library for locum "what can you provide" checklists.
// The library holds NHS and private versions of the same service (and some
// near-duplicate names), but for a locum it is one skill, so each checkbox
// covers every library entry with the same normalised name.

export interface LibraryService { id: string; name: string; category: string }
export interface ServiceChoice { key: string; name: string; ids: string[] }

const CATEGORY_LABELS: Record<string, string> = {
  consultation: 'Consultations',
  nhs_advanced_service: 'NHS advanced services',
  pharmacy_first: 'Pharmacy First',
}

export function categoryLabel(cat: string) {
  return CATEGORY_LABELS[cat] ?? CATEGORY_LABELS[cat.toLowerCase()]
    ?? cat.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

export function serviceKey(name: string) {
  return name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, '')).join(' ')
}

/** Category label → choices, each choice covering all duplicate library ids. */
export function groupServices(services: LibraryService[]): [string, ServiceChoice[]][] {
  const byKey = new Map<string, ServiceChoice & { category: string }>()
  for (const s of services) {
    const key = serviceKey(s.name)
    const existing = byKey.get(key)
    if (existing) {
      existing.ids.push(s.id)
      // Prefer the shorter, plainer name ("Flu vaccination" over "Flu Vaccination (NHS)")
      if (s.name.length < existing.name.length) existing.name = s.name
    } else {
      byKey.set(key, { key, name: s.name, ids: [s.id], category: s.category })
    }
  }
  const groups = new Map<string, ServiceChoice[]>()
  for (const c of byKey.values()) {
    const label = categoryLabel(c.category)
    groups.set(label, [...(groups.get(label) ?? []), { key: c.key, name: c.name, ids: c.ids }])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, choices]) => [label, choices.sort((a, b) => a.name.localeCompare(b.name))])
}
