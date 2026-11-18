// Cloudflare Worker "shasta-mirrors": serves the FreeDNS mirror hostnames (scripts/mirrors/hosts.ts).
// Each mirror is a Cloudflare for SaaS custom hostname on the edushasta.lol zone (FreeDNS CNAME -> mirrors.edushasta.lol,
// an originless AAAA 100:: fallback origin) with its own Workers route to this script, so the main site is never routed
// here. It runs the Pages worker itself (scripts/pages-worker.js, filled in by `bun run mirrors:deploy`), so /api, /wisp,
// /cloud, /nowgg and /ai-models behave exactly as on the main site: straight to the VPS with the backend key, the
// visitor's own IP for the backend's per-IP limits, Origin rewritten from the mirror's. Only the static files differ:
// Pages has no ASSETS binding here, so they come from the public site (the same production build).
import pages from "./pages-worker.js";

const SITE = "https://edushasta.lol";

export default {
	fetch(request, env, ctx) {
		const site = new URL(env.SHASTA_SITE || SITE);
		return pages.fetch(request, { ...env, ASSETS: { fetch: (req) => fromSite(req, site) } }, ctx);
	},
};

async function fromSite(request, site) {
	const url = new URL(request.url);
	const r = await fetch(new URL(url.pathname + url.search, site), { method: request.method, headers: request.headers, redirect: "manual" });
	const location = r.headers.get("Location");
	if (!location || !location.startsWith(site.origin)) return r;
	// keep visitors on the mirror they came in on
	const out = new Response(r.body, r);
	out.headers.set("Location", url.origin + location.slice(site.origin.length));
	return out;
}
