/**
 * The objects this conversation is allowed to use, and the control that adds one.
 *
 * ── Why this one DOES write, when the chip row above the thread does not ──
 *
 * `AiContextChips` is display-only on purpose: it describes what the server
 * assembled, and a chip that set context would be a second client-side source
 * of truth for what the model was told. This control is the other thing. It
 * writes `ai_conversation_tags`, which is the canonical input the `ai-chat`
 * function reads to build its document blocks, so attaching an object here
 * changes what ACT AI can actually see rather than mirroring it.
 *
 * ── Three kinds of context, kept apart ───────────────────────────────────
 *
 * Attached   a tag row on this conversation. The reader put it there, it is
 *            removable, and the server reads it.
 * Inherited  the page the pane was opened from. Also a tag once the thread
 *            exists, but the reader did not choose it, so it is drawn
 *            differently and says where it came from.
 * Mentioned  a name that appears in the prose and nothing more. Deliberately
 *            not a chip: inferring a typed reference from text is how a
 *            conversation about "Apple's suppliers" acquires AAPL as a source
 *            it was never given.
 *
 * ── What may be attached ─────────────────────────────────────────────────
 *
 * Assets, portfolios, themes and notes, because those are the four the tag
 * table's CHECK constraint accepts and therefore the four the server can
 * load. Offering a trade idea or a workflow here would draw a chip the
 * retrieval layer cannot honour, which is worse than not offering it.
 *
 * Candidates come from `useEntitySearch`, which reads through the caller's
 * own RLS, so a reader can only attach an object they can already open. The
 * attachment is not a grant.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle, Briefcase, FileText, Layers, Plus, Search, TrendingUp, X } from 'lucide-react'
import { useEntitySearch, type EntitySearchResult } from '../../hooks/useEntitySearch'
import { referenceUnavailableTitle } from '../../lib/ai/reference-targets'
import { isRetrievalGap, retrievalTitle, type ChipRetrieval } from '../../lib/ai/context-outcome'
import type { TagRef } from '../../hooks/useAI'

/** The four the tag table accepts. Not a style choice: a CHECK constraint. */
export const ATTACHABLE_TYPES = ['asset', 'portfolio', 'theme', 'note'] as const
export type AttachableType = typeof ATTACHABLE_TYPES[number]

const ICON: Record<string, React.ReactNode> = {
  asset: <TrendingUp className="h-3 w-3" />,
  portfolio: <Briefcase className="h-3 w-3" />,
  theme: <Layers className="h-3 w-3" />,
  note: <FileText className="h-3 w-3" />,
}

/*
 * Named headings, because an icon is not a type label.
 *
 * An asset called "Growth" and a theme called "Growth" were two rows
 * distinguished by a 12px glyph, so attaching the wrong one was silent and
 * the conversation then drew its context from an object the reader had not
 * meant to pick.
 */
const GROUP_LABEL: Record<AttachableType, string> = {
  asset: 'Assets',
  portfolio: 'Portfolios',
  theme: 'Themes',
  note: 'Notes',
}

const tagKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

export interface AiContextAttachProps {
  /** Every tag on the conversation, inherited ones included. */
  attached: readonly TagRef[]
  /** The keys that came from the launching page rather than from the reader. */
  inheritedKeys?: readonly string[]
  labels?: Record<string, string>
  onAttach: (tag: TagRef) => void
  onDetach: (tag: TagRef) => void
  /** Open the canonical object. Omitted where the host has no route for it. */
  onOpenObject?: (tag: TagRef) => void
  /**
   * Whether each reference can be followed, per OBJECT rather than per type.
   *
   * It began as a per-type predicate, because only assets had an opener. All
   * four now do, and the question that remains is not "can this kind of
   * thing be opened" but "is this particular one still there, and still
   * mine" -- which only a read of the object answers. So the host resolves
   * the references and reports one of three states:
   *
   *   open      resolved; the chip is a link
   *   checking  the read is in flight; text, and the title says so
   *   gone      deleted, or no longer visible to this reader; text, and the
   *             title says that instead
   *
   * `gone` is shown rather than hidden. The conversation really was about
   * that object, and removing the chip would rewrite what the reader asked.
   */
  referenceStatus?: (tag: TagRef) => 'open' | 'checking' | 'gone'
  /**
   * What the SERVER reported it could read, per object, for the last answer.
   *
   * A different question from `referenceStatus`, and neither answers the
   * other. `referenceStatus` asks "can the READER open this", resolved
   * client-side under the reader's own RLS, and it decides whether the chip
   * is a link. This asks "did the SERVER load it for the answer", and it
   * decides whether the chip is making a claim the answer supports.
   *
   * They disagree in both directions. The failure that prompted this had a
   * portfolio the reader could open perfectly well and that `ai-chat` could
   * not read, because its holdings query named a column that does not
   * exist. `referenceStatus` said `open`, the chip looked attached, and the
   * answer was built from no portfolio at all.
   *
   * `unknown` is the default and is NOT drawn as a problem: it means nothing
   * has been asked about this object yet, which is true of every chip before
   * the first send.
   */
  retrieval?: (tag: TagRef) => ChipRetrieval
  className?: string
}

