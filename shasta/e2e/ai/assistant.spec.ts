// Runs the REAL on-device AI: downloads the Light model through Shasta's model mirror and answers in headless Chromium
// (no WebGPU there, so this is the same CPU path a school Chromebook uses). Needs the network and several minutes the
// first time; the server caches the files in .e2e-store/ai-models. Run: bun run test:ai
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

test.describe.configure({ mode: 'serial' })
test.setTimeout(15 * 60_000)

async function open(page: Page) {
  await page.addInitScript(() => {
    // pin the Light model: that is what a 4 GB Chromebook gets
    if (!localStorage.getItem('shasta-settings')) localStorage.setItem('shasta-settings', JSON.stringify({ state: { settings: { ai: { chatModel: 'light', enabled: true, idleUnloadMinutes: 0, contextMenu: true } } }, version: 4 }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Shasta AI' }).click()
}

/** Every test starts in an empty browser, so the first-run card shows each time: click through it (the server already has the files). */
async function ready(page: Page) {
  await page.getByRole('button', { name: /Set up for this device/ }).click()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible({ timeout: 10 * 60_000 })
}

const lastReply = (page: Page) => page.locator('aside[aria-label="Shasta AI assistant"] [data-role="assistant"]').last()
const ask = async (page: Page, text: string) => {
  const box = page.getByRole('textbox', { name: 'Message' })
  await box.fill(text)
  await box.press('Enter')
}

test('downloads the model and answers a question, talking only to Shasta\'s own server', async ({ page, context }) => {
  const external = new Set<string>()
  context.on('request', (r) => {
    const host = new URL(r.url()).hostname
    if (!/^(localhost|127\.0\.0\.1|.+\.localhost)$/.test(host) && !/^(data|blob|about):/.test(r.url())) external.add(host)
  })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page)
  await expect(page.getByRole('heading', { name: 'Set up Shasta AI' })).toBeVisible()
  await ready(page)
  await ask(page, 'What is the capital of France? Answer in one short sentence.')
  await expect(lastReply(page)).toContainText(/Paris/i, { timeout: 5 * 60_000 })
  await page.screenshot({ path: 'test-results/ai-chat.png' })
  expect(errors).toEqual([])
  // no model host, CDN or lookup service was contacted directly: the mirror and the server handled everything
  expect([...external]).toEqual([])
})

test('reads an attached text file', async ({ page }) => {
  await open(page)
  await ready(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Class notes. The school mascot is a purple walrus named Gerald. The science fair is on 14 March in the gym.') })
  await ask(page, 'What is the mascot called?')
  await expect(lastReply(page)).toContainText(/Gerald/i, { timeout: 5 * 60_000 })
})

test('finds the right part of a long document by meaning (the search model)', async ({ page }) => {
  await open(page)
  await ready(page)
  const filler = (topic: string) => `${topic}. `.repeat(1).concat('Everyone in the village agreed that the harvest festival was the highlight of the year, with music, dancing and long tables of food shared among neighbours. ').repeat(14)
  const doc = [filler('Chapter one: the festival'), filler('Chapter two: the river'), 'Chapter three: the winter. The family faced severe financial hardship and mounting debt, and Grandfather sold the old tractor to pay the bills.', filler('Chapter four: the school'), filler('Chapter five: the spring')].join('\n\n')
  await page.locator('input[type=file]').setInputFiles({ name: 'family-history.txt', mimeType: 'text/plain', buffer: Buffer.from(doc) })
  await ask(page, 'What money troubles did the family have, and what did Grandfather sell?')
  await expect(lastReply(page)).toContainText(/tractor/i, { timeout: 5 * 60_000 })
})

test('describes a picture', async ({ page }) => {
  await open(page)
  await ready(page)
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 400
    c.height = 300
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, 400, 300)
    g.fillStyle = '#d00000'
    g.fillRect(100, 60, 200, 180)
    g.fillStyle = '#000'
    g.font = 'bold 48px sans-serif'
    g.fillText('HELLO', 140, 160)
    return c.toDataURL('image/png')
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'red-box.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') })
  await ask(page, 'What colour is the box and what does it say?')
  await expect(lastReply(page)).toContainText(/red/i, { timeout: 8 * 60_000 })
  await page.screenshot({ path: 'test-results/ai-vision.png' })
})

test('transcribes a spoken recording', async ({ page }) => {
  test.skip(process.platform !== 'darwin', 'uses the macOS "say" command to make the recording')
  const dir = mkdtempSync(path.join(tmpdir(), 'shasta-ai-'))
  const aiff = path.join(dir, 'speech.aiff')
  const wav = path.join(dir, 'speech.wav')
  execFileSync('say', ['-o', aiff, 'The volcano erupted on Tuesday morning.'])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', aiff, wav])
  await open(page)
  await ready(page)
  await page.locator('input[type=file]').setInputFiles({ name: 'speech.wav', mimeType: 'audio/wav', buffer: readFileSync(wav) })
  await ask(page, 'What day did it happen?')
  await expect(lastReply(page)).toContainText(/tuesday/i, { timeout: 8 * 60_000 })
})
