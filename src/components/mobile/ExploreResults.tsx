import { clsx } from 'clsx'
import { FileText, Lightbulb, List as ListIcon, Loader2, Tag, TrendingUp } from 'lucide-react'
import { useExploreSearch, type ExploreKind, type ExploreResult } from '../../hooks/useExploreSearch'

interface ExploreResultsProps {
  query: string
  onSelect: (result: { id: string; title: string; type: string; data: any }) => void
}

const KIND: Record<ExploreKind, { icon: typeof TrendingUp; label: string; tone: string; tabType: string }> = {
  asset: { icon: TrendingUp, label: 'Asset', tone: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30', tabType: 'asset' },
  theme: { icon: Tag, label: 'Theme', tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/30', tabType: 'theme' },
  list: { icon: ListIcon, label: 'List', tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/30', tabType: 'list' },
  note: { icon: FileText, label: 'Note', tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30', tabType: 'note' },
  idea: { icon: Lightbulb, label: 'Idea', tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30', tabType: 'trade-queue' },
}

/**
 * Topic results, shown under the object results.
 *
 * The two answer different questions and both are worth having. Searching
 * "GLP-1" against object names finds nothing — no asset, theme or list is
 * called that — while the prose contains a thesis about exactly it. This is
 * the half that treats a keyword as a subject rather than a name.
 *
 * Every row says where the term was found and quotes the surrounding text, so
 * a result is self-justifying: you can tell why it is here without opening it,
 * which is the difference between a search that explores and one that makes
 * you check ten things.
 */
export function ExploreResults({ query, onSelect }: ExploreResultsProps) {
  const { data: results = [], isLoading } = useExploreSearch(query)
  const trimmed = query.trim()

  if (trimmed.length < 2) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-gray-400">
          Search a ticker, a name, or a topic — "GLP-1", "datacenter", "margin pressure".
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="py-10 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!results.length) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nothing mentions “{trimmed}” yet.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Theses, trade rationales, notes, themes and lists are all searched.
        </p>
      </div>
    )
  }

  return (
    <div className="pb-safe">
      <div className="px-4 pt-3 pb-1.5 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Mentions of “{trimmed}”
        </h2>
        <span className="text-[11px] text-gray-400 tabular-nums">{results.length}</span>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {results.map(r => (
          <ExploreRow key={`${r.kind}:${r.id}`} result={r} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function ExploreRow({
  result,
  onSelect,
}: {
  result: ExploreResult
  onSelect: ExploreResultsProps['onSelect']
}) {
  const cfg = KIND[result.kind]
  const Icon = cfg.icon

  return (
    <button
      type="button"
      onClick={() => onSelect({
        id: result.id,
        title: result.title,
        type: cfg.tabType,
        data: result.data,
      })}
      className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <span className={clsx('shrink-0 mt-0.5 h-7 w-7 rounded-lg flex items-center justify-center', cfg.tone)}>
        <Icon className="h-4 w-4" />
      </span>

      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {result.title}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
            {cfg.label}
          </span>
        </span>

        {/* Why this result is here. Without it a topic search is a list of
            names with no visible connection to what was typed. */}
        <span className="block text-[11px] text-gray-400 mt-0.5">
          matched in {result.matchedIn}
        </span>

        {result.excerpt && (
          <span className="block text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-3 leading-snug">
            {result.excerpt}
          </span>
        )}
      </span>
    </button>
  )
}
