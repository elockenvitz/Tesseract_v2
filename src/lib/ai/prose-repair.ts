/**
 * Render-time repairs to an answer's markdown.
 *
 * ── Measured, not guessed ─────────────────────────────────────────────────
 *
 * Counted over every assistant message stored in production on 11 and 13
 * November 2026 -- ten answers, the whole live corpus:
 *
 *   0 of 10   used a real heading
 *   3 of 10   faked one with a standalone bold line: `**Bull case**`,
 *             `**Bear case**`, `**Price Target Outcomes**`
 *   2 of 10   ran two sentences together: "...the trough.The second..."
 *   1 of 10   showed the reader a database column: `queue_status`,
 *             `outcome_note (from lifecycle_outcome: executed)`
 *
 * The prompt already forbids the last one in so many words, and the answers
 * still do it. A rule the model agrees with and then breaks is not a fix, so
 * these are corrected where the text is turned into elements.
 *
 * ── Why repair the render and not the storage ─────────────────────────────
 *
 * The stored answer is what the model said, and it stays that. Rewriting
 * `ai_conversations.messages` would edit a record of what happened, break
 * every artifact and citation that points into it by offset, and still not
 * help the next answer. This changes what the reader SEES, which is the
 * thing that was wrong.
 *
 * ── Why no model call ─────────────────────────────────────────────────────
 *
 * Every rule here is a deterministic string transform with its own test. A
 * second model call to tidy the first model's prose would cost a request per
 * answer, could not be tested, and would introduce a second voice into the
 * same paragraph.
 *
 * ── What it deliberately will not do ──────────────────────────────────────
 *
 * Invent vocabulary. An internal name that is not in the map below is left
 * exactly as written: a guessed product word is worse than a visible
 * `queue_status`, because the reader cannot tell it was guessed.
 *
 * Pure. No React, no Supabase.
 */
import { SOURCE_KIND_LABEL } from './trail-text'

/**
 * Lines inside a fenced block are code and are never touched.
 *
 * A repair applied inside a fence would corrupt a query the reader asked for,
 * and the fence is the one place an identifier SHOULD appear verbatim.
 */
function mapOutsideFences(content: string, fn: (line: string) => string): string {
  let fenced = false
  return content
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return line
      }
      return fenced ? line : fn(line)
    })
    .join('\n')
}

/** A line that is nothing but bold text, short enough to be a label. */
const BOLD_LINE = /^(\s*)\*\*([^*]{1,60})\*\*(:?)\s*$/

/** How many unindented bold lines look like section labels. */
function countBoldLines(content: string): number {
  let n = 0
  mapOutsideFences(content, line => {
    const match = line.match(BOLD_LINE)
    if (match && match[1].length === 0 && isLabel(match[2])) n += 1
    return line
  })
  return n
}

/** A label, not a claim: no terminal punctuation and no internal sentence. */
function isLabel(text: string): boolean {
  const body = text.trim().replace(/:$/, '').trim()
  if (!body) return false
  return !/[.!?]$/.test(body) && !/\.\s+\S/.test(body)
}

/**
 * A standalone bold line is a heading. Rendered as one.
 *
 * `**Bull case**` on its own line is a section label: the model meant
 * structure and reached for emphasis, because emphasis is what it reaches
 * for by default. Rendering it as bold prose flattens every section to the
 * same weight, which is why an answer with four sections reads as one wall.
 *
 * `###` rather than `##`, because the message bubble is not a document: the
 * h3 style in `AiProse` is the small caps label, which is what a section
 * inside an answer should look like.
 *
 * ── The three things that are NOT promoted ────────────────────────────────
 *
 *   a bolded SENTENCE   "**Decisions are fragmented and the backlog is
 *                       substantial.**" is emphasis, not a section. It is
 *                       left alone: turning a claim into a heading would
 *                       restructure the argument, which is not a repair.
 *   a long line         over 60 characters is prose that happens to be bold.
 *   a list item         `- **Risk**: ...` is a labelled item, and its label
 *                       is doing its job already.
 */
export function promoteBoldHeadings(content: string): string {
  /*
   * TWO or more, or none at all.
   *
   * One bold line is emphasis; two or more are a section system the model
   * built out of the wrong markup. Measured: each of the three live answers
   * that faked headings used between two and four of them.
   *
   * The count is what separates a section label from a bolded JUDGMENT --
   * "**Still a buy on a 12-month view**" is one line, it is the answer's
   * lead sentence, and rendering it as a small-caps label would bury the
   * thing the reader opened the answer for.
   */
  if (countBoldLines(content) < 2) return content

  return mapOutsideFences(content, line => {
    const match = line.match(BOLD_LINE)
    if (!match) return line
    const [, indent, text] = match
    /* Indented means it belongs to a list item, not to the answer. */
    if (indent.length > 0) return line
    /*
     * The colon goes, and it is usually INSIDE the asterisks: the live
     * answers wrote `**Decisions:**`, so stripping only a colon after the
     * closing marker left "### Decisions:" on screen.
     */
    const body = text.trim().replace(/:$/, '').trim()
    /* A sentence, by the only signals available: terminal punctuation, or an
       internal full stop followed by more words. */
    if (!isLabel(text)) return line
    return `### ${body}`
  })
}

