import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NO_PRIVATE_BOOKMARKS } from '@/hooks/usePrivateTab'
import { ClipboardPaste, Search, SlidersHorizontal, Star, TriangleAlert, X } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTabs } from '@/stores/tabsStore'
import { useLibrary } from '@/stores/libraryStore'
import { useSettings, getSettings } from '@/stores/settingsStore'
import { useUi } from '@/stores/uiStore'
import { shownAddress, tabUrl, type Tab } from '@/lib/tabModel'
import { useStore } from '@/store/storeStore'
import { AppIcon } from '@/store/components'
import { NEW_TAB_URL, SEARCH_ENGINES, displayUrl, hostOf, internalPage, isInternalUrl } from '@/lib/url'
import { SitePrivacy } from '@/components/browser/SitePrivacy'
import { useQuerySuggestions } from '@/lib/searchSuggest'
import { buildRows, inlineCompletion, type Row } from '@/lib/omniboxRank'
import { Favicon } from '@/components/browser/Favicon'
import { cn } from '@/lib/utils'

function SiteInfo({ tab }: { tab: Tab }) {
  const url = tabUrl(tab)
  const page = internalPage(url)
  const http = url.startsWith('http:')
  let body: React.ReactNode
  if (page) body = <p>This is one of Shasta's own pages. It never leaves your device.</p>
  else
    body = (
      <>
        <p className="truncate font-medium">{hostOf(url)}</p>
        <p className={cn('mt-0.5 text-xs', http ? 'text-shasta-warn' : 'text-muted-foreground')}>
          {http ? 'Not encrypted (http://)' : 'Encrypted connection (https://)'} · Shasta can't show the certificate details
        </p>
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground">How this works</summary>
          <p className="mt-1">
            {http
              ? 'Nothing on this connection is encrypted, so anyone on the path, including the proxy, can read it. '
              : "The transport refuses sites whose certificate it can't verify, but it doesn't expose the certificate, so don't treat this as a padlock. "}
            The proxy relays your connection and can see which sites you visit, and whoever runs this Shasta server also controls the code your browser runs. Only sign in on a server you trust. Being open in Shasta doesn't make a site trustworthy.
          </p>
        </details>
        <SitePrivacy host={hostOf(url)} />
      </>
    )
  const Icon = page ? Logo : http ? TriangleAlert : url ? SlidersHorizontal : Search
  return (
    <Popover>
      <PopoverTrigger
        aria-label={page ? 'About this page' : http ? 'Not secure — site information' : 'Site information'}
        className={cn('flex h-7 shrink-0 items-center gap-1.5 rounded-full px-1.5 text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg', http && 'text-shasta-warn')}
      >
        <Icon className="size-4" />
        {http && <span className="pr-1 text-xs font-medium">Not secure</span>}
      </PopoverTrigger>
      <PopoverContent>
        <h2 className="mb-2 text-sm font-semibold">{page ? 'Shasta page' : 'Site information'}</h2>
        {body}
      </PopoverContent>
    </Popover>
  )
}

