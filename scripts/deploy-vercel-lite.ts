// Shasta Lite on Vercel: `bun run deploy:vercel-lite` (from the root, so the root .env is loaded) -> https://shasta-lite.vercel.app
// Same build as Base44 (scripts/lib/liteBuild.ts), but Vercel sends real headers, so pages are cross-origin isolated
// from the first load (the service worker's own headers are then a no-op). Vercel project `shasta-lite` in
// dazaseals-projects (`VERCEL_SCOPE`, `SHASTA_LITE_PROJECT` override); the host must be in APP_ORIGINS on the VPS.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { adEnv } from "./lib/adCodes";
import { buildLite, ROOT, run } from "./lib/liteBuild";

const OUT = join(ROOT, ".deploy/vercel-lite");
const project = process.env.SHASTA_LITE_PROJECT ?? "shasta-lite";
const scope = process.env.VERCEL_SCOPE ?? "dazaseals-projects";
const dry = process.argv.includes("--dry-run");
// --preview: a private preview deployment (Vercel Authentication) instead of production, e.g. to test the Wisp relay
const preview = process.argv.includes("--preview");

// Umami website "Shasta Lite (Vercel)"
// Ads: this host's own Adsterra codes (scripts/lib/adCodes.ts)
buildLite(OUT, "a3d45710-11bc-4ba5-a59f-8985ae3a3a92", "/", { ...adEnv("vercel"), VITE_NOWGG_SELF: "1", VITE_WISP_SELF: "1" });

// Wisp on this domain: a Vercel Function relays /wisp/ to the full site's Wisp server (scripts/vercel-wisp/wisp.mjs),
// so browsing keeps working when a filter blocks the full site's domains. Vercel builds it from package.json here.
// maxDuration = how long one tunnel lives before the client reconnects (team on Pro since 2026-11-03: up to 800; Hobby allowed 300).
const WISP_MAX = Number(process.env.VERCEL_WISP_MAX_DURATION || 800);
mkdirSync(join(OUT, "api"), { recursive: true });
copyFileSync(join(ROOT, "scripts/vercel-wisp/wisp.mjs"), join(OUT, "api/wisp.mjs"));
writeFileSync(join(OUT, "package.json"), JSON.stringify({ name: "shasta-lite", private: true, type: "module", dependencies: { "@vercel/functions": "3.10.6", ws: "8.18.3" } }, null, 2));

// Same header policy as `bun run deploy vercel` (scripts/deploy.ts); no /api rewrite: Lite calls the full site directly.
const config = {
	cleanUrls: false,
	functions: { "api/wisp.mjs": { maxDuration: WISP_MAX } },
	headers: [
		{
			source: "/(.*)",
			headers: [
				{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
				{ key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
				{ key: "Document-Isolation-Policy", value: "isolate-and-credentialless" },
				{ key: "Content-Security-Policy", value: "frame-ancestors 'self' https://sites.google.com https://*.gstatic.com https://*.googleusercontent.com" },
			],
		},
		{ source: "/((?!assets/).*)", headers: [{ key: "Cache-Control", value: "no-cache" }] },
		{ source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
		{ source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/" }] },
	],
	// shasta:// pages and ?app= links are client-side: every unknown path answers the app.
	// /cloud/* rides the full site's Cloudflare worker (the cloud-game proxy), so a Lite mirror works too.
	// /nowgg/* likewise, at Vercel's edge: a now.gg game opened here talks to THIS domain only (VITE_NOWGG_SELF).
	rewrites: [{ source: "/cloud/:path*", destination: "https://edushasta.lol/cloud/:path*" }, { source: "/nowgg/:path*", destination: "https://edushasta.lol/nowgg/:path*" }, { source: "/wisp/", destination: "/api/wisp" }, { source: "/wisp", destination: "/api/wisp" }, { source: "/((?!assets/|scramjet/|controller/|rt/|adblock/|licenses/|api/).*)", destination: "/index.html" }],
};
writeFileSync(join(OUT, "vercel.json"), JSON.stringify(config, null, 2));

if (dry) {
	console.log(`built in ${OUT} (--dry-run: not uploaded)`);
	process.exit(0);
}
run(["npx", "-y", "vercel@latest", "link", "--yes", "--project", project, "--scope", scope], OUT);
run(["npx", "-y", "vercel@latest", "deploy", ...(preview ? [] : ["--prod"]), "--yes", "--scope", scope], OUT);
console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` (AGPL section 13)\x1b[0m");
