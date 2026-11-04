// Shasta Lite on bunny.net: `bun run deploy:bunny` (from the root, so the root .env is loaded) -> https://<zone>.b-cdn.net
// Same Lite build as Vercel/Base44/jsDelivr (scripts/lib/liteBuild.ts). Bunny = a Storage Zone (the files) behind a
// Pull Zone (the CDN host), plus a standalone Edge Script (scripts/bunny-relay/relay.js, <zone>-relay.bunny.run) that
// relays Wisp and forwards /api to the full site: this mirror's first backend, and a fallback for every other Lite.
// The PAGE origin must be in APP_ORIGINS on the VPS (/etc/shasta/shasta.env); the relay forwards it unchanged.
//
// Needs BUNNY_API_KEY = the ACCOUNT API key (dash.bunny.net -> Account settings -> API key). The script creates the
// storage + pull zone the first time (idempotent after that), uploads, deletes files the new build no longer has,
// sets the isolation headers as Edge Rules (the service worker adds them too, but real headers isolate the first load),
// makes unknown paths answer index.html with 200 (shasta:// deep links), then purges the CDN cache.
// Env: BUNNY_ZONE (default shasta-lite; names are global, pick another if taken), BUNNY_REGION (storage region, DE).
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { buildLite, FULL, ROOT } from "./lib/liteBuild";

const OUT = join(ROOT, ".deploy/bunny");
const ZONE = process.env.BUNNY_ZONE ?? "shasta-lite";
const REGION = (process.env.BUNNY_REGION ?? "DE").toUpperCase();
const KEY = process.env.BUNNY_API_KEY;
const dry = process.argv.includes("--dry-run");
const relayOnly = process.argv.includes("--relay-only");
const HOST = `https://${ZONE}.b-cdn.net`;


if (!KEY) {
	console.error("BUNNY_API_KEY is not set (dash.bunny.net -> Account settings -> API key)");
	process.exit(1);
}

