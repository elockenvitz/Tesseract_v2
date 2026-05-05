import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { clsx } from 'clsx'

interface AIMessageContentProps {
  content: string
  // Optional: called when the user clicks an inline $TICKER link.
  // If unset, links render as plain styled spans (no navigation).
  onTickerClick?: (symbol: string) => void
}

// Auto-link $TICKER patterns to clickable references. Matches $AAPL, $TSLA,
// $BRK.B (lets the period through). Skipped if already inside a markdown
// link or code span — naive heuristic since proper parsing happens in
// remark, but covers the common case where the AI just emits "$AAPL".
function preprocessTickers(content: string): string {
  // Avoid re-wrapping anything that's already wrapped.
  return content.replace(
    /(^|[\s(])\$([A-Z]{1,5}(?:\.[A-Z])?)\b(?![^[]*\]|[^`]*`)/g,
    (_, lead, sym) => `${lead}[$${sym}](#ticker:${sym})`
  )
}

export function AIMessageContent({ content, onTickerClick }: AIMessageContentProps) {
  const processed = useMemo(() => preprocessTickers(content), [content])

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none
                    prose-headings:mt-3 prose-headings:mb-1.5
                    prose-h1:text-base prose-h2:text-base prose-h3:text-sm prose-h4:text-sm
                    prose-p:my-1.5 prose-p:leading-relaxed
                    prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
                    prose-pre:my-2 prose-pre:bg-gray-900 prose-pre:text-gray-100
                    prose-code:before:content-none prose-code:after:content-none
                    prose-table:my-2 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1
                    prose-blockquote:border-l-2 prose-blockquote:border-gray-300
                    prose-blockquote:pl-3 prose-blockquote:not-italic prose-blockquote:text-gray-600
                    dark:prose-blockquote:text-gray-400 dark:prose-blockquote:border-gray-600
                    prose-strong:text-gray-900 dark:prose-strong:text-white">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks get a copy button + dark theme. Inline code stays inline.
          pre({ children, ...props }) {
            return <CodeBlock {...props}>{children as any}</CodeBlock>
          },
          code({ inline, className, children, ...props }: any) {
            if (inline) {
              return (
                <code
                  className="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[0.85em] font-mono"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            // Block code (handled inside the <pre>; this just renders the inner)
            return (
              <code className={clsx('font-mono text-[12.5px]', className)} {...props}>
                {children}
              </code>
            )
          },
          // Tables — borders + subtle header background
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="border-collapse border border-gray-200 dark:border-gray-700 text-sm">
                  {children}
                </table>
              </div>
            )
          },
          thead({ children }) {
            return <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>
          },
          th({ children }) {
            return (
              <th className="border border-gray-200 dark:border-gray-700 px-2 py-1 text-left font-semibold">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="border border-gray-200 dark:border-gray-700 px-2 py-1 align-top">
                {children}
              </td>
            )
          },
          // Links — handle our internal #ticker:SYMBOL refs, otherwise open external in new tab
          a({ href, children, ...props }) {
            const tickerMatch = href?.match(/^#ticker:([A-Z]{1,5}(?:\.[A-Z])?)$/)
            if (tickerMatch) {
              const sym = tickerMatch[1]
              return (
                <button
                  type="button"
                  onClick={() => onTickerClick?.(sym)}
                  className={clsx(
                    'inline-flex items-baseline px-1 py-0 rounded text-primary-700 dark:text-primary-300',
                    'bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/40',
                    'font-medium no-underline text-[0.95em]',
                    !onTickerClick && 'cursor-default'
                  )}
                  title={onTickerClick ? `Open ${sym}` : sym}
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
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  )
}

// ─── Code block with copy button ───────────────────────────────────────────
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  // children is normally a single <code> element; pull the text out for copy.
  const text = useMemo(() => extractText(children), [children])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // ignore — clipboard may be blocked in iframe
    }
  }

  return (
    <div className="relative group">
      <pre className="overflow-x-auto rounded-md p-3 bg-gray-900 text-gray-100 my-2">
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className={clsx(
          'absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded',
          'text-[10px] font-medium bg-gray-800/80 text-gray-200 hover:bg-gray-700',
          'opacity-0 group-hover:opacity-100 transition-opacity'
        )}
        title="Copy code"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children)
  }
  return ''
}
