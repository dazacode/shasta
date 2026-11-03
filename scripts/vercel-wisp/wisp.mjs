// Shasta Lite on Vercel: a Wisp endpoint on Vercel's OWN domain (shasta-lite.vercel.app/wisp/), so a school filter
// that blocks the full site's domains does not stop browsing here. Vercel cannot run the Wisp server itself (no
// raw TCP egress worth relying on, and the server's SSRF firewall lives on the VPS), so this function is a plain
// byte relay: it accepts the browser's WebSocket and pipes every frame, unchanged, to the full site's Wisp
// endpoint (the VPS behind Cloudflare). The TLS of every proxied site still ends in the browser (libcurl/epoxy), so
// Vercel only ever sees encrypted Wisp frames, exactly like Cloudflare in front of the VPS.
//
// Copied into .deploy/vercel-lite/api/ by scripts/deploy-vercel-lite.ts; `/wisp/` is rewritten to it there.
// A function lives at most `maxDuration` (vercel.json): the socket then closes and the client reconnects
// (scramjetAdapter's health check + the Lite build's fallback endpoints). docs/deployment.md / CLAUDE.md "Lite".
import { upgradeWebSocket } from "@vercel/functions";
import WebSocket from "ws";

const UPSTREAMS = (process.env.WISP_UPSTREAMS || "wss://edushasta.lol/wisp/,wss://shasta-dtg.pages.dev/wisp/").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGIN = process.env.WISP_ORIGIN || "https://shasta-lite.vercel.app";
const MAX_QUEUE = 4 * 1024 * 1024; // bytes held while the upstream connects

export async function GET() {
	return upgradeWebSocket(
		(client) => {
			let up = null;
			let opened = false;
			let next = 0;
			let queued = 0;
			const queue = [];
			const closeBoth = (code, reason) => {
				try { client.close(code ?? 1000, reason ?? ""); } catch {}
				try { up?.close(); } catch {}
			};
			const connect = () => {
				const url = UPSTREAMS[next++];
				const ws = new WebSocket(url, { headers: { Origin: ORIGIN }, perMessageDeflate: false });
				up = ws;
				ws.on("open", () => {
					opened = true;
					for (const [d, bin] of queue) ws.send(d, { binary: bin });
					queue.length = 0; queued = 0;
				});
				ws.on("message", (d, bin) => { if (client.readyState === WebSocket.OPEN) client.send(d, { binary: bin }); });
				ws.on("close", (code) => { if (opened || next >= UPSTREAMS.length) closeBoth(code === 1005 || code === 1006 ? 1011 : code); });
				// an upstream that cannot be reached before it opened: try the next one
				ws.on("error", () => { if (!opened && next < UPSTREAMS.length) { ws.removeAllListeners("close"); connect(); } });
			};
			client.on("message", (d, bin) => {
				if (up?.readyState === WebSocket.OPEN) return up.send(d, { binary: bin });
				queued += d.length ?? 0;
				if (queued > MAX_QUEUE) return closeBoth(1009, "too much data before the relay connected");
				queue.push([d, bin]);
			});
			client.on("close", () => { try { up?.close(); } catch {} });
			client.on("error", () => closeBoth(1011));
			connect();
		},
		{ maxPayload: 1024 * 1024 },
	);
}
