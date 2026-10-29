// The whole Store lifecycle through the real UI, real server and real SQLite: owner -> contributor -> game -> user -> update -> uninstall -> takedown.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { zipSync, strToU8 } from 'fflate'

const SETUP_CODE = 'E2E-SETUP-CODE'

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

const gameZip = (version: string) =>
  Buffer.from(
    zipSync({
      'index.html': strToU8(`<!doctype html><html><head><meta charset="utf-8"><title>Click Quest</title></head><body><h1 id="title">Click Quest ${version}</h1><script src="game.js"></script></body></html>`),
      'game.js': strToU8(`localStorage.setItem('visits', String(Number(localStorage.getItem('visits') || 0) + 1)); localStorage.setItem('save', 'level-3'); document.title = 'Click Quest ${version}'; window.name = 'v${version}';`),
    }),
  )

const nav = (page: Page) => page.getByRole('navigation', { name: 'Store' })

async function newPerson(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto('/')
  await page.getByRole('button', { name: 'Shasta Store' }).first().click()
  await expect(nav(page)).toBeVisible()
  return page
}

/** The recovery-key dialog appears whenever an anonymous account is created. */
async function dismissKey(page: Page) {
  const dlg = page.getByRole('dialog', { name: 'Save your recovery key' })
  await expect(dlg).toBeVisible()
  const key = (await dlg.getByTestId('recovery-key').textContent())!.trim()
  await dlg.getByRole('button', { name: /Skip for now|I've saved it/ }).click()
  await expect(dlg).toBeHidden()
  return key
}

async function openStoreTab(page: Page, section: string) {
  const box = page.getByRole('combobox', { name: 'Address and search bar' })
  await box.click()
  await box.fill(`shasta://store#${section}`)
  await box.press('Enter')
}

async function redeem(page: Page, code: string) {
  await nav(page).getByRole('button', { name: /Account|Guest/ }).click()
  await page.getByLabel('Invite code').fill(code)
  await page.getByRole('button', { name: 'Use code' }).click()
  await dismissKey(page)
}

/** The Library is its own page (shasta://library), reached from the toolbar. */
async function openLibrary(page: Page) {
  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
}

async function openStore(page: Page) {
  // exact: a tab's close button is also named "Close tab … Shasta Store"
  await page.getByRole('button', { name: 'Shasta Store', exact: true }).click()
  await expect(nav(page)).toBeVisible()
}

async function sidebar(page: Page, name: string | RegExp) {
  await nav(page).getByRole('button', { name }).click()
}

test.describe.configure({ mode: 'serial' })

let owner: Page
let contributor: Page
let user: Page
let inviteCode = ''

test('the owner claims the server setup code', async ({ browser }) => {
  owner = await newPerson(browser)
  await redeem(owner, SETUP_CODE)
  await expect(owner.getByText('You are now the Store owner.')).toBeVisible()
  await expect(nav(owner).getByRole('button', { name: 'Manage' })).toBeVisible()
  // the code is single use
  const other = await newPerson(browser)
  await nav(other).getByRole('button', { name: /Account|Guest/ }).click()
  await other.getByLabel('Invite code').fill(SETUP_CODE)
  await other.getByRole('button', { name: 'Use code' }).click()
  await expect(other.getByText(/not valid/)).toBeVisible()
  // a code that fails creates nothing: no account, no recovery key
  await expect(other.getByRole('dialog', { name: 'Save your recovery key' })).toHaveCount(0)
  expect((await other.context().cookies()).some((c) => c.name === 'shasta_session')).toBe(false)
  await other.context().close()
})

test('1. the owner creates an approved contributor invite', async () => {
  await sidebar(owner, 'Manage')
  await owner.getByRole('tab', { name: /Contributors|People/ }).click()
  await owner.getByRole('button', { name: /Invite a contributor/ }).click()
  await owner.getByRole('button', { name: 'Create code' }).click()
  const dlg = owner.getByRole('dialog', { name: 'Invite code ready' })
  inviteCode = (await dlg.locator('code').textContent())!.trim()
  expect(inviteCode).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/)
  await dlg.getByRole('button', { name: 'Done' }).click()
})

test('2-3. the contributor uploads a game and the package is validated', async ({ browser }) => {
  contributor = await newPerson(browser)
  await redeem(contributor, inviteCode)
  await expect(contributor.getByText('You are now an approved contributor.')).toBeVisible()
  await sidebar(contributor, 'Develop')
  await contributor.getByRole('button', { name: 'New app' }).first().click()
  await contributor.getByRole('dialog').getByLabel('App name').fill('Click Quest')
  await contributor.getByRole('button', { name: 'Create draft' }).click()

  await contributor.getByLabel(/Short summary/).fill('Click things, win prizes')
  await contributor.getByLabel(/^Description/).fill('A tiny clicking adventure used to test the Store end to end.')
  await contributor.getByLabel(/^Category/).selectOption({ label: 'Games' })
  await contributor.getByLabel(/^Tags/).fill('clicker, arcade')
  await contributor.getByRole('button', { name: 'Save details' }).click()
  await expect(contributor.getByText(/Saved|saved/).first()).toBeVisible()

  await contributor.getByLabel('Upload icon').setInputFiles({ name: 'icon.png', mimeType: 'image/png', buffer: PNG })
  await contributor.getByLabel('Add screenshots').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG })

  // a bad package is refused with a clear reason before anything is stored
  await contributor.getByLabel(/Version number/).fill('1.0')
  await contributor.getByPlaceholder('Initial release.').fill('Initial release.')
  await contributor.getByRole('button', { name: 'Create draft version' }).click()
  await contributor.getByLabel('Choose a ZIP package').setInputFiles({ name: 'bad.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'index.html': strToU8('<h1>x</h1>'), 'run.php': strToU8('<?php') })) })
  await expect(contributor.getByText(/\.php file/)).toBeVisible()

  await contributor.getByLabel('Choose a ZIP package').setInputFiles({ name: 'game.zip', mimeType: 'application/zip', buffer: gameZip('1.0') })
  await expect(contributor.getByText(/2 files/).first()).toBeVisible()
})

test('4. a contributor without publishing rights submits for review', async () => {
  await contributor.getByRole('button', { name: 'Submit for review' }).click()
  await expect(contributor.getByText(/review/i).first()).toBeVisible()
})

test('the contributor sets up their own storefront', async () => {
  await sidebar(contributor, 'Develop')
  await contributor.getByRole('button', { name: 'My storefront' }).click()
  await expect(contributor.getByText(/0 of 5 done/)).toBeVisible()
  await contributor.getByLabel(/Storefront name/).fill('Alex Games')
  await contributor.getByLabel(/^Tagline/).fill('Tiny games for the classroom')
  await contributor.locator('label:has(input[aria-label="Colour 160"])').click()
  await contributor.getByLabel('Upload logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG })
  await contributor.getByLabel('Upload banner').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: PNG })
  await contributor.getByRole('button', { name: 'Save storefront' }).click()
  await expect(contributor.getByText('Storefront saved.')).toBeVisible()
  await expect(contributor.getByText(/4 of 5 done/)).toBeVisible()
  // the live preview is the real masthead
  await expect(contributor.getByRole('region', { name: 'Live preview' }).getByRole('heading', { name: 'Alex Games', level: 1 })).toBeVisible()
  await contributor.getByRole('button', { name: 'View storefront' }).click()
  await expect(contributor.getByRole('heading', { name: 'Alex Games', level: 1 })).toBeVisible()
  await expect(contributor.getByRole('button', { name: 'Edit storefront' })).toBeVisible()
  await expect(contributor.getByText('Nothing published here yet')).toBeVisible()
})

