import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@pharmstation/core'
import { DEFAULT_DESCRIPTION, SITE_URL, formatTitle, getPageMeta } from './routeMeta'

const DEFAULT_IMAGE = `${SITE_URL}/og-image.jpg`

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

/** What a page can refine once its data has loaded (a pharmacy, product or service). */
export interface PageMetaOverride {
  title?: string
  description?: string
  /** Absolute image URL for link previews. */
  image?: string | null
  /** Path of the preferred URL, e.g. the slug URL when the page was opened by id. */
  canonicalPath?: string
  type?: 'website' | 'product' | 'article'
}

// Page-level refinements, keyed by pathname, so a route change never keeps another page's tags.
const overrides = new Map<string, PageMetaOverride>()

function applyMeta(pathname: string, staff: boolean) {
  const meta = getPageMeta(pathname, { staff })
  const override = overrides.get(pathname) ?? {}
  const title = formatTitle(override.title ?? meta.title)
  const description = (override.description ?? meta.description ?? DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim().slice(0, 300)
  const path = override.canonicalPath ?? pathname
  const url = `${SITE_URL}${path === '/' ? '' : path.replace(/\/+$/, '')}`
  const image = override.image || DEFAULT_IMAGE

  document.title = title
  setMeta('name', 'description', description)
  setMeta('name', 'robots', meta.index ? 'index, follow' : 'noindex, nofollow')
  setMeta('property', 'og:title', title)
  setMeta('property', 'og:description', description)
  setMeta('property', 'og:url', url)
  setMeta('property', 'og:type', override.type ?? 'website')
  setMeta('property', 'og:image', image)
  setMeta('name', 'twitter:title', title)
  setMeta('name', 'twitter:description', description)
  setMeta('name', 'twitter:image', image)
  setCanonical(meta.index ? url : null)
}

/** Keeps the document title, description, robots and social tags in step with the current route. */
export function RouteMeta() {
  const { pathname } = useLocation()
  const isOrgLoggedIn = useAuthStore((state) => state.isOrgLoggedIn)

  useEffect(() => {
    applyMeta(pathname, isOrgLoggedIn)
  }, [pathname, isOrgLoggedIn])

  return null
}

/** Refines the route's title once a page has loaded data, e.g. a pharmacy's name. */
export function usePageTitle(title: string | null | undefined) {
  usePageMeta(title ? { title } : null)
}

/**
 * Refines title, description, image and canonical URL once a page has its data.
 * Pass null while loading. The route's own defaults come back when the page unmounts.
 */
export function usePageMeta(meta: PageMetaOverride | null) {
  const { pathname } = useLocation()
  const isOrgLoggedIn = useAuthStore((state) => state.isOrgLoggedIn)
  const key = meta ? JSON.stringify(meta) : ''

  useEffect(() => {
    if (!meta) return
    overrides.set(pathname, meta)
    applyMeta(pathname, isOrgLoggedIn)
    return () => {
      overrides.delete(pathname)
    }
  }, [pathname, key, isOrgLoggedIn]) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Adds schema.org structured data (JSON-LD) for this page, e.g. a Pharmacy, Product or Service,
 * so search engines can show prices, stock and the pharmacy's address in results.
 */
export function useStructuredData(data: Record<string, unknown> | Array<Record<string, unknown>> | null) {
  const json = data ? JSON.stringify(
    Array.isArray(data) ? { '@context': 'https://schema.org', '@graph': data } : { '@context': 'https://schema.org', ...data },
  ) : ''

  useEffect(() => {
    if (!json) return
    const el = document.createElement('script')
    el.type = 'application/ld+json'
    el.dataset.page = 'true'
    // Escape "<" so a product name can never close the script tag.
    el.textContent = json.replace(/</g, '\\u003c')
    document.head.appendChild(el)
    return () => el.remove()
  }, [json])
}
