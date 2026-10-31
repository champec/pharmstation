// Page titles, descriptions and indexing rules per route.
// Shared by <RouteMeta> (sets the tags at runtime) and the sitemap plugin in vite.config.ts,
// so keep this file free of React and browser APIs.

import { formDefinitions } from '../pages/resources/formDefinitions'
import { logDefinitions } from '../pages/resources/logDefinitions'

export const SITE_URL = 'https://pharmstation.co.uk'
export const SITE_NAME = 'PharmStation'
export const DEFAULT_TITLE = 'PharmStation | Your Digital Pharmacy Workstation'
export const DEFAULT_DESCRIPTION =
  'PharmStation is the digital workstation for UK community pharmacies: CD register, RP log, NHS and private services, online booking, SOPs and patient messaging in one place.'

export interface PageMeta {
  title: string
  description?: string
  /** Public pages are indexed by search engines; everything else gets noindex. */
  index: boolean
}

interface PublicPage {
  path: string
  title: string
  description: string
}

/** Every public, indexable page with a fixed URL. These also make up sitemap.xml. */
export const PUBLIC_PAGES: PublicPage[] = [
  {
    path: '/about',
    title: 'About',
    description: 'PharmStation brings the CD register, RP log, services, bookings and messaging for UK pharmacies into one secure, cloud-based workstation.',
  },
  {
    path: '/book',
    title: 'Book a pharmacy appointment',
    description: 'Find a participating local pharmacy and book a service online, from Pharmacy First consultations to vaccinations and health checks.',
  },
  {
    path: '/shop',
    title: 'Shop from local pharmacies',
    description: 'Browse health, wellbeing and everyday products from independent UK pharmacies, with local delivery or collection.',
  },
  {
    path: '/maps',
    title: 'Pharmacy map',
    description: 'Find community pharmacies near you on an interactive map.',
  },
  {
    path: '/rp',
    title: 'Responsible Pharmacist notice',
    description: 'Create and print a Responsible Pharmacist notice to display in your pharmacy.',
  },
  {
    path: '/resources',
    title: 'Free pharmacy resources',
    description: 'Free printable consultation forms, logs, patient leaflets and operational tools for UK community pharmacies.',
  },
  {
    path: '/resources/forms',
    title: 'Printable pharmacy consultation forms',
    description: 'Free printable Pharmacy First, emergency supply and hypertension service consultation forms.',
  },
  {
    path: '/resources/pils',
    title: 'Patient information leaflet finder',
    description: 'Find and print patient information leaflets for medicines.',
  },
  {
    path: '/resources/logs',
    title: 'Printable pharmacy logs',
    description: 'Free printable near-miss, visitor, fridge temperature and other pharmacy logs.',
  },
  {
    path: '/resources/tools',
    title: 'Pharmacy operational tools',
    description: 'Useful contacts, closure notices, sildenafil cards and other day-to-day tools for pharmacy teams.',
  },
  {
    path: '/resources/tools/contacts',
    title: 'Useful pharmacy contacts',
    description: 'Key contacts for UK community pharmacy teams in one printable list.',
  },
  {
    path: '/resources/tools/closure-notice',
    title: 'Pharmacy closure notice',
    description: 'Create and print a temporary pharmacy closure notice.',
  },
  {
    path: '/resources/tools/sildenafil-cards',
    title: 'Sildenafil patient cards',
    description: 'Printable sildenafil patient information cards for pharmacy supply.',
  },
  {
    path: '/privacy',
    title: 'Privacy notice',
    description: 'How PharmStation collects, uses and protects personal data.',
  },
  ...formDefinitions.map((form) => ({
    path: `/resources/forms/${form.slug}`,
    title: /form$/i.test(form.title) ? form.title : `${form.title} consultation form`,
    description: `Free printable ${form.service} consultation form: ${form.title}.`,
  })),
  ...logDefinitions.map((log) => ({
    path: `/resources/logs/${log.slug}`,
    title: log.title,
    description: log.description,
  })),
]

/** Public pages whose URL depends on data (a pharmacy's slug). */
const DYNAMIC_PUBLIC: Array<{ pattern: RegExp; meta: Omit<PageMeta, 'index'>; index: boolean }> = [
  { pattern: /^\/book\/[^/]+\/payment-result$/, meta: { title: 'Payment result' }, index: false },
  { pattern: /^\/book\/[^/]+\/[^/]+\/confirm$/, meta: { title: 'Confirm your booking' }, index: false },
  {
    pattern: /^\/book\/[^/]+\/[^/]+$/,
    meta: { title: 'Choose an appointment time', description: 'Pick a time and book this pharmacy service online.' },
    index: true,
  },
  {
    pattern: /^\/book\/[^/]+$/,
    meta: { title: 'Book a pharmacy service', description: 'See the services this pharmacy offers and book an appointment online.' },
    index: true,
  },
  {
    pattern: /^\/shop\/[^/]+$/,
    meta: { title: 'Pharmacy shop', description: 'Browse products from this pharmacy, with local delivery or collection.' },
    index: true,
  },
  { pattern: /^\/consult\//, meta: { title: 'Video consultation' }, index: false },
]

/** Private app areas: tab title only, never indexed. Longest prefix wins. */
const PRIVATE_TITLES: Array<[string, string]> = [
  ['/login', 'Sign in'],
  ['/me/login', 'Personal sign in'],
  ['/me', 'My account'],
  ['/patient/login', 'Patient sign in'],
  ['/patient/register', 'Create a patient account'],
  ['/patient', 'My appointments'],
  ['/locum', 'Locum portal'],
  ['/registers/cd', 'CD Register'],
  ['/registers/rp', 'RP Log'],
  ['/registers/returns', 'Patient Returns'],
  ['/registers/scan', 'AI Scan'],
  ['/registers', 'Registers'],
  ['/settings', 'Settings'],
  ['/outreach', 'Pharmacy Outreach'],
  ['/patient-safety', 'Patient Safety'],
  ['/payments', 'Payments'],
  ['/shop-admin', 'Shop admin'],
  ['/services/claims', 'NHS Claims'],
  ['/services/111-referrals', 'NHS 111 Referrals'],
  ['/services', 'Services'],
  ['/appointments', 'Appointments'],
  ['/patients', 'Patients'],
  ['/logs', 'Logs'],
  ['/video', 'Video Consults'],
  ['/messaging/network', 'Pharmacy Network'],
  ['/messaging', 'Messaging'],
  ['/notes', 'Handover Notes'],
  ['/sops', 'SOPs'],
  ['/deliveries', 'Deliveries'],
  ['/driver', 'My Deliveries'],
  ['/peps', 'PEPS'],
  ['/shifts', 'Shifts'],
  ['/care-homes', 'Care Homes'],
]

export function getPageMeta(pathname: string): PageMeta {
  const path = pathname !== '/' ? pathname.replace(/\/+$/, '') : pathname

  const page = PUBLIC_PAGES.find((p) => p.path === path)
  if (page) return { title: page.title, description: page.description, index: true }

  const dynamic = DYNAMIC_PUBLIC.find((d) => d.pattern.test(path))
  if (dynamic) return { ...dynamic.meta, index: dynamic.index }

  if (path === '/') return { title: 'Dashboard', index: false }

  let best: [string, string] | undefined
  for (const entry of PRIVATE_TITLES) {
    const [prefix] = entry
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best[0].length)) {
      best = entry
    }
  }
  return { title: best?.[1] ?? SITE_NAME, index: false }
}

export function formatTitle(title: string): string {
  return title === SITE_NAME ? DEFAULT_TITLE : `${title} | ${SITE_NAME}`
}
