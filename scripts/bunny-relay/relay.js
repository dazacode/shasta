// Shasta's relay on bunny.net (a standalone Edge Script, deployed by scripts/deploy-bunny.ts), so a Lite mirror has
// a backend on a domain of its own (*.b-cdn.net) when a filter blocks shasta-dtg.pages.dev, edushasta.lol and
// vercel.app. Same idea as scripts/vercel-wisp/wisp.mjs:
//   - /wisp/ : a plain byte relay to the full site's Wisp. The TLS of every proxied site still ends in the browser,
//     so Bunny only ever sees encrypted Wisp frames.
//   - /api/*, /cloud/*, /nowgg/*, /ai-models/* : forwarded to the full site unchanged, the browser's Origin included
//     (the backend allows the Lite origins listed in APP_ORIGINS and answers CORS itself). A WebSocket upgrade there
//     (/api/events/ws, /api/pulse/ws, /api/chat/ws, /api/pad/ws, the cloud signalling socket) cannot go through
//     fetch(), so it is relayed like Wisp; the upstream socket carries no Origin, which the backend accepts.
// Nothing is stored or logged here.
import * as BunnySDK from "https://esm.sh/@bunny.net/edgescript-sdk@0.11.2";

const UPSTREAMS = ["https://edushasta.lol", "https://shasta-dtg.pages.dev"];
const FORWARD = /^\/(api|cloud|nowgg|ai-models)(\/|$)/;
const MAX_QUEUE = 4 * 1024 * 1024; // bytes held while the upstream connects
const HOP = ["host", "connection", "upgrade", "keep-alive", "transfer-encoding", "te", "trailer", "proxy-authorization", "cdn-loop"];

function relaySocket(request, path) {
	const { response, socket: client } = request.upgradeWebSocket({ idleTimeout: 60 });
	let up = null;
	let opened = false;
	let next = 0;
	let queued = 0;
	const queue = [];
	let finish;
	const done = new Promise((r) => (finish = r));
	const closeBoth = (code = 1000, reason = "") => {
		try { client.close(code, reason); } catch {}
		try { up?.close(); } catch {}
		finish();
	};
	const connect = () => {
		const ws = new WebSocket(UPSTREAMS[next++].replace(/^https/, "wss") + path);
		ws.binaryType = "arraybuffer";
		up = ws;
		ws.onopen = () => {
			opened = true;
			for (const d of queue) ws.send(d);
			queue.length = 0;
			queued = 0;
		};
		ws.onmessage = (e) => { try { client.send(e.data); } catch {} };
		ws.onclose = (e) => {
			if (!opened && next < UPSTREAMS.length) return connect(); // could not reach this one: try the next
			closeBoth(e.code === 1005 || e.code === 1006 ? 1011 : e.code);
		};
		ws.onerror = () => {};
	};
	client.addEventListener("message", (e) => {
		if (up?.readyState === WebSocket.OPEN) return up.send(e.data);
		queued += e.data?.byteLength ?? e.data?.length ?? 0;
		if (queued > MAX_QUEUE) return closeBoth(1009, "too much data before the relay connected");
		queue.push(e.data);
	});
	client.addEventListener("close", () => closeBoth());
	client.addEventListener("error", () => closeBoth(1011));
	connect();
	// keep the script alive while the tunnel is open
	BunnySDK.v1?.waitUntil?.(done);
	globalThis.Bunny?.v1?.waitUntil?.(done);
	return response;
}

async function forward(request, url) {
	const headers = new Headers(request.headers);
	for (const h of HOP) headers.delete(h);
	const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
	let last;
	for (const base of UPSTREAMS) {
		try {
			const r = await fetch(base + url.pathname + url.search, { method: request.method, headers, body, redirect: "manual" });
			if (r.status === 502 || r.status === 503 || r.status === 504) { last = r; continue; }
			return r;
		} catch (e) {
			last = e;
		}
	}
	return last instanceof Response ? last : new Response("relay: backend unreachable", { status: 502 });
}

BunnySDK.net.http.serve(async (request) => {
	const url = new URL(request.url);
	if (url.pathname === "/wisp/" || url.pathname === "/wisp") {
		if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return new Response("Wisp relay", { status: 426 });
		return relaySocket(request, "/wisp/");
	}
	if (url.pathname === "/healthz") return new Response("ok");
	if (FORWARD.test(url.pathname)) {
		if ((request.headers.get("upgrade") || "").toLowerCase() === "websocket") return relaySocket(request, url.pathname + url.search);
		return forward(request, url);
	}
	return new Response("Not found", { status: 404 });
});
