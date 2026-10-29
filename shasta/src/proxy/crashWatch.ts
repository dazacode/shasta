// Hears uncaught errors in a proxied frame and in the workers it starts (games do their start-up in a worker, whose
// errors never reach the window). Only the message text leaves here; lib/browserSupport.ts decides what it means.

const text = (r: unknown): string =>
  r && typeof r === 'object' && 'message' in r ? `${(r as { name?: string }).name ?? 'Error'}: ${String((r as Error).message)}` : String(r)

export function watchCrashes(win: Window, report: (message: string) => void) {
  win.addEventListener('error', (e: ErrorEvent) => report(e.error ? text(e.error) : e.message ?? ''))
  win.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => report(text(e.reason)))
  const w = win as unknown as Record<'Worker' | 'SharedWorker', unknown>
  for (const name of ['Worker', 'SharedWorker'] as const) {
    const Ctor = w[name]
    if (typeof Ctor !== 'function') continue
    try {
      w[name] = new Proxy(Ctor, {
        construct(target, args, newTarget) {
          const worker = Reflect.construct(target, args, newTarget) as EventTarget
          worker.addEventListener('error', (e) => report((e as ErrorEvent).message ?? ''))
          return worker
        },
      })
    } catch {
      // not replaceable in this frame: the window's own errors are still heard
    }
  }
}
