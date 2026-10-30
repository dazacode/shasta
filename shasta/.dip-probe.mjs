// Does Document-Isolation-Policy make the app cross-origin isolated inside the real Google Sites embed?
// Simulates the fixed prod headers (COOP+COEP) via route interception, with and without DIP.
import { chromium } from "playwright";

const SITE = "https://sites.google.com/view/shasta-mountain/home";
const APP = "shasta-dtg.pages.dev";

async function run({ dip }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const extra = {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "credentialless",
    ...(dip ? { "Document-Isolation-Policy": "isolate-and-credentialless" } : {}),
  };
  await page.route(`**${APP}/**`, async (route) => {
    const req = route.request();
    const resp = await route.fetch();
    route.fulfill({ response: resp, headers: { ...resp.headers(), ...extra } });
  });
  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(12_000);
  const f = page.frames().find((x) => x.url().includes(APP) && x !== page.mainFrame());
  const out = f
    ? await f.evaluate(() => ({
        isolated: window.crossOriginIsolated,
        sab: typeof SharedArrayBuffer !== "undefined",
        dipSupported: "documentIsolationPolicy" in document ? document.documentIsolationPolicy : "(prop absent)",
      }))
    : { error: "app frame not found" };
  await browser.close();
  return out;
}

console.log("COOP+COEP only (prod fix, no DIP):", JSON.stringify(await run({ dip: false })));
console.log("COOP+COEP + Document-Isolation-Policy:", JSON.stringify(await run({ dip: true })));
