/**
 * Fail-closed child-process handling for the verification guards.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Every guard in this repo spawns a checker and reads its stdout. Two of them
 * were written like this:
 *
 *     try { out = execFileSync(...) } catch (e) { out = e.stdout ?? '' }
 *
 * The comment above that catch said "tsc exits non-zero when it finds errors;
 * that is not a failure to run" — which is true, and is also the entire
 * problem. The catch cannot tell that case apart from any other. A checker
 * that was killed by a timeout, died on a stack overflow, exceeded maxBuffer,
 * or never launched at all (`npx` not on PATH) lands in the same branch and
 * hands back whatever partial text it managed to emit. The guard then parses
 * that fragment, finds no violations in it, and prints PASS.
 *
 * A guard that treats "the checker did not run" as "the checker found nothing"
 * is not a guard. `classifyChildOutcome` is the one place that decision is
 * made, and it is pure so it can be tested without spawning anything.
 */

/** npm/npx write these to stderr for reasons unrelated to the checker. */
const BENIGN_STDERR = /^\s*npm (warn|notice|WARN)\b/

/**
 * Strip environment noise so that a genuinely empty stderr can be told apart
 * from a stack trace. Everything that survives this is treated as a crash.
 */
export const meaningfulStderr = (stderr) =>
  String(stderr ?? '')
    .split('\n')
    .filter((l) => l.trim() && !BENIGN_STDERR.test(l))
    .join('\n')

/**
 * Decide whether a spawned checker actually ran to completion.
 *
 * Pure: takes the shape `spawnSync` returns plus the exit codes this
 * particular checker is allowed to use, and returns either `{ ok: true }` or a
 * reason. Nothing here inspects the checker's findings — that is the caller's
 * job, and it may only be done once this returns ok.
 *
 * @param {object} o
 * @param {number|null} o.status      exit code, null if killed by a signal
 * @param {string|null} o.signal      terminating signal, if any
 * @param {Error|undefined} o.error   spawn-level failure (ENOENT, ETIMEDOUT, ENOBUFS)
 * @param {string} o.stderr
 * @param {number[]} o.allowedExitCodes  codes that mean "ran, and reported"
 * @param {string} o.label            checker name, for the message
 */
export function classifyChildOutcome({
  status,
  signal,
  error,
  stderr = '',
  allowedExitCodes = [0],
  label = 'checker',
}) {
  // A spawn-level failure never produced a result at all. ENOENT means the
  // binary was not found; ETIMEDOUT means we killed it; ENOBUFS means the
  // output was truncated mid-stream and anything parsed from it is a fragment.
  if (error) {
    const code = error.code ?? error.name ?? 'unknown'
    return {
      ok: false,
      reason: `${label} did not run to completion: ${code} (${error.message ?? error})`,
    }
  }

  // Killed. `spawnSync`'s timeout lands here on platforms where it does not
  // also set `error`, and so does an OOM kill.
  if (signal) {
    return { ok: false, reason: `${label} was killed by ${signal} — it did not finish.` }
  }

  if (status == null) {
    return { ok: false, reason: `${label} produced no exit status — it did not finish.` }
  }

  if (!allowedExitCodes.includes(status)) {
    return {
      ok: false,
      reason:
        `${label} exited ${status}, which is not a completion code ` +
        `(expected one of ${allowedExitCodes.join(', ')}).`,
    }
  }

  // Checkers here report findings on stdout. Anything on stderr is the process
  // complaining about itself.
  const noise = meaningfulStderr(stderr)
  if (noise) {
    return {
      ok: false,
      reason: `${label} wrote to stderr, which means it failed rather than reported:\n${noise.slice(0, 800)}`,
    }
  }

  return { ok: true }
}

/**
 * Report a classification and exit(1) when it failed.
 *
 * Kept separate from the classifier so the classifier stays testable.
 */
export function requireCompleted(outcome, extra = []) {
  if (outcome.ok) return
  console.error(`FAIL: ${outcome.reason}`)
  console.error('A guard cannot report PASS on a verification that did not complete.')
  extra.forEach((l) => console.error('  ' + l))
  process.exit(1)
}
