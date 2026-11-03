// Shasta Lite on Base44: the now.gg proxy on Base44's OWN domain (https://shasta-lte.base44.app/functions/nowgg),
// so a filter that blocks the full site's domains does not break now.gg games opened from here. A Base44 function
// cannot take sub-paths (`/functions/nowgg/oapi/...` is read as another function's name), so the now.gg path comes
// in `?p=` (the player builds it: docs/nowgg.md "Which proxy a game uses"); the request is forwarded, headers and
// body unchanged, to the full site's /nowgg (server/src/services/nowggProxy.ts does the real work there).
// Copied into .deploy/base44/base44/functions/nowgg/ by scripts/deploy-base44.ts. Runs on Deno, 5 min max.
const UPSTREAM = "https://edushasta.lol/nowgg";
const FALLBACK = "https://shasta-dtg.pages.dev/nowgg";
const PASS = ["accept", "content-type", "authorization", "x-ngg-fe-version", "x-ngg-playuser-token", "x-ngg-skip-evar-check", "x-location", "lang", "user-agent"];
const cors = (origin: string | null): Record<string, string> => ({
	"Access-Control-Allow-Origin": origin || "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "content-type,authorization,x-ngg-fe-version,x-ngg-playuser-token,x-ngg-skip-evar-check,x-location,lang,accept",
	"Access-Control-Expose-Headers": "content-type,x-nowgg-proxy-error,x-nowgg-via",
	"Access-Control-Max-Age": "600",
	Vary: "Origin",
});

export default async function (req: Request): Promise<Response> {
	const origin = req.headers.get("origin");
	if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
	const p = new URL(req.url).searchParams.get("p") || "";
	// only now.gg's own API paths: never an absolute URL or a way out of /nowgg
	if (!/^\/(oapi|accounts|ncm|apps)\//.test(p) || p.includes("..") || p.includes("//")) {
		return Response.json({ error: "bad path", code: "nowgg-bad-path" }, { status: 400, headers: cors(origin) });
	}
	const headers = new Headers();
	for (const h of PASS) { const v = req.headers.get(h); if (v) headers.set(h, v); }
	const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
	let up: Response | null = null;
	for (const base of [UPSTREAM, FALLBACK]) {
		try { up = await fetch(base + p, { method: req.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(45000) }); break; } catch { /* next */ }
	}
	if (!up) return Response.json({ error: "could not reach the Shasta now.gg proxy", code: "nowgg-unreachable" }, { status: 502, headers: cors(origin) });
	const out = new Headers(cors(origin));
	for (const h of ["content-type", "x-nowgg-proxy-error", "x-nowgg-via", "location"]) { const v = up.headers.get(h); if (v) out.set(h, v); }
	out.set("Cache-Control", "no-store");
	return new Response(await up.arrayBuffer(), { status: up.status, headers: out });
}
