/**
 * Model prose, rendered.
 *
 * ── Two faults this replaces ──────────────────────────────────────────────
 *
 * 1. Inline code had no styling at all. The old renderer branched on a
 *    `code({ inline })` prop that react-markdown stopped passing at v9 — the
 *    installed version is 10.1.0 and never sets it — so the branch was dead
 *    and every `like this` span fell through to the BLOCK styling: monospace
 *    at 12.5px with no pill and no background. The v10 shape is used here
 *    instead: `pre` owns the block and renders its own `<code>`, so `code` is
 *    only ever reached inline.
 *
 * 2. Tables were typographically flat. A column of money or percentages read
 *    left-aligned in proportional figures, which is unusable for comparing
 *    down a column — the one thing a table of financial figures exists for.
 *
 * ── Why the renderers are module-scope ───────────────────────────────────
 *
 * A `components` object built inside the render function is a NEW set of
 * component types every time, so React remounts the whole parsed tree on each
 * change. While a reply streams, that is a remount per delta. The renderers
 * that need no closure live at module scope and keep their identity; only the
 * link renderer, which closes over the ticker handler, is rebuilt, and it is
 * memoised on that handler.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It does not reformat a number, and it does not colour one the model did not
 * sign. `lib/ai/figures` carries the reasoning; the short version is that a
 * figure shown to a user must stay traceable to what produced it, and that
 * `4.2%` is a level while `+4.2%` is a change.
 */
