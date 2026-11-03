#!/usr/bin/env bun
/**
 * Refresh the now.gg catalogue snapshot (data/nowgg-catalog.json; also shasta/public/nowgg.json).
 * The endpoint (GET /ncm/appsc/v1/getAppsList) is open, needs no auth and works from any IP.
 *
 *   bun scripts/fetch-nowgg.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchCatalog } from "./lib/nowgg";

const root = path.resolve(import.meta.dir, "..");
const apps = await fetchCatalog();
const payload = { generatedAt: new Date().toISOString(), host: "now.gg", total: apps.length, apps };

for (const file of [path.join(root, "data/nowgg-catalog.json"), path.join(root, "shasta/public/nowgg.json")]) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(payload)}\n`);
	console.log(`wrote ${file}`);
}
console.log(`${apps.length} now.gg apps`);
