// One-off probe: does the Google Sites embed of Shasta actually render, and what breaks?
import { chromium } from "playwright";

const SITE = "https://sites.google.com/view/shasta-mountain/home";
const APP = "shasta-dtg.pages.dev";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[console.${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
// give the app time to boot (wisp handshake + React)
await page.waitForTimeout(15_000);

const frames = page.frames().map((f) => ({ url: f.url(), name: f.name() }));
console.log("FRAMES:\n" + frames.map((f) => "  " + f.url).join("\n"));

async function probe(urlPart) {
  const f = page.frames().find((x) => x.url().includes(urlPart));
  if (!f) return { found: false };
  return await f
    .evaluate(() => ({
      found: true,
      url: location.href,
      isolated: window.crossOriginIsolated,
      sab: typeof SharedArrayBuffer !== "undefined",
      // can we even reach the parent / top?
      hasParent: window.parent !== window,
      inSandbox: (() => {
        try {
          return !!window.frameElement; // throws if opaque-origin cross-origin
        } catch (e) {
          return "frameElement throws: " + e.name;
        }
      })(),
      sandboxAttr: (() => {
        try {
          return window.frameElement?.getAttribute("sandbox") ?? null;
        } catch (e) {
          return "n/a";
        }
      })(),
      fullscreenEnabled: document.fullscreenEnabled,
      bodyText: (document.body?.innerText || "").slice(0, 160),
      hasRoot: !!document.getElementById("root")?.children.length,
    }))
    .catch((e) => ({ found: true, error: e.message }));
}

const app = await probe(APP);
console.log("\nAPP FRAME PROBE:\n" + JSON.stringify(app, null, 2));

// outer wrapper probe (gstatic)
const wrapper = await probe("gstatic.com/atari");
console.log("\nWRAPPER PROBE:\n" + JSON.stringify(wrapper, null, 2));

console.log("\nLOGS (last 30):\n" + logs.slice(-30).join("\n"));
await page.screenshot({ path: ".embed-probe.png", fullPage: false });
console.log("\nscreenshot -> shasta/.embed-probe.png");
await browser.close();
