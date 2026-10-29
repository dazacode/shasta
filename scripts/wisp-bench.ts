// Wisp relay bake-off: measures one endpoint the same way every time, so hosts can be compared.
//
//   bun scripts/wisp-bench.ts local                                  # this machine: server.mjs's Wisp options + a fixture site
//   bun scripts/wisp-bench.ts wss://relay.example/wisp/ --target http://fixture.example/page [--label name] [--max 1600]
//
// --target must be a plain-http page you control (the bench speaks HTTP/1.1 over raw Wisp streams, no TLS) and
// should be the same page for every relay. Never point --max at a relay you do not operate: it opens
// thousands of streams on purpose.
//
// Prints a table and one JSON line (append it to docs/wisp-bakeoff.md's raw results).
//   cold          first handshake (run after the host has been idle to see a real cold start)
//   handshake     p50/p95 of 30 fresh WebSocket + Wisp CONTINUE handshakes, one after another
//   page100       wall time for 100 concurrent GETs over ONE Wisp connection (how a page load uses libcurl/epoxy)
//   maxStreams    concurrent streams held open on one connection (opened 50 at a time) before >1% fail or it drops
import http from "node:http";
import type { AddressInfo } from "node:net";
import { client as wispClient } from "../server/node_modules/@mercuryworkshop/wisp-js/src/entrypoints/client.mjs";

type Conn = InstanceType<typeof wispClient.ClientConnection>;

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : fallback;
};
const MAX = Number(flag("max", "1600"));

function connect(url: string, timeoutMs = 10_000): Promise<{ conn: Conn; ms: number }> {
	return new Promise((resolve, reject) => {
		const started = performance.now();
		const conn = new wispClient.ClientConnection(url);
		const timer = setTimeout(() => (conn.close(), reject(new Error("handshake timed out"))), timeoutMs);
		conn.onopen = () => (clearTimeout(timer), resolve({ conn, ms: performance.now() - started }));
		conn.onerror = () => (clearTimeout(timer), reject(new Error("websocket error")));
		conn.onclose = () => (clearTimeout(timer), reject(new Error("closed during handshake")));
	});
}

/** One HTTP/1.1 GET over a Wisp stream. `hold` keeps the stream open after the first byte arrives. */
function get(conn: Conn, target: URL, hold: boolean, timeoutMs = 30_000): Promise<{ ok: boolean; close?: () => void }> {
	return new Promise((resolve) => {
		const stream = conn.create_stream(target.hostname, Number(target.port || 80));
		const timer = setTimeout(() => (stream.close(), resolve({ ok: false })), timeoutMs);
		let head = "";
		stream.onmessage = (data: Uint8Array) => {
			if (head.length >= 12) return;
			head += new TextDecoder().decode(data.slice(0, 32));
			if (hold && head.length >= 12) {
				clearTimeout(timer);
				resolve({ ok: /^HTTP\/1\.[01] [23]/.test(head), close: () => stream.close() });
			}
		};
		stream.onclose = () => {
			clearTimeout(timer);
			resolve({ ok: !hold && /^HTTP\/1\.[01] [23]/.test(head) });
		};
		const req = `GET ${target.pathname}${target.search} HTTP/1.1\r\nHost: ${target.host}\r\nUser-Agent: shasta-wisp-bench\r\nConnection: ${hold ? "keep-alive" : "close"}\r\n\r\n`;
		stream.send(new TextEncoder().encode(req));
	});
}

const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const round = (n: number) => Math.round(n);

