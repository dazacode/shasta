#!/usr/bin/env bun
// Probes every reading source Shasta Watch would read from: metadata (AniList/Gutendex), page images
// (MangaDex/Weeb Central/XOXO) and chapter text (NovelFire/Gutenberg). These sites churn, so run this
// before trusting a reading shelf. Nothing here touches the app.
//
//   bun run read:probe            # table
//   bun run read:probe --json     # machine-readable
//   bun run read:probe --only mangadex
//
// Exit code is 1 when fewer than --min (default 1) image sources answer, so it can gate a release.
import { mangadex } from "../server/src/services/watch/read/mangadex";
import { weebcentral } from "../server/src/services/watch/read/weebcentral";
import { xoxo } from "../server/src/services/watch/read/xoxo";
import { viewcomics } from "../server/src/services/watch/read/viewcomics";
import { novelfire } from "../server/src/services/watch/read/novelfire";
import { gutenberg } from "../server/src/services/watch/read/gutenberg";
import { anilistMangaList } from "../server/src/services/watch/meta";
import { findSeries } from "../server/src/services/watch/read";
import { isImage } from "../server/src/services/watch/read/http";
import type { Provider } from "../server/src/services/watch/read/types";

interface Result { source: string; kind: string; ok: boolean; note: string; sample: string }

const IMAGE: { provider: Provider; query: string; kind: "manga" | "comic" }[] = [
	{ provider: mangadex, query: "berserk", kind: "manga" },
	{ provider: weebcentral, query: "berserk", kind: "manga" },
	{ provider: viewcomics, query: "batman-2016", kind: "comic" },
	{ provider: xoxo, query: "batman-2016", kind: "comic" },
];
const TEXT: { provider: Provider; query: string }[] = [
	{ provider: novelfire, query: "coiling dragon" },
	{ provider: gutenberg, query: "frankenstein" },
];

const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
const json = process.argv.includes("--json");
const min = Number(process.env.MIN_READ_OK ?? 1);

const skip = (id: string) => only && !id.toLowerCase().includes(only.toLowerCase());

async function probeImages(p: Provider, query: string, kind: string): Promise<Result> {
	const base: Result = { source: p.id, kind, ok: false, note: "", sample: "" };
	try {
		const found = await p.search(query);
		base.note = `${found.length} result(s)`;
		const first = found[0];
		if (!first) return base;
		const chapters = await p.chapters(first.ref);
		base.note += `, ${chapters.length} chapter(s)`;
		const ch = chapters[0];
		if (!ch || !p.pages) return base;
		const pages = await p.pages(first.ref, ch);
		const live = pages[0] ? await isImage(pages[0].url, pages[0].referer) : false;
		base.sample = `${first.title} · ch${ch.number} · ${pages.length} pages · image=${live ? "ok" : "FAIL"} · ${pages[0]?.url.slice(0, 55)}`;
		base.ok = pages.length > 0 && live;
	} catch (e) {
		base.note = (e as Error).message.slice(0, 80);
	}
	return base;
}

async function probeText(p: Provider, query: string): Promise<Result> {
	const base: Result = { source: p.id, kind: "text", ok: false, note: "", sample: "" };
	try {
		const found = await p.search(query);
		base.note = `${found.length} result(s)`;
		const first = found[0];
		if (!first) return base;
		const chapters = await p.chapters(first.ref);
		base.note += `, ${chapters.length} chapter(s)`;
		const ch = chapters[0];
		if (!ch || !p.text) return base;
		const body = await p.text(first.ref, ch);
		base.sample = `${first.title} · ${ch.title.slice(0, 40)} · ${body.html.length} bytes`;
		base.ok = body.html.length > 200;
	} catch (e) {
		base.note = (e as Error).message.slice(0, 80);
	}
	return base;
}

const results: Result[] = [];

const anilist = skip("anilist") ? null : await anilistMangaList("type:MANGA,sort:TRENDING_DESC", {}, "Trending")
	.then((cards): Result => ({ source: "anilist", kind: "metadata", ok: cards.length > 0, note: `${cards.length} manga`, sample: cards[0]?.title ?? "" }))
	.catch((e): Result => ({ source: "anilist", kind: "metadata", ok: false, note: (e as Error).message.slice(0, 80), sample: "" }));
if (anilist) results.push(anilist);

// the resolver's own title match: a known long series must resolve to a provider carrying the WHOLE run (the old
// early-return bug picked MangaDex's 16-chapter One Piece), so guard it.
const matched = skip("find") ? null : await findSeries("manga", "One Piece")
	.then((r): Result => ({ source: "title-match", kind: "series", ok: !!r && r.chapters.length > 500, note: r ? `${r.provider} · ${r.chapters.length} chapters` : "no match", sample: r?.title ?? "" }))
	.catch((e): Result => ({ source: "title-match", kind: "series", ok: false, note: (e as Error).message.slice(0, 80), sample: "" }));
if (matched) results.push(matched);

for (const t of IMAGE) if (!skip(t.provider.id)) results.push(await probeImages(t.provider, t.query, t.kind));
for (const t of TEXT) if (!skip(t.provider.id)) results.push(await probeText(t.provider, t.query));

const okImages = results.filter((r) => (r.kind === "manga" || r.kind === "comic") && r.ok).length;
const totalImages = results.filter((r) => r.kind === "manga" || r.kind === "comic").length;
const okText = results.filter((r) => r.kind === "text" && r.ok).length;
const totalText = results.filter((r) => r.kind === "text").length;
const matchOk = results.find((r) => r.source === "title-match")?.ok ?? true;

if (json) {
	console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
} else {
	const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
	console.log(`\nread probes — ${new Date().toISOString()}\n`);
	for (const r of results) console.log(`    ${r.ok ? "ok  " : "FAIL"} ${pad(r.source, 12)} ${pad(r.kind, 9)} ${r.note}${r.sample ? `\n         → ${r.sample}` : ""}`);
	console.log(`\n  ${okImages}/${totalImages} image sources returned pages; ${okText}/${totalText} text sources returned a chapter; title match ${matchOk ? "ok" : "FAIL"}.`);
}

process.exit((okImages >= (only ? 1 : min) && matchOk) ? 0 : 1);