test('5. the owner approves and the game appears in the store', async () => {
  await sidebar(owner, 'Manage')
  await owner.getByRole('tab', { name: /Review queue/ }).click()
  await expect(owner.getByText('Click Quest')).toBeVisible()
  await owner.getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText(/Nothing is waiting for review/)).toBeVisible()
})

test('6-8. a regular user installs it, sees it in My Library and launches it in an isolated origin', async ({ browser }) => {
  user = await newPerson(browser)
  // the new app shows up on Discover with no rebuild and no reload: live catalog
  await expect(user.getByRole('link', { name: /Click Quest/ }).first()).toBeVisible()
  await user.getByRole('link', { name: /Click Quest/ }).first().click()
  await expect(user.getByRole('heading', { name: 'Click Quest', level: 1 })).toBeVisible()
  await expect(user.getByText('Compatibility & permissions')).toBeVisible()
  // the app lives on the contributor's own storefront
  await user.getByRole('button', { name: 'Open the Alex Games storefront' }).click()
  await expect(user.getByRole('heading', { name: 'Alex Games', level: 1 })).toBeVisible()
  await expect(user.getByRole('link', { name: /Click Quest/ })).toBeVisible()
  await user.getByRole('button', { name: 'Follow', exact: true }).click()
  // no account, no recovery key: following is saved on this device
  await expect(user.getByRole('dialog', { name: 'Save your recovery key' })).toHaveCount(0)
  await expect(user.getByRole('button', { name: 'Following' })).toBeVisible()
  await expect(user.locator('div:has(> dt:has-text("Followers")) > dd')).toHaveText('1')
  await user.getByRole('link', { name: /Click Quest/ }).click()
  await user.getByRole('button', { name: 'Install' }).click()
  await expect(user.getByRole('button', { name: 'Open', exact: true }).first()).toBeVisible()
  expect((await user.context().cookies()).some((c) => c.name === 'shasta_session')).toBe(false)

  // the library survives a refresh (it is in this browser's IndexedDB, not on the server)
  await user.reload()
  await openLibrary(user)
  await expect(user.getByRole('button', { name: /Open Click Quest/ })).toBeVisible()
  await user.getByRole('button', { name: /Open Click Quest/ }).click()

  const frame = user.frameLocator('iframe[title="Click Quest"]')
  await expect(frame.locator('#title')).toHaveText('Click Quest 1.0')
  // isolation: the app is on its own origin and cannot touch Shasta
  const probe = await user.frames().find((f) => f.url().includes('.apps.localhost'))!.evaluate(async () => {
    const out: Record<string, unknown> = { origin: location.origin, save: localStorage.getItem('save'), cookie: document.cookie }
    try { void (parent as Window).document.title; out.parentAccess = 'allowed' } catch { out.parentAccess = 'blocked' }
    out.api = (await fetch('/api/auth/me').catch(() => ({ status: 0 }))).status
    return out
  })
  expect(probe.origin).toMatch(/^http:\/\/[0-9a-f]{20}\.apps\.localhost:4180$/)
  expect(probe.parentAccess).toBe('blocked')
  expect(probe.cookie).toBe('')
  expect(probe.api).toBe(404)
  expect(probe.save).toBe('level-3')
})

