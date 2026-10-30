# Source of the hosted Shasta

| | |
|---|---|
| Hosted instance | https://shasta-dtg.pages.dev |
| Shasta version | 0.2.0 |
| Published from | commit `eb73b6319d6d2a0e2c01b8aa9b1abd1b93b22698` (plus uncommitted work at publish time) |
| Published on | 2026-10-30 |
| Scramjet engine | https://github.com/dazacode/shasta-scramjet, tag `shasta-v0.1.3` (submodule `scramjet/`) |
| Wisp relay | https://github.com/dazacode/shasta-wisp, tag `shasta-v0.1.2` (submodule `wisp/`) |

Shasta is a browser built on [Scramjet](https://github.com/MercuryWorkshop/scramjet). Scramjet is
AGPL-3.0, so a hosted copy must let its users get the corresponding source of the version they are
using. This repository is that source: published from our development tree at the commit above, so
it is the real code and not a re-implementation of it. (Our own production bundle is minified and
obfuscated for size; the code here is what it is built from.)

Included: the browser, its Scramjet integration, the build scripts, and the engine and relay forks
as submodules. Not included: anything that only exists to serve Shasta from our own machines (the
Store backend, deployment notes, CI), and generated output.

To build the browser from here:

```sh
git clone --recursive https://github.com/dazacode/shasta && cd shasta
bun install
bun run build     # builds the engine (Rust) and the browser
```

Under AGPL section 13 the offer has to stay good for as long as a copy is hosted. It does: this
repository is regenerated and pushed by `bun run publish:source` on each release, and the deployed
instance links to it (Settings → About → Source code).
