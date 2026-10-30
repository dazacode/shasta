// The stats dashboard (self-hosted Umami on the VPS, see CLAUDE.md "Stats dashboard"): `bun run stats <command>`.
//   sites                        websites Umami knows, and whether scripts/vps/umami-sites.json lists them
//   add <domain> [--name N] [--short S]
//                                creates the website (or reuses one with that domain), adds it to umami-sites.json,
//                                rebuilds the home dashboard, and prints how to put the tracker on that host
//   dashboard                    rebuilds the home dashboard from umami-sites.json (online-now counters first)
//   summary [--hours N]          online now + visitors/views per site (default last 24 h)
// Every call goes `ssh shasta sudo umami-api METHOD PATH` (scripts/vps/umami-api): it signs in on the VPS, so the admin
// password never leaves it. Umami's MCP (Claude Code `umami`) is read-only: use it for questions, this for changes.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SITES_FILE = join(ROOT, "scripts/vps/umami-sites.json");
const STATS_URL = "https://stats.176-100-37-63.sslip.io";

type Site = { name: string; short: string; domain: string; id: string; main?: boolean };

function api<T = unknown>(method: string, path: string, body?: unknown): T {
	const r = Bun.spawnSync(["ssh", "shasta", "sudo", "umami-api", method, `'${path}'`], {
		stdin: body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body)),
		stdout: "pipe",
		stderr: "pipe",
	});
	const out = r.stdout.toString().trim();
	if (r.exitCode !== 0) throw new Error(`umami ${method} ${path} failed: ${out || r.stderr.toString().trim()}`);
	return (out ? JSON.parse(out) : null) as T;
}

const readSites = (): Site[] => JSON.parse(readFileSync(SITES_FILE, "utf8"));
const writeSites = (s: Site[]) => writeFileSync(SITES_FILE, JSON.stringify(s, null, "\t") + "\n");

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
}

// ---- the home dashboard -----------------------------------------------------------------------------------------
// Umami 3.4 board format: rows (size = height in px, 150..600) of at most 4 columns, each one component bound to a
// website. Layout: online-now counters for every site, today's numbers, visitor charts, then the main site in depth,
// then one compact row per other site.
function board(sites: Site[]) {
	let n = 0;
	const id = (p: string) => `${p}${++n}`;
	const c = (type: string, site: Site, title: string, props?: Record<string, unknown>) => ({
		id: id("c"),
		component: { type, entityType: "website", entityId: site.id, websiteId: site.id, title, ...(props ? { props } : {}) },
	});
	const text = (t: string) => ({ id: id("c"), component: { type: "TextBlock", props: { text: t } } });
	const row = (size: number, columns: unknown[]) => ({ id: id("r"), size, columns });
	const chunks = <T,>(a: T[], k: number) => Array.from({ length: Math.ceil(a.length / k) }, (_, i) => a.slice(i * k, i * k + k));
	const main = sites.find((s) => s.main) ?? sites[0];
	const others = sites.filter((s) => s !== main);
	const rows: unknown[] = [];

	const online = sites.map((s) => c("RealtimeActiveUsers", s, `Online now · ${s.short}`));
	if (online.length < 4) online.push(text("Online = visitors active in the last 5 minutes. Feature use and the sites people open are events (site, page.store, app.launch). Full detail and Realtime: Websites, then pick a site."));
	for (const cols of chunks(online, 4)) rows.push(row(170, cols));
	for (const cols of chunks(sites.map((s) => c("WebsiteMetricsBar", s, `Today · ${s.short}`)), 2)) rows.push(row(160, cols));
	for (const cols of chunks(sites.map((s) => c("WebsiteChart", s, `Visitors · ${s.short}`)), 2)) rows.push(row(360, cols));
	rows.push(row(340, [c("RealtimeChart", main, `Realtime · ${main.short}`), c("WorldMap", main, `Where visitors are · ${main.short}`)]));
	rows.push(row(420, [
		c("MetricsTable", main, "Top pages", { type: "path", limit: 10 }),
		c("MetricsTable", main, "Top events", { type: "event", limit: 10 }),
		c("MetricsTable", main, "Where they came from", { type: "referrer", limit: 10 }),
		c("MetricsTable", main, "Countries", { type: "country", limit: 10 }),
	]));
	rows.push(row(380, [
		c("MetricsTable", main, "Devices", { type: "device", limit: 5 }),
		c("MetricsTable", main, "Operating systems", { type: "os", limit: 10 }),
		c("MetricsTable", main, "Browsers", { type: "browser", limit: 10 }),
		c("WeeklyTraffic", main, `Busiest hours · ${main.short}`),
	]));
	for (const s of others) {
		rows.push(row(380, [
			c("MetricsTable", s, `${s.short} · top pages`, { type: "path", limit: 10 }),
			c("MetricsTable", s, `${s.short} · top events`, { type: "event", limit: 10 }),
			c("MetricsTable", s, `${s.short} · countries`, { type: "country", limit: 10 }),
			c("WorldMap", s, `${s.short} · map`),
		]));
	}
	return { name: "Shasta", description: "Every site at a glance", parameters: { rows } };
}

