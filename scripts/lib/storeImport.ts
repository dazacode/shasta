// Shared machinery for importing a whole external catalogue into the Shasta Store as linked apps.
// Talks to the Store API directly over ONE ssh tunnel (the same endpoints `shasta publish` uses), with a worker
// pool so a catalogue of tens of thousands is practical. Metadata/art are supplied by each source adapter.
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const HOST = process.env.SHASTA_SSH ?? "shasta";
const REMOTE_ENV = process.env.SHASTA_SSH_ENV || "/etc/shasta/shasta.env";

export interface ImportItem {
	/** the app name shown in the Store */
	name: string;
	/** the live web address the linked app opens */
	url: string;
	summary: string;
	description: string;
	/** original makers, shown first */
	developers: string[];
	/** whoever ported/found it, shown after the makers */
	porters?: { name: string; url?: string }[];
	/** where it came from; the credit shown last */
	host: { name: string; url: string };
	tags: string[];
	/** a Store category id (defaults to "games") */
	category?: string;
	iconUrl?: string;
	/** the wide image used as the banner screenshot */
	bannerUrl?: string;
	notes?: string;
	/** a tag that marks this app as ours, so re-runs update it and other sources' duplicates are skipped */
	source: string;
}

export interface RunOptions {
	dry?: boolean;
	only?: string;
	jobs?: number;
}

const die = (msg: string): never => {
	console.error(`import: ${msg}`);
	process.exit(1);
};

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function tagify(list: string[], extra: string[]): string[] {
	const out: string[] = [];
	for (const raw of [...list, ...extra]) {
		const t = String(raw)
			.toLowerCase()
			.trim()
			.replace(/\s+/g, "-")
			.replace(/[^\p{L}\p{N}-]/gu, "")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 24);
		if (t && !out.includes(t)) out.push(t);
		if (out.length >= 10) break;
	}
	return out;
}

