// Cloudflare Pages worker for Shasta. `bun run deploy cloudflare` copies it to `_worker.js` and fills in the
// placeholders. Static files never reach it (`_routes.json` sends only the paths below here), so they stay free
// and unmetered. Wisp cannot run on Cloudflare itself (TCP sockets to Cloudflare IPs, i.e. a large part of the
// web, are blocked, and the free plan allows 10 ms of CPU per request), and the Store needs bun + SQLite + disk:
//   /api/*, /wisp/*  -> the real backend (the Docker image on a VPS, or `bun run share` for now)
//   /ai-models/*     -> the backend's mirror when there is one, else Hugging Face directly (same allow-list)
//   files over Pages' 25 MiB limit (the ONNX Runtime wasm) -> jsdelivr, same version, checked byte-identical
// The backend can also be changed without a rebuild: SHASTA_BACKEND_URL in the Pages project settings wins.

const BACKEND = "__SHASTA_BACKEND__";
/** published path -> upstream URL, for the files that are too big for Pages */
const OVERSIZE = JSON.parse("__SHASTA_OVERSIZE__");

const MODEL_ORGS = ["onnx-community", "HuggingFaceTB", "Xenova"];
const SEGMENT = /^[A-Za-z0-9_.@-]{1,160}$/;
const REVISION = /^(main|[0-9a-f]{40})$/;

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		const backend = (env.SHASTA_BACKEND_URL || BACKEND).replace(/\/+$/, "");
		const path = url.pathname;

		if (OVERSIZE[path]) return fromUpstream(request, OVERSIZE[path], path.startsWith("/assets/"));
		// Cloud games: proxy the stratus API from Cloudflare's edge, NOT from the VPS. The mirrors' /stratus/*
		// backend is fine from the US but stalls from the VPS's Frankfurt colo, so fetching it here (in the
		// visitor's own colo) is what actually works. Falls back to the backend if every mirror fails.
		if (path.startsWith("/cloud/")) return cloudProxy(request, env, backend);
		if (path.startsWith("/ai-models/")) return backend ? toBackend(request, backend, env) : fromHuggingFace(request, path);
		if (path.startsWith("/api/") || path.startsWith("/wisp/") || path === "/healthz") {
			if (backend && EDGE_CACHED.test(path) && isAnonymousRead(request, url)) return cachedBackend(request, backend, env, ctx);
			if (backend) return toBackend(request, backend, env);
			return noBackend(path);
		}
		return env.ASSETS.fetch(request);
	},
};

// Public Store reads and published icons/screenshots are kept in this data centre's cache for as long as the backend
// allows (`s-maxage` on catalogue answers, `immutable` media), so a crowd opening the Store mostly never reaches the
// tunnel or the VPS. Only anonymous reads: a request with a cookie (a staff session) or another site's Origin always
// goes straight through. Browsers still revalidate catalogue answers every time (ETag -> 304 from here).
// Note: the Cache API does nothing on some *.dev hostnames; it takes effect on a custom domain.
const EDGE_CACHED = /^\/api\/(catalog\/|media\/)/;

function isAnonymousRead(request, url) {
	if (request.method !== "GET") return false;
	if (request.headers.get("Cookie")) return false;
	const origin = request.headers.get("Origin");
	return !origin || origin === url.origin;
}

function edgeTtl(headers) {
	const cc = headers.get("Cache-Control") || "";
	if (!/\bpublic\b/.test(cc) || headers.get("Set-Cookie")) return 0;
	if (/\bimmutable\b/.test(cc)) return 31536000;
	const m = /s-maxage=(\d+)/.exec(cc);
	return m ? Math.min(Number(m[1]), 3600) : 0;
}

/** 304 when the browser already has this version */
function answer(request, response, cacheState) {
	const headers = new Headers(response.headers);
	headers.set("X-Shasta-Edge", cacheState);
	const etag = headers.get("ETag");
	if (etag && request.headers.get("If-None-Match") === etag) {
		for (const h of ["Content-Length", "Content-Encoding", "Content-Type"]) headers.delete(h);
		return new Response(null, { status: 304, headers });
	}
	return new Response(response.body, { status: response.status, headers });
}

