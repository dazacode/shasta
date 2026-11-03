import { api, closeTunnel } from "./lib/storeImport";
const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
const a = apps.find((x) => x.name === "Case Simulator");
if (!a) throw new Error("no Case Simulator");
console.log("slug:", a.slug, "| status", a.status);
const l = await api<any>("GET", `/api/apps/${a.slug}/launch`);
console.log("kind:", l.kind, "| version:", l.version, "| url:", l.target?.url);
closeTunnel();
const url = l.target?.url;
if (url) {
	const html = await (await fetch(url)).text();
	console.log("package bytes:", html.length, "| new hunt UX:", html.includes("Looking for a host near you"), "| new vpn msg:", html.includes("to every route we tried"), "| baked appId:", /"appId":"\d+"/.exec(html)?.[0]);
}
