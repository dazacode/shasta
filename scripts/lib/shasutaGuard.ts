// Shasuta (the console-style gaming mode, shasta/src/shasuta/) is unreleased. A production build leaves it out
// (shasta/vite.config.ts); this is the net under that: a build folder that still holds its chunk (Shasuta-<hash>.js /
// .css, named after its entry module, so it survives the obfuscator) is refused before anything is uploaded.
// `SHASTA_ALLOW_SHASUTA=1` is for the day it ships (it also needs `VITE_SHASUTA=1` at build time).
import { join } from "node:path";

export function assertNoShasuta(dir: string, what: string): void {
	if (process.env.SHASTA_ALLOW_SHASUTA === "1") return;
	const found = [...new Bun.Glob("**/*").scanSync({ cwd: dir })].filter((f) => /shasuta/i.test(f));
	if (!found.length) return;
	console.error(
		`\x1b[31m${what} (${join(dir)}) contains Shasuta, the unreleased gaming mode:\n  ${found.slice(0, 5).join("\n  ")}\nRebuild without VITE_SHASUTA=1 (\`bun run build\`); production builds leave it out. Refusing to continue.\x1b[0m`,
	);
	process.exit(1);
}