/**
 * Two sentences run together get the space back.
 *
 * "...is the trough.The second..." appeared in two of ten live answers. It
 * reads as a typo the reader made.
 *
 * ── Why this is narrower than it looks ────────────────────────────────────
 *
 * It fires only on a LOWERCASE letter, then the stop, then an uppercase
 * letter followed by a lowercase one. That one condition excludes everything
 * that must not be touched:
 *
 *   BRK.B      uppercase before the stop
 *   U.S.A      same
 *   3.5        digits
 *   e.g.The    fires, and correctly: "e.g. The"
 *   $AAPL      no stop
 *
 * URLs and inline code are excluded separately, because a link is not prose
 * and `a.Name` inside backticks is an expression.
 */
export function separateRunOnSentences(content: string): string {
  return mapOutsideFences(content, line =>
    mapOutsideSpans(line, text =>
      text.replace(/(?<=[a-z])([.!?])(?=[A-Z][a-z])/g, '$1 '),
    ),
  )
}

/**
 * Apply a transform to prose only, skipping inline code and links.
 *
 * Inline code is skipped because it is deliberately verbatim. A link's target
 * is skipped because inserting a space into a URL breaks it, and a URL is
 * full of the exact pattern the sentence rule looks for.
 */
function mapOutsideSpans(line: string, fn: (text: string) => string): string {
  /* Alternation order matters: a code span may contain brackets, so it has to
     be consumed first. */
  const protect = /(`[^`]*`|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+)/g
  const parts = line.split(protect)
  return parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join('')
}

/**
 * Database names the reader should never have been shown.
 *
 * ── Why a fixed map and not a rule ────────────────────────────────────────
 *
 * Because a rule would have to guess. `queue_status` reads as "queue status",
 * which is not what the product calls it either -- it is the decision's
 * status, and only someone who knows the schema knows that. So each entry is
 * a decision, and anything not listed is left verbatim.
 *
 * The record names are derived from `SOURCE_KIND_LABEL`, the same map the
 * evidence section renders, so prose and provenance cannot call one record
 * two things. The field names below it are the ones the live corpus actually
 * leaked, plus the columns the retrieval tools select by name.
 */
const INTERNAL_FIELD_WORDS: Readonly<Record<string, string>> = Object.freeze({
  queue_status: 'decision status',
  lifecycle_outcome: 'execution outcome',
  outcome_note: 'outcome note',
  decision_requests: 'PM rulings',
  decision_reviews: 'reviews',
  accepted_trades: 'committed trades',
  price_targets: 'price targets',
  checklist_items: 'requirements',
  asset_notes: 'notes',
  asset_id: 'the asset',
  organization_id: 'the firm',
  user_id: 'the person',
  created_at: 'when it was created',
  updated_at: 'when it was last changed',
  is_system: 'whether it is a published view',
})

/** Every internal name with a product word, record kinds included. */
export function internalWord(identifier: string): string | null {
  const key = identifier.trim().toLowerCase()
  if (INTERNAL_FIELD_WORDS[key]) return INTERNAL_FIELD_WORDS[key]
  const kindLabel = (SOURCE_KIND_LABEL as Record<string, string>)[key]
  return kindLabel ? kindLabel.toLowerCase() : null
}

/**
 * Turn a leaked identifier into the word the product uses.
 *
 * Only inside an inline code span, which is how these arrive: the model
 * backticks a column name because it knows it is technical, which is the
 * signal that it should not have been there at all. Prose that merely
 * mentions `queue_status` without backticks is left alone -- rewriting
 * arbitrary words in a sentence is how a repair becomes a paraphrase.
 *
 * `identifier: value` is handled, because that is the shape the live corpus
 * leaked: `lifecycle_outcome: executed` becomes "execution outcome: executed".
 */
export function humaniseInternalNames(content: string): string {
  return mapOutsideFences(content, line =>
    line.replace(/`([^`]+)`/g, (whole, inner: string) => {
      const [, name, rest] = inner.match(/^([A-Za-z_][A-Za-z0-9_.]*)(\s*:\s*\S.*)?$/) ?? []
      if (!name) return whole
      const word = internalWord(name)
      /* Unlisted: left exactly as written. See the header. */
      if (!word) return whole
      return rest ? `${word}${rest}` : word
    }),
  )
}

/**
 * Every repair, in the order they must run.
 *
 * Headings first, because promoting a line changes what counts as a line of
 * prose. The sentence rule last, so it sees the text the reader will.
 */
export function repairAnswerProse(content: string): string {
  if (typeof content !== 'string' || !content) return ''
  return separateRunOnSentences(humaniseInternalNames(promoteBoldHeadings(content)))
}
