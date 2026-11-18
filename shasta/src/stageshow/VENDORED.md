# Stageshow kit (vendored)

`kit/` is upstream [benjitaylor/skills `stageshow/kit`](https://github.com/benjitaylor/skills/tree/main/stageshow), version
1.1.1 (MIT, `LICENSE`), with three Shasta changes. Re-apply them whenever the kit is updated:

1. **Class prefix `sk-` instead of `ss-`.** Shasuta (the console mode) has used `ss-` for its own classes since before the kit
   came in, and its main stage is literally `.ss-stage`, the kit's root class. The kit's unlayered element reset
   (`:where(.ss-stage) :is(p, label, button, input…) { all: revert }`) then wiped every label and paragraph inside Shasuta
   (Profile's labels went black and inline, 2026-11-08), and the kit's layered rules leaked onto Shasuta's `.ss-row`,
   `.ss-scroll`, `.ss-field`. After copying a new kit, rename in `kit/` AND in every consumer (components/whatsNew,
   components/demos, shasuta/tour/Scenes.tsx and scenes.css), never in Shasuta's own files:
   `python -c` with `re.sub(r'(?<![A-Za-z0-9])ss-', 'sk-', text)` over those `.css/.ts/.tsx` files. Examples copied from the
   skill (`.agents/skills/stageshow/examples`) need the same rename.
2. `stage.css` `.sk-fit`: `min-width: 0; contain: inline-size;` (a scaled stage must never size its container).
3. `phone.tsx`: the unused `useLayoutEffect` import removed (the app's strict tsconfig).

The skill itself (`.agents/skills/stageshow`) stays exactly upstream, with its own `ss-` names, for filming in its playground.
