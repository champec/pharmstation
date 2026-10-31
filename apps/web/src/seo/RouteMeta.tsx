import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_DESCRIPTION, SITE_URL, formatTitle, getPageMeta } from './routeMeta'

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!href) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('link')
    el.rel = 'canonical'
    document.head.appendChild(el)
  }
  el.href = href
}

/** Keeps the document title, description, robots and social tags in step with the current route. */
export function RouteMeta() {
  const { pathname } = useLocation()

  useEffect(() => {
    const meta = getPageMeta(pathname)
    const title = formatTitle(meta.title)
    const description = meta.description ?? DEFAULT_DESCRIPTION
    const url = `${SITE_URL}${pathname === '/' ? '' : pathname.replace(/\/+$/, '')}`

    document.title = title
    setMeta('name', 'description', description)
    setMeta('name', 'robots', meta.index ? 'index, follow' : 'noindex, nofollow')
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    setCanonical(meta.index ? url : null)
  }, [pathname])

  return null
}

/** Refines the route's title once a page has loaded data, e.g. a pharmacy's name. */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) document.title = formatTitle(title)
  }, [title])
}