function pushDashboard() {
	const sites = readSites();
	api("POST", "/api/dashboard", board(sites));
	console.log(`dashboard rebuilt for ${sites.length} site(s): ${STATS_URL}/dashboard`);
}

// ---- commands ---------------------------------------------------------------------------------------------------
const cmd = process.argv[2];
type Website = { id: string; name: string; domain: string };
const websites = () => api<{ data: Website[] }>("GET", "/api/websites?pageSize=200").data;

if (cmd === "sites") {
	const listed = new Set(readSites().map((s) => s.id));
	for (const w of websites()) console.log(`${listed.has(w.id) ? "on dashboard " : "not listed   "} ${w.id}  ${w.domain}  (${w.name})`);
} else if (cmd === "add") {
	const domain = (process.argv[3] ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) {
		console.error("usage: bun run stats add <domain> [--name 'Shasta X'] [--short X]");
		process.exit(2);
	}
	const name = arg("--name") ?? `Shasta (${domain})`;
	const short = arg("--short") ?? domain.split(".")[0];
	let site = websites().find((w) => w.domain === domain);
	if (site) console.log(`Umami already has ${domain}: ${site.id}`);
	else {
		site = api<Website>("POST", "/api/websites", { name, domain });
		console.log(`created website ${name}: ${site.id}`);
	}
	const sites = readSites();
	if (!sites.some((s) => s.id === site!.id)) {
		sites.push({ name: site.name, short, domain, id: site.id });
		writeSites(sites);
		console.log(`added to scripts/vps/umami-sites.json`);
	}
	pushDashboard();
	console.log(`\nTracker for ${domain}:
  a Shasta build: VITE_STATS_URL=${STATS_URL} VITE_STATS_WEBSITE_ID=${site.id} at BUILD time
    (the deploy script for that host sets them, like scripts/deploy-base44.ts; the Pages site reads the root .env)
  any other page: <script defer src="${STATS_URL}/s.js" data-website-id="${site.id}"></script>
If that host is a Shasta frontend on another origin, it also needs APP_ORIGINS on the VPS for the Store and chat.`);
} else if (cmd === "dashboard") {
	pushDashboard();
} else if (cmd === "summary") {
	const hours = Number(arg("--hours") ?? 24);
	const endAt = Date.now();
	const startAt = endAt - hours * 3600_000;
	for (const s of readSites()) {
		const active = api<{ visitors: number }>("GET", `/api/websites/${s.id}/active`);
		const st = api<Record<string, number>>("GET", `/api/websites/${s.id}/stats?startAt=${startAt}&endAt=${endAt}`);
		console.log(`${s.name.padEnd(28)} online ${String(active.visitors).padStart(4)} | last ${hours} h: ${st.visitors} visitors, ${st.visits} visits, ${st.pageviews} views`);
	}
} else {
	console.log("bun run stats sites | add <domain> [--name N] [--short S] | dashboard | summary [--hours N]");
	process.exit(cmd ? 2 : 0);
}
