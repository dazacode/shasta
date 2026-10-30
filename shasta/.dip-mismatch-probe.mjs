// Validates: with DIP on the shell AND the same-origin child frame, the shell keeps synchronous access
// (contentDocument). With DIP on only one side, access is lost -- exactly the TurboWarp bug.
import { chromium } from "playwright";
const SITE = "https://sites.google.com/view/shasta-mountain/home";
const APP = "shasta-dtg.pages.dev";

async function run({ matchChild }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: "block" }); // else the app SW serves /index.html and skips the route
  const page = await ctx.newPage();
  await page.route(`**${APP}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const resp = await route.fetch();
    const addDip = matchChild || path !== "/index.html"; // mismatch: shell gets DIP, /index.html child does not
    route.fulfill({
      response: resp,
      headers: { ...resp.headers(), "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "credentialless", ...(addDip ? { "Document-Isolation-Policy": "isolate-and-credentialless" } : {}) },
    });
  });
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(11_000);
  const f = page.frames().find((x) => x.url().includes(APP) && x !== page.mainFrame());
  const out = !f
    ? { error: "no app frame" }
    : await f.evaluate(async () => {
        const shellIsolated = window.crossOriginIsolated;
        const child = document.createElement("iframe");
        child.src = "/index.html?probe=1";
        document.body.appendChild(child);
        await new Promise((r) => (child.onload = r));
        let syncAccess = false;
        try {
          syncAccess = !!child.contentDocument && child.contentDocument.title.length >= 0;
        } catch {
          syncAccess = false;
        }
        return { shellIsolated, shellCanReadChild: syncAccess, childIsolated: (() => { try { return child.contentWindow.crossOriginIsolated; } catch { return "n/a"; } })() };
      });
  await browser.close();
  return out;
}

console.log("shell+child both DIP   :", JSON.stringify(await run({ matchChild: true })));
console.log("shell DIP only (mismatch):", JSON.stringify(await run({ matchChild: false })));