const api = async (method: string, path: string, body?: unknown) => {
	const r = await fetch(`https://api.bunny.net${path}`, {
		method,
		headers: { AccessKey: KEY, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await r.text();
	if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
	return text ? JSON.parse(text) : null;
};


// --- relay (a standalone Edge Script on its own *.b-cdn.net host, scripts/bunny-relay/relay.js) ---
// Wisp + /api for Lite mirrors on a domain that is not pages.dev / edushasta.lol / vercel.app. Runs BEFORE the build:
// the build needs its address.
type Script = { Id: number; Name: string; LinkedPullZones?: { Id: number; PullZoneName: string; DefaultHostname: string }[] };
const RELAY = `${ZONE}-relay`;
const scripts = (await api("GET", "/compute/script?perPage=1000")) as { Items?: Script[] } | Script[];
let script = (Array.isArray(scripts) ? scripts : scripts.Items ?? []).find((x) => x.Name === RELAY);
const code = await Bun.file(join(ROOT, "scripts/bunny-relay/relay.js")).text();
if (!script) {
	console.log(`creating edge script ${RELAY}`);
	script = (await api("POST", "/compute/script", { Name: RELAY, Code: code, ScriptType: 1, CreateLinkedPullZone: true, LinkedPullZoneName: RELAY })) as Script;
} else await api("POST", `/compute/script/${script.Id}/code`, { Code: code });
await api("POST", `/compute/script/${script.Id}/publish`, { Note: "deploy-bunny" });
script = (await api("GET", `/compute/script/${script.Id}`)) as Script;
const relayZone = script.LinkedPullZones?.[0];
if (!relayZone) throw new Error("the relay script has no linked pull zone");
// websockets are off on a new pull zone; 500 at once is the free default cap (billed per connection-minute)
await api("POST", `/pullzone/${relayZone.Id}`, { EnableWebSockets: true, MaxWebSocketConnections: 500 });
const RELAY_HOST = relayZone.DefaultHostname.replace(/^https?:\/\//, "");
console.log(`relay: https://${RELAY_HOST} (wisp + api)`);
if (relayOnly) process.exit(0);

// Umami website "Shasta Lite (Bunny)" (scripts/vps/umami-sites.json)
// No ads: Adsterra codes are per host and none are registered for this one (scripts/lib/adCodes.ts).
// The relay goes FIRST here (its own domain, like Vercel Lite's own /wisp/), then the shared fallbacks.
buildLite(OUT, process.env.BUNNY_STATS_ID ?? "d6737221-5998-430a-8747-d426b08be530", "/", {
	VITE_WISP_URLS: [`wss://${RELAY_HOST}/wisp/`, `wss://${new URL(FULL).host}/wisp/`, "wss://edushasta.lol/wisp/", "wss://shasta-lite.vercel.app/wisp/"].join(","),
	VITE_API_ORIGINS: [`https://${RELAY_HOST}`, FULL, "https://edushasta.lol"].join(","),
});

if (dry) {
	console.log(`built in ${OUT} (--dry-run: not uploaded)`);
	process.exit(0);
}

// --- storage zone (the files) ---
type StorageZone = { Id: number; Name: string; Password: string; StorageHostname?: string; Region: string };
const storage = (await api("GET", "/storagezone?perPage=1000")) as { Items?: StorageZone[] } | StorageZone[];
let found = (Array.isArray(storage) ? storage : storage.Items ?? []).find((z) => z.Name === ZONE);
if (!found) {
	console.log(`creating storage zone ${ZONE} (${REGION})`);
	found = (await api("POST", "/storagezone", { Name: ZONE, Region: REGION, ZoneTier: 0 })) as StorageZone;
}
// re-read: the create answer may lack the password, and a brand-new zone takes a few seconds to accept it
const zone = (await api("GET", `/storagezone/${found.Id}`)) as StorageZone;
// unknown paths answer the app (client-side shasta:// pages, ?app= links), with 200 like Vercel/Base44
await api("POST", `/storagezone/${zone.Id}`, { Custom404FilePath: "/index.html", Rewrite404To200: true });
const storageHost = zone.StorageHostname ?? (zone.Region === "DE" ? "storage.bunnycdn.com" : `${zone.Region.toLowerCase()}.storage.bunnycdn.com`);
const sto = (path: string) => `https://${storageHost}/${ZONE}/${path}`;

// --- pull zone (the CDN host) ---
type EdgeRule = { Guid: string; Description: string };
type PullZone = { Id: number; Name: string; EdgeRules?: EdgeRule[] };
const pulls = (await api("GET", `/pullzone?perPage=1000&search=${encodeURIComponent(ZONE)}`)) as { Items?: PullZone[] } | PullZone[];
let pull = (Array.isArray(pulls) ? pulls : pulls.Items ?? []).find((p) => p.Name === ZONE);
if (!pull) {
	console.log(`creating pull zone ${ZONE} -> ${HOST}`);
	pull = (await api("POST", "/pullzone", { Name: ZONE, OriginType: 2, StorageZoneId: zone.Id, Type: 0 })) as PullZone;
}
pull = (await api("GET", `/pullzone/${pull.Id}`)) as PullZone;

// Edge Rules, matched by Description so a re-run updates them instead of adding copies. Same policy as Vercel Lite.
const header = (name: string, value: string) => ({ ActionType: 5, ActionParameter1: name, ActionParameter2: value });
const all = { Type: 0, PatternMatches: ["*"], PatternMatchingType: 0 };
const assets = (match: number) => ({ Type: 0, PatternMatches: ["*/assets/*"], PatternMatchingType: match });
const rules = [
	{
		Description: "shasta: isolation",
		first: header("Cross-Origin-Opener-Policy", "same-origin"),
		extra: [
			header("Cross-Origin-Embedder-Policy", "credentialless"),
			header("Document-Isolation-Policy", "isolate-and-credentialless"),
			header("Content-Security-Policy", "frame-ancestors 'self' https://sites.google.com https://*.gstatic.com https://*.googleusercontent.com"),
			header("Service-Worker-Allowed", "/"),
		],
		triggers: [all],
	},
	{ Description: "shasta: no-cache", first: header("Cache-Control", "no-cache"), extra: [], triggers: [assets(2)] },
	{ Description: "shasta: immutable assets", first: header("Cache-Control", "public, max-age=31536000, immutable"), extra: [], triggers: [assets(0)] },
];
for (const [i, r] of rules.entries()) {
	const existing = pull.EdgeRules?.find((e) => e.Description === r.Description);
	await api("POST", `/pullzone/${pull.Id}/edgerules/addOrUpdate`, {
		...(existing ? { Guid: existing.Guid } : {}),
		...r.first,
		ExtraActions: r.extra,
		Triggers: r.triggers,
		TriggerMatchingType: 1,
		Description: r.Description,
		Enabled: true,
		OrderIndex: i,
	});
}

// --- upload ---
const local: string[] = [];
const walk = (dir: string) => {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p);
		else local.push(relative(OUT, p).split("\\").join("/"));
	}
};
walk(OUT);

const put = async (rel: string, tries = 4): Promise<void> => {
	const r = await fetch(sto(rel), { method: "PUT", headers: { AccessKey: zone.Password, "content-type": "application/octet-stream" }, body: Bun.file(join(OUT, rel)) });
	if (r.ok) return;
	if (tries > 1) {
		await Bun.sleep(r.status === 401 ? 5000 : 1000);
		return put(rel, tries - 1);
	}
	throw new Error(`upload ${rel}: ${r.status} ${await r.text()}`);
};
// index.html and sw.js LAST: a visitor mid-deploy never gets a page whose hashed assets are not up yet
const late = new Set(["index.html", "sw.js"]);
const queue = local.filter((f) => !late.has(f));
let done = 0;
await Promise.all(
	Array.from({ length: 16 }, async () => {
		for (let f = queue.shift(); f; f = queue.shift()) {
			await put(f);
			if (++done % 50 === 0) console.log(`uploaded ${done}/${local.length}`);
		}
	}),
);
for (const f of late) if (local.includes(f)) await put(f);
console.log(`uploaded ${local.length} files`);

// --- remove what the new build no longer has (old hashed assets) ---
type Obj = { ObjectName: string; IsDirectory: boolean };
const remote: string[] = [];
const list = async (dir: string) => {
	const r = await fetch(sto(dir), { headers: { AccessKey: zone.Password, accept: "application/json" } });
	if (!r.ok) throw new Error(`list ${dir}: ${r.status}`);
	for (const o of (await r.json()) as Obj[]) {
		if (o.IsDirectory) await list(`${dir}${o.ObjectName}/`);
		else remote.push(`${dir}${o.ObjectName}`);
	}
};
await list("");
const keep = new Set(local);
const stale = remote.filter((f) => !keep.has(f));
for (const f of stale) await fetch(sto(f), { method: "DELETE", headers: { AccessKey: zone.Password } });
if (stale.length) console.log(`deleted ${stale.length} old files`);

await api("POST", `/pullzone/${pull.Id}/purgeCache`);
console.log(`\x1b[32mdeployed: ${HOST}\x1b[0m`);
console.log(`\x1b[33mAPP_ORIGINS on the VPS must include ${HOST} (Store, chat)\x1b[0m`);
console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` (AGPL section 13)\x1b[0m");
