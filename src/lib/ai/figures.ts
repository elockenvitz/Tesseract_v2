/**
 * Reading a financial figure out of model prose, without rewriting it.
 *
 * ── What this does and deliberately does not do ───────────────────────────
 *
 * It CLASSIFIES. It never reformats, rounds, converts a unit or recomputes
 * anything. The number the reader sees is the number the model wrote, because
 * a figure surfaced to a user has to be traceable to its source, and a
 * presentation layer that quietly turns "1,234.5m" into "$1.23bn" has broken
 * that chain while looking tidier.
 *
 * What the classification buys is alignment and restraint: a numeric column
 * gets right-aligned with tabular figures so a reader can compare down it, and
 * a figure the model explicitly SIGNED gets a direction tone.
 *
 * ── Why tone needs an explicit sign ───────────────────────────────────────
 *
 * `+4.2%` is a change and `4.2%` is a level. Colouring the second green would
 * assert a direction the model never stated — for a weight, a margin or a
 * multiple that is simply false. So tone is returned only for a leading `+`,
 * a leading `-`, or the accountant's parenthesised negative. Everything else
 * is neutral, including a bare number that happens to be large.
 */

export type FigureUnit = 'money' | 'percent' | 'multiple' | 'basis_points' | 'scaled' | 'plain'

export interface Figure {
  /** What the written suffix or prefix says it is. Never inferred. */
  unit: FigureUnit
  /** The model wrote a leading + or -, or wrapped it in parentheses. */
  signed: boolean
  /** A leading `-` or a parenthesised value. */
  negative: boolean
}

/* A currency prefix, digits with thousands separators, an optional decimal,
   and an optional written unit. Anchored at both ends: a cell must be WHOLLY
   a figure, so "Q3 2026 revenue" and "2026-11-10" are both correctly not one.
   The internal hyphen in a date fails the pattern, which is the point. */
const FIGURE = /^([+-]?)([$€£¥]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%|bps|bp|x|×|bn|b|mm|m|k|tn|t)?$/i

const UNIT_BY_SUFFIX: Record<string, FigureUnit> = {
  '%': 'percent',
  bps: 'basis_points',
  bp: 'basis_points',
  x: 'multiple',
  '×': 'multiple',
  bn: 'scaled', b: 'scaled', mm: 'scaled', m: 'scaled', k: 'scaled',
  tn: 'scaled', t: 'scaled',
}

/**
 * Read a cell as a figure, or null when it is not wholly one.
 *
 * Accepts the accountant's `(1,234)` for a negative. Rejects anything carrying
 * words, a range, two numbers, or a date.
 */
export function readFigure(raw: string): Figure | null {
  const text = raw.trim()
  if (!text) return null

  /* `(1,234.5)` — a negative with no minus sign anywhere in it. Unwrapped
     first so the pattern below sees an ordinary number. */
  const paren = /^\((.+)\)$/.exec(text)
  const body = paren ? paren[1].trim() : text

  const m = FIGURE.exec(body)
  if (!m) return null

  const [, sign, currency, , , suffix] = m
  const negative = paren ? true : sign === '-'
  const unit: FigureUnit =
    suffix ? (UNIT_BY_SUFFIX[suffix.toLowerCase()] ?? 'plain')
      : currency ? 'money'
      : 'plain'

  return { unit, signed: Boolean(paren || sign), negative }
}

/** Whether a cell should be treated as numeric for alignment. */
export function isFigure(raw: string): boolean {
  return readFigure(raw) !== null
}

/**
 * The direction tone for a figure, or null for a level.
 *
 * Null is the common case and the safe one: a number with no sign is not a
 * change, and nothing may render it as though it were.
 */
export function figureTone(raw: string): 'up' | 'down' | null {
  const f = readFigure(raw)
  if (!f || !f.signed) return null
  return f.negative ? 'down' : 'up'
}