export function AiContextAttach({
  attached, inheritedKeys = [], labels = {}, onAttach, onDetach, onOpenObject,
  referenceStatus = () => 'open', retrieval = () => 'unknown', className,
}: AiContextAttachProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Index into the FLATTENED candidate list, or -1 for nothing selected. */
  const [cursor, setCursor] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const searchable = query.trim().length >= 2

  const { results, isLoading } = useEntitySearch({
    query,
    types: [...ATTACHABLE_TYPES],
    /* Raised from 6. Six across four kinds is one or two of each, so the
       grouped list below could not show a reader that there were other
       portfolios matching "growth" -- it showed one and looked complete. */
    limit: 12,
    /* Two characters, so opening the control does not issue a search for the
       empty string across four tables. */
    enabled: open && searchable,
  })

  const inherited = new Set(inheritedKeys)
  const already = new Set(attached.map(tagKey))

  /*
   * Grouped by kind, in a fixed order, and FLATTENED back for the keyboard.
   *
   * The list was flat with a 12px icon as the only type signal, so an asset
   * called "Growth" and a theme called "Growth" were two identical rows and
   * attaching the wrong one was silent. Grouping puts a named heading above
   * each kind.
   *
   * The order is fixed rather than by relevance: a list that reorders its
   * sections between keystrokes cannot be navigated, because the row under
   * the cursor changes meaning as the reader types.
   */
  const groups = useMemo(() => {
    const byType = new Map<AttachableType, EntitySearchResult[]>()
    for (const t of ATTACHABLE_TYPES) byType.set(t, [])
    for (const r of results) byType.get(r.type as AttachableType)?.push(r)
    return ATTACHABLE_TYPES
      .map(type => ({ type, items: byType.get(type) ?? [] }))
      .filter(g => g.items.length > 0)
  }, [results])

  /** The same rows the reader sees, in the same order, for arrow keys. */
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups])

  /* A new result set invalidates the cursor. Keeping the index would leave
     it pointing at whatever now occupies that position. */
  useEffect(() => { setCursor(flat.length > 0 ? 0 : -1) }, [flat])

  const attach = (r: EntitySearchResult) => {
    setQuery('')
    setOpen(false)
    setCursor(-1)
    onAttach({ type: r.type as TagRef['type'], id: r.id, label: r.title })
  }

  const close = () => { setOpen(false); setQuery(''); setCursor(-1) }

  const move = (delta: number) => {
    if (flat.length === 0) return
    setCursor(c => {
      const next = (c + delta + flat.length) % flat.length
      /* Scroll the row into view in the overflow container, because the list
         is 56px tall and the fourth match is otherwise selected off-screen. */
      requestAnimationFrame(() => {
        const row = listRef.current
          ?.querySelector<HTMLElement>(`[data-candidate-index="${next}"]`)
        /* Guarded rather than called optionally. `scrollIntoView` is absent
           in jsdom and in older embedded webviews, and an unguarded call
           throws from inside a frame callback, where nothing catches it and
           the whole pane unmounts. */
        if (typeof row?.scrollIntoView === 'function') {
          row.scrollIntoView({ block: 'nearest' })
        }
      })
      return next
    })
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return }
    if (e.key === 'Enter') {
      /* Only when something is selected AND attachable. Enter on an already
         added object did nothing visible, which reads as a broken control
         rather than as a no-op. */
      const pick = flat[cursor]
      if (!pick) return
      e.preventDefault()
      if (!already.has(`${pick.type}:${pick.id}`)) attach(pick)
    }
  }

  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)} data-testid="ai-context-attach">
      {attached.map(t => {
        const key = tagKey(t)
        const isInherited = inherited.has(key)
        const label = t.label || labels[key] || t.id.slice(0, 6)
        const status = referenceStatus(t)
        const served = retrieval(t)
        const gap = isRetrievalGap(served)
        return (
          <span
            key={key}
            data-slot="ai-context-chip"
            data-attach-origin={isInherited ? 'inherited' : 'attached'}
            data-reference-status={status}
            /* The server's verdict, exposed so a test can assert the chip is
               not just repeating the client's own tag write. */
            data-retrieval={served}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-medium',
              /*
               * A retrieval gap outranks the attached/inherited styling.
               *
               * Those two say where the chip came from, which stops mattering
               * the moment the object was not in the answer: the reader's
               * question is no longer "did I add this" but "was it used".
               */
              gap
                ? 'border border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-500/60 dark:bg-amber-900/20 dark:text-amber-200'
                : isInherited
                  ? 'border border-dashed border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
                  : 'border border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200',
            )}
            /* The server's sentence wins when there is one: "you can open
               this but the answer did not use it" is the more surprising and
               more actionable of the two facts. */
            title={retrievalTitle(label, served)
              ?? (status !== 'open'
                ? referenceUnavailableTitle(label, status === 'checking')
                : isInherited
                  ? `${label} comes from the page you opened this from`
                  : `${label} was added to this conversation`)}
          >
            <span className="shrink-0 opacity-70">
              {gap
                ? <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                : ICON[t.type] ?? <FileText className="h-3 w-3" />}
            </span>
            {onOpenObject && status === 'open' ? (
              <button
                type="button"
                data-slot="ai-context-open"
                onClick={() => onOpenObject(t)}
                className="max-w-[14ch] truncate hover:underline"
              >
                {label}
              </button>
            ) : (
              <span
                className={clsx('max-w-[14ch] truncate', status === 'gone' && 'line-through opacity-60')}
              >
                {label}
              </span>
            )}
            <button
              type="button"
              aria-label={`Remove ${label} from this conversation`}
              data-slot="ai-context-remove"
              onClick={() => onDetach(t)}
              className="rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        )
      })}

      {!open ? (
        <button
          type="button"
          data-testid="ai-context-add"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:border-gray-400 hover:text-gray-900 dark:border-gray-600 dark:text-gray-300 dark:hover:text-gray-100"
        >
          <Plus className="h-3 w-3" />Add context
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            data-testid="ai-context-search"
            placeholder="Asset, portfolio, theme or note"
            role="combobox"
            aria-expanded={searchable}
            aria-controls="ai-context-results"
            aria-autocomplete="list"
            aria-activedescendant={cursor >= 0 && flat[cursor]
              ? `ai-context-option-${cursor}`
              : undefined}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="w-[15rem] rounded-full border border-gray-300 py-0.5 pl-7 pr-2 text-[12px] outline-none focus:border-primary-400 dark:border-gray-600 dark:bg-gray-800"
          />
          {/* Opening the control and typing one character used to show
              nothing at all, which looks like a search that found nothing
              rather than one that has not run. */}
          {!searchable && query.trim().length > 0 && (
            <p
              data-testid="ai-context-minlength"
              className="absolute bottom-full left-0 z-20 mb-1 w-[18rem] rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] italic text-gray-400 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              Keep typing, two characters at least.
            </p>
          )}
          {searchable && (
            <ul
              ref={listRef}
              id="ai-context-results"
              role="listbox"
              aria-label="Objects you can attach"
              data-testid="ai-context-results"
              className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-[18rem] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              {isLoading ? (
                <li className="px-2 py-1 text-[11px] italic text-gray-400">Searching…</li>
              ) : flat.length === 0 ? (
                <li className="px-2 py-1 text-[11px] italic text-gray-400">
                  Nothing you can open matches that.
                </li>
              ) : (
                groups.map(group => (
                  /*
                   * `role="group"` on an `<li>`, not a nested `<ul>`: a
                   * listbox's options must be its own descendants for
                   * `aria-activedescendant` to address them, and a second
                   * `<ul>` inside breaks that for a screen reader.
                   */
                  <li key={group.type} role="group" aria-labelledby={`ai-context-group-${group.type}`}>
                    <p
                      id={`ai-context-group-${group.type}`}
                      data-slot="ai-context-group"
                      className="px-2 pb-0.5 pt-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500"
                    >
                      {GROUP_LABEL[group.type]}
                    </p>
                    <ul role="none" className="contents">
                      {group.items.map(r => {
                        const taken = already.has(`${r.type}:${r.id}`)
                        const index = flat.indexOf(r)
                        const active = index === cursor
                        return (
                          <li key={`${r.type}:${r.id}`} role="none">
                            <button
                              type="button"
                              id={`ai-context-option-${index}`}
                              role="option"
                              aria-selected={active}
                              aria-disabled={taken || undefined}
                              data-slot="ai-context-candidate"
                              data-candidate-index={index}
                              data-candidate-type={r.type}
                              disabled={taken}
                              /* Pointer moves the cursor too, so the keyboard
                                 and the mouse never disagree about which row
                                 Enter would take. */
                              onMouseEnter={() => setCursor(index)}
                              onClick={() => attach(r)}
                              className={clsx(
                                'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px]',
                                taken
                                  ? 'cursor-default text-gray-400'
                                  : 'text-gray-700 dark:text-gray-200',
                                active && !taken && 'bg-gray-100 dark:bg-gray-800',
                              )}
                            >
                              <span className="shrink-0 opacity-60">{ICON[r.type] ?? <FileText className="h-3 w-3" />}</span>
                              <span className="flex-1 truncate">{r.title}</span>
                              {r.subtitle && (
                                <span className="max-w-[8rem] shrink-0 truncate text-[10px] text-gray-400">{r.subtitle}</span>
                              )}
                              {taken && <span className="shrink-0 text-[10px]">already added</span>}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
