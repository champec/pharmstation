import { useEffect, useState } from 'react'
import { getUserClient } from '@pharmstation/supabase-client'

let cachedToken: string | null = null
let tokenRequest: Promise<string> | null = null

async function fetchMapboxToken(): Promise<string> {
  if (cachedToken) return cachedToken

  tokenRequest ??= getUserClient().functions.invoke<{ token?: string }>('map-config')
    .then(({ data, error }) => {
      if (error) throw error
      if (!data?.token) throw new Error('Mapbox token is unavailable')
      cachedToken = data.token
      return data.token
    })
    .finally(() => {
      tokenRequest = null
    })

  return tokenRequest
}

export function useMapboxToken(enabled = true) {
  const [token, setToken] = useState<string | null>(cachedToken)
  const [loading, setLoading] = useState(enabled && !cachedToken)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || token) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetchMapboxToken()
      .then((value) => {
        if (!cancelled) setToken(value)
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Unable to load map configuration')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, token])

  return { token, loading, error }
}
