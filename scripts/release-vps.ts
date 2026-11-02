// Releases the backend to the production VPS as a Docker image: `bun run release:vps [--dry-run]`.
// 1. rsync the build context (Dockerfile, server, wisp, apps, shasta/dist) into /opt/shasta/build on the VPS; only
//    changed files travel. 2. `shasta-ctl build <id>` builds shasta:<id> there (native x86_64; Docker's layer cache
//    rebuilds only what changed). 3. `shasta-ctl activate <id>` backs up the database, switches shasta:current,
//    restarts and health-checks, and reverts on failure. Rollback: `ssh shasta shasta-ctl rollback`.
// VPS setup (Docker, firewall, systemd unit, shasta-ctl) lives in scripts/vps/.
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const HOST = process.env.SHASTA_SSH ?? 'shasta'
const BUILD = '/opt/shasta/build'
const dry = process.argv.includes('--dry-run')

function run(cmd: string[], opts: { quiet?: boolean } = {}) {
	if (!opts.quiet) console.log(`\x1b[36m> ${cmd.join(' ')}\x1b[0m`)
	const p = Bun.spawnSync(cmd, { cwd: root, stdio: ['inherit', 'inherit', 'inherit'] })
	if (p.exitCode !== 0) {
		console.error(`\x1b[31mfailed: ${cmd[0]} (exit ${p.exitCode})\x1b[0m`)
		process.exit(1)
	}
}
const out = (cmd: string[]) => Bun.spawnSync(cmd, { cwd: root }).stdout.toString().trim()

for (const need of ['shasta/dist/index.html', 'server/src', 'wisp/src', 'apps']) {
	if (!existsSync(path.join(root, need))) {
		console.error(`missing ${need}: run \`bun run build\` first`)
		process.exit(1)
	}
}
const emulators = out(['sh', '-c', 'ls -d apps/emu-*/ 2>/dev/null | wc -l'])
if (emulators === '0') console.warn('\x1b[33mno apps/emu-* (bun run build:emulators): the emulators would be unpublished from this release\x1b[0m')
const dirty = out(['git', 'status', '--porcelain', '--', 'server', 'wisp', 'Dockerfile']) ? '-dirty' : ''
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
const id = `${stamp}-${out(['git', 'rev-parse', '--short', 'HEAD'])}${dirty}`
console.log(`release ${id} -> ${HOST}  (dist built ${statSync(path.join(root, 'shasta/dist/index.html')).mtime.toISOString()})`)

const rsync = ['rsync', '-a', '--delete', '--relative', '--exclude', 'node_modules', '--exclude', '.DS_Store', ...(dry ? ['--dry-run', '--stats'] : [])]
run([...rsync, 'Dockerfile', 'server/package.json', 'server/bun.lock', 'server/server.mjs', 'server/turn-gate.ts', 'server/src', 'wisp/package.json', 'wisp/LICENSE', 'wisp/src', 'apps', 'shasta/dist', `${HOST}:${BUILD}/`])
if (dry) process.exit(0)
run(['ssh', HOST, `shasta-ctl build ${id} && shasta-ctl activate ${id} && shasta-ctl prune 5`])
console.log(`\n\x1b[32mlive: ${id}\x1b[0m  (rollback: ssh ${HOST} shasta-ctl rollback)`)
