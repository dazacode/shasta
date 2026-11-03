import { chromium } from "playwright";
const browser = await chromium.launch({ proxy: { server: "socks5://127.0.0.1:1080" } });
const page = await browser.newPage();
const oapi = [];
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/oapi/")) oapi.push({ status: r.status(), ct: r.headers()["content-type"], url: u.slice(0, 90) });
});
try {
  await page.goto("https://now.gg/apps/lunime/5691/gacha-life-2.html", { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(12000);
} catch (e) { console.log("nav:", e.message); }
console.log("oapi responses:", JSON.stringify(oapi, null, 1));
console.log("egress check:", await page.evaluate(async () => (await (await fetch("https://ifconfig.co/json")).json()).ip).catch(() => "?"));
await browser.close();
