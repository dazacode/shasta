// Shasta on your phone: its own small service worker, scoped to /me/ ONLY. It never touches Shasta's main worker
// (/sw.js: the proxy engine and the browser's offline shell) and never answers anything outside the phone app.
// What it does: keeps a copy of the phone app (me.html and its /assets/ files) so /me/ opens without a connection.
// It never answers /api, /wisp, /~/, /ai-models, /cloud, /nowgg or another origin: those always go to the network.
// The browser registers it from src/me/main.tsx. Hosts serve the app at /me; a navigation to /me/ (or below) is
// answered here from the network copy of /me first, then the saved copy.
const CACHE = "shasta-me-v1";
const PAGE = new URL("../me", self.registration.scope).pathname; // "/me" (or "<base>me")
const NEVER = /^\/(api|wisp|~|ai-models|cloud|nowgg)(\/|$)/;

const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);

async function savePage(response) {
	const cache = await caches.open(CACHE);
	const html = await response.clone().text();
	await cache.put(PAGE, response.clone());
	const wanted = new Set(assetsOf(html));
	await Promise.all([...wanted].map((u) => cache.match(u).then((hit) => hit || cache.add(u).catch(() => {}))));
	// many versions later: drop build files this page no longer names (a lazy chunk still in use is fetched again)
	const keys = await cache.keys();
	if (keys.length > 150) {
		for (const req of keys) {
			const p = new URL(req.url).pathname;
			if (p.startsWith("/assets/") && !wanted.has(p)) await cache.delete(req);
		}
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		fetch(PAGE, { cache: "no-cache", credentials: "omit" })
			.then((r) => (r.ok ? savePage(r) : null))
			.catch(() => {})
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k.startsWith("shasta-me-") && k !== CACHE).map((k) => caches.delete(k))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const req = event.request;
	if (req.method !== "GET" || req.headers.has("range")) return;
	const url = new URL(req.url);
	if (url.origin !== location.origin || NEVER.test(url.pathname)) return;

	if (req.mode === "navigate") {
		// only the phone app itself; anything else under /me/ that is a real file goes to the network
		if (!(url.pathname === `${PAGE}/` || url.pathname === `${PAGE}/index.html`)) return;
		event.respondWith(
			fetch(PAGE, { cache: "no-cache", credentials: "omit" })
				.then((r) => {
					if (r.ok) event.waitUntil(savePage(r.clone()));
					return r;
				})
				.catch(async () => (await caches.match(PAGE, { cacheName: CACHE })) || Response.error()),
		);
		return;
	}

	// content-hashed build files and the stickers: the saved copy first (they never change under the same name)
	if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/social/stickers/")) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const hit = await cache.match(req);
				if (hit) return hit;
				const r = await fetch(req);
				if (r.ok && r.type === "basic") event.waitUntil(cache.put(req, r.clone()));
				return r;
			}),
		);
	}
});
