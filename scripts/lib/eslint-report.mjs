/**
 * Pure selectors over eslint's JSON formatter output.
 *
 * ── The message that matched nothing ──────────────────────────────────────
 *
 * The mobile ratchet selects violations by rule id:
 *
 *     report.flatMap(f => f.messages.filter(m => test(m.ruleId ?? '')))
 *
 * When a file will not parse there is no syntax tree, so no rule runs, so
 * there is no rule id. eslint reports it like this instead:
 *
 *     { ruleId: null, fatal: true, severity: 2,
 *       message: "Parsing error: Identifier expected." }
 *
 * `ruleId ?? ''` turns that into the empty string, which ends with neither
 * `no-use-before-define` nor `react-hooks/rules-of-hooks`. The file counted
 * toward "files linted" — proof the linter ran — while contributing zero
 * violations, because a file that cannot be parsed cannot violate anything.
 * The ratchet read the resulting silence as compliance and printed PASS.
 */

/**
 * Files eslint could not parse.
 *
 * `fatal` is the documented flag. The second clause catches the same condition
 * on formatter versions that omit it: severity 2 with no rule attached can
 * only be eslint speaking for itself.
 */
export const fatalMessages = (report) =>
  (report ?? []).flatMap((f) =>
    (f?.messages ?? [])
      .filter((m) => m?.fatal === true || (m?.severity === 2 && m?.ruleId == null))
      .map((m) => `${f.filePath}:${m.line ?? '?'} ${m.message}`),
  )

/** Violations of a rule, selected by id. */
export const messagesByRule = (report, test) =>
  (report ?? []).flatMap((f) =>
    (f?.messages ?? [])
      .filter((m) => test(m?.ruleId ?? ''))
      .map((m) => `${f.filePath}:${m.line} ${m.message}`),
  )

/** eslint reports a file it linted whether or not it could read it. */
export const filesLinted = (report) => (Array.isArray(report) ? report.length : 0)
