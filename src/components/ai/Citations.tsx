/**
 * The documents the model QUOTED, which is a stronger claim than consulted.
 *
 * Kept visibly apart from the research trail for that reason. The trail says
 * "I looked here"; this says "this sentence rests on these words". Merging the
 * two labels would let a reader take a list of files the model opened as
 * evidence for a specific claim.
 */
import { useState, useMemo } from 'react'
import { BookOpen, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { SourceRef } from './ResearchTrail'
import type { AiSourceRef, MessageCitation } from '../../lib/ai/presentation'

const SNIPPET_MAX = 200

interface CitationsProps {
  citations: MessageCitation[]
  defaultOpen?: boolean
  onOpenSource?: (source: AiSourceRef) => void
  className?: string
}

export function Citations({ citations, defaultOpen = false, onOpenSource, className }: CitationsProps) {
  const [open, setOpen] = useState(defaultOpen)

  /*
   * Group snippets by document, keeping the document's provenance.
   *
   * Keyed by id where there is one, falling back to the title, because two
   * notes can share a title and must not merge into one source. The ref is
   * kept alongside the snippets so a quoted document can be opened, not just
   * read.
   */
  const grouped = useMemo(() => {
    const m = new Map<string, { ref: AiSourceRef | null; title: string; snippets: string[] }>()
    for (const c of citations) {
      const key = c.document_id || c.document_title
      const entry = m.get(key) || {
        title: c.document_title,
        ref: c.document_id && c.kind
          ? {
              kind: c.kind, id: c.document_id, asset_id: c.asset_id ?? null,
              symbol: c.symbol ?? null, title: c.document_title, timestamp: c.timestamp ?? null,
            }
          : null,
        snippets: [] as string[],
      }
      entry.snippets.push(c.cited_text)
      m.set(key, entry)
    }
    return [...m.values()]
  }, [citations])

  if (grouped.length === 0) return null

  return (
    <div className={clsx('mt-3 pt-2 border-t border-gray-200 dark:border-gray-700/60', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400
                   hover:text-gray-800 dark:hover:text-gray-200"
        title={open ? 'Hide quoted sources' : 'Show quoted sources'}
        aria-expanded={open}
      >
        <BookOpen className="w-3 h-3" />
        {grouped.length} quoted source{grouped.length === 1 ? '' : 's'}
        <ChevronRight className={clsx('w-3 h-3 transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {grouped.map((g, gi) => (
            <li key={g.ref?.id ?? `${g.title}-${gi}`} className="text-[11px]">
              {g.ref
                ? <SourceRef source={g.ref} onOpen={onOpenSource} />
                : <span className="font-semibold text-gray-700 dark:text-gray-300">{g.title}</span>}
              <ul className="ml-3 space-y-0.5 mt-0.5">
                {g.snippets.map((s, i) => (
                  <li
                    key={i}
                    className="text-gray-600 dark:text-gray-400 italic border-l-2
                               border-gray-300 dark:border-gray-600 pl-2"
                  >
                    "{s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) + '…' : s}"
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
