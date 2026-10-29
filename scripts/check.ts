// `bun run check`: typecheck and unit tests, plus the backend's tests when the backend is in this
// checkout. The public source snapshot ships the browser only, so this has to stay useful without
// server/ instead of failing on a missing directory (CI runs this the same way).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function run(cmd: string[], cwd: string) {
	console.log(`\x1b[36m> ${cmd.join(" ")}\x1b[0m`);
	if (Bun.spawnSync(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] }).exitCode !== 0) process.exit(1);
}

run(["bun", "run", "typecheck"], join(root, "shasta"));
run(["bun", "run", "test"], join(root, "shasta"));
if (existsSync(join(root, "server", "package.json"))) run(["bun", "test"], join(root, "server"));
else console.log("no server/ in this checkout: skipping the backend tests");
console.log("\n\x1b[32mcheck ok\x1b[0m");