async function cachedBackend(request, backend, env, ctx) {
	const cache = caches.default;
	const key = new Request(request.url, { method: "GET" });
	const hit = await cache.match(key).catch(() => null);
	if (hit) {
		const headers = new Headers(hit.headers);
		headers.set("Cache-Control", headers.get("X-Browser-Cache-Control") || "no-cache");
		headers.delete("X-Browser-Cache-Control");
		return answer(request, new Response(hit.body, { status: hit.status, headers }), "hit");
	}
	// ask for the whole answer (not a 304) so it can be stored
	const plain = new Request(request, { headers: new Headers(request.headers) });
	plain.headers.delete("If-None-Match");
	plain.headers.delete("If-Modified-Since");
	const r = await toBackend(plain, backend, env);
	const ttl = r.status === 200 ? edgeTtl(r.headers) : 0;
	if (ttl) {
		const stored = new Response(r.clone().body, r);
		stored.headers.set("X-Browser-Cache-Control", r.headers.get("Cache-Control"));
		stored.headers.set("Cache-Control", `public, max-age=${ttl}`);
		ctx.waitUntil(cache.put(key, stored).catch(() => {}));
	}
	return answer(request, r, ttl ? "miss" : "bypass");
}

async function toBackend(request, backend, env) {
	const url = new URL(request.url);
	const target = new URL(url.pathname + url.search, backend);
	const headers = new Headers(request.headers);
	// the backend refuses requests without it (BACKEND_KEY in server.mjs); a Pages secret, never sent to browsers
	headers.delete("X-Shasta-Backend-Key");
	if (env.SHASTA_BACKEND_KEY) headers.set("X-Shasta-Backend-Key", env.SHASTA_BACKEND_KEY);
	// The Store API only accepts its own Origin. The browser vouched that this request comes from our page, so
	// say the same in the backend's terms; any other Origin goes through unchanged and is refused there.
	if (headers.get("Origin") === url.origin) headers.set("Origin", target.origin);
	// The visitor's address, for the backend's per-IP limits (it trusts this only with TRUST_PROXY=1).
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip) headers.set("X-Forwarded-For", ip);
	headers.set("X-Forwarded-Host", url.host);
	headers.set("X-Forwarded-Proto", "https");
	try {
		// A websocket upgrade (Wisp) is passed straight through by the runtime, so it costs no CPU per message.
		return await fetch(target, { method: request.method, headers, body: request.body, redirect: "manual" });
	} catch {
		return offline(url.pathname);
	}
}

// ---- cloud games (opium.best "stratus") ------------------------------------------------------------------------
// The player's control plane goes through /cloud/*. We forward it to one of the public mirror hosts from here, so
// the visitor only ever talks to this domain (a school filter that blocks cdn.vipersfutbol.com still works).
// Mirrors are interchangeable (a session created on one can be signalled on another), so one is picked, cached and
// swapped on failure. The signalling WebSocket is passed through the same way Wisp is.
const CLOUD_HOSTS = [
	"cdn.vipersfutbol.com",
	"cdn.northstreetumc.org",
	"cdn.pcesc.org",
	"cdn.kcchallengevbc.com",
	"cdn.slcbmooc.org",
	"cdn.topstargym.net",
	"cdn.goaplytexas.org",
	"cdn.clearfieldswimming.org",
	"cdn.richardacademy.cfd",
];
let cloudHost = null;
let cloudAt = 0;

async function probeCloud(host) {
	try {
		const r = await fetch(`https://${host}/stratus/status`, { signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } });
		// a Cloudflare challenge answers with HTML/403: still alive, just not JSON. Take it over nothing.
		if (!r.ok) return { host, idle: -1 };
		const j = await r.json();
		return j && j.pool && !j.pool.health?.down ? { host, idle: j.pool.idle ?? 0 } : null;
	} catch {
		return null;
	}
}