const stripTags = (html: string) =>
	(html || "")
		.replace(/<\s*br\s*\/?>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&[a-z#0-9]+;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();

export function summarize(text: string, fallback: string): string {
	const t = stripTags(text);
	if (!t) return fallback.slice(0, 120);
	const stop = t.search(/\.(\s|$)/);
	const first = stop > 3 && stop <= 120 ? t.slice(0, stop + 1) : t;
	return first.length <= 120 ? first : `${first.slice(0, 117).trimEnd()}...`;
}

export function cleanText(html: string): string {
	return (html || "")
		.replace(/<\s*br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

// ---- ssh tunnel ------------------------------------------------------------------------------------------------
async function freePort(): Promise<number> {
	const net = await import("node:net");
	return new Promise((resolve, reject) => {
		const srv = net.createServer().once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address() as { port: number };
			srv.close(() => resolve(port));
		});
	});
}

const realConfig = process.env.SHASTA_CONFIG || path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "shasta", "cli.json");
const session = process.env.SHASTA_SESSION || (existsSync(realConfig) ? (JSON.parse(readFileSync(realConfig, "utf8")).cookie ?? "") : "");

let endpoint: { url: string; key: string } | null = null;
let tunnelProc: ReturnType<typeof Bun.spawn> | null = null;

async function connect() {
	if (endpoint) return endpoint;
	if (process.env.SHASTA_URL && !process.env.SHASTA_URL.startsWith("ssh://")) {
		endpoint = { url: process.env.SHASTA_URL.replace(/\/+$/, ""), key: process.env.SHASTA_BACKEND_KEY ?? "" };
		return endpoint;
	}
	const read = Bun.spawnSync(["ssh", "-o", "BatchMode=yes", HOST, `sudo -n grep -E '^(BACKEND_KEY|PORT)=' ${REMOTE_ENV}`], { stderr: "pipe" });
	if (read.exitCode !== 0) die(`cannot read ${REMOTE_ENV} over ssh on ${HOST}: ${read.stderr.toString().trim() || `exit ${read.exitCode}`}`);
	const env = Object.fromEntries(read.stdout.toString().trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
	const local = await freePort();
	tunnelProc = Bun.spawn(["ssh", "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ControlPath=none", "-L", `127.0.0.1:${local}:127.0.0.1:${env.PORT || "8080"}`, HOST], { stdout: "ignore", stderr: "pipe" });
	for (let i = 0; i < 50; i++) {
		if (tunnelProc.exitCode !== null) break;
		try {
			if ((await fetch(`http://127.0.0.1:${local}/healthz`)).ok) {
				endpoint = { url: `http://127.0.0.1:${local}`, key: env.BACKEND_KEY ?? "" };
				return endpoint;
			}
		} catch {}
		await Bun.sleep(200);
	}
	tunnelProc.kill();
	return die(`cannot open an ssh tunnel to ${HOST}`);
}

export function closeTunnel() {
	tunnelProc?.kill();
	tunnelProc = null;
	endpoint = null;
}

export async function api<T = any>(method: string, p: string, opts: { json?: unknown; raw?: Uint8Array } = {}): Promise<T> {
	const { url, key } = await connect();
	const headers: Record<string, string> = {};
	if (key) headers["X-Shasta-Backend-Key"] = key;
	if (session) headers.Cookie = session;
	let body: BodyInit | undefined;
	if (opts.raw) {
		headers["Content-Type"] = "application/octet-stream";
		body = opts.raw as unknown as BodyInit;
	} else if (opts.json !== undefined) {
		headers["Content-Type"] = "application/json";
		body = JSON.stringify(opts.json);
	}
	const res = await fetch(url + p, { method, headers, body });
	const text = await res.text();
	let data: any;
	try {
		data = text ? JSON.parse(text) : undefined;
	} catch {
		data = undefined;
	}
	if (!res.ok) {
		const det = data?.error?.details;
		throw new Error(`${res.status} ${data?.error?.message ?? res.statusText}${Array.isArray(det) ? ` (${det.join("; ")})` : ""}`);
	}
	return data as T;
}

// ---- images ----------------------------------------------------------------------------------------------------
const requireFromShasta = createRequire(path.join(root, "shasta/package.json"));
let _sharp: any = null;
const sharp = () => (_sharp ??= requireFromShasta("sharp"));

async function get(url: string, timeoutMs = 20000): Promise<Buffer> {
	const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!r.ok) throw new Error(`${r.status} for ${url}`);
	return Buffer.from(await r.arrayBuffer());
}
async function iconFrom(bytes: Buffer, file: string) {
	await sharp()(bytes).resize(256, 256, { fit: "cover", position: "attention" }).png({ compressionLevel: 9 }).toFile(file);
}
export async function letterIcon(name: string, file: string) {
	const h = [...name].reduce((x, c) => (x * 31 + c.charCodeAt(0)) % 360, 7);
	const ch = (name.trim().charAt(0) || "?").toUpperCase().replace(/[<>&]/g, "");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="oklch(0.62 0.17 ${h})"/><stop offset="1" stop-color="oklch(0.4 0.12 ${(h + 40) % 360})"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><text x="128" y="132" font-family="Helvetica,Arial,sans-serif" font-size="140" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central">${ch}</text></svg>`;
	await sharp()(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
}

// ---- the run ---------------------------------------------------------------------------------------------------
interface Existing {
	tags: string[];
	versions: string[];
	draft?: string;
	screenshots: number;
}
const idCache = new Map<string, string>();
const bump = (v: string) => {
	const p = v.split(".").map(Number);
	p[p.length - 1] = (Number.isFinite(p[p.length - 1]) ? p[p.length - 1] : 0) + 1;
	return p.join(".");
};
const highest = (vs: string[]) => vs.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const devAppFields = (a: any): Existing => ({ tags: a.tags ?? [], versions: (a.versions ?? []).map((v: any) => v.version), draft: (a.versions ?? []).find((v: any) => v.state === "draft")?.version, screenshots: (a.screenshots ?? []).length });

function appPayload(item: ImportItem, name: string) {
	let description = (item.description || "").replace(/\s+/g, " ").trim();
	if (description.length < 20) description = `${name}${description ? `: ${description}` : ""} — a linked web app from ${item.host.name}.`;
	let summary = (item.summary || "").replace(/\s+/g, " ").trim() || description.slice(0, 120);
	return {
		name,
		summary: summary.slice(0, 120),
		description: description.slice(0, 5000),
		category: item.category ?? "games",
		tags: tagify(item.tags, [item.source]),
		credits: [
			...item.developers.slice(0, 6).map((d) => ({ role: "developer", name: d.slice(0, 60) })),
			...(item.porters ?? []).slice(0, 4).map((p) => (p.url ? { role: "port", name: p.name.slice(0, 60), url: p.url } : { role: "port", name: p.name.slice(0, 60) })),
			{ role: "host", name: item.host.name.slice(0, 60), url: item.host.url },
		].slice(0, 12),
	};
}

export async function runImport(items: ImportItem[], opts: RunOptions = {}) {
	const wanted = items.filter((i) => !opts.only || i.name.toLowerCase().includes(opts.only.toLowerCase()));
	if (!wanted.length) die(`nothing matches --only "${opts.only}"`);

	const work = mkdtempSync(path.join(tmpdir(), "import-"));
	const existing = new Map<string, Existing>();
	if (!opts.dry) {
		await connect();
		const { apps } = await api<{ apps: any[] }>("GET", "/api/dev/apps?all=1&brief=1");
		for (const a of apps) {
			existing.set(norm(a.name), devAppFields(a));
			idCache.set(norm(a.name), a.id);
		}
	}

	const jobs = Math.max(1, Math.min(opts.jobs ?? 6, 16));
	let done = 0;
	let skipped = 0;
	let failed = 0;
	let cursor = 0;
	const failures: string[] = [];
	const t0 = Date.now();

	const publishOne = async (item: ImportItem) => {
		let name = item.name.replace(/\s+/g, " ").trim().slice(0, 60);
		if (name.length < 2) name = `${name} app`;
		const key = norm(name);
		const already = existing.get(key);
		if (already && !already.tags.includes(item.source)) {
			skipped++;
			return;
		}
		if (opts.dry) {
			console.log(`  · ${name}`);
			return;
		}
		let version = already ? (already.draft ?? (already.versions.length ? bump(highest(already.versions)!) : "1.0.0")) : "1.0.0";
		try {
			let app: any;
			if (already) {
				app = await api<any>("PATCH", `/api/dev/apps/${idCache.get(key)}`, { json: appPayload(item, name) });
			} else {
				app = await api<any>("POST", "/api/dev/apps", { json: { ...appPayload(item, name), kind: "linked" } });
				idCache.set(key, app.id);
				// remember this name so a second entry with the same name bumps instead of colliding
				existing.set(key, { tags: [item.source], versions: [version], draft: undefined, screenshots: 0 });
			}
			const appId = app.id as string;

			// icon (a letter tile when the source has no art)
			const iconFile = path.join(work, `icon-${appId}.png`);
			try {
				if (item.iconUrl) await iconFrom(await get(item.iconUrl), iconFile);
				else await letterIcon(name, iconFile);
			} catch {
				await letterIcon(name, iconFile);
			}
			await api("PUT", `/api/dev/apps/${appId}/icon`, { raw: readFileSync(iconFile) });

			// banner only on first import, so re-runs do not stack screenshots
			if (item.bannerUrl && (!already || already.screenshots === 0)) {
				const shot = path.join(work, `shot-${appId}.webp`);
				try {
					await sharp()(await get(item.bannerUrl)).resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 82 }).toFile(shot);
				} catch {}
				if (existsSync(shot)) await api("POST", `/api/dev/apps/${appId}/screenshots`, { raw: readFileSync(shot) });
			}

			// version + submit; retry on a same-name collision (two catalogue entries) or a leftover draft
			let published = false;
			for (let attempt = 0; attempt < 6 && !published; attempt++) {
				try {
					const v = await api<any>("POST", `/api/dev/apps/${appId}/versions`, { json: { version, notes: item.notes ?? "", linkedUrl: item.url } });
					const draft = (v.versions ?? []).find((x: any) => x.state === "draft" && x.version === version);
					if (!draft) throw new Error("could not create a draft version");
					await api("POST", `/api/dev/versions/${draft.id}/submit`, { json: { keepPrevious: false } });
					published = true;
				} catch (e) {
					const msg = (e as Error).message;
					if (/already been submitted/i.test(msg)) {
						published = true;
					} else if (/higher than ([\d.]+)/.exec(msg)) {
						version = bump(/higher than ([\d.]+)/.exec(msg)![1]);
					} else if (/already in progress/i.test(msg)) {
						const now = await api<any>("GET", `/api/dev/apps/${appId}`).catch(() => null);
						const draft = (now?.versions ?? []).find((x: any) => x.state === "draft");
						if (draft) {
							await api("POST", `/api/dev/versions/${draft.id}/submit`, { json: { keepPrevious: false } }).catch(() => undefined);
							published = true;
						}
						// else the other writer just finished: loop and re-evaluate the version
					} else {
						throw e;
					}
				}
			}
			if (!published) throw new Error("could not publish a version");

			done++;
			if (done % 200 === 0) console.log(`  … ${done} imported, ${skipped} skipped · ${(done / ((Date.now() - t0) / 1000)).toFixed(1)}/s`);
		} catch (e) {
			failed++;
			failures.push(`${item.name}: ${(e as Error).message}`);
			if (failures.length <= 30) console.log(`  ✗ ${item.name}  ${(e as Error).message}`);
		}
	};

	await Promise.all(
		new Array(jobs).fill(0).map(async () => {
			while (cursor < wanted.length) await publishOne(wanted[cursor++]);
		}),
	);

	rmSync(work, { recursive: true, force: true });
	closeTunnel();
	console.log(`\n${done} imported, ${skipped} skipped, ${failed} failed · ${((Date.now() - t0) / 60000).toFixed(1)} min`);
	if (failures.length) console.log(`\nfirst failures:\n${failures.slice(0, 40).map((f) => `  - ${f}`).join("\n")}`);
	if (failed) process.exitCode = 1;
}
