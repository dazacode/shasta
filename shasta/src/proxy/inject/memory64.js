// Memory64 shim (see ../memory64Shim.ts for the whole picture). Runs in every proxied window AND worker before the page's
// own scripts, only on a Chrome without Memory64 (it checks itself and returns at once otherwise). Called as (src)(self).
// Plain JS on purpose: it is injected as text (?raw import), so the bundler's obfuscator can never split it.
//
// What it patches, each found on Chrome 126 with fiveplay.lol (2026-10-31), each generic:
// - WebAssembly.Memory/Table built with `address: 'i64'` / BigInt sizes -> 32-bit ones (max 4 GiB); grow/get/set take
//   BigInts and grow hands BigInts back, like a 64-bit memory/table. The module itself is converted on the server.
// - GPUQueue.writeBuffer/writeTexture from a buffer over 2 GiB: Chrome 126 throws "size exceeds the supported range"
//   -> copy just the bytes being uploaded.
// - FileSystemSyncAccessHandle.read/write with a buffer over 2 GiB: Chrome 126 claims a full read but leaves zeros
//   (every packfile header read back as 0) -> go through a temporary buffer. A write that returns an error code
//   (4294967288 = -8 = no space) is logged instead of silently losing data.
// - Render targets in r8/rg8/rgba8snorm (renderable only with 'texture-formats-tier1', Chrome 138+) -> 16-bit float.
// - WGSL `enable clip_distances;` without the 'clip-distances' feature (Chrome 131+) -> the clip-distance output is
//   removed (struct member + its constructor argument), losing only user clip planes.
// - A module that still fails to compile as 64-bit gets a plain explanation in the console.
// Not fixable here: GPU limits (fiveplay's lighting shader needs 22 textures per stage, Chrome 126 allows 16).
(function shim(G) {
  const WA = G && G.WebAssembly;
  if (!WA || WA.__shastaM64)
    return;
  try {
    new WA.Memory({ initial: 1n, maximum: 1n, address: "i64" });
    return;
  } catch {}
  Object.defineProperty(WA, "__shastaM64", { value: true });
  const PAGES_4G = 65536;
  const lowered = new WeakSet;
  const log = (msg) => {
    try {
      G.console.info("[Shasta Memory64] " + msg);
    } catch {}
  };
  const num = (v) => typeof v === "bigint" ? Number(v) : v;
  const is64 = (d) => d && (d.address === "i64" || d.index === "i64" || typeof d.initial === "bigint" || typeof d.maximum === "bigint");
  const lower = (d, cap) => {
    const out = {};
    for (const k in d)
      if (k !== "address" && k !== "index")
        out[k] = num(d[k]);
    if (typeof out.maximum === "number" && out.maximum > cap)
      out.maximum = cap;
    return out;
  };
  const Mem = WA.Memory;
  const Tab = WA.Table;
  const memProto = Mem.prototype;
  const tabProto = Tab.prototype;
  const NewMem = new Proxy(Mem, {
    construct(t, args, nt) {
      const d = args[0];
      if (!is64(d))
        return Reflect.construct(t, args, nt);
      const l = lower(d, PAGES_4G);
      if (l.initial > PAGES_4G) {
        log("the game asks for " + l.initial / 16 + " MB at the start, more than the 4096 MB a 32-bit memory can hold");
      }
      const m = Reflect.construct(t, [l], nt);
      lowered.add(m);
      log("64-bit memory requested (" + Number(d.initial) / 16 + " MB, max " + (d.maximum != null ? Number(d.maximum) / 16 + " MB" : "none") + "): giving it 32-bit memory (" + l.initial / 16 + " MB, max " + (l.maximum != null ? l.maximum / 16 + " MB" : "none") + (l.shared ? ", shared" : "") + ")");
      return m;
    }
  });
  const NewTab = new Proxy(Tab, {
    construct(t, args, nt) {
      const d = args[0];
      if (!is64(d))
        return Reflect.construct(t, args, nt);
      const rest = args.slice(1);
      const tab = Reflect.construct(t, [lower(d, 4294967295), ...rest], nt);
      lowered.add(tab);
      log("64-bit table requested: giving it a 32-bit one");
      return tab;
    }
  });
  const memGrow = memProto.grow;
  memProto.grow = function(delta) {
    const r = memGrow.call(this, num(delta));
    return lowered.has(this) || typeof delta === "bigint" ? BigInt(r) : r;
  };
  const tabGrow = tabProto.grow;
  tabProto.grow = function(delta, ...rest) {
    const r = tabGrow.call(this, num(delta), ...rest);
    return lowered.has(this) || typeof delta === "bigint" ? BigInt(r) : r;
  };
  const tabGet = tabProto.get;
  tabProto.get = function(i) {
    return tabGet.call(this, num(i));
  };
  const tabSet = tabProto.set;
  tabProto.set = function(i, ...rest) {
    return tabSet.call(this, num(i), ...rest);
  };
  try {
    Object.defineProperty(WA, "Memory", { value: NewMem, writable: true, configurable: true });
    Object.defineProperty(WA, "Table", { value: NewTab, writable: true, configurable: true });
  } catch {
    WA.Memory = NewMem;
    WA.Table = NewTab;
  }
  const BIG = 2147483647;
  const bigBuffer = (d) => {
    try {
      return !!d && (d.buffer ? d.buffer.byteLength : d.byteLength) > BIG;
    } catch {
      return false;
    }
  };
  const Q = G.GPUQueue && G.GPUQueue.prototype;
  if (Q && typeof Q.writeBuffer === "function") {
    const writeBuffer = Q.writeBuffer;
    let noted = false;
    Q.writeBuffer = function(buf, off, data, dataOffset, size) {
      if (!bigBuffer(data))
        return writeBuffer.apply(this, arguments);
      if (!noted) {
        noted = true;
        log("GPU uploads come from a memory over 2 GB: copying each one (this Chrome cannot upload from it directly)");
      }
      const es = data.BYTES_PER_ELEMENT || 1;
      const start = (data.byteOffset || 0) + (dataOffset || 0) * es;
      const length = size != null ? size * es : (data.byteLength ?? 0) - (dataOffset || 0) * es;
      const copy = new Uint8Array(data.buffer || data, start, length).slice();
      return writeBuffer.call(this, buf, off, copy);
    };
  }
  if (Q && typeof Q.writeTexture === "function") {
    const writeTexture = Q.writeTexture;
    Q.writeTexture = function(dest, data, layout, size) {
      if (!bigBuffer(data))
        return writeTexture.apply(this, arguments);
      const offset = layout && layout.offset || 0;
      const view = data.buffer ? new Uint8Array(data.buffer, data.byteOffset + offset, data.byteLength - offset) : new Uint8Array(data, offset);
      if (view.byteLength > BIG)
        throw new RangeError("[Shasta Memory64] writeTexture from a view over 2 GB cannot be copied");
      return writeTexture.call(this, dest, view.slice(), { ...layout, offset: 0 }, size);
    };
  }
  const H = G.FileSystemSyncAccessHandle && G.FileSystemSyncAccessHandle.prototype;
  if (H && typeof H.read === "function") {
    const read = H.read;
    const write = H.write;
    let noted = false;
    const note = () => {
      if (noted)
        return;
      noted = true;
      log("file reads/writes into a memory over 2 GB: going through a temporary buffer");
    };
    const bytesOf = (v) => new Uint8Array(v.buffer || v, v.byteOffset || 0, v.byteLength);
    H.read = function(view, opts) {
      if (!bigBuffer(view))
        return read.apply(this, arguments);
      note();
      const dst = bytesOf(view);
      const tmp = new Uint8Array(dst.byteLength);
      const got = read.call(this, tmp, opts);
      dst.set(got === tmp.byteLength ? tmp : tmp.subarray(0, got));
      return got;
    };
    let full = false;
    H.write = function(view, opts) {
      const big = bigBuffer(view);
      if (big)
        note();
      const got = big ? write.call(this, bytesOf(view).slice(), opts) : write.apply(this, arguments);
      if (typeof got === "number" && got > (view?.byteLength ?? 0) && !full) {
        full = true;
        log("a file write failed (" + (got > 2147483647 ? "error " + (got - 4294967296) : got) + (got === 4294967288 ? " = no space: the storage quota is full" : "") + "). Free up space or clear site data in Settings -> Privacy.");
      }
      return got;
    };
  }
  const SNORM = { r8snorm: "r16float", rg8snorm: "rg16float", rgba8snorm: "rgba16float" };
  const DEV = G.GPUDevice && G.GPUDevice.prototype;
  const TEX = G.GPUTexture && G.GPUTexture.prototype;
  if (DEV && TEX && typeof DEV.createTexture === "function") {
    const remapped = new WeakSet;
    const lacks = (dev) => !(dev.features && dev.features.has("texture-formats-tier1"));
    const fmt = (f) => typeof f === "string" && SNORM[f] || f;
    const createTexture = DEV.createTexture;
    let noted = false;
    DEV.createTexture = function(desc) {
      if (!desc || !SNORM[desc.format] || !(desc.usage & 16) || !lacks(this))
        return createTexture.apply(this, arguments);
      if (!noted) {
        noted = true;
        log("render targets in an 8-bit signed format this GPU/Chrome cannot draw into: using 16-bit float ones");
      }
      const t = createTexture.call(this, { ...desc, format: SNORM[desc.format], viewFormats: desc.viewFormats && desc.viewFormats.map(fmt) });
      remapped.add(t);
      return t;
    };
    const createView = TEX.createView;
    TEX.createView = function(desc) {
      if (remapped.has(this) && desc && SNORM[desc.format])
        return createView.call(this, { ...desc, format: SNORM[desc.format] });
      return createView.apply(this, arguments);
    };
    for (const name of ["createRenderPipeline", "createRenderPipelineAsync"]) {
      const orig = DEV[name];
      if (typeof orig !== "function")
        continue;
      DEV[name] = function(desc) {
        const targets = desc && desc.fragment && desc.fragment.targets;
        if (!lacks(this) || !Array.isArray(targets) || !targets.some((t) => t && SNORM[t.format]))
          return orig.apply(this, arguments);
        return orig.call(this, { ...desc, fragment: { ...desc.fragment, targets: targets.map((t) => t && SNORM[t.format] ? { ...t, format: SNORM[t.format] } : t) } });
      };
    }
  }
  const D = G.GPUDevice && G.GPUDevice.prototype;
  if (D && typeof D.createShaderModule === "function") {
    const createShaderModule = D.createShaderModule;
    let noted = false;
    D.createShaderModule = function(desc) {
      const code = desc && desc.code;
      if (typeof code !== "string" || !/\benable\s+clip_distances\s*;/.test(code) || this.features && this.features.has("clip-distances")) {
        return createShaderModule.apply(this, arguments);
      }
      const fixed = stripClipDistances(code);
      if (!noted) {
        noted = true;
        log("shaders use clip_distances, which this GPU/Chrome does not offer: drawing them without clip planes");
      }
      return createShaderModule.call(this, { ...desc, code: fixed });
    };
  }
  const explain = (e) => {
    const msg = String(e?.message ?? e);
    if (/memory64|i64|address|limits|table64/i.test(msg))
      log("a 64-bit (Memory64) WebAssembly module could not be compiled: " + msg + ". It needs Chrome 133 or newer, or a copy converted by Shasta.");
    throw e;
  };
  for (const name of ["compile", "instantiate", "compileStreaming", "instantiateStreaming"]) {
    const orig = WA[name];
    if (typeof orig !== "function")
      continue;
    WA[name] = function(...a) {
      return orig.apply(this, a).catch(explain);
    };
  }
  function stripClipDistances(code) {
    let out = code.replace(/\benable\s+clip_distances\s*;/g, "");
    const splitTop = (s) => {
      const parts = [];
      let depth = 0;
      let start = 0;
      for (let i = 0;i < s.length; i++) {
        const c = s[i];
        if (c === "(" || c === "<" || c === "[")
          depth++;
        else if (c === ")" || c === ">" || c === "]")
          depth--;
        else if (c === "," && depth === 0) {
          parts.push(s.slice(start, i));
          start = i + 1;
        }
      }
      parts.push(s.slice(start));
      return parts;
    };
    const structRe = /struct\s+([A-Za-z_]\w*)\s*\{([^}]*)\}/g;
    const edits = [];
    out = out.replace(structRe, (whole, name, body) => {
      if (!/@builtin\(\s*clip_distances\s*\)/.test(body))
        return whole;
      const members = splitTop(body);
      const trailing = members.length && !members[members.length - 1].trim() ? members.pop() : undefined;
      const index = members.findIndex((m) => /@builtin\(\s*clip_distances\s*\)/.test(m));
      const member = /([A-Za-z_]\w*)\s*:/.exec(members[index].replace(/@\w+\([^)]*\)/g, ""))?.[1] ?? "";
      edits.push({ name, index, member });
      members.splice(index, 1);
      return `struct ${name} {${members.join(",")}${trailing !== undefined ? "," + trailing : ""}}`;
    });
    for (const { name, index, member } of edits) {
      let from = 0;
      for (;; ) {
        const at = out.slice(from).search(new RegExp(`\\b${name}\\s*\\(`));
        if (at < 0)
          break;
        const open = out.indexOf("(", from + at);
        let depth = 0;
        let close = -1;
        for (let i = open;i < out.length; i++) {
          if (out[i] === "(")
            depth++;
          else if (out[i] === ")" && --depth === 0) {
            close = i;
            break;
          }
        }
        if (close < 0)
          break;
        const args = splitTop(out.slice(open + 1, close));
        if (args.length > index && args.some((a) => a.trim())) {
          args.splice(index, 1);
          const inner = args.join(",");
          out = out.slice(0, open + 1) + inner + out.slice(close);
          from = open + 1 + inner.length;
        } else
          from = close;
      }
      if (member)
        out = out.replace(new RegExp(`[A-Za-z_][\\w.]*\\.${member}\\s*(\\[[^\\]]*\\])?\\s*[-+*/]?=[^;]*;`, "g"), "");
    }
    return out;
  }
})
