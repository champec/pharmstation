import { createServer, defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/** Emits sitemap.xml from the public page list in src/seo/routeMeta.ts. */
function sitemap(): Plugin {
  return {
    name: 'pharmstation-sitemap',
    apply: 'build',
    async generateBundle() {
      // Load the app's page list through Vite so the config doesn't pull app source into its own type-check
      const server = await createServer({ configFile: false, root: __dirname, server: { middlewareMode: true }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
      let pages: Array<{ path: string }>
      let siteUrl: string
      try {
        const mod = await server.ssrLoadModule('/src/seo/routeMeta.ts')
        pages = mod.PUBLIC_PAGES
        siteUrl = mod.SITE_URL
      } finally {
        await server.close()
      }
      const urls = pages.map((page) => `  <url><loc>${siteUrl}${page.path}</loc></url>`).join('\n')
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
