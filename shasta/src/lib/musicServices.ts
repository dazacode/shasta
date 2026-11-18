// The music, radio and podcast sites Shasta knows by address. One list, used to decide that what plays is music (even in a <video>,
// which several of these use) and to give the player the right behaviour and the right honest tips (shasuta/musicNotes.ts).
// Only the address, the name and a few facts live here; everything else is detected from the page while it plays.

export interface MusicService {
  id: string
  name: string
  /** an address matches itself and its subdomains */
  hosts: string[]
  /** the page puts "Artist - Title" in the title and the uploader as the artist (SoundCloud and the like) */
  titleHasArtist?: boolean
  /** spoken word: no lyrics, no covers */
  spoken?: boolean
  /** live radio: no position, no previous, no lyrics */
  radio?: boolean
}

export const SERVICES: MusicService[] = [
  { id: 'youtube-music', name: 'YouTube Music', hosts: ['music.youtube.com'] },
  { id: 'spotify', name: 'Spotify', hosts: ['open.spotify.com', 'play.spotify.com'] },
  { id: 'apple-music', name: 'Apple Music', hosts: ['music.apple.com'] },
  { id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com'], titleHasArtist: true },
  { id: 'tidal', name: 'TIDAL', hosts: ['tidal.com'] },
  { id: 'deezer', name: 'Deezer', hosts: ['deezer.com'] },
  { id: 'amazon-music', name: 'Amazon Music', hosts: ['music.amazon.com', 'music.amazon.co.uk', 'music.amazon.de', 'music.amazon.co.jp', 'music.amazon.ca'] },
  { id: 'pandora', name: 'Pandora', hosts: ['pandora.com'], radio: true },
  { id: 'bandcamp', name: 'Bandcamp', hosts: ['bandcamp.com'] },
  { id: 'audiomack', name: 'Audiomack', hosts: ['audiomack.com'], titleHasArtist: true },
  { id: 'mixcloud', name: 'Mixcloud', hosts: ['mixcloud.com'] },
  { id: 'napster', name: 'Napster', hosts: ['napster.com'] },
  { id: 'qobuz', name: 'Qobuz', hosts: ['qobuz.com'] },
  { id: 'yandex-music', name: 'Yandex Music', hosts: ['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by'] },
  { id: 'jiosaavn', name: 'JioSaavn', hosts: ['jiosaavn.com'] },
  { id: 'gaana', name: 'Gaana', hosts: ['gaana.com'] },
  { id: 'anghami', name: 'Anghami', hosts: ['anghami.com'] },
  { id: 'boomplay', name: 'Boomplay', hosts: ['boomplay.com'] },
  { id: 'audius', name: 'Audius', hosts: ['audius.co'] },
  { id: 'jamendo', name: 'Jamendo', hosts: ['jamendo.com'] },
  { id: 'lastfm', name: 'Last.fm', hosts: ['last.fm'] },
  { id: 'nts', name: 'NTS Radio', hosts: ['nts.live'], radio: true },
  { id: 'tunein', name: 'TuneIn', hosts: ['tunein.com'], radio: true },
  { id: 'iheart', name: 'iHeartRadio', hosts: ['iheart.com'], radio: true },
  { id: 'radio-garden', name: 'Radio Garden', hosts: ['radio.garden'], radio: true },
  { id: 'radio-net', name: 'radio.net', hosts: ['radio.net'], radio: true },
  { id: 'siriusxm', name: 'SiriusXM', hosts: ['siriusxm.com'], radio: true },
  { id: 'apple-podcasts', name: 'Apple Podcasts', hosts: ['podcasts.apple.com'], spoken: true },
  { id: 'google-podcasts', name: 'Podcasts', hosts: ['podcasts.google.com'], spoken: true },
  { id: 'pocket-casts', name: 'Pocket Casts', hosts: ['pocketcasts.com'], spoken: true },
  { id: 'castbox', name: 'Castbox', hosts: ['castbox.fm'], spoken: true },
  { id: 'spreaker', name: 'Spreaker', hosts: ['spreaker.com'], spoken: true },
]

const norm = (host: string) => host.toLowerCase().replace(/^www\./, '')

/** The service an address belongs to (it or a subdomain of it), or null. */
export function serviceForHost(host: string): MusicService | null {
  const h = norm(host)
  if (!h) return null
  return SERVICES.find((s) => s.hosts.some((d) => h === d || h.endsWith(`.${d}`))) ?? null
}

/** Every address, for the music-or-video rule. */
export const MUSIC_HOSTS: string[] = SERVICES.flatMap((s) => s.hosts)
