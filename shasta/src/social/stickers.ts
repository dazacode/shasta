// The curated stickers: Noto Emoji SVGs (Google, Apache-2.0 per its README; the repo's OFL text ships too), self-hosted
// under public/social/stickers/ (source note in SOURCE.txt there, licences in /licenses/). Profiles, reactions and
// guestbook notes only ever carry these ids; the server drops anything else.
import { BASE } from '@/lib/edition'

export interface Sticker {
  id: string
  label: string
  src: string
}

const LIST: [id: string, label: string][] = [
  ['grin', 'Big grin'], ['smile', 'Smile'], ['laugh', 'Laughing'], ['cool', 'Cool'], ['party-face', 'Party face'], ['starstruck', 'Star-struck'],
  ['thinking', 'Thinking'], ['sleepy', 'Sleepy'], ['wow', 'Wow'], ['hug', 'Hug'], ['thumbs-up', 'Thumbs up'], ['clap', 'Clapping'],
  ['hooray', 'Hooray'], ['wave', 'Wave'], ['peace', 'Peace'], ['strong', 'Strong'], ['heart', 'Red heart'], ['blue-heart', 'Blue heart'],
  ['green-heart', 'Green heart'], ['yellow-heart', 'Yellow heart'], ['purple-heart', 'Purple heart'], ['star', 'Star'], ['fire', 'Fire'],
  ['sparkles', 'Sparkles'], ['rainbow', 'Rainbow'], ['sun', 'Sun'], ['moon', 'Moon'], ['blossom', 'Blossom'], ['sunflower', 'Sunflower'],
  ['pizza', 'Pizza'], ['cookie', 'Cookie'], ['bubble-tea', 'Bubble tea'], ['controller', 'Game controller'], ['trophy', 'Trophy'],
  ['music', 'Music'], ['art', 'Art'], ['books', 'Books'], ['rocket', 'Rocket'], ['cat', 'Cat'], ['dog', 'Dog'], ['panda', 'Panda'],
  ['fox', 'Fox'], ['frog', 'Frog'], ['unicorn', 'Unicorn'], ['space-invader', 'Space invader'], ['robot', 'Robot'], ['gift', 'Gift'],
  ['confetti', 'Confetti'],
]

export const STICKERS: readonly Sticker[] = LIST.map(([id, label]) => ({ id, label, src: `${BASE}social/stickers/${id}.svg` }))

const byId = new Map(STICKERS.map((s) => [s.id, s]))
export const stickerById = (id: string | null | undefined): Sticker | null => (id ? (byId.get(id) ?? null) : null)
export const isSticker = (id: unknown): id is string => typeof id === 'string' && byId.has(id)

/** a few to offer first as quick reactions */
export const QUICK_REACTIONS = ['heart', 'laugh', 'fire', 'hooray', 'controller', 'hug'] as const
