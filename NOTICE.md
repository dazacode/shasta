# Shasta: copyright, license and source

Shasta (ShastaStudy / EDUShasta.com)
Copyright (C) 2026 dazacode and the Shasta contributors

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero
General Public License, version 3 only (AGPL-3.0-only), as published by the Free Software Foundation. It is
distributed WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

## Source code for network users (AGPL section 13)

Anyone who uses a hosted Shasta must be able to get the complete corresponding source of the version they use,
including local modifications. The public snapshot lives at **https://github.com/dazacode/shasta**, regenerated
from this tree by `bun run publish:source` on every release and stamped there with the commit and version it came
from (`SOURCE.md`). A build points visitors at it with `VITE_SOURCE_URL` (shown in Settings → Advanced → About
and in Settings → Offline & storage). `bun run doctor` warns when it is unset, and a public launch must not go
ahead without it.

The corresponding source of a deployment is: that snapshot at the deployed commit, plus the Scramjet engine below
at the commit pinned by the `scramjet/` submodule and named in `engine.pin` (the source repo's `patches/` mirrors our fork's own commits for a plain-upstream checkout).

## Third-party components shipped in the browser bundle

| Component | License | Source |
|---|---|---|
| Scramjet (core + controller), Mercury Workshop | AGPL-3.0-only | https://github.com/dazacode/shasta-scramjet (fork of https://github.com/MercuryWorkshop/scramjet, upstream commit b14b709a + our commits on its `shasta` branch; `patches/*.patch` mirror them for a plain-upstream checkout) |
| Wisp relay fork, our own | LGPL-3.0-or-later | https://github.com/dazacode/shasta-wisp (fork of https://github.com/MercuryWorkshop/wisp-js at its `shasta` branch; upstream relicensed from AGPL-3.0 to LGPL-3.0-or-later in commit `38a363f`). The submodule is `wisp/`, pinned by `wisp.pin`. |
| @mercuryworkshop/epoxy-transport, libcurl-transport | AGPL-3.0-only | npm / https://github.com/MercuryWorkshop |
| @mercuryworkshop/wisp-js (server, the fallback relay) | LGPL-3.0-or-later | npm / https://github.com/MercuryWorkshop/wisp-js |
| Geist, Poppins, Urbanist fonts (Fontsource) | SIL OFL 1.1 | license texts shipped at `/licenses/` in every build |
| Other npm dependencies (React, Base UI, Zustand, Motion, Lucide, transformers.js, ONNX Runtime, pdf.js, ...) | MIT / Apache-2.0 / ISC | their npm packages |

AI model weights downloaded on the device (SmolLM2, Qwen3, SmolVLM, Whisper, MiniLM) carry their own licenses on
Hugging Face and are not part of Shasta's source.
