import http from "node:http";
import { chromium } from "playwright";

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end("<!doctype html><meta charset=utf-8><title>cors</title><body>ok</body>");
});
await new Promise((r) => server.listen(5199, "127.0.0.1", r));

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on("console", (m) => logs.push(m.text()));
await page.goto("http://127.0.0.1:5199/");
const out = await page.evaluate(async () => {
  const res = {};
  const H = { accept: "application/json, text/plain, */*", lang: "en", "x-ngg-fe-version": "berlin-v1.54.400-arm.5", "x-ngg-skip-evar-check": "true",
    "x-location": JSON.stringify({ location: "game_sdk", versionName: "10001", countryCode: "US", platform: "cloud", deviceType: "desktop" }) };
  try {
    const r = await fetch("https://now.gg/accounts/auth/v2/access-token?implicitGuestLogin=true", { headers: H });
    const j = await r.json();
    res.guest = { status: r.status, acao: r.headers.get("access-control-allow-origin"), ok: j.success };
    const auth = { ...H, authorization: "NowV2 " + j.access_token, origin: location.origin };
    const r2 = await fetch("https://now.gg/oapi/1/play/v1/createPlayUser", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ uaId: "ua-cors" + Math.random().toString(36).slice(2, 12) }) });
    res.create = { status: r2.status, acao: r2.headers.get("access-control-allow-origin"), body: (await r2.text()).slice(0, 120) };
  } catch (e) { res.error = String(e); }
  return res;
});
console.log("RESULT", JSON.stringify(out, null, 2));
if (logs.length) console.log("console:", logs.join("\n"));
await browser.close();
server.close();
