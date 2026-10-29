import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUTS } from '@/lib/shortcuts'
import { useUi } from '@/stores/uiStore'

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work while focus is in Shasta or in a page. Your browser reserves some combinations (like new-tab and close-tab); use the Alt+Shift alternatives for those, or the buttons in the interface.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid gap-1">
          {SHORTCUTS.map((s) => (
            <div key={s.action} className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 odd:bg-muted/40">
              <dt>{s.label}</dt>
              <dd className="flex gap-2">
                {s.keys.map((k) => (
                  <kbd key={k} className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {k}
                  </kbd>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