test('installed apps have their own addresses: game:// for games, app:// for the rest', async () => {
  const omnibox = user.getByRole('combobox', { name: 'Address and search bar' })
  // the running app is addressed by name, not by some URL on the open web
  await expect(omnibox).toHaveValue('game://click-quest')
  await user.getByRole('button', { name: 'New tab' }).click()
  // not installed: a clear message, nothing is fetched
  await omnibox.fill('game://not-installed')
  await omnibox.press('Enter')
  await expect(user.getByText(/isn't installed on this device/)).toBeVisible()
  // installed apps are suggested by name before any web search
  await omnibox.fill('click qu')
  await expect(user.getByRole('option', { name: /Click Quest/ })).toBeVisible()
  // either scheme finds it, and it focuses the app that is already running instead of loading a second copy
  await omnibox.fill('app://click-quest')
  await omnibox.press('Enter')
  await expect(omnibox).toHaveValue('game://click-quest')
  await expect(user.getByRole('tab', { name: /^Click Quest$/ })).toHaveCount(1)
  await expect(user.frameLocator('iframe[title="Click Quest"]').locator('#title')).toHaveText('Click Quest 1.0')
})

test('a shared link opens the listing for a friend who has never used Shasta', async ({ browser }) => {
  const friend = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await friend.goto('/?app=click-quest')
  await expect(friend.getByRole('heading', { name: 'Click Quest', level: 1 })).toBeVisible()
  await expect(friend.getByRole('button', { name: 'Install' })).toBeVisible()
  // the parameter is gone, so a reload does not open a second copy
  expect(new URL(friend.url()).search).toBe('')
  await expect(friend.getByRole('button', { name: 'Share', exact: true })).toBeVisible()
  await friend.context().close()
})

test('a player reports a problem from the running game; the owner sees it with the device details', async () => {
  await user.getByRole('button', { name: 'Report a problem' }).click()
  const dlg = user.getByRole('dialog', { name: 'Report a problem with Click Quest' })
  await expect(dlg.getByRole('button', { name: 'Send report' })).toBeDisabled()
  await dlg.getByRole('button', { name: "Controls don't work" }).click()
  await dlg.getByLabel(/Anything else/).fill('the jump key does nothing')
  await dlg.getByText('Exactly what is sent').click()
  await expect(dlg.getByText(/^Chrome \d+$/)).toBeVisible()
  await dlg.getByRole('button', { name: 'Send report' }).click()
  await expect(user.getByRole('heading', { name: "Thanks, it's sent" })).toBeVisible()
  await user.getByRole('button', { name: 'Done' }).click()

  await openStoreTab(owner, '/admin/reports')
  await expect(owner.getByText('the jump key does nothing')).toBeVisible()
  await expect(owner.getByText("Controls don't work", { exact: true })).toBeVisible()
  await expect(owner.getByText(/Browser: Chrome \d+/)).toBeVisible()
  await owner.getByRole('button', { name: 'Resolve', exact: true }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Resolve', exact: true }).click()
  await expect(owner.getByText('No open reports')).toBeVisible()
})

test('9. the contributor uploads version 1.1', async () => {
  await sidebar(contributor, 'Develop')
  await contributor.getByRole('button', { name: /Click Quest/ }).first().click()
  await contributor.getByLabel(/Version number/).fill('1.1')
  await contributor.getByPlaceholder('What changed in this version?').fill('Bug fixes and a brand new level.')
  await contributor.getByRole('button', { name: 'Create draft version' }).click()
  await contributor.getByLabel('Choose a ZIP package').setInputFiles({ name: 'game-1.1.zip', mimeType: 'application/zip', buffer: gameZip('1.1') })
  await expect(contributor.getByText(/2 files/).first()).toBeVisible()
  await contributor.getByRole('button', { name: 'Submit for review' }).click()
  await expect(contributor.getByText(/Version 1\.1 was sent to the Store owner for review/)).toBeVisible()
  // the live version is still 1.0 while 1.1 is reviewed
  await expect(user.frameLocator('iframe[title="Click Quest"]').locator('#title')).toHaveText('Click Quest 1.0')
})

test('10-11. the user sees an update appear live and takes it', async () => {
  await sidebar(owner, 'Manage')
  await owner.getByRole('tab', { name: /Review queue/ }).click()
  await expect(owner.getByText(/Bug fixes and a brand new level/)).toBeVisible()
  await owner.getByRole('button', { name: 'Approve' }).click()
  await expect(owner.getByText(/Nothing is waiting for review/)).toBeVisible()

  // the user's open app tab shows the update without any reload (server-sent event)
  await expect(user.getByRole('button', { name: /Update to 1\.1/ })).toBeVisible({ timeout: 15_000 })
  await user.getByRole('button', { name: /Update to 1\.1/ }).click()
  await expect(user.frameLocator('iframe[title="Click Quest"]').locator('#title')).toHaveText('Click Quest 1.1', { timeout: 15_000 })
})

test('12. the user uninstalls and removes the app data; the app stays in the store', async () => {
  await user.getByRole('button', { name: 'Back to Library' }).click()
  const tile = user.getByRole('button', { name: /Open Click Quest/ }).first()
  await tile.hover()
  await user.getByRole('button', { name: 'More options for Click Quest' }).first().click()
  await user.getByRole('menuitem', { name: /Uninstall/ }).click()
  const dlg = user.getByRole('dialog', { name: /Uninstall Click Quest/ })
  await dlg.getByLabel(/delete this app's saved data/).check()
  await dlg.getByRole('button', { name: 'Uninstall' }).click()
  await expect(user.getByText(/saved data was cleared/)).toBeVisible({ timeout: 15_000 })
  await expect(user.getByText('Your library is empty')).toBeVisible()
  // the app's tab was closed with it
  await expect(user.getByRole('tab', { name: /^Click Quest$/ })).toHaveCount(0)
  // still in the global store, and reinstalling starts from a clean slate
  await openStore(user)
  await sidebar(user, 'Discover')
  await user.getByRole('link', { name: /Click Quest/ }).first().click()
  await user.getByRole('button', { name: 'Install' }).first().click()
  await user.getByRole('button', { name: 'Open', exact: true }).first().click()
  // the visit counter was wiped with the app's data, so this launch is the first one again
  await expect
    .poll(async () => (await user.frames().find((f) => f.url().includes('.apps.localhost'))?.evaluate(() => localStorage.getItem('visits'))) ?? 'pending', { timeout: 15_000 })
    .toBe('1')
})

test('clicking an installed app always opens its tab, even when the server sends less detail', async () => {
  // close the running app, then open it again from the Library while the server omits the newer fields (an older server)
  await user.getByRole('button', { name: 'Close Click Quest', exact: true }).click()
  await expect(user.getByRole('tab', { name: /^Click Quest$/ })).toHaveCount(0)
  await user.route('**/api/apps/*/launch', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    for (const k of ['id', 'slug', 'scheme', 'kind']) delete body[k]
    await route.fulfill({ response: res, json: body })
  })
  await openLibrary(user)
  await user.getByRole('button', { name: /Open Click Quest/ }).first().click()
  await expect(user.getByRole('tab', { name: /^Click Quest$/ })).toHaveCount(1)
  await expect(user.getByRole('combobox', { name: 'Address and search bar' })).toHaveValue('game://click-quest')
  await expect(user.frameLocator('iframe[title="Click Quest"]').locator('#title')).toBeVisible()
  await user.unroute('**/api/apps/*/launch')
})

test('the visitor can export a profile with the installed-app list and no secrets', async () => {
  await user.getByRole('button', { name: 'New tab', exact: true }).click()
  const box = user.getByRole('combobox', { name: 'Address and search bar' })
  await box.click()
  await box.fill('shasta://settings#profile')
  await box.press('Enter')
  const [download] = await Promise.all([user.waitForEvent('download'), user.getByRole('button', { name: 'Export profile' }).click()])
  const text = (await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8'))
  const profile = JSON.parse(text)
  expect(profile.format).toBe('shasta-profile')
  expect(profile.library.apps).toHaveLength(1)
  expect(text).not.toMatch(/cookie|password|token|shasta_session/i)
  // back to the running app for the next test
  await user.getByRole('tab', { name: /^Click Quest$/ }).click()
})

test('13. the owner unpublishes the game; it disappears and installed copies explain why', async () => {
  await sidebar(owner, 'Manage')
  await owner.getByRole('tab', { name: 'All apps' }).click()
  await owner.getByRole('button', { name: /Actions for Click Quest|More|⋯/ }).first().click()
  await owner.getByRole('menuitem', { name: 'Unpublish' }).click()
  await owner.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click()

  // live: the app the user has open is flagged, and the catalog and library react without a reload
  await expect(user.getByText(/Taken offline by its developer: reloading will not work/)).toBeVisible({ timeout: 15_000 })
  await user.getByRole('button', { name: 'Back to Library' }).click()
  await openStore(user)
  await sidebar(user, 'Discover')
  await expect(user.getByText(/The Store is empty/)).toBeVisible({ timeout: 15_000 })
  await openLibrary(user)
  // the tile itself says the app is unavailable (the open app tab, hidden behind, carries its own notice)
  await expect(user.getByRole('button', { name: /Click Quest is unavailable/ }).first()).toBeVisible()
  await user.getByRole('button', { name: /Click Quest is unavailable/ }).first().click()
  await expect(user.getByText(/isn't in the Store/)).toBeVisible()
})

test('anyone can apply to publish; the owner approves; the applicant becomes a contributor from the same page', async ({ browser }) => {
  const applicant = await newPerson(browser)
  await sidebar(applicant, 'Publish')
  await expect(applicant.getByRole('heading', { name: 'Publish in the Store' })).toBeVisible()
  await applicant.getByLabel('Your name or the name you publish under').fill('Robin')
  await applicant.getByLabel('What do you want to publish?').fill('A small HTML5 puzzle game I made for my class.')
  await applicant.getByLabel('A way to reach you (optional)').fill('robin on Discord')
  const send = applicant.getByRole('button', { name: 'Send application' })
  await expect(send).toBeDisabled()
  await applicant.getByLabel('I have read the rules and will follow them').check()
  await send.click()
  await expect(applicant.getByText('Your application is waiting for the owner')).toBeVisible()

  await openStoreTab(owner, '/admin/applications')
  const card = owner.locator('div').filter({ hasText: 'robin on Discord' }).filter({ has: owner.getByRole('button', { name: 'Approve' }) }).last()
  await expect(card).toContainText('puzzle game')
  await card.getByRole('button', { name: 'Approve' }).click()
  const dlg = owner.getByRole('dialog')
  await dlg.getByLabel('Message to them (optional)').fill('Welcome aboard!')
  await dlg.getByRole('button', { name: 'Approve' }).click()
  await expect(dlg.getByText('Robin is approved')).toBeVisible()
  await dlg.getByRole('button', { name: 'Done' }).click()

  // the applicant's browser picks up the answer (a fresh visit to the page)
  await openStoreTab(applicant, '/')
  await sidebar(applicant, 'Publish')
  await expect(applicant.getByText('Welcome aboard!')).toBeVisible()
  await applicant.getByRole('button', { name: 'Become a contributor' }).click()
  await dismissKey(applicant)
  await expect(nav(applicant).getByRole('button', { name: 'Develop' })).toBeVisible()
  await applicant.context().close()
})

test('every Store screen renders for the owner without a runtime error', async () => {
  const errors: string[] = []
  owner.on('pageerror', (e) => errors.push(e.message))
  const screens: [string, RegExp][] = [
    ['/', /Store is empty|Recently added/],
    ['/stores', /Storefronts/],
    ['/search?group=games', /Games/],
    ['/account', /Account/],
    ['/develop', /Develop/],
    ['/develop/storefront', /Official storefront/],
    ['/storefront/shasta', /Official Shasta storefront/],
    ['/admin/queue', /Manage the Store/],
    ['/admin/apps', /All apps/],
    ['/admin/applications', /Answered applications are deleted/],
    ['/admin/people', /Owners and contributors/],
    ['/apply', /already a contributor/],
    ['/admin/curation', /Featured|Collections/],
    ['/admin/categories', /Categories/],
    ['/admin/reports', /Reports/],
    ['/admin/activity', /Activity/],
  ]
  for (const [path, text] of screens) {
    await openStoreTab(owner, path)
    await expect(owner.getByText(text).first(), path).toBeVisible({ timeout: 10_000 })
  }
  // the Library is a page of its own, not part of the Store
  const box = owner.getByRole('combobox', { name: 'Address and search bar' })
  await box.click()
  await box.fill('shasta://library')
  await box.press('Enter')
  await expect(owner.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible()
  await expect(owner.getByRole('navigation', { name: 'Store' })).toHaveCount(0)
  // the Store has no Library entry any more
  await openStoreTab(owner, '/')
  await expect(nav(owner).getByRole('button', { name: /Library/ })).toHaveCount(0)
  // the audit log recorded the whole flow
  await openStoreTab(owner, '/admin/activity')
  await expect(owner.getByText(/unpublish/i).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('a page that crashes does not take the browser down', async () => {
  // simulate a server answering with something the page cannot use (for example an older server after an update)
  await owner.route('**/api/catalog/home', (route) => route.fulfill({ json: { total: 1 } }))
  await openStoreTab(owner, '/')
  const alert = owner.getByRole('alert').filter({ hasText: 'This page ran into a problem' })
  await expect(alert).toBeVisible()
  // the rest of Shasta is still alive: tab strip and address bar
  await expect(owner.getByRole('tab').first()).toBeVisible()
  await expect(owner.getByRole('combobox', { name: 'Address and search bar' })).toBeVisible()
  // once the server behaves again, "Try again" recovers without reloading
  await owner.unroute('**/api/catalog/home')
  await alert.getByRole('button', { name: 'Try again' }).click()
  await expect(alert).toHaveCount(0)
  await expect(owner.getByRole('navigation', { name: 'Store' })).toBeVisible()
})

test('a big catalogue: Explore and Discover load more as you scroll, with no app twice', async () => {
  // a fake 150-app catalogue served the way the real API pages it (offset/limit, limit clamped to 60)
  const cats = [{ id: 'puzzle', name: 'Puzzle', isGame: true }, { id: 'racing', name: 'Racing', isGame: true }, { id: 'tools', name: 'Tools', isGame: false }]
  const apps = Array.from({ length: 150 }, (_, i) => ({
    id: `big-${i}`, slug: `big-${i}`, name: `Big Game ${String(i).padStart(3, '0')}`, developer: `Studio ${i % 7}`, store: null, summary: '', kind: 'linked',
    category: cats[i % 3], iconUrl: null, bannerUrl: null, featured: i < 3, version: null, releasedAt: Date.now() - i * 3_600_000, updatedAt: null, status: 'published',
  }))
  const requests: string[] = []
  await owner.route('**/api/catalog/apps?*', (route) => {
    const p = new URL(route.request().url()).searchParams
    requests.push(p.toString())
    let list = apps.filter((a) => !p.get('category') || a.category.id === p.get('category'))
    if (p.get('group') === 'games') list = list.filter((a) => a.category.isGame)
    const offset = Number(p.get('offset') ?? 0)
    const limit = Math.min(Number(p.get('limit') ?? 24), 60)
    return route.fulfill({ json: { total: list.length, items: list.slice(offset, offset + limit) } })
  })
  await owner.route('**/api/catalog/home', (route) =>
    route.fulfill({
      json: {
        total: 150, stores: [], featured: apps.slice(0, 3), trending: apps.slice(3, 13), popular: apps.slice(3, 11), recentlyAdded: apps.slice(0, 26), recentlyUpdated: [], collections: [],
        categories: cats.map((c) => ({ ...c, count: 50 })), byCategory: [], announcement: null,
      },
    }),
  )
  try {
    await openStoreTab(owner, '/search?sort=name')
    await expect(owner.getByText('150 results')).toBeVisible()
    const tiles = owner.locator('[role="link"][aria-label^="Big Game"]')
    await expect(tiles).toHaveCount(24)
    // scrolling to the end of the list loads the next page and appends it
    await tiles.last().scrollIntoViewIfNeeded()
    await expect.poll(() => tiles.count()).toBeGreaterThan(24)
    // keep scrolling the Store's own scroller to the bottom until everything is in
    await expect
      .poll(async () => {
        await tiles.last().evaluate((el) => {
          let s: HTMLElement | null = el.parentElement
          while (s && getComputedStyle(s).overflowY !== 'auto') s = s.parentElement
          s?.scrollTo({ top: s.scrollHeight })
        })
        return tiles.count()
      }, { timeout: 15_000 })
      .toBe(150)
    await expect(owner.getByText("That's all 150 apps.")).toBeVisible()
    const names = await tiles.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(new Set(names).size).toBe(150)
    expect(requests.some((r) => r.includes('offset=24'))).toBe(true)

    // Discover: every rail is distinct, and the whole catalogue is at the bottom
    await openStoreTab(owner, '/')
    await expect(owner.getByRole('heading', { name: 'Recently added' })).toBeVisible()
    const railIds = async () =>
      owner.locator('section[aria-label]:not([aria-label="Browse everything"]):not([aria-label="Featured"]) [role="link"][aria-label^="Big Game"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/^\d+\. /, '').split(',')[0]))
    // rails further down mount (and fetch) only as they come near: scroll down a screen at a time
    const browse = owner.getByRole('heading', { name: /Browse all 150/ })
    await expect
      .poll(async () => {
        await owner.getByRole('heading', { name: 'Recently added' }).evaluate((el) => {
          let s: HTMLElement | null = el.parentElement
          while (s && getComputedStyle(s).overflowY !== 'auto') s = s.parentElement
          s?.scrollBy({ top: s.clientHeight })
        })
        return browse.count()
      }, { timeout: 20_000 })
      .toBe(1)
    await expect(owner.getByRole('heading', { name: 'Puzzle', level: 2 })).toBeAttached()
    const ids = await railIds()
    expect(ids.length).toBeGreaterThan(20)
    expect(new Set(ids).size).toBe(ids.length)
    await expect(owner.locator('section[aria-label="Browse everything"] [role="link"]')).not.toHaveCount(0)
  } finally {
    await owner.unroute('**/api/catalog/apps?*')
    await owner.unroute('**/api/catalog/home')
  }
})
