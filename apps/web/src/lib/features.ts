/**
 * Feature switches set at build time (Vercel env vars).
 *
 * NHS services stay off until NHS approval (pen test funding). While off,
 * NHS services in the library show as "Coming soon" and can't be added or
 * delivered. Set VITE_NHS_SERVICES_ENABLED=true to turn them on.
 */
export const NHS_SERVICES_ENABLED = import.meta.env.VITE_NHS_SERVICES_ENABLED === 'true'
