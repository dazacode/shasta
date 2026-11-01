import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useUi } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'pointer-events-auto flex max-w-lg items-center gap-3 rounded-xl bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10',
              t.tone === 'error' && 'ring-shasta-danger/50',
            )}
          >
            <span className={cn(t.tone === 'error' && 'text-shasta-danger')}>{t.message}</span>
            {t.action && (
              <button
                className="h-7 rounded-md px-2 font-medium text-shasta-accent transition-colors duration-150 ease-shasta hover:bg-shasta-hover"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded-full p-0.5 text-shasta-muted hover:bg-shasta-hover">
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
