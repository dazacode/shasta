// The media hub on the real music platforms: each one plays a track through the proxy, and Shasta must pick it up
// generically (no per-site code): from the page's navigator.mediaSession when it describes its media (else the tab's
// title), from its <audio>/<video> element, also one never added to the page (Deezer). The toolbar hub must say
// "Playing: <title>" and the "Now playing" banner must have shown the same title. Needs the network; a failure can be
// the site (layout, consent wall, region), so read the screenshot before blaming Shasta. Run: bun run test:compat -- media
import { test, expect, type FrameLocator, type Page } from '@playwright/test'
import { go, openShasta, pageFrame } from '../support/helpers'

test.use({
  baseURL: 'http://localhost:4173',
  locale: 'en-US',
  // the sites that start on their own (YouTube) do so in a real browser after the click in the omnibox
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
})

interface Platform {
  name: string
  url: string
  /** consent banners / sign-in nags that cover the play button (each tried once, if present) */
  dismiss?: RegExp[]
  /** presses play; omitted = the page starts by itself */
  play?: (f: FrameLocator) => Promise<void>
  /** a reason it cannot be tested anonymously */
  fixme?: string
}

const byName = (name: RegExp) => (f: FrameLocator) => f.getByRole('button', { name }).first().click({ timeout: 15_000 })

const PLATFORMS: Platform[] = [
  { name: 'YouTube Music', url: 'https://music.youtube.com/watch?v=Z85lxckrtzg' },
  { name: 'YouTube', url: 'https://www.youtube.com/watch?v=sOnqjkJTMaA' },
  { name: 'Apple Music (preview)', url: 'https://music.apple.com/us/album/thriller/269572838?i=269573364', play: byName(/^Preview$/i) },
  { name: 'TIDAL (preview)', url: 'https://tidal.com/browse/track/1781887', play: byName(/^Play$/) },
  // its bottom-bar "Play current" stays disabled until something was played: use the big one next to the title
  {
    name: 'SoundCloud',
    url: 'https://soundcloud.com/forss/flickermood',
    dismiss: [/^Continue to Website$/],
    play: async (f) => {
      await f.locator('.modal__closeButton').click({ timeout: 4000 }).catch(() => {})
      await f.locator('a.sc-button-play').first().click({ timeout: 15_000 })
    },
    fixme: 'playback itself stalls through the proxy (2026-11-01: stream requests answer 400/404, the player stays at 0:00, also in real Chrome)',
  },
  // Bandcamp and Jamendo set no media session: the tab's title names the track
  { name: 'Bandcamp', url: 'https://c418.bandcamp.com/track/sweden', dismiss: [/^Accept necessary only$/], play: (f) => f.locator('.playbutton').first().click({ timeout: 15_000 }) },
  // a detached <audio> that starts by `autoplay`, never play(); the anonymous preview is 30 s
  { name: 'Deezer', url: 'https://www.deezer.com/en/track/3135556', dismiss: [/^Refuse$/], play: byName(/^Listen$/) },
  { name: 'Jamendo', url: 'https://www.jamendo.com/track/1884527', play: (f) => f.locator('button.js-play-me').first().click({ timeout: 15_000 }) },
  { name: 'Spotify', url: 'https://open.spotify.com/track/2LlQb7Uoj1kKyGhlkBf9aC', fixme: 'playing needs a signed-in account (and Widevine, which test Chromium lacks)' },
]

/** The page's own media session title, read from the proxied frame. */
async function sessionTitle(page: Page): Promise<string> {
  for (const f of page.frames()) {
    if (f.parentFrame() !== page.mainFrame() || !f.url().includes('/~/')) continue
    const t = await f.evaluate(() => navigator.mediaSession?.metadata?.title ?? '').catch(() => '')
    if (t) return t
  }
  return ''
}

for (const p of PLATFORMS) {
  test(`media hub detects ${p.name}`, async ({ page }) => {
    test.fixme(!!p.fixme, p.fixme)
    test.setTimeout(120_000)
    // every banner that appears, as it appears (it leaves after a few seconds, often before the checks below)
    await page.addInitScript(() => {
      if (window.top !== window) return
      const seen: string[] = ((window as unknown as { __banners: string[] }).__banners = [])
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('[role=status]')) {
          const t = el.textContent ?? ''
          if (t.startsWith('Now playing') && !seen.includes(t)) seen.push(t)
        }
      }).observe(document, { childList: true, subtree: true, characterData: true })
    })
    await openShasta(page)
    await go(page, p.url)
    const f = pageFrame(page)
    // let the site settle (consent banners arrive late)
    await page.waitForTimeout(8000)
    for (const name of p.dismiss ?? []) await f.getByRole('button', { name }).first().click({ timeout: 4000 }).catch(() => {})
    if (p.play) await p.play(f)

    // Shasta found it playing, with a real name (not the "media" placeholder)...
    const hub = page.getByRole('toolbar', { name: 'Browser toolbar' }).getByRole('button', { name: /^Playing: / })
    await expect(hub).toBeVisible({ timeout: 40_000 })
    const shown = ((await hub.getAttribute('aria-label')) ?? '').replace(/^Playing: /, '')
    expect(shown).not.toBe('media')
    // ...the page's own title when it described the track...
    const described = await sessionTitle(page)
    if (described) expect(shown).toBe(described)
    // ...and the Now playing banner announced it
    await expect.poll(() => page.evaluate(() => (window as unknown as { __banners: string[] }).__banners), { timeout: 10_000 }).toContainEqual(expect.stringContaining(shown))
  })
}