async function pickCloud() {
	if (cloudHost && Date.now() - cloudAt < 60_000) return cloudHost;
	const alive = (await Promise.all(CLOUD_HOSTS.map(probeCloud))).filter(Boolean);
	alive.sort((a, b) => b.idle - a.idle);
	cloudHost = alive[0]?.host ?? CLOUD_HOSTS[0];
	cloudAt = Date.now();
	return cloudHost;
}

async function cloudProxy(request, env, backend) {
	const url = new URL(request.url);
	const seg = url.pathname.slice("/cloud/".length).split("/");
	const pinned = seg[0] && seg[0] !== "stratus" ? seg[0] : null; // /cloud/<host>/stratus/... pins a mirror
	const rest = `/${(pinned ? seg.slice(1) : seg).join("/")}${url.search}`;
	const origin = request.headers.get("Origin");
	const cors = { Vary: "Origin" };
	if (origin) {
		cors["Access-Control-Allow-Origin"] = origin;
		cors["Access-Control-Allow-Credentials"] = "true"; // the player sends credentials:include
		cors["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
		cors["Access-Control-Allow-Headers"] = "content-type,x-api-key";
		cors["Access-Control-Max-Age"] = "600";
	}
	if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
	// our TURN-over-TLS fronts are backend config (CLOUD_TURN_RELAYS, services/cloudProxy.ts); none without one
	if (url.pathname === "/cloud/relay") {
		if (backend) return toBackend(request, backend, env);
		return new Response('{"relays":[]}', { headers: { ...cors, "content-type": "application/json", "Cache-Control": "no-store" } });
	}

	const upgrade = (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
	const fallback = upgrade ? request : request.clone();
	const body = upgrade || request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
	const headers = new Headers(request.headers);
	headers.delete("host");

	const primary = await pickCloud();
	for (const host of pinned ? [pinned] : [primary, ...CLOUD_HOSTS.filter((h) => h !== primary)]) {
		try {
			const r = await fetch(`https://${host}${rest}`, { method: request.method, headers, body, redirect: "manual", signal: upgrade ? undefined : AbortSignal.timeout(8000) });
			if (upgrade) {
				if (r.webSocket) return new Response(null, { status: 101, webSocket: r.webSocket });
				continue; // not a socket: try the next mirror (then the backend)
			}
			const out = new Headers(r.headers);
			for (const [k, v] of Object.entries(cors)) out.set(k, v);
			out.delete("set-cookie"); // the mirror's Domain= would be wrong on this host
			out.set("Cache-Control", "no-store");
			return new Response(r.body, { status: r.status, headers: out });
		} catch {
			cloudHost = null; // this one looks down; re-probe on the next call
		}
	}
	return backend ? toBackend(fallback, backend, env) : new Response(JSON.stringify({ error: "no cloud mirror answered" }), { status: 502, headers: { ...cors, "content-type": "application/json", "Cache-Control": "no-store" } });
}

// No SHASTA_BACKEND_URL yet (a frontend-only deployment). The app reads `X-Shasta-Backend: none` and the
// `no-backend` code to say "not connected yet" instead of "server down"; setting the variable in the Pages
// project connects a backend without a rebuild.
function noBackend(path) {
	const headers = { "Cache-Control": "no-store", "X-Shasta-Backend": "none" };
	if (path === "/healthz") return new Response("ok (no backend)", { headers: { ...headers, "Content-Type": "text/plain" } });
	const message = "This Shasta deployment has no server connected yet, so website browsing and the Store are unavailable. Everything stored on this device keeps working.";
	if (path.startsWith("/api/")) return Response.json({ error: { code: "no-backend", message } }, { status: 503, headers });
	return new Response(message, { status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } });
}

function offline(path) {
	const message = "Shasta's server is offline right now, so browsing and the Store are unavailable. Try again later.";
	if (path.startsWith("/api/")) {
		return Response.json({ error: { code: "offline", message } }, { status: 503, headers: { "Cache-Control": "no-store" } });
	}
	return new Response(message, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

async function fromUpstream(request, upstream, immutable) {
	const headers = {};
	for (const h of ["If-None-Match", "If-Modified-Since", "Range"]) if (request.headers.get(h)) headers[h] = request.headers.get(h);
	const r = await fetch(upstream, { method: request.method === "HEAD" ? "HEAD" : "GET", headers });
	const out = new Headers();
	for (const h of ["Content-Range", "ETag", "Last-Modified", "Accept-Ranges"]) if (r.headers.get(h)) out.set(h, r.headers.get(h));
	copyLength(r, out);
	out.set("Content-Type", "application/wasm");
	out.set("X-Content-Type-Options", "nosniff");
	out.set("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
	return new Response(r.body, { status: r.status, headers: out });
}

// Same rules as server/src/services/aiModels.ts: allow-listed orgs, `resolve` paths only, redirects only to
// Hugging Face's own hosts. Nothing is stored; the file streams through.
async function fromHuggingFace(request, pathname) {
	let parts;
	try {
		parts = pathname.slice("/ai-models/".length).split("/").map(decodeURIComponent);
	} catch {
		return notFound();
	}
	const [org, repo, resolve, rev, ...file] = parts;
	if (resolve !== "resolve" || !org || !repo || !rev || !file.length || file.length > 7) return notFound();
	if (!MODEL_ORGS.includes(org) || !REVISION.test(rev)) return notFound();
	for (const seg of [org, repo, ...file]) if (!SEGMENT.test(seg) || seg === "." || seg === "..") return notFound();

	let url = new URL(`https://huggingface.co/${org}/${repo}/resolve/${rev}/${file.map(encodeURIComponent).join("/")}`);
	for (let i = 0; i <= 5; i++) {
		const r = await fetch(url, { method: request.method === "HEAD" ? "HEAD" : "GET", redirect: "manual", headers: { "User-Agent": "shasta-model-mirror" } });
		if (r.status >= 300 && r.status < 400) {
			const next = allowedRedirect(r.headers.get("Location") || "", url.href);
			if (!next) return new Response("redirect to a host that is not allowed", { status: 502 });
			url = next;
			continue;
		}
		if (!r.ok) return new Response(`model file not available (${r.status})`, { status: r.status === 404 ? 404 : 502, headers: { "Cache-Control": "no-store" } });
		const name = file.at(-1);
		const out = new Headers({
			"Content-Type": name.endsWith(".json") ? "application/json; charset=utf-8" : name.endsWith(".txt") || name.endsWith(".jinja") ? "text/plain; charset=utf-8" : "application/octet-stream",
			"X-Content-Type-Options": "nosniff",
			"Cross-Origin-Resource-Policy": "same-origin",
			"Cache-Control": rev === "main" ? "public, max-age=3600" : "public, max-age=31536000, immutable",
		});
		copyLength(r, out);
		return new Response(r.body, { status: 200, headers: out });
	}
	return new Response("too many redirects", { status: 502 });
}

function allowedRedirect(location, base) {
	try {
		const u = new URL(location, base);
		const host = u.hostname.toLowerCase();
		const ok = host === "huggingface.co" || host.endsWith(".huggingface.co") || host === "hf.co" || host.endsWith(".hf.co");
		return u.protocol === "https:" && ok ? u : null;
	} catch {
		return null;
	}
}

// fetch() hands over a decoded body; the upstream length is only right when it was not compressed.
function copyLength(r, out) {
	if (r.headers.get("Content-Length") && !r.headers.get("Content-Encoding")) out.set("Content-Length", r.headers.get("Content-Length"));
}

const notFound = () => new Response("not found", { status: 404, headers: { "Cache-Control": "no-store" } });
