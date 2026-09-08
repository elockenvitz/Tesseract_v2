/**
 * Pure reader for `tsc --noEmit --listFiles` output.
 *
 * ── The measurement that was not a measurement ────────────────────────────
 *
 * The card-surface gate asserted "positive proof of work" by counting how many
 * files tsc had loaded, and it counted them like this:
 *
 *     lines.filter(l => l.trim() && !/error TS\d+/.test(l)).length
 *
 * Every line that is not a diagnostic is a file path. Except that a TypeScript
 * diagnostic is frequently several lines: the first carries `error TS2322:`
 * and the elaborations under it ("Type 'undefined' is not assignable to type
 * '{}'.") are indented continuations that carry no error code. On a clean run
 * of this repo there are 2,393 of them, and all 2,393 were being counted as
 * files.
 *
 * So the number moved with how VERBOSE the errors were, not with how much work
 * tsc did. Measured on this repository:
 *
 *                             clean      one JSX syntax error
 *     tsc exit status             2                         2
 *     files actually loaded   3,131                     3,132
 *     diagnostics             8,773                         4
 *     "files loaded" printed  5,524                     3,132
 *     verdict                  PASS                      PASS
 *
 * The compiler loaded the SAME files both times. What collapsed was not
 * coverage, it was the error text — because TypeScript reports syntactic
 * diagnostics and then skips semantic analysis of the whole program. All 8,769
 * type errors vanished, any of which could have been on the card surface, and
 * the gate read the resulting silence as cleanliness.
 *
 * Two consequences shape everything below.
 *
 * 1. Count file paths as file paths. A line is a file if it looks like one.
 *
 * 2. The count is NOT the completion test, because it barely moved. The
 *    completion test is causal: a grammar-band diagnostic means tsc never got
 *    to type-checking, so it is a hard failure regardless of what the scoped
 *    error count says.
 */

/** `path(line,col): error TS1234: message` */
const LOCATED = /^(.*?)\((\d+),(\d+)\): (error|warning) TS(\d+): /
/** `error TS5023: Unknown compiler option` — config errors carry no location. */
const UNLOCATED = /^(error|warning) TS(\d+): /
/** What tsc --listFiles emits: one absolute path per line. */
const SOURCE_EXT = /\.(d\.ts|[mc]?tsx?|[mc]?jsx?|json)$/i

/**
 * Diagnostics TypeScript raises before it can type-check anything.
 *
 * TS1xxx is the grammar band and TS17xxx is its JSX half. Their presence is
 * proof that semantic analysis was skipped: the compiler emits syntactic
 * diagnostics INSTEAD of semantic ones, never both.
 *
 * Verified against this repo's accepted baseline of 8,773 errors, which
 * contains zero diagnostics in either band — every one is TS2xxx, TS6xxx,
 * TS7xxx or TS18xxx. So this rule fires on an aborted compile and never on the
 * backlog the repo intentionally tolerates.
 */
export const isGrammarCode = (code) =>
  (code >= 1000 && code <= 1999) || (code >= 17000 && code <= 17999)

/**
 * The compiler could not be configured or could not find what it was told to
 * read. TS5xxx is the option band. The 6xxx codes are named individually
 * because that band also holds `noUnusedLocals`, which the baseline is full of.
 */
export const isInfrastructureCode = (code) =>
  (code >= 5000 && code <= 5999) || [6046, 6053, 6054, 6059, 6231, 6504].includes(code)

/**
 * A diagnostic reported against the config file itself.
 *
 * The general form of the rule above, and the one that does not need a list:
 * tsc only complains about a tsconfig when it could not use it, and the
 * accepted baseline contains no such diagnostic — every one of its 8,773 is
 * against a file under src/.
 */
export const isConfigFileDiagnostic = (d) => /tsconfig[^/\\]*\.json$/i.test(d?.path ?? '')

/**
 * Split raw tsc output into diagnostics, file paths, and diagnostic
 * elaborations — the three things that used to be two.
 */
export function parseTscOutput(stdout) {
  const diagnostics = []
  const files = []
  let continuations = 0
  let unclassified = 0

  for (const rawLine of String(stdout ?? '').split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line.trim()) continue

    const located = line.match(LOCATED)
    if (located) {
      diagnostics.push({ path: located[1], code: Number(located[5]), raw: line })
      continue
    }
    const unlocated = line.match(UNLOCATED)
    if (unlocated) {
      diagnostics.push({ path: '', code: Number(unlocated[2]), raw: line })
      continue
    }
    // Elaborations are indented under their diagnostic.
    if (/^\s/.test(line)) {
      continuations++
      continue
    }
    if (SOURCE_EXT.test(line.trim())) {
      files.push(line.trim())
      continue
    }
    unclassified++
  }

  return { diagnostics, files, continuations, unclassified }
}

/**
 * Did this compile establish the accepted baseline, or did it abort?
 *
 * Returns the problems that make it the second. An empty array means tsc ran
 * the whole program and whatever it reported can be trusted.
 */
export function assessTscCompletion({ diagnostics, files }, { minFiles }) {
  const problems = []

  const grammar = diagnostics.filter((d) => isGrammarCode(d.code))
  if (grammar.length) {
    problems.push(
      `${grammar.length} syntax/grammar diagnostic(s). TypeScript reports these INSTEAD of ` +
        `type errors, so the repository was never type-checked:`,
    )
    grammar.slice(0, 10).forEach((d) => problems.push('    ' + d.raw))
  }

  const infra = diagnostics.filter((d) => isInfrastructureCode(d.code) || isConfigFileDiagnostic(d))
  if (infra.length) {
    problems.push(`${infra.length} compiler configuration/resolution error(s):`)
    infra.slice(0, 10).forEach((d) => problems.push('    ' + d.raw))
  }

  if (files.length < minFiles) {
    problems.push(
      `tsc listed only ${files.length} source files, expected at least ${minFiles}. ` +
        `The program was not built.`,
    )
  }

  return problems
}

/** Card-surface scoping. Separator-normalised: a mismatch would scope to nothing. */
export function scopeDiagnostics(diagnostics, paths) {
  const norm = (p) => p.split('\\').join('/')
  return diagnostics.filter((d) => paths.some((p) => norm(d.path).startsWith(p)))
}
