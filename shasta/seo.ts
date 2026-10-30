// Crawler-facing signals that bias school web filters toward categorizing Shasta as "Education"
// instead of "uncategorized / proxy / web hosting / filtering-bypass".
//
// Why this exists: vendor classifiers (GoGuardian, Lightspeed, ContentKeeper, Cisco/Talos, zvelo,
// BrightCloud, FortiGuard ...) fetch `/` WITHOUT running JavaScript. Shasta's own HTML is a blank
// SPA shell (`<div id="root"></div>`), so those crawlers see no text at all and never guess a topic.
// The education copy therefore lives in index.html (#root) and this plugin keeps every absolute URL
// (canonical, og:url, sitemap) pointed at the origin the site is actually served from.
//
// Set VITE_SITE_ORIGIN at build time to the real domain (e.g. https://shasta.example.org) so every
// signal matches the deploy; it falls back to the Pages host used in private development. See
// docs/unblocking.md for the whole play.
import type { Plugin } from 'vite'

const DEFAULT_ORIGIN = 'https://shasta-dtg.pages.dev'

export function seoPlugin({ origin }: { origin?: string } = {}): Plugin {
  const site = (origin ?? process.env.VITE_SITE_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, '')

  const robots = `User-agent: *
Allow: /

Sitemap: ${site}/sitemap.xml
`

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${site}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`

  // ads.txt, only when this build ships an AdSense publisher id: the standard Google line proves the account is
  // authorised to sell this domain's inventory. `ca-pub-1234` in settings -> `pub-1234` here.
  const pub = (process.env.VITE_ADSENSE_CLIENT ?? '').trim().replace(/^ca-/, '')
  const adsTxt = pub ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` : ''

  return {
    name: 'shasta-seo',
    // the %SITE_ORIGIN% token in index.html (canonical, og:url, JSON-LD @id)
    transformIndexHtml: (html) => html.replaceAll('%SITE_ORIGIN%', site),
    // robots.txt + sitemap.xml in the build output; fixed file names, never content-hashed
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots })
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap })
      if (adsTxt) this.emitFile({ type: 'asset', fileName: 'ads.txt', source: adsTxt })
    },
    // and in dev, so both can be checked without a full build
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url !== '/robots.txt' && url !== '/sitemap.xml' && !(url === '/ads.txt' && adsTxt)) return next()
        res.setHeader('Content-Type', url.endsWith('.xml') ? 'application/xml' : 'text/plain')
        res.end(url === '/robots.txt' ? robots : url === '/ads.txt' ? adsTxt : sitemap)
      })
    },
  }
}
