import { createServer, defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Emits sitemap.xml from the public page list in src/seo/routeMeta.ts. */
function sitemap(): Plugin {
  let mode = 'production'
  return {
    name: 'pharmstation-sitemap',
    apply: 'build',
    configResolved(config) {
      mode = config.mode
    },
    async generateBundle() {
      const env = { ...loadEnv(mode, __dirname, 'VITE_'), ...process.env }
      // Load the app's page list through Vite so the config doesn't pull app source into its own type-check
      const server = await createServer({ configFile: false, root: __dirname, server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
      let pages: Array<{ path: string; lastmod?: string }>
      let siteUrl: string
      try {
        const mod = await server.ssrLoadModule('/src/seo/routeMeta.ts')
        // Every public pharmacy, bookable service and shop product, read with the public key.
        const dynamic = await server.ssrLoadModule('/src/seo/dynamicSitemap.ts')
        const live = await dynamic.loadDynamicSitemap(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
        pages = [...mod.PUBLIC_PAGES, ...live]
        siteUrl = mod.SITE_URL
      } finally {
        await server.close()
      }
      const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const urls = pages
        .map((page) => `  <url><loc>${escape(siteUrl + page.path)}</loc>${page.lastmod ? `<lastmod>${page.lastmod}</lastmod>` : ''}</url>`)
        .join('\n')
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), sitemap()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
  },
})