/**
 * What a single table cell is, for rendering purposes.
 *
 * ── Why a `token` kind exists ─────────────────────────────────────────────
 *
 * A reported defect: a weight column came back as `3.2%`, `unknown`,
 * `reduced`. Those are not comparable weights, and rendering all three the
 * same way invited a reader to compare them as though they were. The words
 * are not wrong — "unknown" is often the only true answer — but they are a
 * different kind of statement from a number, and the table has to say so.
 *
 * `token` is a short non-figure: a status word, a placeholder, an absence.
 * `text` is everything longer, which is prose and stays left-aligned.
 */
export type CellKind = 'blank' | 'figure' | 'token' | 'text'

/* Short enough to sit in a column of numbers without becoming a paragraph.
   Three words covers "not held", "no position", "awaiting PM ruling". */
const TOKEN_MAX_CHARS = 24
const TOKEN_MAX_WORDS = 3

export function cellKind(raw: string): CellKind {
  const text = raw.trim()
  if (!text) return 'blank'
  if (isFigure(text)) return 'figure'
  /* A full stop means a sentence, whatever its length. */
  if (text.endsWith('.')) return 'text'
  if (text.length > TOKEN_MAX_CHARS) return 'text'
  return text.split(/\s+/).length <= TOKEN_MAX_WORDS ? 'token' : 'text'
}

/** A cell that carries no value at all, and never counts against a column. */
const PLACEHOLDERS = new Set(['-', '–', '—', 'n/a', 'n.a.', 'na', '?'])

function isPlaceholder(cell: string): boolean {
  return PLACEHOLDERS.has(cell.toLowerCase())
}

/**
 * How a column behaves, where it behaves like a column of values.
 *
 * `figures` — every cell that says anything is a figure.
 * `mixed`   — some are figures and the rest are short tokens.
 *
 * Both are right-aligned, so a reader can compare down the column. The
 * difference is what happens to the non-figures: see `CellKind`.
 */
export type ColumnKind = 'figures' | 'mixed'

/**
 * Which columns of a markdown table hold values, and of which kind.
 *
 * ── What changed here, and why it is not a loosening ──────────────────────
 *
 * This used to answer one question — is the column numeric — and a single
 * stray word made the whole column text. The stated reason was that a
 * left-aligned number column is untidy while a right-aligned sentence is
 * unreadable, and that reason still holds: a column containing a SENTENCE is
 * still not a value column.
 *
 * What it conflated is a sentence with a status word. "reduced" sitting in a
 * weight column is the case the reader complained about, and treating the
 * column as prose was the worst of the options: the numbers stopped lining up
 * AND the word still sat in the same place a number would. So that case is
 * now `mixed`, and the renderer marks the word as not-a-number instead.
 *
 * Header cells are deliberately excluded by the caller — a column of returns
 * is still numeric when its header says "Change".
 */
export function valueColumns(bodyRows: string[][]): Map<number, ColumnKind> {
  const width = bodyRows.reduce((w, r) => Math.max(w, r.length), 0)
  const shapes = new Map<number, ColumnKind>()

  for (let col = 0; col < width; col++) {
    let figures = 0
    let tokens = 0
    let prose = 0
    for (const row of bodyRows) {
      const cell = (row[col] ?? '').trim()
      if (!cell || isPlaceholder(cell)) continue
      const kind = cellKind(cell)
      if (kind === 'figure') figures += 1
      else if (kind === 'token') tokens += 1
      else prose += 1
    }
    /* A single sentence still disqualifies the column outright. */
    if (prose > 0 || figures === 0) continue
    shapes.set(col, tokens === 0 ? 'figures' : 'mixed')
  }
  return shapes
}

/**
 * Which columns are right-aligned.
 *
 * Both column kinds are: lining the values up is the whole point, and a short
 * token aligned with them reads as the column's own vocabulary rather than as
 * a stray piece of prose.
 */
export function numericColumns(bodyRows: string[][]): Set<number> {
  return new Set(valueColumns(bodyRows).keys())
}
