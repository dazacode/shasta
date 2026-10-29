// Pictures, sound and video on the device: decoding, resizing, sampling frames, recording the microphone and reading
// answers aloud. Nothing here uploads anything.

export const MAX_MEDIA_BYTES = 80 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 15 * 60
export const MAX_VIDEO_AUDIO_SECONDS = 5 * 60

/** Shrinks a picture so a small device can process it; also strips metadata by re-encoding. */
export async function downscaleImage(blob: Blob, maxEdge = 768): Promise<Blob> {
  const bmp = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height))
    const w = Math.max(1, Math.round(bmp.width * scale))
    const h = Math.max(1, Math.round(bmp.height * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } finally {
    bmp.close()
  }
}

/** Decodes any audio (or a video's sound track) to 16 kHz mono, the format speech recognition wants. */
export async function decodeAudio(blob: Blob, maxSeconds = MAX_AUDIO_SECONDS): Promise<{ samples: Float32Array; seconds: number }> {
  if (blob.size > MAX_MEDIA_BYTES) throw new Error(`That file is larger than ${MAX_MEDIA_BYTES / 1048576} MB.`)
  const ctx = new AudioContext()
  try {
    let decoded: AudioBuffer
    try {
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    } catch {
      throw new Error('This browser could not read the sound in that file.')
    }
    const seconds = Math.min(decoded.duration, maxSeconds)
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * 16_000)), 16_000)
    const src = offline.createBufferSource()
    src.buffer = decoded
    src.connect(offline.destination)
    src.start()
    const rendered = await offline.startRendering()
    return { samples: rendered.getChannelData(0).slice(), seconds }
  } finally {
    void ctx.close()
  }
}

export interface VideoFrame {
  time: number
  image: Blob
}

/** Evenly spaced still frames of a video, small enough to describe quickly. */
export async function sampleVideoFrames(file: Blob, count: number): Promise<{ frames: VideoFrame[]; duration: number }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('This browser could not open that video.'))
      video.src = url
    })
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (!duration) throw new Error('This browser could not read the length of that video.')
    const scale = Math.min(1, 512 / Math.max(video.videoWidth || 512, video.videoHeight || 512))
    const w = Math.max(2, Math.round((video.videoWidth || 512) * scale))
    const h = Math.max(2, Math.round((video.videoHeight || 288) * scale))
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot read video frames.')
    const frames: VideoFrame[] = []
    for (let i = 0; i < count; i++) {
      const time = ((i + 0.5) / count) * duration
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('The video took too long to seek.')), 10_000)
        video.onseeked = () => (clearTimeout(t), resolve())
        video.currentTime = time
      })
      ctx.drawImage(video, 0, 0, w, h)
      frames.push({ time, image: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 }) })
    }
    return { frames, duration }
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

export interface Recording {
  stop(): Promise<Blob>
  cancel(): void
}

/** Records the microphone until stopped. The browser asks for permission the first time. */
export async function recordMicrophone(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const rec = new MediaRecorder(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  const release = () => stream.getTracks().forEach((t) => t.stop())
  rec.start()
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => (release(), resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' })))
        rec.state !== 'inactive' ? rec.stop() : rec.onstop?.(new Event('stop'))
      }),
    cancel: () => {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
  }
}

// ---- reading aloud ----
// Only voices that run on the device are used. Some browsers' default voices stream the text to a server; Shasta
// promises on-device AI, so without a local voice it stays silent and says so.

const localVoice = () => {
  const lang = navigator.language.slice(0, 2).toLowerCase()
  const local = speechSynthesis.getVoices().filter((v) => v.localService)
  return local.find((v) => v.lang.toLowerCase().startsWith(lang)) ?? local[0] ?? null
}

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && localVoice() !== null

export function speak(text: string, onEnd?: () => void): boolean {
  if (typeof speechSynthesis === 'undefined') return false
  const voice = localVoice()
  if (!voice) return false
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text.slice(0, 6000))
  u.voice = voice
  u.onend = u.onerror = () => onEnd?.()
  speechSynthesis.speak(u)
  return true
}
export const stopSpeaking = () => typeof speechSynthesis !== 'undefined' && speechSynthesis.cancel()
