// Fetch wrapper for the Store backend. Every failure becomes an ApiError with a message that is safe to show people.
import { APP_API_ORIGIN } from '@/lib/appApi'

/**
 * In the installed app the backend is another origin (lib/appApi.ts): the `/api/media/...` addresses in responses
 * are made absolute so <img> loads them from there. A no-op everywhere else.
 */
function absoluteMedia(v: unknown): unknown {
  if (typeof v === 'string') return v.startsWith('/api/media/') ? APP_API_ORIGIN + v : v
  if (Array.isArray(v)) return v.map(absoluteMedia)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, absoluteMedia(x)]))
  return v
}

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
  get offline() {
    // status 0: unreachable; 503 offline/no-backend: the static host's worker says there is no Store server behind it
    return this.status === 0 || this.code === 'offline' || this.code === 'no-backend'
  }
  get noBackend() {
    return this.code === 'no-backend'
  }
  get unauthorized() {
    return this.status === 401
  }
}

interface Options {
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

async function request<T>(method: string, path: string, { body, signal, headers }: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      signal,
      headers: { ...(body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, "Can't reach the Store server. Check your connection and try again.", 'offline')
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* not JSON: a proxy or hosting error page */
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(res.status, err?.message ?? (res.status >= 500 ? 'The Store server had a problem. Try again in a moment.' : `Request failed (${res.status}).`), err?.code, err?.details)
  }
  return (APP_API_ORIGIN ? absoluteMedia(json) : json) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal }),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, { body }),
  put: <T>(path: string, body: unknown = {}) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  /** raw file body (icons, screenshots) */
  blob: <T>(method: 'PUT' | 'POST', path: string, file: Blob) => request<T>(method, path, { body: file }),
}

/** ZIP uploads report progress, which fetch cannot. The body is the raw file. */
export function uploadWithProgress<T>(path: string, file: Blob, onProgress: (fraction: number) => void): { promise: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<T>((resolve, reject) => {
    xhr.open('PUT', path)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError(0, "Can't reach the Store server. Check your connection and try again.", 'offline'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    xhr.onload = () => {
      let json: any = null
      try {
        json = xhr.responseText ? JSON.parse(xhr.responseText) : null
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(json as T)
      else reject(new ApiError(xhr.status, json?.error?.message ?? `Upload failed (${xhr.status}).`, json?.error?.code))
    }
    xhr.send(file)
  })
  return { promise, abort: () => xhr.abort() }
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong.')
