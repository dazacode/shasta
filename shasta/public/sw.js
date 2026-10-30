// An Isolated Web App enforces Trusted Types in workers too, so importScripts() needs a policy (see /boot.js).
try {
	if (self.trustedTypes && !self.trustedTypes.defaultPolicy) {
		self.trustedTypes.createPolicy("default", { createHTML: (s) => s, createScript: (s) => s, createScriptURL: (s) => s });
	}
} catch {}
importScripts("/controller/controller.sw.js");

// ---- offline application shell ------------------------------------------------------------------------------
// Shasta's own files are kept in a cache named after the build, so the browser interface starts with no network.
// `bun run build` replaces the placeholder below with the build's version (shasta/offlineManifest.ts), which also
// lists every file with its sha256 in /offline-manifest.json. Under `bun run dev` the placeholder stays and the
// shell is off: Vite's modules must never be cached.
//
// Rules:
// - Scramjet routes first, exactly as before. The shell never answers anything under Scramjet's prefix (/~/), not
//   even after a restart of this worker has emptied Scramjet's list of tabs, and never another origin, /api,
//   /wisp, /ai-models or /healthz: proxied pages and the Store are always live.
// - Only navigations to / and files under /assets, /scramjet, /controller, /ort (plus root icons/manifest) are
//   looked up, cache first. Anything not cached goes to the network as usual.
// - Nothing enters the cache unless its sha256 matches the manifest of this version, so a half-deployed server can
//   never mix versions.
// - First visit: installing caches nothing, so Scramjet's worker is up at once; the page then asks for the files
//   (lib/offline.ts). Update: the new version is fully cached during install (unchanged files are copied from the
//   old cache). If that fails the install fails, and the browser keeps the old worker and its cache.
// - controller.sw.js calls skipWaiting() and clients.claim(): a successfully installed version takes over at once
//   and open windows keep running their old code (Scramjet revives them). So the previous version's cache is kept,
//   without the AI runtime, as a fallback for those windows (their lazy chunks and ?v= engine files), and dropped
//   at the next update.
// - Response headers are kept as the server sent them (COOP/COEP included), so a launch from the cache is
//   cross-origin isolated exactly when a launch from the server is.
const SHELL_VERSION = "__SHASTA_SHELL_VERSION__";
// Shasta Lite (scripts/deploy-base44.ts stamps "yes" here): its host cannot send headers, so this worker gives Shasta's
// own pages the cross-origin isolation the full site's server sends (threaded wasm games need it). Same policy as the
// server, on every same-origin page it serves: a document with a different policy would cut the shell off from it.
// Lite has no offline shell (the host rewrites index.html, so its checksums never match).
const LITE_BUILD = "__SHASTA_LITE__" === "yes";
const ISOLATION = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "credentialless",
	"Document-Isolation-Policy": "isolate-and-credentialless",
};
// Off in the installed app (an Isolated Web App): its files already come from the signed bundle on disk, which
// Chrome updates as a whole, so a cached copy on top would only serve the previous version.
const SHELL_ON = !SHELL_VERSION.startsWith("__") && location.protocol !== "isolated-app:" && !LITE_BUILD;
const SHELL_PREFIX = "shasta-shell-";
const SHELL_CACHE = SHELL_PREFIX + SHELL_VERSION;
const MANIFEST_URL = "/offline-manifest.json";
// which shell cache is active, so the next version knows which one to keep as "previous"
const META_CACHE = "shasta-offline-meta";
const META_URL = "/__shasta/offline-meta";
const SHELL_PATHS = /^\/(assets|scramjet|controller|ort)\/[^/]+$|^\/[^/]+\.(webmanifest|svg|png|ico)$/;

