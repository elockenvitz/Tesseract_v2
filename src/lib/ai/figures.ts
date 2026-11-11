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
 * Which columns of a markdown table are numeric, from the parsed rows.
 *
 * A column counts as numeric when at least one cell is a figure and no cell
 * is a non-empty non-figure. One stray word in a column of numbers makes the
 * whole column text, which is the conservative direction: a left-aligned
 * number column is untidy, a right-aligned sentence is unreadable.
 *
 * Header cells are deliberately excluded by the caller — a column of returns
 * is still numeric when its header says "Change".
 */
export function numericColumns(bodyRows: string[][]): Set<number> {
  const width = bodyRows.reduce((w, r) => Math.max(w, r.length), 0)
  const numeric = new Set<number>()

  for (let col = 0; col < width; col++) {
    let sawFigure = false
    let sawOther = false
    for (const row of bodyRows) {
      const cell = (row[col] ?? '').trim()
      if (!cell || cell === '-' || cell === '—' || cell === 'n/a') continue
      if (isFigure(cell)) sawFigure = true
      else sawOther = true
    }
    if (sawFigure && !sawOther) numeric.add(col)
  }
  return numeric
}