import { createContext, useContext, useMemo, useState, isValidElement, cloneElement, Children } from 'react'
import type { ReactNode, ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { clsx } from 'clsx'
import { isFigure, figureTone, numericColumns } from '../../lib/ai/figures'
import { preprocessTickers, extractText, tableBodyRows } from '../../lib/ai/markdown'

interface AiProseProps {
  content: string
  /**
   * Called when the reader clicks an inline $TICKER.
   *
   * Unset renders the pill as a plain styled span rather than a dead button,
   * because a control that looks pressable and does nothing is worse than a
   * label.
   */
  onTickerClick?: (symbol: string) => void
  className?: string
}

/** Which columns of the table currently being rendered are numeric. */
const NumericCols = createContext<Set<number>>(new Set())

const PROSE_CLASSES = [
  'prose prose-sm dark:prose-invert max-w-none',
  /* Headings carry the hierarchy, so they get the space. Body copy stays
     tight: a chat reply is read in a column, not a document. */
  'prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-h1:text-[15px] prose-h1:mt-4 prose-h1:mb-1.5',
  'prose-h2:text-[14px] prose-h2:mt-4 prose-h2:mb-1.5',
  'prose-h3:text-[13px] prose-h3:mt-3 prose-h3:mb-1',
  'prose-h4:text-[13px] prose-h4:mt-3 prose-h4:mb-1',
  'prose-p:my-2 prose-p:leading-[1.6]',
  'prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-li:leading-[1.55]',
  'prose-strong:text-gray-900 dark:prose-strong:text-white',
  'prose-hr:my-4 prose-hr:border-gray-200 dark:prose-hr:border-gray-700',
  'prose-pre:my-2 prose-pre:p-0 prose-pre:bg-transparent',
  'prose-code:before:content-none prose-code:after:content-none',
  'prose-blockquote:border-l-2 prose-blockquote:border-gray-300',
  'prose-blockquote:pl-3 prose-blockquote:not-italic prose-blockquote:text-gray-600',
  'dark:prose-blockquote:text-gray-400 dark:prose-blockquote:border-gray-600',
].join(' ')

export function AiProse({ content, onTickerClick, className }: AiProseProps) {
  const processed = useMemo(() => preprocessTickers(content), [content])
  const components = useMemo<Components>(
    () => ({ ...STABLE_COMPONENTS, a: linkRenderer(onTickerClick) }),
    [onTickerClick],
  )

  return (
    <div className={clsx(PROSE_CLASSES, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  )
}

/* ── cells ───────────────────────────────────────────────────────────────── */

function useNumeric(col: number): boolean {
  const cols = useContext(NumericCols)
  return col >= 0 && cols.has(col)
}

function colOf(props: unknown): number {
  return (props as { 'data-col'?: number })?.['data-col'] ?? -1
}

function Th({ children, ...props }: { children?: ReactNode }) {
  const right = useNumeric(colOf(props))
  return (
    <th
      className={clsx(
        'px-2.5 py-1.5 font-semibold text-gray-600 dark:text-gray-300',
        'text-[11px] uppercase tracking-wide whitespace-nowrap',
        right ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  )
}

function Td({ children, ...props }: { children?: ReactNode }) {
  const right = useNumeric(colOf(props))
  const text = extractText(children)
  const tone = figureTone(text)
  return (
    <td
      className={clsx(
        'px-2.5 py-1.5 align-top',
        right && 'text-right tabular-nums whitespace-nowrap',
        /* Only a figure the model signed gets a direction. */
        tone === 'up' && 'text-emerald-700 dark:text-emerald-400',
        tone === 'down' && 'text-red-700 dark:text-red-400',
        !tone && isFigure(text) && 'text-gray-900 dark:text-gray-100',
      )}
    >
      {children}
    </td>
  )
}

const STABLE_COMPONENTS: Components = {
  /*
   * The block owns itself.
   *
   * `pre`'s children have already been through the `code` component, which
   * now always renders the inline pill. So the text is pulled out and
   * re-rendered here rather than passed through, which is what keeps `code`
   * free to be unconditionally inline.
   */
  pre({ children }) {
    return <CodeBlock text={extractText(children)} />
  },

  /* Only ever reached inline, per the note on `pre`. */
  code({ children }) {
    return (
      <code className="px-1 py-0.5 rounded bg-gray-200/80 dark:bg-gray-700/80
                       text-[0.85em] font-mono text-gray-800 dark:text-gray-100">
        {children}
      </code>
    )
  },

  table({ node, children }) {
    return (
      <NumericColsProvider node={node}>
        <div className="my-3 -mx-1 overflow-x-auto">
          <table className="mx-1 border-collapse text-[12.5px] leading-snug">
            {children}
          </table>
        </div>
      </NumericColsProvider>
    )
  },

  thead({ children }) {
    return <thead className="border-b border-gray-300 dark:border-gray-600">{children}</thead>
  },

  /*
   * The row hands each cell its column index.
   *
   * A cell cannot work this out for itself — hast gives it no position among
   * its siblings — and a header has to take its alignment from the column's
   * DATA, not from its own text: a column of returns is numeric even though
   * the word "Change" is not. Only elements are counted, so the whitespace
   * text nodes between cells cannot shift the index.
   */
  tr({ children }) {
    let col = -1
    return (
      <tr className="border-b border-gray-200/70 last:border-0 dark:border-gray-700/60">
        {Children.map(children, (child) => {
          if (!isValidElement(child)) return child
          col += 1
          return cloneElement(child as ReactElement<{ 'data-col'?: number }>, { 'data-col': col })
        })}
      </tr>
    )
  },

  th: Th,
  td: Td,
}

function NumericColsProvider({ node, children }: { node: unknown; children: ReactNode }) {
  const cols = useMemo(() => numericColumns(tableBodyRows(node)), [node])
  return <NumericCols.Provider value={cols}>{children}</NumericCols.Provider>
}

function linkRenderer(onTickerClick?: (symbol: string) => void): Components['a'] {
  return function A({ href, children, ...props }) {
    const ticker = href?.match(/^#ticker:([A-Z]{1,5}(?:\.[A-Z])?)$/)
    if (ticker) {
      const sym = ticker[1]
      if (!onTickerClick) {
        return (
          <span className="inline-flex items-baseline px-1 rounded font-medium text-[0.95em]
                           text-primary-700 dark:text-primary-300
                           bg-primary-50 dark:bg-primary-900/20">
            {children}
          </span>
        )
      }
      return (
        <button
          type="button"
          onClick={() => onTickerClick(sym)}
          className="inline-flex items-baseline px-1 rounded font-medium no-underline text-[0.95em]
                     text-primary-700 dark:text-primary-300
                     bg-primary-50 dark:bg-primary-900/20
                     hover:bg-primary-100 dark:hover:bg-primary-900/40"
          title={`Open ${sym}`}
        >
          {children}
        </button>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary-600 dark:text-primary-400 hover:underline"
        {...props}
      >
        {children}
      </a>
    )
  }
}

/* ── code block ──────────────────────────────────────────────────────────── */

function CodeBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* The clipboard can be refused outright. Say nothing rather than claim
         a copy that did not happen. */
    }
  }

  return (
    <div className="relative group my-2">
      <pre className="overflow-x-auto rounded-md p-3 bg-gray-900 text-gray-100 text-[12.5px] leading-relaxed">
        <code className="font-mono">{text}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded
                   text-[10px] font-medium bg-gray-800/80 text-gray-200 hover:bg-gray-700
                   opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
        title="Copy code"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

