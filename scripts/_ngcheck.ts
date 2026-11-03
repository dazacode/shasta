import { api, closeTunnel } from "./lib/storeImport";
const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
const mine = apps.filter((a) => (a.tags ?? []).includes("nowgg"));
const live = mine.filter((a) => a.status === "published");
console.log("nowgg rows:", mine.length, "| published:", live.length, "| removed:", mine.filter((a) => a.status === "removed").length);
const noLive = live.filter((a) => !(a.versions ?? []).some((v: any) => v.state === "live"));
console.log("published without a live version:", noLive.length);
const dupes = new Map<string, number>();
for (const a of live) dupes.set(a.name, (dupes.get(a.name) ?? 0) + 1);
console.log("duplicate live names:", [...dupes].filter(([, n]) => n > 1).length);
const a = live.find((x) => x.name === "Case Simulator");
const l = await api<any>("GET", `/api/apps/${a.slug}/launch`);
console.log("spot:", a.name, "| version", l.version, "| kind", l.kind);
closeTunnel();
if (l.target?.url) {
	const html = await (await fetch(l.target.url)).text();
	console.log("package has new player:", html.includes("Looking for a host near you"), "| baked proxy appId:", /"appId":"\d+"/.exec(html)?.[0]);
}
