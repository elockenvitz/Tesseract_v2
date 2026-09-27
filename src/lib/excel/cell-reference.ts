/**
 * Excel cell references, shared between the desktop grid and a phone.
 *
 * ── Why this module exists ─────────────────────────────────────────────────
 *
 * `parseCellReference` was module-private inside `src/utils/excelParser.ts`,
 * a 1,600-line file whose other exports all take an `XLSX.WorkBook`. A phone
 * has no workbook, but it still has to speak the same reference language, and
 * the only two ways to get this function were to export it or to copy it.
 * A copy is how two clients start disagreeing about what "Summary!B5" means.
 *
 * ── What a reference is ────────────────────────────────────────────────────
 *
 * One string, optionally sheet-qualified: `"B5"` or `"Summary!B5"`. That is
 * the whole contract — `FieldMapping.cell` is a single flat string with no
 * separate sheet field, so the qualification lives inside the value.
 *
 * ── The qualification rule, and why a phone cannot use the desktop's ───────
 *
 * The desktop decides with `workbook.SheetNames.length > 1`: a multi-sheet
 * workbook writes `Summary!B5`, a single-sheet workbook writes a bare `B5`.
 * That rule needs the file open. A phone does not have the file, so it cannot
 * evaluate that condition and must not pretend to.
 *
 * Instead a phone takes the sheet name as an explicit input: name a sheet and
 * the reference is qualified, leave it blank and it is bare. That reproduces
 * both desktop outcomes exactly, and the author is the one person who knows
 * which their workbook is. `sheetNamesIn` then makes the common case one tap
 * by reading the sheets already used in a template.
 *
 * ── A known inconsistency, recorded not fixed ──────────────────────────────
 *
 * Auto-detection always qualifies (`excelParser.ts` builds `${sheetName}!...`
 * unconditionally), while clicking a cell qualifies only when the workbook
 * has several sheets. So the same cell in the same single-sheet workbook is
 * stored as `Sheet1!B5` when detected and `B5` when clicked. Both parse, so
 * nothing breaks, but the stored string depends on provenance. Reproducing
 * that split on mobile would spread it; this module just parses both.
 */

/** A reference split into its parts. `sheet` is null for a bare reference. */
export interface ParsedCellReference {
  sheet: string | null
  cell: string
}

/**
 * Parse `"Summary!B5"` or `"B5"`.
 *
 * Moved verbatim from excelParser.ts, including its leniency: a string that
 * does not look like a reference comes back as `{sheet: null, cell: <input>}`
 * rather than throwing. Callers depend on that — it is what lets a
 * half-typed reference exist in form state without exploding — so validation
 * is a separate function below rather than a change to this one.
 */
export function parseCellReference(ref: string): ParsedCellReference {
  // Trim whitespace and handle edge cases
  const trimmed = ref.trim()
  if (!trimmed) {
    return { sheet: null, cell: '' }
  }

  const match = trimmed.match(/^(?:(.+)!)?([A-Z]+[0-9]+)$/i)
  if (!match) {
    return { sheet: null, cell: trimmed }
  }
  return {
    sheet: match[1]?.trim() || null,
    cell: match[2].toUpperCase()
  }
}

/**
 * Compose a stored reference from a sheet name and a cell.
 *
 * The inverse of the parse, and the exact string shape the desktop grid
 * writes: no quoting, even when the sheet name contains spaces, because the
 * desktop writes `${activeSheet}!${cellRef}` raw. Adding quotes here would
 * produce `'Model Sheet'!B5`, which the parser above does NOT strip — its
 * regex would hand back a sheet named `'Model Sheet'`, the lookup would miss,
 * and the value would silently resolve against the first sheet instead. So
 * matching the desktop's lack of quoting is the correct behaviour, not an
 * oversight inherited from it.
 */
export function formatCellReference(sheet: string | null | undefined, cell: string): string {
  const trimmedCell = cell.trim().toUpperCase()
  const trimmedSheet = sheet?.trim()
  if (!trimmedSheet) return trimmedCell
  return `${trimmedSheet}!${trimmedCell}`
}

/** A1-style cell, no sheet: one or more letters then one or more digits. */
const CELL_ONLY = /^[A-Z]+[0-9]+$/i

/**
 * Is this a usable single-cell reference?
 *
 * The desktop has no validator at all — its only gate is a non-empty check at
 * save time, because the grid can only ever produce well-formed references.
 * A phone accepts typing, so it needs one: without it the first bad reference
 * is discovered at extraction time, against a real workbook, long after the
 * person who typed it has gone.
 */
export function isValidCellReference(ref: string): boolean {
  const { cell } = parseCellReference(ref)
  return CELL_ONLY.test(cell)
}

/**
 * Is this a usable range, as `snapshot_ranges.range` stores it?
 *
 * Ranges are a different shape from cells and only exist on snapshot ranges —
 * a `FieldMapping` addresses exactly one cell and cannot hold a range.
 */
export function isValidRangeReference(ref: string): boolean {
  const trimmed = ref.trim()
  if (!trimmed) return false

  const withoutSheet = trimmed.includes('!')
    ? trimmed.slice(trimmed.indexOf('!') + 1)
    : trimmed

  const [start, end, ...rest] = withoutSheet.split(':')
  if (rest.length > 0 || !start || !end) return false
  return CELL_ONLY.test(start.trim()) && CELL_ONLY.test(end.trim())
}

/** Split a stored range into its sheet and its two ends. */
export function parseRangeReference(ref: string): {
  sheet: string | null
  start: string
  end: string
} {
  const trimmed = ref.trim()
  const bang = trimmed.indexOf('!')
  const sheet = bang === -1 ? null : trimmed.slice(0, bang).trim() || null
  const body = bang === -1 ? trimmed : trimmed.slice(bang + 1)
  const [start = '', end = ''] = body.split(':')
  return { sheet, start: start.trim().toUpperCase(), end: end.trim().toUpperCase() }
}

/** Compose a stored range. Same no-quoting rule as `formatCellReference`. */
export function formatRangeReference(
  sheet: string | null | undefined,
  start: string,
  end: string,
): string {
  const body = `${start.trim().toUpperCase()}:${end.trim().toUpperCase()}`
  const trimmedSheet = sheet?.trim()
  return trimmedSheet ? `${trimmedSheet}!${body}` : body
}

/**
 * The distinct sheet names a template already refers to, in first-seen order.
 *
 * This is how a phone offers sheet choices without opening the workbook: the
 * template itself records which sheets its author used. A template with no
 * qualified references yields an empty list, which is the honest answer —
 * it means every existing reference is bare, and a new bare one will match.
 */
export function sheetNamesIn(references: readonly string[]): string[] {
  const seen: string[] = []
  for (const ref of references) {
    const { sheet } = ref.includes(':') ? parseRangeReference(ref) : parseCellReference(ref)
    if (sheet && !seen.includes(sheet)) seen.push(sheet)
  }
  return seen
}
