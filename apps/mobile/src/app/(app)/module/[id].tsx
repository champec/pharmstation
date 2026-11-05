// Module mini-app route. The heavy lifting (tabs, gating, web-only handling)
// lives in ModuleHost so this stays a thin entry point.
import { useLocalSearchParams } from 'expo-router'

import { ModuleHost } from '@/components/module/ModuleHost'

export default function ModuleScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>()
  return <ModuleHost key={`${id}:${tab ?? ''}`} moduleId={id} initialTab={tab} />
}
