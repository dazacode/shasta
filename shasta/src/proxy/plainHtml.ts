// jsDelivr serves every .html file from a GitHub repo or npm package as text/plain (on purpose: it is a CDN, not a
// web host), so a tab opened on one shows source code. Game libraries (gn-math's games, after gn-math.dev went
// offline) live there, so a page NAVIGATION to such a file is treated as the HTML it is. Only that host, only
// .html/.htm, only text/plain: anything else keeps the type the server sent.
const PLAIN_HTML_HOSTS = new Set(['cdn.jsdelivr.net', 'fastly.jsdelivr.net', 'gcore.jsdelivr.net', 'testingcf.jsdelivr.net', 'cdn.statically.io'])

export function servePlainAsHtml(url: URL, destination: string, contentType: string | null): boolean {
  if (destination !== 'document' && destination !== 'iframe') return false
  if (!PLAIN_HTML_HOSTS.has(url.hostname)) return false
  if (!/^\/(gh|npm)\//.test(url.pathname) || !/\.html?$/i.test(url.pathname)) return false
  return /^\s*text\/plain\b/i.test(contentType ?? '')
}
