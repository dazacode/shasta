import { chromium } from "playwright";
const browser = await chromium.launch({ proxy: { server: "socks5://127.0.0.1:1080" } });
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 160)); });
const res = [];
page.on("response", (r) => { if (r.url().includes("/oapi/")) res.push(r.status() + " " + (r.headers()["content-type"] || "") + " " + r.url().replace(/https:\/\/now\.gg/, "")); });
await page.goto("https://now.gg/apps/lunime/5691/gacha-life-2.html", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(8000);
// click Play if present
const btn = await page.$("text=Play");
if (btn) { await btn.click().catch(()=>{}); await page.waitForTimeout(15000); }
console.log("oapi:", JSON.stringify(res.slice(0, 12), null, 0));
console.log("title:", await page.title());
console.log("has video/canvas:", await page.evaluate(() => !!document.querySelector("video,canvas")));
console.log("errors:", JSON.stringify(errs.slice(0, 8)));
await browser.close();
