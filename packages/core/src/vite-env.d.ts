// ============================================
// Minimal Vite `import.meta.env` typing.
//
// The stores call Supabase edge functions with
// `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`, which the
// consuming apps (Vite) type via `vite/client`. This ambient declaration
// makes the package's own `tsc --noEmit` pass without depending on Vite.
// ============================================

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly [key: string]: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
