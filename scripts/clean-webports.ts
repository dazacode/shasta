#!/usr/bin/env bun
/**
 * Cleans up the listings scripts/import-webports.ts added (the Ultimate Catalog of Web Game Ports, which is also what
 * ported2browser.com shows): one listing per game, its real name, the original developer and publisher, an
 * encyclopedia description and genre tags instead of the host-as-developer credits and play-page blurbs of the first
 * import. What each listing should be lives in lib/webportsMeta.ts (shared with the import, so a re-run keeps it).
 *
 *   - facts come from the game's Wikipedia article (the lead, as the description, credited) and its Wikidata entry
 *     (P178 developer, P123 publisher, P136 genre, P404 game mode), cached in .cache/webports-wiki.json;
 *   - an article whose short description does not say it is a game is refused, never applied;
 *   - other ports of the same game and catalogue rows that are not games are UNPUBLISHED (reversible with
 *     `shasta apps republish`), never deleted; the merged-into listing names the other ports;
 *   - games with no article keep their makers unknown (no credit is invented), only the host-as-developer goes.
 *
 * Writes a backup of every listing it touches to .cache/webports-backup-<time>.json before changing anything.
 * Safe to re-run: only listings that would change are patched.
 *
 * `--release` also publishes a new version of every cleaned listing (same address, release notes saying what changed), so
 * the cleanup shows in the Store's "Recently updated" (which lists new versions, not edited listings). Run it once.
 *
 *   bun scripts/clean-webports.ts [--dry] [--refresh] [--only <name>] [--release]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { api, closeTunnel, summarize, tagify } from "./lib/storeImport";
import { DROP, ELSEWHERE, MERGED, PORTS, genreTags, lead, makersFromLead, rowOfSlug } from "./lib/webportsMeta";

const root = path.resolve(import.meta.dir, "..");
const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1]?.toLowerCase() : undefined;
const CACHE = path.join(root, ".cache/webports-wiki.json");
const UA = { "User-Agent": "ShastaStore/1.0 (catalogue metadata; https://github.com/dazacode/shasta)" };
const README = "https://raw.githubusercontent.com/Carter54git/Ultimate-Catalog-Of-Web-Game-Ports/main/README.md";
const SOURCE = "webports";

// ---- Wikipedia + Wikidata -------------------------------------------------------------------------------------
interface Wiki {
	title: string;
	url: string;
	shortDescription: string;
	extract: string;
	qid?: string;
	developers: string[];
	publishers: string[];
	genres: string[];
	multiplayer: boolean;
	year?: number;
}
type Cache = Record<string, Wiki | { missing: true; reason: string }>;
const cache: Cache = !argv.includes("--refresh") && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

async function getJson(url: string): Promise<any> {
	for (let i = 0; i < 5; i++) {
		const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30_000) }).catch(() => null);
		if (r?.ok) return r.json();
		await Bun.sleep(r?.status === 429 ? 10_000 * (i + 1) : 2000);
	}
	throw new Error(`gave up on ${url}`);
}
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function resolveWiki(titles: string[]) {
	const todo = [...new Set(titles)].filter((t) => !cache[t]);
	if (!todo.length) return;
	console.log(`looking up ${todo.length} Wikipedia articles…`);
	const found: Record<string, Wiki> = {};
	for (const batch of chunks(todo, 20)) {
		const q = new URLSearchParams({ action: "query", format: "json", formatversion: "2", redirects: "1", prop: "extracts|pageprops|description|info", inprop: "url", exintro: "1", explaintext: "1", exlimit: "20", ppprop: "wikibase_item", titles: batch.join("|") });
		const d = await getJson(`https://en.wikipedia.org/w/api.php?${q}`);
		// asked title -> the page it lands on; several asked titles can land on one page
		const normalized = new Map<string, string>((d.query?.normalized ?? []).map((n: any) => [n.from, n.to]));
		const redirects = new Map<string, { to: string; fragment?: string }>((d.query?.redirects ?? []).map((r: any) => [r.from, { to: r.to, fragment: r.tofragment }]));
		const pages = new Map<string, any>((d.query?.pages ?? []).map((p: any) => [p.title, p]));
		for (const asked of batch) {
			const n = normalized.get(asked) ?? asked;
			const r = redirects.get(n);
			// a redirect to a section (an expansion inside its base game's article) is not an article about this game
			if (r?.fragment) {
				cache[asked] = { missing: true, reason: `redirects to a section of "${r.to}"` };
				continue;
			}
			const p = pages.get(r?.to ?? n);
			if (!p || p.missing) {
				cache[asked] = { missing: true, reason: "no such article" };
				continue;
			}
			const desc: string = p.description ?? "";
			// the article must be about a game (or a game series / mod / remake), not a film, a manga or a franchise
			if (!/\b(video ?games?|games?|mod|modification|remake|source port|visual novel|adventure|shooter|simulator|series)\b/i.test(desc) || /\b(film|manga|(?<!visual )novel|television|anime series|comic)\b/i.test(desc)) {
				cache[asked] = { missing: true, reason: `article is not about a game: "${desc}"` };
				continue;
			}
			found[asked] = { title: p.title, url: p.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, shortDescription: desc, extract: p.extract ?? "", qid: p.pageprops?.wikibase_item, developers: [], publishers: [], genres: [], multiplayer: false };
		}
		await Bun.sleep(500);
	}
	for (const t of todo) if (!cache[t] && !found[t]) cache[t] = { missing: true, reason: "not returned by Wikipedia" };

	// Wikidata: claims, then the labels of everything they point at
	const byQid = new Map<string, Wiki[]>();
	for (const w of Object.values(found)) if (w.qid) byQid.set(w.qid, [...(byQid.get(w.qid) ?? []), w]);
	const refs = new Map<string, Set<string>>(); // qid -> referenced ids per property
	const claims = new Map<string, Record<string, string[]>>();
	for (const batch of chunks([...byQid.keys()], 50)) {
		const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${batch.join("|")}`);
		for (const [qid, ent] of Object.entries<any>(d.entities ?? {})) {
			const statements = (p: string) => (ent.claims?.[p] ?? []).filter((c: any) => c.rank !== "deprecated" && c.mainsnak?.datavalue?.value);
			const pick = (p: string) => statements(p).map((c: any) => c.mainsnak.datavalue.value);
			const ids = (p: string) => pick(p).map((v: any) => v.id).filter(Boolean) as string[];
			// makers: Wikidata also lists every platform's porting studio and every region's publisher, qualified with
			// P400 platform / P291 place / P495 country / P3005 valid in place; the original ones carry none (or are
			// marked preferred)
			const main = (p: string) => {
				const all = statements(p);
				const preferred = all.filter((c: any) => c.rank === "preferred");
				const plain = all.filter((c: any) => !["P400", "P291", "P495", "P3005", "P518"].some((q) => c.qualifiers?.[q]));
				return (preferred.length ? preferred : plain.length ? plain : all.slice(0, 1)).map((c: any) => c.mainsnak.datavalue.value.id).filter(Boolean) as string[];
			};
			const c = { P178: main("P178"), P123: main("P123"), P136: ids("P136"), P404: ids("P404") };
			claims.set(qid, c);
			const s = new Set<string>([...c.P178, ...c.P123, ...c.P136, ...c.P404]);
			refs.set(qid, s);
			const years = pick("P577").map((v: any) => Number(/^[+-](\d{4})/.exec(v.time ?? "")?.[1])).filter((y: number) => y > 1950);
			if (years.length) for (const w of byQid.get(qid) ?? []) w.year = Math.min(...years);
		}
		await Bun.sleep(500);
	}
	const allRefs = [...new Set([...refs.values()].flatMap((s) => [...s]))];
	const label = new Map<string, string>();
	for (const batch of chunks(allRefs, 50)) {
		const d = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${batch.join("|")}`);
		for (const [id, ent] of Object.entries<any>(d.entities ?? {})) if (ent.labels?.en?.value) label.set(id, ent.labels.en.value);
		await Bun.sleep(500);
	}
	for (const [qid, c] of claims) {
		const names = (ids: string[]) => [...new Set(ids.map((i) => label.get(i)).filter((x): x is string => !!x && x.length <= 60))];
		for (const w of byQid.get(qid) ?? []) {
			w.developers = names(c.P178).slice(0, 3);
			w.publishers = names(c.P123).slice(0, 2);
			w.genres = names(c.P136);
			w.multiplayer = c.P404.some((i) => /multiplayer|cooperative/i.test(label.get(i) ?? ""));
		}
	}
	Object.assign(cache, found);
	mkdirSync(path.dirname(CACHE), { recursive: true });
	writeFileSync(CACHE, JSON.stringify(cache, null, "\t"));
}

// ---- the catalogue: each row's source repository (the porter) --------------------------------------------------
const rowName = (cell: string) => cell.replace(/^[⭐▶\s]+/, "").replace(/\s*\(\d+\)$/, "").replace(/\s+/g, " ").trim();
async function catalogueSources(): Promise<Map<string, { name: string; url: string }>> {
	const md = await (await fetch(README)).text();
	const out = new Map<string, { name: string; url: string }>();
	for (const l of md.split("\n")) {
		if (!l.startsWith("|")) continue;
		const c = l.split("|").map((s) => s.trim());
		if (c.length < 5 || !c[1] || c[1] === "Game" || /^-+$/.test(c[1])) continue;
		const src = /\((https:\/\/github\.com\/([^/)]+)\/([^/)]+)[^)]*)\)/.exec(c[3] ?? "");
		if (src && !out.has(rowName(c[1]).toLowerCase())) out.set(rowName(c[1]).toLowerCase(), { name: src[2], url: `https://github.com/${src[2]}/${src[3]}` });
	}
	return out;
}

// ---- building a listing -----------------------------------------------------------------------------------------
interface Credit {
	role: string;
	name: string;
	url?: string;
}
const hostOf = (u: string) => {
	try {
		return new URL(u).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
};
const linkedUrl = (a: any): string => a.linkedUrl ?? a.versions?.find((v: any) => v.current)?.linkedUrl ?? a.versions?.find((v: any) => v.linkedUrl)?.linkedUrl ?? "";
// the first import wrote these when a play page had no usable blurb
const GENERIC = /a browser port (listed in the Ultimate Catalog of Web Game Ports and )?playable at /i;
/** a person's own page (`user.github.io`, `user.itch.io`) names its maker; any other host label is not a developer */
const personalHost = (h: string) => /^[^.]+\.(github\.io|itch\.io|gitlab\.io|codeberg\.page)$/i.test(h);

