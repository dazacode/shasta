// Bigger covers from the addresses music sites give for small ones. Several services serve one picture at many sizes and put the size in
// the address (the ideas are what Last.fm's Web Scrobbler does per site: SoundCloud's -t50x50, Pandora's 90W_90H, Apple's 100x100bb).
// Returns the addresses to try, biggest guess first, ending with the original, so a guess that does not exist falls back safely.

/** Candidate addresses for a cover, best first, always ending with `url` itself. */
export function artworkCandidates(url: string): string[] {
  const out: string[] = []
  const add = (u: string) => {
    if (u !== url && !out.includes(u)) out.push(u)
  }
  let host = ''
  try {
    host = new URL(url, 'https://x.invalid').hostname
  } catch {
    return [url]
  }
  // SoundCloud: ...-t50x50.jpg, -t120x120, -t200x200, -large, -t300x300 -> -t500x500
  if (/sndcdn\.com$/.test(host)) add(url.replace(/-(?:t\d+x\d+|large|badge|small|tiny|crop|original)\.(jpg|jpeg|png|webp)(\?.*)?$/i, '-t500x500.$1$2'))
  // Spotify: the 64 px and 300 px image ids become the 640 px one
  if (/scdn\.co$/.test(host)) add(url.replace(/(\/image\/)ab67616d0000(?:4851|1e02)/i, '$1ab67616d0000b273').replace(/(\/image\/)ab67616d00004851/i, '$1ab67616d0000b273'))
  // Apple (mzstatic): .../100x100bb.jpg -> 600x600bb.jpg
  if (/mzstatic\.com$/.test(host)) add(url.replace(/\/\d+x\d+(bb|cc|sr)?(-\d+)?\.(jpg|png|webp)(\?.*)?$/i, '/600x600bb.$3'))
  // Pandora: ...90W_90H... -> 500W_500H
  if (/pandora\.com$|pandoracdn\.com$|p-cdn\.us$/.test(host)) add(url.replace(/\d+W_\d+H/i, '500W_500H'))
  // Deezer: .../56x56-000000-80-0-0.jpg -> 500x500-...
  if (/dzcdn\.net$/.test(host)) add(url.replace(/\/(\d+)x(\d+)(-[\d-]+)?\.(jpg|png|webp)$/i, '/500x500$3.$4'))
  // Google-hosted (YouTube Music): =w60-h60-l90-rj -> =w544-h544-l90-rj
  if (/googleusercontent\.com$|ggpht\.com$/.test(host)) add(url.replace(/=w\d+-h\d+/i, '=w544-h544'))
  return [...out, url]
}
