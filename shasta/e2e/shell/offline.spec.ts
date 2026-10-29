// The offline application shell in a real browser: first install, cold start and refresh with the server gone,
// recovery (Wisp reconnects, browsing works), a failed update that leaves the installed version working, a good
// update, cleanup of the old version, and "Clear offline data".
//
// It runs its own copy of the test server (ports 4192/4193) so it can kill it, and a persistent browser profile so
// a relaunch really starts from what is stored on disk.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { activeTab, go, loadingBar, omnibox } from '../support/helpers'

const PORT = 4192
const APP = `http://localhost:${PORT}`
const SITE = `http://localhost:${PORT + 1}`

let server: ChildProcess | null = null
let profile = ''
let ctx: BrowserContext | null = null

async function startServer() {
  server = spawn('bun', ['e2e/support/server.mjs'], { env: { ...process.env, SHELL_PORT: String(PORT), SITE_PORT: String(PORT + 1) }, stdio: 'ignore' })
  await expect.poll(async () => fetch(`${APP}/index.html`).then((r) => r.ok).catch(() => false), { timeout: 15_000 }).toBe(true)
}

async function stopServer() {
  if (!server) return
  const s = server
  server = null
  await new Promise<void>((resolve) => {
    s.once('exit', () => resolve())
    s.kill('SIGKILL')
  })
  await expect.poll(async () => fetch(`${APP}/index.html`).then(() => true).catch(() => false)).toBe(false)
}

async function launch(offline = false): Promise<Page> {
  ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 }, offline })
  return ctx.pages()[0] ?? (await ctx.newPage())
}

async function relaunch(offline: boolean) {
  await ctx?.close()
  return launch(offline)
}

/** Waits for the browser interface itself (not the proxy engine, which cannot connect offline). */
async function shellUp(page: Page) {
  await expect(omnibox(page)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('tab').first()).toBeVisible()
}

/** fakeDeploy() appends `<!-- version -->` after </html>; the parser puts it on the document itself */
const servedVersion = (page: Page) => page.evaluate(() => [...document.childNodes].find((n) => n.nodeType === Node.COMMENT_NODE)?.textContent?.trim() ?? 'original')

/** the connection banner (a tab's own error page is an alert too) */
const banner = (page: Page) => page.getByRole('alert').filter({ hasText: /^(You're offline\. Shasta|Can't reach the proxy|Connection to the proxy|Starting the proxy|The proxy engine)/ })

const shellCaches = (page: Page) => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('shasta-shell-')).sort())

/** URLs of the core group that are not in the active version's cache yet. */
const missingCore = (page: Page, cacheName?: string) =>
  page.evaluate(async (wanted) => {
    const name = wanted ?? (await caches.keys()).find((k) => k.startsWith('shasta-shell-'))
    if (!name) return ['(no cache)']
    const cache = await caches.open(name)
    const manifest = await (await cache.match('/offline-manifest.json'))?.json()
    if (!manifest) return ['(no manifest)']
    const out: string[] = []
    for (const f of manifest.files) if (f.group === 'core' && !(await cache.match(f.url))) out.push(f.url)
    return out
  }, cacheName)

/** Asks the browser to check sw.js and reports what became of the new worker. */
const tryUpdate = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        void navigator.serviceWorker.getRegistration().then((reg) => {
          reg!.addEventListener('updatefound', () => {
            const w = reg!.installing!
            w.addEventListener('statechange', () => {
              if (w.state === 'installed' || w.state === 'redundant') resolve(w.state)
            })
          })
          reg!.update().catch((e) => resolve(`update() failed: ${e}`))
        })
      }),
  )

async function visitFixture(page: Page) {
  await go(page, `${SITE}/`)
  await expect(activeTab(page)).toHaveAttribute('aria-label', /^Fixture Home/, { timeout: 30_000 })
  await expect(loadingBar(page)).toHaveCount(0, { timeout: 30_000 })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  profile = mkdtempSync(path.join(tmpdir(), 'shasta-offline-'))
  await startServer()
})

test.afterAll(async () => {
  await ctx?.close().catch(() => undefined)
  await stopServer()
  rmSync(profile, { recursive: true, force: true })
})

test('first visit installs the worker and keeps the whole shell offline', async () => {
  const page = await launch()
  await page.goto(`${APP}/`)
  await shellUp(page)
  await expect(page.getByRole('alert').filter({ hasText: /Starting the proxy engine/ })).toHaveCount(0, { timeout: 30_000 })
  // Scramjet still routes through the same worker
  await visitFixture(page)
  // the background download (starts a few seconds after boot) fills the versioned cache
  await expect.poll(() => missingCore(page), { timeout: 60_000 }).toEqual([])
  expect(await shellCaches(page)).toHaveLength(1)
  // nothing optional was downloaded without being asked for
  const ai = await page.evaluate(async () => {
    const name = (await caches.keys()).find((k) => k.startsWith('shasta-shell-'))!
    return (await (await caches.open(name)).keys()).filter((r) => new URL(r.url).pathname.startsWith('/ort/')).length
  })
  expect(ai).toBe(0)
})