addEventListener("fetch", (e) => {
	if ($scramjetController.shouldRoute(e)) {
		e.respondWith($scramjetController.route(e));
		return;
	}
	if (LITE_BUILD && e.request.mode === "navigate" && new URL(e.request.url).origin === location.origin) {
		e.respondWith(isolated(e.request));
		return;
	}
	if (!SHELL_ON) return;
	const key = shellKey(e.request);
	if (key) e.respondWith(fromShell(e, key));
});

addEventListener("install", (e) => {
	if (SHELL_ON) e.waitUntil(installShell());
});

addEventListener("activate", (e) => {
	if (SHELL_ON) e.waitUntil(activateShell());
});

addEventListener("message", (e) => {
	const msg = e.data;
	if (!msg || typeof msg !== "object" || !msg.$shastaOffline || !e.ports[0]) return;
	const port = e.ports[0];
	e.waitUntil(
		handleMessage(msg.$shastaOffline, port).catch((err) => port.postMessage({ type: "error", ...describeError(err) }))
	);
});

/** Shasta Lite: the page from the network, with the isolation headers its host cannot send. */
async function isolated(request) {
	const response = await fetch(request);
	// a redirect (opaque) or an error page passes as it is
	if (response.type === "opaqueredirect" || response.status === 0) return response;
	const headers = new Headers(response.headers);
	for (const [k, v] of Object.entries(ISOLATION)) headers.set(k, v);
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** The cache key for a request the shell may answer, or null to leave the request alone. */
function shellKey(request) {
	if (request.method !== "GET" || request.headers.has("range")) return null;
	const url = new URL(request.url);
	if (url.origin !== location.origin) return null;
	if (request.mode === "navigate") {
		// /?online always goes to the network: signing in again behind an access gate (Cloudflare Access), whose
		// login page a cached start would never show
		if (url.searchParams.has("online")) return null;
		return url.pathname === "/" || url.pathname === "/index.html" ? "/index.html" : null;
	}
	return SHELL_PATHS.test(url.pathname) ? url.pathname + url.search : null;
}

async function fromShell(event, key) {
	const hit = await caches.match(key, { cacheName: SHELL_CACHE });
	if (hit) return hit;
	// a window still running the previous version asks for its own files (never a navigation: that starts fresh)
	if (event.request.mode !== "navigate") {
		const meta = await readMeta();
		const old = meta.previous && (await caches.match(key, { cacheName: meta.previous }));
		if (old) return old;
	}
	const response = await fetch(event.request);
	// an evicted or damaged entry is put back, once the shell has been downloaded at all
	if (response.ok) event.waitUntil(repair(key, response.clone()).catch(() => {}));
	return response;
}

async function repair(key, response) {
	if (!(await caches.has(SHELL_CACHE))) return;
	const manifest = await cachedManifest(SHELL_CACHE);
	const entry = manifest && manifest.files.find((f) => f.url === key);
	if (entry) await store(await caches.open(SHELL_CACHE), entry, response);
}

async function installShell() {
	try {
		await installShellFiles();
	} catch (err) {
		// the page asks for this (op "updateInfo"), so a failed update is reported instead of silently keeping the old version
		const meta = await readMeta(true);
		await writeMeta({ ...meta, lastUpdateError: { version: SHELL_VERSION, at: Date.now(), ...describeError(err) } });
		throw err;
	}
}

async function installShellFiles() {
	const older = (await caches.keys()).filter((n) => n.startsWith(SHELL_PREFIX) && n !== SHELL_CACHE);
	if (!older.length) return;
	const manifest = await fetchManifest();
	const previous = [];
	for (const name of older) {
		const old = await cachedManifest(name);
		if (old) previous.push({ cache: await caches.open(name), manifest: old });
	}
	// the AI runtime is optional: carried over when the person had it, best effort
	let wantAi = false;
	for (const p of previous) {
		for (const f of p.manifest.files) if (f.group === "ai" && (await p.cache.match(f.url))) wantAi = true;
	}
	const cache = await caches.open(SHELL_CACHE);
	await putManifest(cache, manifest);
	for (const entry of manifest.files) if (entry.group === "core") await ensure(cache, entry, previous);
	if (wantAi) {
		for (const entry of manifest.files) if (entry.group === "ai") await ensure(cache, entry, previous).catch(() => {});
	}
}

async function activateShell() {
	const meta = await readMeta();
	const previous = meta.active && meta.active !== SHELL_CACHE && (await caches.has(meta.active)) ? meta.active : null;
	for (const name of await caches.keys()) {
		if (name.startsWith(SHELL_PREFIX) && name !== SHELL_CACHE && name !== previous) await caches.delete(name);
	}
	if (previous) {
		// open windows of the previous version never need its AI runtime: the current one serves /ort/
		const manifest = await cachedManifest(previous);
		const cache = await caches.open(previous);
		for (const f of manifest ? manifest.files : []) if (f.group === "ai") await cache.delete(f.url);
	}
	await writeMeta({ active: SHELL_CACHE, previous });
}

let metaMemo = null;
/** `fresh`: another worker (a failing update) may have written it since */
async function readMeta(fresh = false) {
	if (!metaMemo || fresh) {
		const hit = await caches.match(META_URL, { cacheName: META_CACHE });
		metaMemo = hit ? await hit.json() : {};
	}
	return metaMemo;
}

async function writeMeta(meta) {
	metaMemo = meta;
	await (await caches.open(META_CACHE)).put(META_URL, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
}

// ---- messages from the page (lib/offline.ts), answered on the MessagePort ----

async function handleMessage(msg, port) {
	if (msg.op === "skipWaiting") {
		await self.skipWaiting();
		return port.postMessage({ type: "done" });
	}
	if (msg.op === "updateInfo") {
		const meta = await readMeta(true);
		return port.postMessage({ type: "updateInfo", enabled: SHELL_ON, version: SHELL_ON ? SHELL_VERSION : null, lastUpdateError: meta.lastUpdateError || null });
	}
	if (!SHELL_ON) return port.postMessage({ type: "status", enabled: false, version: null });
	if (msg.op === "status") {
		const stored = await cachedManifest(SHELL_CACHE);
		let manifest = stored;
		let error = null;
		if (!manifest) manifest = await fetchManifest().catch((err) => ((error = describeError(err)), null));
		const cache = (await caches.has(SHELL_CACHE)) ? await caches.open(SHELL_CACHE) : null;
		const files = [];
		for (const f of manifest ? manifest.files : []) {
			files.push({ url: f.url, size: f.size, group: f.group, cached: !!(cache && (await cache.match(f.url))) });
		}
		return port.postMessage({ type: "status", enabled: true, version: SHELL_VERSION, app: manifest && manifest.app, files, error });
	}
	if (msg.op === "cache") {
		const manifest = (await cachedManifest(SHELL_CACHE)) || (await fetchManifest());
		const entry = manifest.files.find((f) => f.url === msg.url);
		if (!entry) throw shellError("unknown-file", `${msg.url} is not part of this version`);
		const cache = await caches.open(SHELL_CACHE);
		if (!(await cache.match(MANIFEST_URL))) await putManifest(cache, manifest);
		let last = 0;
		await ensure(cache, entry, [], (received) => {
			// at most a few messages per second per file
			if (received - last < 262144 && received !== entry.size) return;
			last = received;
			port.postMessage({ type: "progress", received });
		});
		return port.postMessage({ type: "done" });
	}
	if (msg.op === "drop") {
		const manifest = await cachedManifest(SHELL_CACHE);
		if (manifest && (await caches.has(SHELL_CACHE))) {
			const cache = await caches.open(SHELL_CACHE);
			for (const f of manifest.files) if (f.group === msg.group) await cache.delete(f.url);
		}
		return port.postMessage({ type: "done" });
	}
	if (msg.op === "clear") {
		for (const name of await caches.keys()) if (name.startsWith(SHELL_PREFIX)) await caches.delete(name);
		await writeMeta({ active: SHELL_CACHE, previous: null });
		return port.postMessage({ type: "done" });
	}
	throw shellError("unknown-op", `unknown operation ${msg.op}`);
}

// ---- helpers ----

/** Makes sure one file is in `cache`: already there, copied from an older version's cache (same sha256), or fetched. */
async function ensure(cache, entry, previous, onBytes) {
	if (await cache.match(entry.url)) return;
	for (const p of previous) {
		const same = p.manifest.files.find((f) => f.sha256 === entry.sha256);
		const old = same && (await p.cache.match(same.url));
		if (old) return cache.put(entry.url, old);
	}
	// content-hashed files may come from the HTTP cache; fixed names must be revalidated
	try {
		await store(cache, entry, await download(entry, entry.url.startsWith("/assets/") ? "default" : "no-cache"), onBytes);
	} catch (err) {
		// The browser's own cache can hold another build's bytes under the same name (a file whose name did not change
		// with its contents, or a revalidation that kept a stale copy). Once more straight from the server.
		if (!err || err.code !== "mismatch") throw err;
		await store(cache, entry, await download(entry, "reload"), onBytes);
	}
}

async function download(entry, mode) {
	try {
		return await fetch(entry.url, { cache: mode });
	} catch {
		throw shellError("network", "The download was interrupted: Shasta's server could not be reached.");
	}
}

/** Reads the whole body, checks it against the manifest and caches it with the server's own headers. */
async function store(cache, entry, response, onBytes) {
	if (!response.ok) throw shellError("http", `${entry.url} answered HTTP ${response.status}`);
	const reader = response.body.getReader();
	const chunks = [];
	let received = 0;
	for (;;) {
		let step;
		try {
			step = await reader.read();
		} catch {
			throw shellError("network", "The download was interrupted: the connection dropped.");
		}
		if (step.done) break;
		chunks.push(step.value);
		received += step.value.byteLength;
		if (onBytes) onBytes(received);
	}
	const body = new Uint8Array(received);
	let at = 0;
	for (const c of chunks) body.set(c, at), (at += c.byteLength);
	if ((await sha256(body)) !== entry.sha256) {
		throw shellError("mismatch", `${entry.url} on the server is not the file this version expects (Shasta was probably just updated).`);
	}
	const headers = new Headers(response.headers);
	headers.delete("Content-Encoding");
	headers.set("Content-Length", String(received));
	await cache.put(entry.url, new Response(body, { status: 200, statusText: "OK", headers }));
}

async function fetchManifest() {
	let response;
	try {
		response = await fetch(`${MANIFEST_URL}?v=${SHELL_VERSION}`, { cache: "no-store" });
	} catch {
		throw shellError("network", "Shasta's server could not be reached.");
	}
	if (!response.ok) throw shellError("http", `${MANIFEST_URL} answered HTTP ${response.status}`);
	const manifest = await response.json();
	if (manifest.version !== SHELL_VERSION) {
		throw shellError("version", "A newer version of Shasta is on the server. Restart Shasta to update, then download again.");
	}
	return manifest;
}

async function cachedManifest(cacheName) {
	const hit = await caches.match(MANIFEST_URL, { cacheName });
	return hit ? hit.json() : null;
}

function putManifest(cache, manifest) {
	return cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), { headers: { "Content-Type": "application/json" } }));
}

async function sha256(bytes) {
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function shellError(code, message) {
	const err = new Error(message);
	err.code = code;
	return err;
}

function describeError(err) {
	if (err && err.name === "QuotaExceededError") {
		return { code: "quota", message: "The browser has no room left to keep Shasta offline. Free up space on this device, or clear other site data." };
	}
	if (err && err.code) return { code: err.code, message: err.message };
	return { code: "unknown", message: String((err && err.message) || err) };
}
