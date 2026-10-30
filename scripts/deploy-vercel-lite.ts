// Shasta Lite on Vercel: `bun run deploy:vercel-lite` (from the root, so the root .env is loaded) -> https://shasta-lite.vercel.app
// Same build as Base44 (scripts/lib/liteBuild.ts), but Vercel sends real headers, so pages are cross-origin isolated
// from the first load (the service worker's own headers are then a no-op). Vercel project `shasta-lite` in
// dazaseals-projects (`VERCEL_SCOPE`, `SHASTA_LITE_PROJECT` override); the host must be in APP_ORIGINS on the VPS.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildLite, ROOT, run } from "./lib/liteBuild";

const OUT = join(ROOT, ".deploy/vercel-lite");
const project = process.env.SHASTA_LITE_PROJECT ?? "shasta-lite";
const scope = process.env.VERCEL_SCOPE ?? "dazaseals-projects";
const dry = process.argv.includes("--dry-run");

// Umami website "Shasta Lite (Vercel)"
// Ads: own Monetag zone if set (VITE_MONETAG_ZONE_VERCEL), else the full site's zone (VITE_MONETAG_ZONE).
const zone = process.env.VITE_MONETAG_ZONE_VERCEL || process.env.VITE_MONETAG_ZONE;
buildLite(OUT, "a3d45710-11bc-4ba5-a59f-8985ae3a3a92", "/", zone ? { VITE_MONETAG_ZONE: zone } : {});

// Same header policy as `bun run deploy vercel` (scripts/deploy.ts); no /api rewrite: Lite calls the full site directly.
const config = {
	cleanUrls: false,
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
	// shasta:// pages and ?app= links are client-side: every unknown path answers the app
	rewrites: [{ source: "/((?!assets/|scramjet/|controller/|adblock/|licenses/).*)", destination: "/index.html" }],
};
writeFileSync(join(OUT, "vercel.json"), JSON.stringify(config, null, 2));

if (dry) {
	console.log(`built in ${OUT} (--dry-run: not uploaded)`);
	process.exit(0);
}
run(["npx", "-y", "vercel@latest", "link", "--yes", "--project", project, "--scope", scope], OUT);
run(["npx", "-y", "vercel@latest", "deploy", "--prod", "--yes", "--scope", scope], OUT);
console.log("\x1b[33mpublic source must match what is hosted: run `bun run publish:source` (AGPL section 13)\x1b[0m");
