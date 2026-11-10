// Public pharmacy, service and product URLs for sitemap.xml, read at build time with the
// public (anon) key, so they obey the same rules as the live pages. Every deploy refreshes them.
// No React or browser APIs here: vite.config.ts loads this file.

import { slugMap } from '../lib/slugs'

interface Row { [key: string]: any }

async function get(base: string, key: string, path: string): Promise<Row[]> {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (!response.ok) throw new Error(`${path}: ${response.status}`)
  return response.json()
}

async function rpc(base: string, key: string, name: string, body: Row): Promise<Row[]> {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  return response.json()
}

export interface SitemapEntry { path: string; lastmod?: string }

/** Returns [] (and the build carries on) when Supabase can't be reached. */
export async function loadDynamicSitemap(base: string | undefined, key: string | undefined): Promise<SitemapEntry[]> {
  if (!base || !key || !/^https:\/\//.test(base)) return []
  try {
    const [orgs, services, shops, products] = await Promise.all([
      get(base, key, 'ps_organisations?select=id,slug&is_public=eq.true&is_active=eq.true'),
      get(base, key, 'ps_services?select=*&is_public=eq.true&is_active=eq.true'),
      rpc(base, key, 'ps_shop_list_orgs', { p_lat: null, p_lng: null }),
      get(base, key, 'ps_shop_products?select=*&is_active=eq.true'),
    ])
    const entries: SitemapEntry[] = []
    for (const org of orgs) {
      const segment = org.slug || org.id
      const orgServices = services.filter((s) => s.org_id === org.id && !s.archived_at)
      if (orgServices.length) {
        entries.push({ path: `/book/${segment}` })
        const slugs = slugMap(orgServices as any)
        orgServices.forEach((s) => entries.push({ path: `/book/${segment}/${slugs.get(s.id)}` }))
      }
    }
    for (const shop of shops) {
      const segment = shop.slug || shop.org_id
      entries.push({ path: `/shop/${segment}` })
      const orgProducts = products.filter((p) => p.org_id === shop.org_id)
      const slugs = slugMap(orgProducts as any)
      orgProducts.forEach((p) => entries.push({ path: `/shop/${segment}/${slugs.get(p.id)}`, lastmod: p.updated_at?.slice(0, 10) }))
    }
    return entries
  } catch (error) {
    console.warn(`[sitemap] pharmacy pages skipped: ${(error as Error).message}`)
    return []
  }
}