async function bench(url: string, target: URL) {
	const cold = (await connect(url)).ms;
	const samples: number[] = [];
	for (let i = 0; i < 30; i++) {
		const { conn, ms } = await connect(url);
		samples.push(ms);
		conn.close();
	}

	const { conn } = await connect(url);
	let started = performance.now();
	const results = await Promise.all(Array.from({ length: 100 }, () => get(conn, target, false)));
	const page100 = { ms: round(performance.now() - started), failed: results.filter((r) => !r.ok).length };
	conn.close();

	// ramp until breakage; a fresh connection per step so one step's leftovers do not count against the next
	let maxStreams = 0;
	let brokeAt: { n: number; failed: number; reason: string } | null = null;
	for (let n = 100; n <= MAX; n *= 2) {
		let dropped = false;
		const { conn } = await connect(url);
		conn.onclose = () => (dropped = true);
		started = performance.now();
		// opened 50 at a time and all held: this measures concurrency, not how many connects a burst survives
		// (a burst mostly measures the target's accept backlog, 128 on macOS)
		const held: { ok: boolean; close?: () => void }[] = [];
		for (let i = 0; i < n && !dropped; i += 50) held.push(...(await Promise.all(Array.from({ length: Math.min(50, n - i) }, () => get(conn, target, true, 20_000)))));
		const failed = held.filter((r) => !r.ok).length;
		held.forEach((r) => r.close?.());
		conn.close();
		if (dropped || failed > n * 0.01) {
			brokeAt = { n, failed, reason: dropped ? "connection dropped" : `${failed}/${n} streams failed` };
			break;
		}
		maxStreams = n;
	}
	return {
		cold: round(cold),
		handshake: { p50: round(pct(samples, 50)), p95: round(pct(samples, 95)) },
		page100,
		maxStreams,
		brokeAt,
	};
}

/** The production Wisp options from server/server.mjs, except loopback is allowed so the bench can reach its fixture. */
async function localRelay() {
	const { server: wisp } = await import("../server/node_modules/@mercuryworkshop/wisp-js/src/entrypoints/server.mjs");
	wisp.options.allow_private_ips = true;
	wisp.options.allow_loopback_ips = true;
	wisp.options.allow_udp_streams = false;
	wisp.options.stream_limit_total = Number(process.env.WISP_STREAMS_TOTAL || 500);
	const relay = http.createServer((_, res) => res.writeHead(404).end());
	relay.on("upgrade", (req, socket, head) => wisp.routeRequest(req, socket, head));
	const page = "<!doctype html><title>bench</title>" + "x".repeat(16 * 1024);
	const fixture = http.createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(page));
	await Promise.all([relay, fixture].map((s) => new Promise<void>((r) => s.listen(0, "127.0.0.1", r))));
	return {
		url: `ws://127.0.0.1:${(relay.address() as AddressInfo).port}/wisp/`,
		target: new URL(`http://127.0.0.1:${(fixture.address() as AddressInfo).port}/`),
		stop: () => (relay.close(), fixture.close(), relay.closeAllConnections(), fixture.closeAllConnections()),
	};
}

const endpoint = args[0];
if (!endpoint || endpoint.startsWith("--")) {
	console.error("usage: bun scripts/wisp-bench.ts local | <wss-url> --target http://host/page [--label name] [--max N]");
	process.exit(2);
}
let url = endpoint;
let target = flag("target") ? new URL(flag("target")!) : null;
let stop = () => {};
if (endpoint === "local") ({ url, target, stop } = await localRelay());
if (!target || target.protocol !== "http:") {
	console.error("--target http://... is required for a remote relay (plain http, a page you control)");
	process.exit(2);
}

const r = await bench(url, target);
stop();
const label = flag("label", endpoint === "local" ? "local (server.mjs options)" : new URL(url).host);
console.log(`\n${label}`);
console.log(`  cold start        ${r.cold} ms`);
console.log(`  handshake         p50 ${r.handshake.p50} ms, p95 ${r.handshake.p95} ms`);
console.log(`  100 GETs          ${r.page100.ms} ms (${r.page100.failed} failed)`);
console.log(`  max streams       ${r.maxStreams}${r.brokeAt ? ` (broke at ${r.brokeAt.n}: ${r.brokeAt.reason})` : ` (no breakage up to --max ${MAX})`}`);
console.log(JSON.stringify({ label, at: new Date().toISOString(), ...r }));
process.exit(0);
