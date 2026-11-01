// The holiday photos (one per event in lib/events.ts). Real, freely licensed photographs from Wikimedia Commons
// (public domain / CC0 only, so nothing is share-alike), self-hosted under /seasonal/ so no outside host is contacted
// and a school filter that blocks Commons changes nothing. `bun run build:seasonal` downloads each ORIGINAL, checks
// its sha1 against the one recorded here and writes `<id>.webp` (1920 px, the new tab) + `<id>-sm.webp` (960 px,
// the Store/Watch banners and the wallpaper swatch). Pure data: scripts/build-seasonal.ts imports it.
//
// Changing a photo: pick one on commons.wikimedia.org (public domain or CC0), put its file name + sha1 here, run the
// script, commit the two webp files. Credits are shown in Customize, so keep `author`/`license` exact.

export interface SeasonalPhoto {
  /** = the event id in lib/events.ts, and the file name under /seasonal/ */
  id: 'halloween' | 'thanksgiving' | 'winter' | 'newyear'
  /** the file on Wikimedia Commons (without "File:") */
  file: string
  /** sha1 of the original, as Commons reports it (the script refuses anything else) */
  sha1: string
  author: string
  license: 'Public domain' | 'CC0'
  /** CSS background-position: keeps the subject clear of the search bar in the middle */
  position: string
  /** the photo is dark enough for white text on its own; otherwise the page darkens it a little more */
  dark: boolean
}

export const SEASONAL_PHOTOS: SeasonalPhoto[] = [
  { id: 'halloween', file: 'Jack-O-Lantern at night.jpg', sha1: 'd98746bc74a962623dd728ba68846e775a7e3e39', author: 'Alabama Extension', license: 'CC0', position: '50% 75%', dark: true },
  { id: 'thanksgiving', file: 'Fall foliage in Custer Gallatin National Forest near Yellowstone (50425001591).jpg', sha1: 'ec8769d37c996141924a9f2fd9ba4da24b427a6e', author: 'Yellowstone National Park', license: 'Public domain', position: '50% 50%', dark: false },
  { id: 'winter', file: 'Snowy Night, Forest, Dunes, and Cleveland Peak (53406270337).jpg', sha1: '618de259b2cfaadf2f60473be2932129b614aa6f', author: 'Great Sand Dunes National Park and Preserve', license: 'Public domain', position: '50% 60%', dark: true },
  { id: 'newyear', file: 'Bratislava New Year Fireworks.jpg', sha1: 'e81bf88405b447c4ba811a5b7ae3abca30cafffa', author: 'Ondrejk', license: 'Public domain', position: '50% 40%', dark: false },
]

export const photoPage = (p: SeasonalPhoto) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.file.replaceAll(' ', '_'))}`