test('cold start and refresh with the server gone', async () => {
  await stopServer()
  const page = await relaunch(true)
  const failed: string[] = []
  page.on('requestfailed', (r) => failed.push(new URL(r.url()).pathname))
  await page.goto(`${APP}/`)
  await shellUp(page)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  await expect(banner(page)).toContainText("You're offline. Shasta itself keeps working")
  // the full interface: settings open and say the copy is ready
  await go(page, 'shasta://settings#offline')
  await expect(page.getByText(/^Ready\. Shasta/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Opening websites always needs an internet connection/)).toBeVisible()

  await page.reload()
  await shellUp(page)
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)
  // nothing Shasta needs had to come from the network (only the live parts: Wisp, the Store API, sw.js checks)
  const shellFailures = failed.filter((p) => /^\/(assets|scramjet|controller|ort)\/|^\/(index\.html)?$/.test(p))
  expect(shellFailures).toEqual([])
})

test('recovers when the connection comes back: Wisp reconnects and websites load', async () => {
  await startServer()
  const page = ctx!.pages()[0]
  await ctx!.setOffline(false)
  await expect(banner(page)).toHaveCount(0, { timeout: 45_000 })
  await visitFixture(page)
})

test('a failed update keeps the installed version; a working one takes over, open windows keep theirs until restart', async () => {
  const page = ctx!.pages()[0]
  const before = await shellCaches(page)

  // a broken deploy: the new index.html cannot be downloaded
  await fetch(`${APP}/__ctl/deploy?version=e2e-next`)
  await fetch(`${APP}/__ctl/fail?path=/index.html`)
  expect(await tryUpdate(page)).toBe('redundant')
  expect(await shellCaches(page)).toEqual(expect.arrayContaining(before))
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(false)
  // the installed version still starts with no network
  await stopServer()
  await ctx!.setOffline(true)
  await page.reload()
  await shellUp(page)
  expect(await servedVersion(page)).toBe('original')

  // the deploy is fixed
  await startServer()
  await ctx!.setOffline(false)
  await fetch(`${APP}/__ctl/deploy?version=e2e-next`)
  expect(await tryUpdate(page)).toBe('installed')
  // Scramjet's worker takes over at once; this window is not reloaded under the person's feet
  await expect(page.getByText('Shasta has been updated. Restart to use the new version.')).toBeVisible({ timeout: 10_000 })
  expect(await servedVersion(page)).toBe('original')
  // the window still running the old version can open parts of it it had not loaded yet (from the kept copy)
  await go(page, 'shasta://history')
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Restart' }).click()])
  await shellUp(page)
  expect(await servedVersion(page)).toBe('e2e-next')
  // the new version plus the previous one (kept for windows that were open), nothing older
  expect(await shellCaches(page)).toEqual([before[0], 'shasta-shell-e2e-next'].sort())
  expect(await missingCore(page, 'shasta-shell-e2e-next')).toEqual([])

  // the new version starts offline too
  await stopServer()
  await ctx!.setOffline(true)
  await page.reload()
  await shellUp(page)
  expect(await servedVersion(page)).toBe('e2e-next')
})

test('"Clear offline data" removes the copy and Shasta keeps working online', async () => {
  await startServer()
  // back to the real build so the worker and the server agree again
  const page = await relaunch(false)
  await page.goto(`${APP}/`)
  await shellUp(page)
  // the browser notices the server is back on the original build; wait until that version has taken over
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { version } = await (await fetch('/offline-manifest.json', { cache: 'no-store' })).json()
          const reg = await navigator.serviceWorker.getRegistration()
          return (await caches.keys()).includes(`shasta-shell-${version}`) && !reg?.installing && !reg?.waiting
        }),
      { timeout: 30_000 },
    )
    .toBe(true)
  await go(page, 'shasta://settings#offline')
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('Offline copy removed.')).toBeVisible()
  expect(await shellCaches(page)).toEqual([])
  // and it stays cleared: no background download comes back
  await page.reload()
  await shellUp(page)
  await page.waitForTimeout(6000)
  expect(await shellCaches(page)).toEqual([])
})

test('"Download for offline use" with progress, and the AI runtime only when asked for', async () => {
  const page = ctx!.pages()[0]
  await go(page, 'shasta://settings#offline')
  await expect(page.getByText('Not downloaded yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Download for offline use' }).click()
  await expect(page.getByText('Shasta is ready to use offline.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/^Ready\. Shasta/)).toBeVisible()
  expect(await missingCore(page)).toEqual([])
  const ortFiles = () =>
    page.evaluate(async () => {
      const name = (await caches.keys()).find((k) => k.startsWith('shasta-shell-'))!
      return (await (await caches.open(name)).keys()).filter((r) => new URL(r.url).pathname.startsWith('/ort/')).length
    })
  expect(await ortFiles()).toBe(0)

  // opting in downloads it (27 MB) with a progress bar; no AI model is fetched for this
  const models: string[] = []
  page.on('request', (r) => r.url().includes('/ai-models/') && models.push(r.url()))
  await page.getByRole('switch', { name: 'Include the AI runtime' }).click()
  const bar = page.getByRole('progressbar', { name: 'Offline download' })
  await expect(bar).toBeVisible()
  await expect(bar).toHaveCount(0, { timeout: 60_000 })
  await expect(page.getByRole('alert').filter({ hasText: /interrupted|no room/ })).toHaveCount(0)
  expect(await ortFiles()).toBe(2)
  expect(models).toEqual([])

  // opting out removes it again
  await page.getByRole('switch', { name: 'Include the AI runtime' }).click()
  await expect.poll(ortFiles).toBe(0)
  expect(await missingCore(page)).toEqual([])
})
