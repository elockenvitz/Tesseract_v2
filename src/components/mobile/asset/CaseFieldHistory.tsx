import { useMemo } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { useContributionHistory } from '../../../hooks/useContributions'

interface CaseFieldHistoryProps {
  contributionId: string
}

/**
 * What changed in one case field, and when.
 *
 * Shows the difference rather than the whole revision. A case section is
 * several paragraphs, so a list of full versions is unreadable on a phone and
 * buries the one sentence that actually moved — which is the thing worth
 * reviewing before a decision.
 */
export function CaseFieldHistory({ contributionId }: CaseFieldHistoryProps) {
  const { history, isLoading } = useContributionHistory(contributionId)

  if (isLoading) {
    return <div className="h-4 w-24 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
  }

  if (!history.length) {
    return (
      <p className="text-xs text-gray-400">No edits recorded yet.</p>
    )
  }

  return (
    <ol className="space-y-3">
      {history.map(entry => (
        <li key={entry.id}>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 truncate">
              {entry.user?.full_name ?? 'Someone'}
            </span>
            <span className="text-[11px] text-gray-400 whitespace-nowrap">
              {relative(entry.changed_at)}
            </span>
          </div>
          <Diff before={entry.old_content} after={entry.new_content} />
        </li>
      ))}
    </ol>
  )
}

/**
 * A word-level difference between two revisions.
 *
 * Word-level rather than character-level because prose edits are word edits:
 * a character diff of a rewritten sentence produces confetti, where a word
 * diff reads as a sentence with parts struck out and parts added.
 */
function Diff({ before, after }: { before: string | null; after: string }) {
  const parts = useMemo(() => diffWords(before ?? '', after), [before, after])

  // Case prose is authored in markdown, so a revision is usually a bulleted
  // list. Rendered into a plain <p> the browser collapsed every newline and the
  // list arrived as one run-on paragraph with literal "-" scattered through it.
  // Whitespace is preserved and list markers are drawn as bullets, so a diff of
  // a list still reads as a list.
  const BODY = 'text-[13px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words'

  // A first draft has nothing to compare against; showing every word as an
  // addition is noise, so it reads as plain new text.
  if (!before) {
    return <p className={BODY}>{prettifyMarkers(after)}</p>
  }

  return (
    <p className={BODY}>
      {parts.map((part, i) => (
        <span
          key={i}
          className={clsx(
            part.kind === 'added' && 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
            part.kind === 'removed' && 'bg-red-100 text-red-900 line-through dark:bg-red-900/40 dark:text-red-200'
          )}
        >
          {prettifyMarkers(part.text)}
        </span>
      ))}
    </p>
  )
}

/**
 * Markdown list markers as bullets, and emphasis markers dropped.
 *
 * The diff is word-level over the raw source, so it cannot be handed to a
 * markdown renderer without losing the added/removed spans. Rewriting just the
 * markers keeps the diff intact while making the text read as prose rather than
 * as source. Ordered lists keep their numbers, which carry meaning.
 */
function prettifyMarkers(text: string): string {
  return text
    .replace(/(^|\n)[ \t]*[-*+][ \t]+/g, '$1• ')
    .replace(/(^|\n)[ \t]*(#{1,6})[ \t]+/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*/g, '$1$2')
}

type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * Longest common subsequence over words.
 *
 * Guarded by size: LCS is O(n×m), and a pair of long revisions would otherwise
 * build a matrix large enough to lock the main thread on a phone. Past the
 * limit it falls back to showing the new text alone, which is honest — it just
 * stops claiming to highlight what moved.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean)
  const b = after.split(/(\s+)/).filter(Boolean)

  const MAX = 400
  if (a.length > MAX || b.length > MAX) {
    return [{ kind: 'same', text: after }]
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const parts: DiffPart[] = []
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts[parts.length - 1]
    // Merge runs so a changed phrase is one highlighted block rather than a
    // separate span per word.
    if (last && last.kind === kind) last.text += text
    else parts.push({ kind, text })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i])
      i++
    } else {
      push('added', b[j])
      j++
    }
  }
  while (i < a.length) push('removed', a[i++])
  while (j < b.length) push('added', b[j++])

  return parts
}

function relative(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDistanceToNow(date, { addSuffix: true })
}