export function Omnibox({ tab }: { tab: Tab }) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{ tabId: string; text: string } | null>(null)
  const [focused, setFocused] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const focusNonce = useUi((s) => s.focusOmnibox)
  const bookmarks = useLibrary((s) => s.bookmarks)
  const history = useLibrary((s) => s.history)
  const engine = useSettings((s) => s.settings.searchEngine)
  const suggestionsOn = useSettings((s) => s.settings.searchSuggestions)
  const submit = useTabs((s) => s.submit)

  const installed = useStore((s) => s.library?.installed)
  const url = tabUrl(tab)
  const isNewTab = url === NEW_TAB_URL
  // installed apps show as app://name or game://name; everything else as the real address
  const shown = shownAddress(tab, displayUrl)
  const text = draft?.tabId === tab.id ? draft.text : isNewTab ? '' : focused ? (tab.app ? shown : url) : shown

  // Ctrl/Cmd+L (and new tabs) ask for focus through the UI store
  useEffect(() => {
    if (!focusNonce) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusNonce])

  const typed = draft?.tabId === tab.id && draft.text.trim() !== '' && draft.text !== url
  const predictions = useQuerySuggestions(open && typed ? draft!.text : '', engine, suggestionsOn)
  const query = draft?.tabId === tab.id ? draft.text : ''
  // inline completion ("roblox" -> "roblox.com"): off right after a deletion, so Backspace removes what was added
  const [noInline, setNoInline] = useState(false)
  const inline = useMemo(() => (open && focused && typed && suggestionsOn && !noInline ? inlineCompletion(query, bookmarks, history, predictions) : null), [open, focused, typed, suggestionsOn, noInline, query, bookmarks, history, predictions])
  const rows = useMemo<Row[]>(() => (open ? buildRows({ query: query.trim(), engine, suggestionsOn, bookmarks, history, installed, predictions, inline }) : []), [open, query, engine, suggestionsOn, bookmarks, history, installed, predictions, inline])
  const shownText = inline ? text + inline.suffix : text
  // keep the added part selected, so typing replaces it and Enter takes it
  useLayoutEffect(() => {
    const el = inputRef.current
    if (inline && el && document.activeElement === el) el.setSelectionRange(text.length, shownText.length)
  }, [inline, text, shownText])

  const close = () => {
    setOpen(false)
    setHighlight(-1)
  }

  const go = (target: string) => {
    if (submit(tab.id, target)) {
      setDraft(null)
      close()
      inputRef.current?.blur()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      if (!rows.length) return
      const dir = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((h) => (h + dir + rows.length + (h === -1 && dir === -1 ? 1 : 0)) % rows.length)
    } else if (e.key === 'Escape') {
      if (open && rows.length) {
        e.preventDefault()
        close()
      } else {
        // second Escape: throw away the edit and give the page back its focus
        setDraft(null)
        close()
        inputRef.current?.blur()
      }
    } else if ((e.key === 'ArrowRight' || e.key === 'End' || e.key === 'Tab') && inline && e.currentTarget.selectionStart !== e.currentTarget.selectionEnd) {
      // take the completion into the text instead of leaving it as a suggestion
      e.preventDefault()
      setDraft({ tabId: tab.id, text: text + inline.suffix })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(highlight >= 0 && rows[highlight] ? rows[highlight].url : inline ? inline.url : text)
    }
  }

  const paste = async () => {
    try {
      const clip = await navigator.clipboard.readText()
      setDraft({ tabId: tab.id, text: clip.trim() })
      setOpen(true)
      inputRef.current?.focus()
    } catch {
      useUi.getState().toast('Your browser did not allow Shasta to read the clipboard. Paste with ' + (navigator.platform.includes('Mac') ? '⌘V' : 'Ctrl+V') + ' instead.', { tone: 'error' })
    }
  }

  const showClear = text.length > 0 && focused
  const placeholder = getSettings().searchEngine ? `Search ${SEARCH_ENGINES[engine].label} or enter a URL` : 'Search or enter a URL'

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className={cn(
          'flex h-bar-h items-center gap-1.5 rounded-full bg-shasta-field px-2 transition-shadow',
          focused && 'ring-2 ring-shasta-accent/60',
          tab.error && !focused && 'ring-1 ring-shasta-danger/40',
        )}
      >
        <SiteInfo tab={tab} />
        <input
          ref={inputRef}
          value={shownText}
          role="combobox"
          aria-label="Address and search bar"
          aria-expanded={open && rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          onChange={(e) => {
            setNoInline(/^delete/.test((e.nativeEvent as InputEvent).inputType ?? ''))
            setDraft({ tabId: tab.id, text: e.target.value })
            setOpen(true)
            setHighlight(-1)
          }}
          onFocus={(e) => {
            setFocused(true)
            setOpen(true)
            e.currentTarget.select()
          }}
          onBlur={() => {
            setFocused(false)
            close()
            setDraft(null)
          }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          inputMode="url"
          className="min-w-0 flex-1 bg-transparent px-1 text-[14px] text-shasta-fg outline-none placeholder:text-shasta-muted"
        />
        {showClear ? (
          <button type="button" aria-label="Clear address" onMouseDown={(e) => e.preventDefault()} onClick={() => { setDraft({ tabId: tab.id, text: '' }); inputRef.current?.focus() }} className="grid size-6 shrink-0 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
            <X className="size-3.5" />
          </button>
        ) : (
          text === '' && (
            <button type="button" aria-label="Paste from clipboard" title="Paste from clipboard" onClick={paste} className="grid size-6 shrink-0 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg">
              <ClipboardPaste className="size-3.5" />
            </button>
          )
        )}
        <BookmarkStar tab={tab} />
      </div>

      {open && rows.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-2xl bg-popover p-1.5 text-popover-foreground shadow-xl ring-1 ring-foreground/10"
        >
          {!typed && <li role="presentation" className="px-3 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">Recently visited</li>}
          {rows.map((r, i) => (
            <li
              key={r.id + r.kind}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => go(r.url)}
              className={cn('flex cursor-default items-center gap-3 rounded-xl px-3 py-2 text-sm', i === highlight && 'bg-shasta-hover')}
            >
              {r.kind === 'app' ? (
                <AppIcon app={{ name: r.primary, iconUrl: r.iconUrl ?? null }} size={20} />
              ) : r.kind === 'search' ? (
                <Search className="size-4 shrink-0 text-shasta-muted" />
              ) : (
                <Favicon url={r.url} className="size-5" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {r.kind === 'search' && r.typedPrefix ? (
                  <>
                    {r.typedPrefix}
                    <strong className="font-semibold">{r.primary.slice(r.typedPrefix.length)}</strong>
                  </>
                ) : r.kind === 'bookmark' || r.kind === 'history' || r.kind === 'nav' ? (
                  <Match text={r.primary} q={query.trim()} />
                ) : (
                  r.primary
                )}
                {r.kind === 'search' && r.secondary && <span className="text-muted-foreground"> - {r.secondary}</span>}
                {r.kind !== 'search' && r.secondary && <span className="ml-2 text-xs text-shasta-accent">{r.kind === 'app' || r.id === 'primary' || r.id === 'inline' ? <span className="text-muted-foreground">{r.secondary}</span> : <Match text={r.secondary} q={query.trim()} />}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Bolds the part of `text` that matches what was typed. */
function Match({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold">{text.slice(i, i + q.length)}</strong>
      {text.slice(i + q.length)}
    </>
  )
}

function BookmarkStar({ tab }: { tab: Tab }) {
  const url = tabUrl(tab)
  const nonce = useUi((s) => s.bookmarkEditor)
  const [open, setOpen] = useState(false)
  const [seenNonce, setSeenNonce] = useState(nonce)
  const bookmark = useLibrary((s) => s.bookmarks.find((b) => b.type === 'bookmark' && b.url === url))
  const allNodes = useLibrary((s) => s.bookmarks)
  const folders = useMemo(() => allNodes.filter((b) => b.type === 'folder'), [allNodes])
  const lib = useLibrary.getState
  const disabled = isInternalUrl(url) || tab.private

  // Cmd/Ctrl+D asks for the editor through the store; derive "open" from the counter change
  if (nonce !== seenNonce) {
    setSeenNonce(nonce)
    if (!disabled) setOpen(true)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={tab.private ? NO_PRIVATE_BOOKMARKS : bookmark ? 'Edit bookmark' : 'Bookmark this page'}
        title={tab.private ? NO_PRIVATE_BOOKMARKS : undefined}
        onClick={(e) => {
          if (!bookmark && !disabled) {
            e.preventDefault()
            lib().addBookmark({ url, title: tab.entries[tab.index].title })
            setOpen(true)
          }
        }}
        className="grid size-7 shrink-0 place-items-center rounded-full text-shasta-muted hover:bg-shasta-hover hover:text-shasta-fg disabled:pointer-events-none disabled:opacity-40"
      >
        <Star className={cn('size-[18px]', bookmark && 'fill-shasta-accent text-shasta-accent')} />
      </PopoverTrigger>
      <PopoverContent align="end">
        {bookmark && (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setOpen(false)
            }}
          >
            <h2 className="text-sm font-semibold">Bookmark added</h2>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Name
              <input
                autoFocus
                value={bookmark.title}
                onChange={(e) => lib().updateNode(bookmark.id, { title: e.target.value })}
                className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Folder
              <select
                value={bookmark.parentId ?? ''}
                onChange={(e) => lib().updateNode(bookmark.id, { parentId: e.target.value || null })}
                className="h-8 rounded-md border border-input bg-popover px-2 text-sm text-foreground"
              >
                <option value="">Bookmarks</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-between">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10"
                onClick={() => {
                  lib().removeNode(bookmark.id)
                  setOpen(false)
                }}
              >
                Remove
              </button>
              <button type="submit" className="rounded-md bg-shasta-accent px-4 py-1.5 text-sm font-medium text-shasta-accent-fg">
                Done
              </button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  )
}
