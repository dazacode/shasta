import http from "node:http";
import { chromium } from "playwright";
const server = http.createServer((_q,res)=>{res.writeHead(200,{"content-type":"text/html"});res.end("ok")});
await new Promise(r=>server.listen(5199,"127.0.0.1",r));
const browser = await chromium.launch();
const page = await browser.newPage();
const logs=[]; page.on("console",m=>logs.push(m.text().slice(0,200)));
await page.goto("http://127.0.0.1:5199/");
const out = await page.evaluate(async () => {
  const H={"accept":"application/json","x-ngg-fe-version":"berlin-v1.54.400-arm.5","x-ngg-skip-evar-check":"true","x-location":"{}"};
  const r={};
  for (const base of ["https://now.gg","https://doctoraux.com","https://mathsspot.com"]) {
    try { const x = await fetch(base+"/oapi/3/play/v1/getMaintenanceStatus?appId=5691",{headers:H}); r[base]={status:x.status,acao:x.headers.get("access-control-allow-origin"),body:(await x.text()).slice(0,60)}; }
    catch(e){ r[base]="ERR "+String(e).slice(0,90); }
  }
  return r;
});
console.log(JSON.stringify(out,null,1));
console.log("console:", logs.slice(0,4).join(" | "));
await browser.close(); server.close();
