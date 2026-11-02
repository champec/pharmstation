import { useEffect, useState } from 'react'

/** Matches the breakpoint where the staff side nav becomes an off-canvas drawer (see app.css). */
export const MOBILE_NAV_QUERY = '(max-width: 800px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_NAV_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_NAV_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
