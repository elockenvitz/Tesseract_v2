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
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Briefcase, FileText, Layers, Plus, Search, TrendingUp, X } from 'lucide-react'
import { useEntitySearch, type EntitySearchResult } from '../../hooks/useEntitySearch'
import { referenceUnavailableTitle } from '../../lib/ai/reference-targets'
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
  className?: string
}

export function AiContextAttach({
  attached, inheritedKeys = [], labels = {}, onAttach, onDetach, onOpenObject,
  referenceStatus = () => 'open', className,
}: AiContextAttachProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const { results, isLoading } = useEntitySearch({
    query,
    types: [...ATTACHABLE_TYPES],
    limit: 6,
    /* Two characters, so opening the control does not issue a search for the
       empty string across four tables. */
    enabled: open && query.trim().length >= 2,
  })

  const inherited = new Set(inheritedKeys)
  const already = new Set(attached.map(tagKey))

  const attach = (r: EntitySearchResult) => {
    setQuery('')
    setOpen(false)
    onAttach({ type: r.type as TagRef['type'], id: r.id, label: r.title })
  }

  return (
    <div className={clsx('flex flex-wrap items-center gap-1.5', className)} data-testid="ai-context-attach">
      {attached.map(t => {
        const key = tagKey(t)
        const isInherited = inherited.has(key)
        const label = t.label || labels[key] || t.id.slice(0, 6)
        const status = referenceStatus(t)
        return (
          <span
            key={key}
            data-slot="ai-context-chip"
            data-attach-origin={isInherited ? 'inherited' : 'attached'}
            data-reference-status={status}
            className={clsx(
              'inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-medium',
              isInherited
                ? 'border border-dashed border-gray-300 text-gray-600 dark:border-gray-600 dark:text-gray-400'
                : 'border border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200',
            )}
            title={status !== 'open'
              ? referenceUnavailableTitle(label, status === 'checking')
              : isInherited
                ? `${label} comes from the page you opened this from`
                : `${label} was added to this conversation`}
          >
            <span className="shrink-0 opacity-70">{ICON[t.type] ?? <FileText className="h-3 w-3" />}</span>
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
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setOpen(false); setQuery('') }
            }}
            className="w-[15rem] rounded-full border border-gray-300 py-0.5 pl-7 pr-2 text-[12px] outline-none focus:border-primary-400 dark:border-gray-600 dark:bg-gray-800"
          />
          {query.trim().length >= 2 && (
            <ul
              data-testid="ai-context-results"
              className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-[18rem] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            >
              {isLoading ? (
                <li className="px-2 py-1 text-[11px] italic text-gray-400">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-2 py-1 text-[11px] italic text-gray-400">
                  Nothing you can open matches that.
                </li>
              ) : (
                results.map(r => {
                  const taken = already.has(`${r.type}:${r.id}`)
                  return (
                    <li key={`${r.type}:${r.id}`}>
                      <button
                        type="button"
                        data-slot="ai-context-candidate"
                        disabled={taken}
                        onClick={() => attach(r)}
                        className={clsx(
                          'flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px]',
                          taken
                            ? 'cursor-default text-gray-400'
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800',
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
                })
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
