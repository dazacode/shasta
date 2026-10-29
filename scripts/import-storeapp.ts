#!/usr/bin/env bun
/**
 * Adds every web app in the store.app catalogue (https://store.app, by PWA Labs) to the Shasta Store as a linked app.
 *
 * store.app is a directory of web apps/PWAs; each page carries structured data (name, description, real URL, icon).
 * Entries already in the Store (ChatGPT, Discord, games…) are skipped by name.
 *
 *   bun scripts/import-storeapp.ts [--dry] [--only Notion] [--jobs 6]
 */
import { runImport, summarize, type ImportItem } from "./lib/storeImport";

const SITE = "https://store.app";
const argv = process.argv.slice(2);
const opt = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

// store.app category slug -> Store category id
const CAT: Record<string, string> = {
	games: "games",
	entertainment: "entertainment",
	music: "entertainment",
	"photo_video": "entertainment",
	sports: "entertainment",
	kids: "entertainment",
	news: "entertainment",
	social: "entertainment",
	education: "education",
	reference: "education",
	medical: "education",
};
const CAT_PRIORITY = ["games", "entertainment", "education", "productivity"];
const KNOWN_CATS = new Set(["ai", "business", "crypto", "developer-tools", "education", "entertainment", "finance", "food-drink", "graphics-design", "health-fitness", "kids", "lifestyle", "medical", "music", "navigation", "news", "photo_video", "productivity", "reference", "shopping", "social", "sports", "travel", "utilities", "weather", "games"]);

const BRAND_FIX: Record<string, string> = { openai: "OpenAI", github: "GitHub", iphone: "iPhone", chatgpt: "ChatGPT", youtube: "YouTube", whatsapp: "WhatsApp" };
function brandFrom(url: string, fallback: string): string {
	try {
		const parts = new URL(url).hostname.replace(/^www\./, "").split(".");
		const label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
		const clean = label.replace(/[^a-z0-9]/gi, "").toLowerCase();
		if (!clean) return fallback;
		return BRAND_FIX[clean] ?? clean.charAt(0).toUpperCase() + clean.slice(1);
	} catch {
		return fallback;
	}
}

async function mapLimit<T, R>(list: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
	let i = 0;
	const out: R[] = new Array(list.length);
	await Promise.all(
		new Array(Math.min(limit, list.length)).fill(0).map(async () => {
			while (i < list.length) {
				const j = i++;
				out[j] = await fn(list[j]);
			}
		}),
	);
	return out;
}

const sitemap = await (await fetch(`${SITE}/apps/sitemap.xml`)).text();
const slugs = [...sitemap.matchAll(/<loc>https:\/\/store\.app\/([^<]+)<\/loc>/g)].map((m) => m[1]).filter((s) => s && !s.includes("/") && !["browse", "search", "about", "privacy", "terms", "list", "sitemap"].includes(s));
console.log(`${slugs.length} store.app entries`);

const items = (
	await mapLimit(slugs, 10, async (slug): Promise<ImportItem | null> => {
		try {
			const html = await (await fetch(`${SITE}/${slug}`)).text();
			const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
			if (!ld) return null;
			const data = JSON.parse(ld) as { name?: string; description?: string; url?: string; image?: string };
			const name = data.name?.trim();
			const url = data.url?.trim();
			if (!name || !url || !/^https?:/.test(url)) return null;
			const cats = [...html.matchAll(/href="\/browse\/all\/([a-z_-]+)"/g)].map((m) => m[1]).filter((c) => KNOWN_CATS.has(c));
			const category = CAT_PRIORITY.find((p) => cats.some((c) => (CAT[c] ?? "productivity") === p)) ?? "productivity";
			const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
			const description = (data.description || name).trim();
			return {
				name: name.slice(0, 60),
				url,
				summary: summarize(description, name),
				description,
				developers: [brandFrom(url, name)],
				host: { name: "Store.app", url: SITE },
				tags: cats.slice(0, 4),
				category,
				iconUrl: data.image || og,
				bannerUrl: og || data.image,
				notes: "Listed on Store.app, a web-app directory.",
				source: "storeapp",
			};
		} catch {
			return null;
		}
	})
).filter((x): x is ImportItem => !!x);

console.log(`${items.length} store.app apps with metadata`);
await runImport(items, { dry: argv.includes("--dry"), only: opt("only"), jobs: Number(opt("jobs")) || undefined });
