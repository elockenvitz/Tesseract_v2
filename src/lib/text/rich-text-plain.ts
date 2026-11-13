/**
 * Research prose as plain text, for surfaces that cannot render it.
 *
 * ── Why this exists outside a component ─────────────────────────────────
 *
 * Every stored research field in this app is Markdown. The reading surfaces
 * render it (`SmartInputRenderer`, `ReactMarkdown`). The POINTER surfaces --
 * a two-line rail excerpt, a `line-clamp-2` requirement summary, a timeline
 * entry -- deliberately do not: a clamped paragraph with headings, bullets
 * and bold runs inside it is unreadable at that size, and a renderer in a
 * clamped box also drags block margins into a row that budgeted for text.
 *
 * So those surfaces print a string. The defect was that they printed the
 * STORED string, so a thesis written as `**iPhone weakness** -> demand slows`
 * reached the reader as the literal characters `**iPhone weakness**`.
 *
 * This lived as `ourViewPlainText` inside `OurViewSummary.tsx`, which is why
 * only that one surface was correct: nothing else could import it without
 * pulling a component module in. It is the same function, moved, and
 * `ourViewPlainText` still exists there as an alias.
 *
 * ── The rule ────────────────────────────────────────────────────────────
 *
 * A surface that shows research either renders it or flattens it with this.
 * Interpolating a stored field straight into JSX is the bug. `markdown-leak`
 * in `src/components/__tests__/` is the guard that says so.
 *
 * This never rewrites what is stored. It is display-only, applied on the way
 * to the screen, and the full markup stays in the database untouched.
 */

/**
 * Strip HTML and Markdown markup, keeping the words.
 *
 * Verbatim by construction: nothing is summarised, reordered or reworded,
 * because several callers attribute the result to a named analyst.
 */
export function richTextToPlain(content: string | null | undefined): string {
  /*
   * HTML *and* Markdown.
   *
   * This stripped tags only, and contributions are MARKDOWN — every other
   * surface renders them through `ReactMarkdown` / `SmartInputRenderer`. So a
   * thesis written as "**Services** mix is mispriced" reached the Snapshot,
   * the conclusion band and the phone as the literal characters `**Services**`,
   * and a `## Heading` or a `[link](url)` leaked whole. Reported from the
   * authenticated app as raw Markdown in the excerpts.
   *
   * Order matters: images before links (both start `[`), and emphasis after
   * code so a backtick span is not half-unwrapped.
   */
  return (content ?? '')
    // HTML first — some contributions carry both.
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Fenced and inline code: keep the code, drop the fence.
    .replace(/```[a-z]*\n?/gi, ' ')
    .replace(/`([^`]*)`/g, '$1')
    // Images drop entirely; links keep their text, not their URL.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Block syntax at the start of a line: headings, quotes, list bullets,
    // ordered markers and horizontal rules.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/^\s{0,3}([-*_]\s*){3,}$/gm, ' ')
    // Emphasis. Longest marker first so `**` is not left as a stray `*`.
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/___([^_]+)___/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The same, but keeping the shape of the writing.
 *
 * ── Why two functions ───────────────────────────────────────────────────
 *
 * `richTextToPlain` collapses every newline, which is right for a one- or
 * two-line pointer: a `line-clamp-2` box has no use for paragraph breaks and
 * a leading newline would spend one of its two lines on nothing.
 *
 * But several surfaces print research into a `whitespace-pre-wrap` box with a
 * generous clamp — the list Overview case column runs to fourteen lines.
 * There the line structure IS the content: a three-bullet risk list collapsed
 * into one paragraph reads as a run-on sentence, and the three risks stop
 * being three things. Those callers want the markup gone and the lines kept.
 *
 * List bullets become `•`, because a clamped list with no markers at all
 * reads as prose that lost its punctuation. Numbered items keep their number.
 * Nothing else is substituted — no markers are invented for headings, and a
 * heading simply loses its hashes and stays on its own line.
 */
export function richTextToPlainBlock(content: string | null | undefined): string {
  const flat = (content ?? '')
    // HTML first. Block-level tags become a newline rather than a space, so
    // rich text that stored `<p>` or `<li>` keeps its breaks instead of
    // melting into one line the moment it passes through here.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Fences go, the code inside stays on its own lines.
    .replace(/^\s*```[a-z]*\s*$/gim, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')

  const lines = flat.split('\n').map(raw => {
    const line = raw.replace(/[ \t]+/g, ' ').trim()
    if (/^([-*_]\s*){3,}$/.test(line)) return ''      // horizontal rule
    return line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^[-*+]\s+/, '• ')
      // Emphasis, longest marker first, after the block syntax so a bold
      // bullet label is not left holding a stray asterisk.
      .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/___([^_]+)___/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .trim()
  })

  // Collapse runs of blank lines to one. A clamped box cannot afford to spend
  // two of its lines on the gap a Markdown writer left before a heading.
  const out: string[] = []
  for (const line of lines) {
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
