import type { Backend, DeviceProfile, Kind, Tier } from './catalog'

export type Role = 'system' | 'user' | 'assistant'
export interface ChatMessage {
  role: Role
  content: string
}

export interface GenerationOptions {
  maxNewTokens: number
  temperature: number
}

export type WorkerRequest =
  | { id: number; op: 'init'; profile: DeviceProfile; modelHost: string; ortBase: string }
  | { id: number; op: 'load'; kind: Kind; tier: Tier; speech: 'tiny' | 'base' }
  | ({ id: number; op: 'chat'; tier: Tier; messages: ChatMessage[] } & GenerationOptions)
  | { id: number; op: 'vision'; image: Blob; prompt: string; maxNewTokens: number }
  | { id: number; op: 'transcribe'; audio: Float32Array; speech: 'tiny' | 'base'; language?: string }
  | { id: number; op: 'embed'; texts: string[] }
  | { id: number; op: 'abort'; target: number }
  | { id: number; op: 'unload'; kinds: Kind[] }

export interface TranscriptChunk {
  start: number
  end: number
  text: string
}

export type WorkerEvent =
  | { id: number; type: 'file'; kind: Kind; file: string; loaded: number; total: number }
  | { id: number; type: 'stage'; kind: Kind; stage: 'loading' | 'ready' | 'running'; backend?: Backend }
  | { id: number; type: 'token'; text: string }
  | { id: number; type: 'progress'; done: number; total: number }
  | { id: number; type: 'result'; value?: unknown }
  | { id: number; type: 'error'; message: string }
