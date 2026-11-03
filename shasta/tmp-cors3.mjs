import http from "node:http";
import { chromium } from "playwright";
const server = http.createServer((_q,res)=>{res.writeHead(200,{"content-type":"text/html"});res.end("ok")});
await new Promise(r=>server.listen(5199,"127.0.0.1",r));
const b = await chromium.launch(); const p = await b.newPage();
const logs=[]; p.on("console",m=>logs.push(m.text().slice(0,160)));
await p.goto("http://127.0.0.1:5199/");
const out = await p.evaluate(async () => {
  const H={"accept":"application/json, text/plain, */*","x-ngg-fe-version":"berlin-v1.54.400-arm.5","x-ngg-skip-evar-check":"true","x-location":"{}"};
  const r={};
  for (const base of ["https://restudythis.com","https://doctoraux.com","https://now.gg"]) {
    try { const x = await fetch(base+"/oapi/3/play/v1/getMaintenanceStatus?appId=5691",{headers:H}); r[base]=x.status+" acao="+x.headers.get("access-control-allow-origin")+" "+(await x.text()).slice(0,40); }
    catch(e){ r[base]="ERR "+String(e).slice(0,70); }
  }
  return r;
});
console.log(JSON.stringify(out,null,1));
console.log("console:", logs.slice(0,3).join(" | "));
await b.close(); server.close();
