// Qwen3-style models may still write a hidden reasoning block (<think>…</think>) before the answer. It is noise for a
// student, so it is removed from the stream. Tags can arrive split across chunks, so a possible partial tag is held back.
const OPEN = '<think>'
const CLOSE = '</think>'

/** Length of the longest tail of `s` that is the start of `tag`. */
function partial(s: string, tag: string): number {
  for (let n = Math.min(s.length, tag.length - 1); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n
  return 0
}

export function createThinkFilter() {
  let buf = ''
  let inThink = false
  return {
    push(chunk: string): string {
      buf += chunk
      let out = ''
      for (;;) {
        if (inThink) {
          const i = buf.indexOf(CLOSE)
          if (i < 0) {
            buf = buf.slice(buf.length - partial(buf, CLOSE))
            return out
          }
          buf = buf.slice(i + CLOSE.length).replace(/^\s+/, '')
          inThink = false
        } else {
          const i = buf.indexOf(OPEN)
          if (i >= 0) {
            out += buf.slice(0, i)
            buf = buf.slice(i + OPEN.length)
            inThink = true
            continue
          }
          const keep = partial(buf, OPEN)
          out += buf.slice(0, buf.length - keep)
          buf = buf.slice(buf.length - keep)
          return out
        }
      }
    },
    /** What is left when the stream ends (a held-back "<" that never became a tag). */
    flush(): string {
      const rest = inThink ? '' : buf
      buf = ''
      return rest
    },
  }
}
