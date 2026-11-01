// Worker console forwarding (see ../workerPrelude.ts). Put in front of every proxied worker script; sends the worker's
// console.* lines and uncaught errors to Shasta's in-app console over a BroadcastChannel, at once (a game worker often
// blocks inside wasm for good, so a batching timer would never fire), max 150 lines a second per worker.
// Called as (src)(self, label, channelName). Plain JS on purpose: injected as text (?raw import), never obfuscated.
(function forwarder(G, source, channel) {
  if (!G || G.__shastaConsole)
    return;
  G.__shastaConsole = true;
  let ch;
  let nativePost;
  try {
    ch = new G.BroadcastChannel(channel);
    // Scramjet's worker runtime (loaded after this) patches BroadcastChannel.prototype.postMessage and wraps every
    // message for the proxied origin: keep the browser's own one
    nativePost = G.BroadcastChannel.prototype.postMessage;
  } catch {
    return;
  }
  const MAX_TEXT = 2000;
  const PER_SECOND = 150;
  let windowStart = 0;
  let sent = 0;
  let dropped = 0;
  const str = (v, depth) => {
    if (typeof v === "string")
      return depth ? JSON.stringify(v) : v;
    if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean" || typeof v === "bigint")
      return String(v);
    if (typeof v === "function")
      return "ƒ " + (v.name || "anonymous") + "()";
    try {
      const o = v;
      if (typeof o.message === "string" && typeof o.name === "string")
        return typeof o.stack === "string" && o.stack.includes(o.message) ? o.stack : o.name + ": " + o.message;
      if (depth >= 2)
        return Array.isArray(v) ? "Array(" + v.length + ")" : "{…}";
      if (Array.isArray(v))
        return "[" + v.slice(0, 30).map((x) => str(x, depth + 1)).join(", ") + (v.length > 30 ? ", …" : "") + "]";
      if (ArrayBuffer.isView(v))
        return v.constructor.name + "(" + v.length + ")";
      return "{" + Object.keys(o).slice(0, 20).map((k) => k + ": " + str(o[k], depth + 1)).join(", ") + "}";
    } catch {
      return Object.prototype.toString.call(v);
    }
  };
  const post = (level, args) => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      sent = 0;
    }
    if (sent >= PER_SECOND) {
      dropped++;
      return;
    }
    sent++;
    let text;
    try {
      if (typeof args[0] === "string" && args[0].includes("%c"))
        args = [args[0].replace(/%c/g, ""), ...args.slice(1).filter((a) => typeof a !== "string" || !/:/.test(a))];
      text = args.map((a) => str(a, 0)).join(" ");
    } catch {
      text = "(unreadable message)";
    }
    if (dropped) {
      text = "(" + dropped + " lines skipped: too many per second) " + text;
      dropped = 0;
    }
    if (text.length > MAX_TEXT)
      text = text.slice(0, MAX_TEXT) + "…";
    try {
      nativePost.call(ch, { kind: "shasta-console", level, source, text });
    } catch {}
  };
  const con = G.console;
  if (con) {
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = con[level];
      if (typeof orig !== "function")
        continue;
      con[level] = function(...args) {
        try {
          post(level, args);
        } catch {}
        return orig.apply(this, args);
      };
    }
  }
  try {
    G.addEventListener("error", (e) => post("error", ["Uncaught " + (e.error ? str(e.error, 0) : e.message) + (e.filename ? " (" + String(e.filename).replace(/[?#].*$/, "").split("/").pop() + ":" + e.lineno + ")" : "")]));
    G.addEventListener("unhandledrejection", (e) => post("error", ["Uncaught (in promise) " + str(e.reason, 0)]));
  } catch {}
})
