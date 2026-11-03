// Ad-hoc end-to-end check for the now.gg player + /nowgg proxy fallback (docs/nowgg.md).
//
// It proves the fix on a *flagged* host: serve the player locally, drive it with its API base on a
// VPS that now.gg flags, and watch the proxy transparently fall back to `NOWGG_FALLBACKS`. On the
// VPS run the proxy alone (`server/src/services/nowggProxy.ts` + a 5-line http server is enough),
// then tunnel it here. From the repo root (`node shasta/tmp-nowgg-e2e.mjs`):
//
//   ssh shasta 'cd /tmp/ng && setsid nohup bun run ngserver.ts >/tmp/ng/log 2>&1 </dev/null &'
//   ssh -f -N -L 4599:127.0.0.1:4599 shasta
//
// Expects the game to start: "RESULT: VIDEO TRACK RECEIVED — works" and every request tagged
// `x-nowgg-via: nowgg.fun`. Uses `shasta/public/nowgg.html` as-is, only baking the proxy base.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const PROXY = process.env.NOWGG_E2E_PROXY || "http://127.0.0.1:4599/nowgg";
const html = readFileSync(new URL("./public/nowgg.html", import.meta.url), "utf8").replace("/*__PROXY__*/null", JSON.stringify(PROXY));
const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); }).listen(8899);

const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
const via = [];
page.on("response", (r) => { const v = r.headers()["x-nowgg-via"]; if (v) via.push(r.url().split("/nowgg")[1] + " -> " + v); });

await page.goto("http://127.0.0.1:8899/?g=1400&n=Geometry%20Dash");
let ok = false;
for (let i = 0; i < 45 && !ok; i++) {
	ok = (await page.evaluate(() => document.querySelector("#v")?.srcObject?.getTracks?.().length || 0)) > 0;
	if (!ok) await page.waitForTimeout(2000);
}
console.log("\n=== reached through ===\n" + via.join("\n"));
console.log("\n=== log tail ===\n" + (await page.evaluate(() => document.querySelector("#log")?.innerText?.slice(-700))));
console.log("\nRESULT:", ok ? "VIDEO TRACK RECEIVED — works" : "no track");
await b.close();
server.close();
process.exit(ok ? 0 : 1);