function plan(app: any, meta: (typeof PORTS)[string], wiki: Wiki | undefined, alts: any[], source?: { name: string; url: string }) {
	const url = linkedUrl(app);
	const host = hostOf(url);
	const credits: Credit[] = app.credits ?? [];
	const hostCredit = credits.find((c) => c.role === "host") ?? { role: "host", name: host, url: `https://${host}/` };
	const name = (meta.name ?? app.name).slice(0, 60);

	// who ported it: the catalogue's source repo, else a personal host's owner, else whatever port credit there was
	const ports: Credit[] = credits.filter((c) => c.role === "port");
	// (not when the source repo is the host itself: the genizy/web-port mirror rows)
	if (!ports.length && source && !hostCredit.name.toLowerCase().startsWith(`${source.name.toLowerCase()}/`)) ports.push({ role: "port", name: source.name.slice(0, 60), url: source.url });
	const oldDevs = credits.filter((c) => c.role === "developer");
	// the original makers as the article's first lines name them; Wikidata's lists also carry every later port's
	// studio and every region's publisher (Quake -> Nightdive's 2021 remaster), so they are only the fallback
	const said = wiki ? makersFromLead(wiki.extract) : { developers: [], publishers: [] };
	let makers: Credit[];
	if (meta.keepText) makers = [...oldDevs, ...credits.filter((c) => c.role === "publisher")];
	else if (wiki && (said.developers.length || wiki.developers.length)) {
		const devs = said.developers.length ? said.developers : wiki.developers;
		// Wikidata's publishers include every region's (Quake III -> a Chinese localiser): only when the lead names nobody
		const pubs = said.developers.length ? said.publishers : wiki.publishers;
		makers = [...devs.map((n) => ({ role: "developer", name: n })), ...pubs.map((n) => ({ role: "publisher", name: n }))];
		// the person behind a personal host ported it; they are not the original developer
		if (!ports.length && personalHost(host) && oldDevs[0]) ports.push({ role: "port", name: oldDevs[0].name, url: `https://${host}/` });
	} else makers = personalHost(host) ? oldDevs : []; // no article: a host label is never a maker; a person's page is
	if (meta.keepText && wiki) for (const p of said.publishers.length ? said.publishers : wiki.publishers) if (!makers.some((m) => m.name === p)) makers.push({ role: "publisher", name: p });
	const makerNames = new Set(makers.map((m) => m.name.toLowerCase().replace(/[^a-z0-9]/g, "")));
	const seen = new Set<string>();
	const nextCredits = [...makers, ...ports.filter((p) => !makerNames.has(p.name.toLowerCase().replace(/[^a-z0-9]/g, ""))), hostCredit].filter((c) => {
		const k = `${c.role}:${c.name.toLowerCase()}`;
		if (seen.has(k) || !c.name) return false;
		seen.add(k);
		return true;
	}).slice(0, 12);

	// text
	const altHosts = [...new Set(alts.map((a) => hostOf(linkedUrl(a))).filter((h) => h && h !== host))];
	let summary: string = app.summary;
	let description: string = app.description ?? "";
	if (!meta.keepText) {
		// the host as credited (a mirror is credited as its repository, not the CDN that serves it)
		const where = hostCredit.name.includes("/") ? `the ${hostCredit.name} collection` : hostCredit.name;
		const port = `This listing opens a browser port hosted at ${where}${ports[0] ? `, ported by ${ports[0].name}` : ""}.`;
		const also = altHosts.length ? ` Other ports of the game: ${altHosts.join(", ")}.` : "";
		if (wiki?.extract) {
			const body = lead(wiki.extract);
			summary = summarize(body, name);
			description = `${body}\n\n${port}${also}\n\nGame description from Wikipedia ("${wiki.title}", CC BY-SA 4.0).`;
		} else {
			// the listing's own text, without what an earlier run of this script added to it
			const prior = description
				.replace(/\s*This listing opens a browser port[\s\S]*$/, "")
				.replace(/\s*Other ports of the game:[\s\S]*$/, "")
				.replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, playable in your browser\\.$`), "")
				.replace(/\s+/g, " ")
				.trim();
			const own = GENERIC.test(prior) || prior.length < 40 ? "" : prior;
			description = own ? `${own}\n\n${port}${also}` : `${name}, playable in your browser. ${port}${also}`;
			if (GENERIC.test(summary) || !summary || summary.length < 12 || /\.\.\.$|vs\.$/.test(summary)) summary = summarize(own || `${name}, playable in your browser.`, name);
		}
	} else if (altHosts.length && !description.includes("Other ports of the game")) {
		description = `${description}\n\nOther ports of the game: ${altHosts.join(", ")}.`;
	}

	// tags: genres from Wikidata on top of what the listing had (minus the bare markers), source marker kept
	const had: string[] = (app.tags ?? []).filter((t: string) => t !== SOURCE);
	const genre = wiki ? genreTags(wiki.genres) : [];
	if (wiki?.multiplayer) genre.push("multiplayer");
	const tags = [...tagify([...genre, ...had.filter((t) => !["port", "browser"].includes(t)), "port", "browser"], []).slice(0, 9), SOURCE];

	return { name, summary: summary.slice(0, 120), description: description.slice(0, 5000), credits: nextCredits, tags };
}

// ---- run ----------------------------------------------------------------------------------------------------------
const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
const ours = apps.filter((a) => (a.tags ?? []).includes(SOURCE) && a.status !== "removed");
console.log(`${ours.length} listings from the web ports catalogue (${ours.filter((a) => a.status === "published").length} live)`);

// keyed by catalogue row (found from the slug: a cleaned-up listing's name is no longer its row's, and can equal a
// folded row's name); a listing that maps to no row keeps its own name as key and is reported, never touched
const detail = new Map<string, any>();
let di = 0;
await Promise.all(
	new Array(8).fill(0).map(async () => {
		while (di < ours.length) {
			const a = ours[di++];
			detail.set(rowOfSlug(a.slug) ?? a.name, await api<any>("GET", `/api/dev/apps/${a.id}`));
		}
	}),
);
const backup = path.join(root, `.cache/webports-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
mkdirSync(path.dirname(backup), { recursive: true });
writeFileSync(backup, JSON.stringify([...detail.values()], null, "\t"));
console.log(`backup: ${path.relative(root, backup)}`);

await resolveWiki(Object.values(PORTS).map((m) => m.wiki).filter((t): t is string => !!t));
const sources = await catalogueSources();

// names other sources already use (a renamed listing must not collide with, say, the wasm.rip import of the same game)
const otherNames = new Map(apps.filter((a) => !(a.tags ?? []).includes(SOURCE) && a.status === "published").map((a) => [a.name.toLowerCase(), a]));

const report = { patched: 0, unchanged: 0, unpublished: 0, refused: [] as string[], unknown: [] as string[], collisions: [] as string[], failed: [] as string[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

for (const [rowNameKey, app] of detail) {
	if (only && !rowNameKey.toLowerCase().includes(only)) continue;
	const meta = PORTS[rowNameKey];
	const into = MERGED.get(rowNameKey);
	const elsewhere = ELSEWHERE[rowNameKey];
	if (into || elsewhere || DROP.includes(rowNameKey)) {
		if (app.status !== "published") continue;
		console.log(`  − ${rowNameKey}  ${into ? `(folded into ${PORTS[into]?.name ?? into})` : elsewhere ? `(already listed as ${elsewhere})` : "(not a game)"}`);
		report.unpublished++;
		if (!dry) await api("POST", `/api/dev/apps/${app.id}/unpublish`).catch((e) => report.failed.push(`${rowNameKey}: ${e.message}`));
		continue;
	}
	if (!meta) {
		report.unknown.push(rowNameKey);
		continue;
	}
	const hit = meta.wiki ? cache[meta.wiki] : undefined;
	const wiki = hit && !("missing" in hit) ? hit : undefined;
	if (meta.wiki && !wiki) report.refused.push(`${rowNameKey} -> "${meta.wiki}": ${(hit as any)?.reason ?? "no data"}`);
	const alts = (meta.merge ?? []).map((n) => detail.get(n)).filter(Boolean);
	const next = plan(app, meta, wiki, alts, sources.get(rowNameKey.toLowerCase()));
	const clash = otherNames.get(next.name.toLowerCase());
	if (clash && next.name !== app.name) report.collisions.push(`${rowNameKey} -> "${next.name}" (also ${clash.slug}, tags ${(clash.tags ?? []).join(",")})`);

	const patch: Record<string, unknown> = {};
	for (const k of ["name", "summary", "description", "credits", "tags"] as const) if (!same(next[k], app[k])) patch[k] = next[k];
	if (!Object.keys(patch).length) {
		report.unchanged++;
		continue;
	}
	report.patched++;
	if (dry) {
		const devs = (c: Credit[]) => c.map((x) => `${x.role}:${x.name}`).join(", ");
		console.log(`\n  ✎ ${app.name}${patch.name ? `  ->  ${next.name}` : ""}`);
		if (patch.credits) console.log(`      credits: ${devs(app.credits)}\n           ->  ${devs(next.credits)}`);
		if (patch.summary) console.log(`      summary: ${next.summary}`);
		if (patch.tags) console.log(`      tags:    ${next.tags.join(", ")}`);
		if (only) console.log(`      description:\n${next.description.replace(/^/gm, "        ")}`);
		continue;
	}
	await api("PATCH", `/api/dev/apps/${app.id}`, { json: patch }).catch((e) => report.failed.push(`${rowNameKey}: ${e.message}`));
}
// ---- --release: a new version of each listing, so the cleanup shows in "Recently updated" ------------------------
if (argv.includes("--release")) {
	const NOTES = "Listing cleaned up: the game's real name, its original developer and publisher, a proper description and genres. Other ports of the same game are now named here instead of being separate listings.";
	const bump = (v: string) => {
		const p = v.split(".").map(Number);
		if (p.length < 2) p.push(0);
		p[p.length - 1] = (Number.isFinite(p[p.length - 1]) ? p[p.length - 1] : 0) + 1;
		return p.join(".");
	};
	const targets = [...detail].filter(([row, a]) => PORTS[row] && a.status === "published" && (!only || row.toLowerCase().includes(only)));
	let released = 0;
	for (const [row, a] of targets) {
		const current = await api<any>("GET", `/api/dev/apps/${a.id}`);
		const vs: any[] = current.versions ?? [];
		// already released by an earlier --release run
		if (vs.some((v) => v.notes === NOTES)) continue;
		const url = linkedUrl(current);
		const top = vs.map((v) => v.version).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })).pop() ?? "1.0.0";
		if (dry) {
			console.log(`  ↑ ${current.name}  ${top} -> ${bump(top)}`);
			released++;
			continue;
		}
		try {
			const out = await api<any>("POST", `/api/dev/apps/${a.id}/versions`, { json: { version: bump(top), notes: NOTES, linkedUrl: url } });
			const draft = (out.versions ?? []).find((v: any) => v.state === "draft");
			if (!draft) throw new Error("no draft version was created");
			await api("POST", `/api/dev/versions/${draft.id}/submit`, { json: { keepPrevious: false } });
			released++;
		} catch (e) {
			report.failed.push(`${row} (release): ${(e as Error).message}`);
		}
	}
	console.log(`\n${dry ? "[dry] " : ""}${released} new versions released`);
}
closeTunnel();

console.log(`\n${dry ? "[dry] " : ""}${report.patched} listings updated, ${report.unchanged} already clean, ${report.unpublished} unpublished (merged or not a game)`);
if (report.refused.length) console.log(`\narticle refused or missing (makers left unknown):\n${report.refused.map((x) => `  - ${x}`).join("\n")}`);
if (report.collisions.length) console.log(`\nsame name as a listing from another source:\n${report.collisions.map((x) => `  - ${x}`).join("\n")}`);
if (report.unknown.length) console.log(`\nnot in lib/webportsMeta.ts (left alone):\n${report.unknown.map((x) => `  - ${x}`).join("\n")}`);
if (report.failed.length) {
	console.log(`\nfailed:\n${report.failed.map((x) => `  - ${x}`).join("\n")}`);
	process.exitCode = 1;
}
