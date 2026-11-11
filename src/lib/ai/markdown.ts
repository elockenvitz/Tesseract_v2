/**
 * Markdown helpers for the AI prose renderer.
 *
 * Separate from the renderer because fast refresh only works on a module that
 * exports components and nothing else — and because these are the parts worth
 * testing without a DOM: turning `$AAPL` into a link and reading a table's
 * body out of the parsed tree are both pure string work.
 */
import type { ReactNode } from 'react'

/**
 * Auto-link $TICKER patterns.
 *
 * Matches $AAPL, $TSLA, $BRK.B (the period is let through). Skipped inside an
 * existing link or code span — a naive heuristic, since proper parsing happens
 * in remark, but it covers the common case where the model just emits "$AAPL".
 */
export function preprocessTickers(content: string): string {
  return content.replace(
    /(^|[\s(])\$([A-Z]{1,5}(?:\.[A-Z])?)\b(?![^[]*\]|[^`]*`)/g,
    (_, lead, sym) => `${lead}[$${sym}](#ticker:${sym})`,
  )
}

/** The text of a rendered subtree, for classifying a cell or copying a block. */
export function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children)
  }
  return ''
}

type HastNode = { type?: string; tagName?: string; value?: string; children?: HastNode[] }

/** The text of a hast subtree. */
function hastText(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(hastText).join('')
}

/**
 * The BODY rows of a parsed table, as cell text.
 *
 * The header is excluded on purpose: its words would make every column
 * non-numeric and defeat the alignment entirely. A column of returns is
 * numeric even though the word "Change" is not.
 */
export function tableBodyRows(node: unknown): string[][] {
  const table = node as HastNode | undefined
  const sections = (table?.children ?? []).filter(c => c.tagName === 'tbody')
  const rowNodes = sections.length
    ? sections.flatMap(s => (s.children ?? []).filter(r => r.tagName === 'tr'))
    : (table?.children ?? []).filter(r => r.tagName === 'tr')
  return rowNodes.map(r =>
    (r.children ?? []).filter(c => c.tagName === 'td' || c.tagName === 'th').map(hastText),
  )
}
