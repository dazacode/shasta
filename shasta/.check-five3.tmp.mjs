import { chromium } from 'playwright';
const B = process.argv[3];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
let crashed = false; p.on('crash', () => crashed = true);
const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await p.goto(B, { waitUntil: 'load' });
await p.waitForTimeout(10000);
const omni = p.locator('input').first();
await omni.click(); await omni.fill('https://fiveplay.lol/'); await omni.press('Enter');
const marks = [];
for (let t = 10; t <= 70; t += 10) {
  await p.waitForTimeout(10000);
  const failed = await p.getByText("This page couldn't be loaded").count().catch(() => -1);
  marks.push(`${t}s:${failed ? 'ERROR' : 'ok'}`);
  if (failed) break;
}
console.log(B, marks.join(' '), 'crash:', crashed);
const det = p.getByText('Technical details');
if (await det.count()) { await det.click(); console.log('details:', (await p.locator('details').innerText()).slice(0, 600)); }
console.log('errors:', errs.slice(0, 4));
await b.close();
