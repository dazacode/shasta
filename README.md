# Shasta — browser source

Shasta is a browser that runs inside a browser tab: a desktop-style window with tabs, an omnibox,
bookmarks, history, downloads and settings, on top of the
[Scramjet](https://github.com/MercuryWorkshop/scramjet) interception proxy. It ships a curated
**Store** of games and web apps that install with one click and run sandboxed on their own address.

This repository is the **source of the browser**, published from our development tree at each
release because Scramjet is AGPL-3.0 and a hosted copy has to offer its source. See
[SOURCE.md](SOURCE.md) for the exact commit a deployment is built from, and [NOTICE.md](NOTICE.md)
for the licence and third-party components.

- Hosted: <https://shasta-dtg.pages.dev> · beta · AGPL-3.0-only ([LICENSE](LICENSE))
- Bugs, game requests and publishing: the Shasta Discord (this is not where development happens)
- The Store command line is its own project: [dazacode/shasta-cli](https://github.com/dazacode/shasta-cli)

## What is here

| Path | |
|---|---|
| `shasta/` | The browser: React + TypeScript + Vite, the shell, the Store, and the Scramjet integration |
| `scramjet/` | The engine fork, as a submodule (tagged `shasta-v0.1.3`) |
| `wisp/` | The relay fork, as a submodule (tagged `shasta-v0.1.2`) |
| `scripts/` | The build scripts |
| `apps/` | First-party browser apps |

Not here: the Store **backend** (a separate program, `server/`), our deployment/engineering notes,
and anything generated.

## Build

Needs [Bun](https://bun.sh) >= 1.1, a Rust toolchain with the `wasm32` target, and `pnpm`.

```sh
git clone --recursive https://github.com/dazacode/shasta && cd shasta
bun install
bun run build        # builds the engine (Rust) and the browser -> shasta/dist
cd shasta && bun run preview
```

`bun run dev` / `bun run start` also bring up a Wisp server; the full setup additionally expects the
Store backend, which is why it lives in the same tree during development but is not published here.

## Licence and credits

Shasta is AGPL-3.0-only. Browsing is powered by [Scramjet](https://github.com/MercuryWorkshop/scramjet)
by the Mercury Workshop team, together with their Wisp protocol and `libcurl-transport` /
`epoxy-transport` packages; those are AGPL-3.0 and are included through the two submodules above.
[NOTICE.md](NOTICE.md) lists every third-party component shipped in the browser bundle and its
licence, and [LICENSE](LICENSE) holds the full AGPL text.
