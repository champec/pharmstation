// ============================================
// PharmStation mobile — Module preferences store (Zustand + AsyncStorage)
//
// Powers the configurable home screen:
//   - favourites : modules the user has pinned (manual ordering intent)
//   - usage      : open counts used to surface "most used" modules
//
// Persistence is local + per-device. Ordering is a pure selector so the home
// screen stays declarative. Hydration is fire-and-forget on app start.
// ============================================

import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'

import type { MobileModule } from '@/modules/types'

const STORAGE_KEY = 'ps-module-prefs:v1'

interface PersistedShape {
  favourites: string[]
  usage: Record<string, number>
}

interface ModulePrefsState extends PersistedShape {
  hydrated: boolean
  hydrate: () => Promise<void>
  toggleFavourite: (moduleId: string) => void
  recordOpen: (moduleId: string) => void
  isFavourite: (moduleId: string) => boolean
}

async function persist(state: PersistedShape) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Non-fatal: preferences are best-effort.
  }
}

export const useModulePrefsStore = create<ModulePrefsState>((set, get) => ({
  favourites: [],
  usage: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedShape>
        set({
          favourites: parsed.favourites ?? [],
          usage: parsed.usage ?? {},
          hydrated: true,
        })
        return
      }
    } catch {
      // Ignore corrupt storage and start fresh.
    }
    set({ hydrated: true })
  },

  toggleFavourite: (moduleId) => {
    const { favourites } = get()
    const next = favourites.includes(moduleId)
      ? favourites.filter((id) => id !== moduleId)
      : [...favourites, moduleId]
    set({ favourites: next })
    void persist({ favourites: next, usage: get().usage })
  },

  recordOpen: (moduleId) => {
    const usage = { ...get().usage, [moduleId]: (get().usage[moduleId] ?? 0) + 1 }
    set({ usage })
    void persist({ favourites: get().favourites, usage })
  },

  isFavourite: (moduleId) => get().favourites.includes(moduleId),
}))

// ----------------------------------------------------------------------------
// Ordering selector (pure) — used by the home launcher.
//
// Order: pinned favourites first (in pin order), then the rest by usage count
// (desc), with the registry order as a stable tie-breaker.
// ----------------------------------------------------------------------------
export function orderModules(
  modules: MobileModule[],
  favourites: string[],
  usage: Record<string, number>,
): MobileModule[] {
  const favIndex = new Map(favourites.map((id, i) => [id, i]))
  const registryIndex = new Map(modules.map((m, i) => [m.id, i]))

  return [...modules].sort((a, b) => {
    const aFav = favIndex.has(a.id)
    const bFav = favIndex.has(b.id)
    if (aFav && bFav) return favIndex.get(a.id)! - favIndex.get(b.id)!
    if (aFav) return -1
    if (bFav) return 1

    const usageDiff = (usage[b.id] ?? 0) - (usage[a.id] ?? 0)
    if (usageDiff !== 0) return usageDiff

    return registryIndex.get(a.id)! - registryIndex.get(b.id)!
  })
}
