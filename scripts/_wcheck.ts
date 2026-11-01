import { api, closeTunnel } from "./lib/storeImport";
// spot-check one of the suffixed cloud apps actually serves the fixed player
const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
const a = apps.find((x) => x.name === "Stardew Valley (Cloud)");
const l = await api<any>("GET", `/api/apps/${a.slug}/launch`);
console.log("slug:", a.slug, "| kind:", l.kind, "| url:", l.target.url);
closeTunnel();
