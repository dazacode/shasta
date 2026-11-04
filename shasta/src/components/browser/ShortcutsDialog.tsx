import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUTS, type Action } from '@/lib/shortcuts'
import { useUi } from '@/stores/uiStore'

/** Sections of the dialog, so a shortcut is found by what it acts on. Anything not listed lands in "More". */
const SECTIONS: { title: string; actions: Action[] }[] = [
  { title: 'Tabs', actions: ['newTab', 'newPrivateTab', 'closeTab', 'reopenTab', 'nextTab', 'prevTab', 'tabN', 'duplicateTab', 'pinTab'] },
  { title: 'Page', actions: ['focusAddress', 'back', 'forward', 'reload', 'stop', 'home', 'bookmark', 'print'] },
  { title: 'Shasta', actions: ['history', 'bookmarks', 'downloads', 'settings', 'toggleBookmarksBar', 'toggleAssistant'] },
  { title: 'Window and games', actions: ['fullscreen', 'toggleGameMode'] },
]

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  const listed = new Set(SECTIONS.flatMap((s) => s.actions))
  const rest = SHORTCUTS.filter((s) => !listed.has(s.action))
  const sections = [...SECTIONS.map((s) => ({ title: s.title, items: SHORTCUTS.filter((d) => s.actions.includes(d.action)) })), { title: 'More', items: rest }].filter((s) => s.items.length)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts work while focus is in Shasta or in a page. Your browser reserves some combinations (like new-tab and close-tab); use the Alt+Shift alternatives for those, or the buttons in the interface.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {sections.map((sec) => (
            <section key={sec.title} aria-labelledby={`sc-${sec.title}`}>
              <h3 id={`sc-${sec.title}`} className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                {sec.title}
              </h3>
              <dl className="grid">
                {sec.items.map((s) => (
                  <div key={s.action} className="flex items-center justify-between gap-4 border-b border-border/60 px-2 py-1.5 last:border-b-0">
                    <dt className="text-sm">{s.label}</dt>
                    <dd className="flex shrink-0 gap-1.5">
                      {s.keys.map((k) => (
                        <kbd key={k} className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
