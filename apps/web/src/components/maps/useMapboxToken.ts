import { useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'

interface MapConfigResponse {
  token?: string
}

export function useMapboxToken(enabled = true) {
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function loadToken() {
      setLoading(true)
      setError(null)

      const { data, error: invokeError } = await getUserClient().functions.invoke<MapConfigResponse>('map-config')
      if (cancelled) return

      if (invokeError || !data?.token) {
        setToken(null)
        setError('The map configuration could not be loaded. Please try again.')
      } else {
        setToken(data.token)
      }
      setLoading(false)
    }

    loadToken().catch(() => {
      if (!cancelled) {
        setToken(null)
        setError('The map configuration could not be loaded. Please try again.')
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [enabled])

  return { token, loading, error }
}
