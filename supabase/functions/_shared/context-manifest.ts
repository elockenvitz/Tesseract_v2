/**
 * What the server actually loaded for each attached object, reported back.
 *
 * ── The defect this exists for ──────────────────────────────────────────
 *
 * Attaching an object writes a row to `ai_conversation_tags` and draws a
 * chip. The chip was the client asserting its own write succeeded. It said
 * nothing about whether `ai-chat` then found the object, was allowed to read
 * it, or got anything back.
 *
 * In the context loop a tag that resolved to nothing produced an empty
 * string and was dropped, silently. So the reader saw "Large Cap Growth"
 * pinned to the conversation, asked about it, and got an answer built from
 * no portfolio at all -- with nothing on screen distinguishing that from an
 * answer that used it. The model, given no portfolio and no statement that
 * one was missing, answered as though the question were general.
 *
 * A chip is now a claim the server has to support. Each attached tag gets an
 * outcome, the outcomes go into the system prompt so the model must say what
 * it could not see, and they come back in the response so the chip shows the
 * server's verdict rather than the client's hope.
 *
 * ── The five outcomes ───────────────────────────────────────────────────
 *
 * resolved      loaded, and carries something to reason about.
 * empty         loaded, and carries nothing. An asset with no research is a
 *               real state and NOT an error: the answer should say the firm
 *               has written nothing on it, which is different from saying it
 *               could not look.
 * unavailable   the read returned no row. Deleted, or not visible to this
 *               reader -- and those two are deliberately NOT separated.
 * unsupported   the type has no retrieval path, so a chip for it could never
 *               have been honoured.
 * failed        the read itself errored. Transient, and distinct from a read
 *               that worked and found nothing.
 *
 * ── Why `unavailable` does not distinguish deleted from forbidden ───────
 *
 * It cannot, from this seat. Every read here runs under the caller's own
 * RLS, so "deleted" and "exists but is not yours" are the same empty result.
 * Telling them apart needs a privileged read of a client-supplied id, which
 * is both forbidden here and a disclosure in its own right -- "that
 * portfolio exists and belongs to someone else" is information the reader
 * was not entitled to.
 *
 * So the state names both possibilities and claims neither. A guess dressed
 * as a diagnosis would be worse than the ambiguity.
 */

export type ContextOutcome =
  | "resolved"
  | "empty"
  | "unavailable"
  | "unsupported"
  | "failed";

export interface ContextEntry {
  type: string;
  id: string;
  outcome: ContextOutcome;
  /** What was loaded, for `resolved`: e.g. ["thesis", "3 notes"]. */
  loaded?: readonly string[];
  /** The reason, for the non-resolved outcomes. One short sentence. */
  detail?: string;
}

/** The four `ai_conversation_tags` accepts. A CHECK constraint, not a choice. */
const RETRIEVABLE = new Set(["asset", "portfolio", "theme", "note"]);

export function isRetrievableType(type: string): boolean {
  return RETRIEVABLE.has(type);
}

/**
 * Classify one tag from what its reads returned.
 *
 * `found` is whether the primary row came back. `errored` is whether a read
 * threw or returned an error, which outranks everything: a failed read that
 * happens to leave `found` false is a failure, not an absence.
 */
export function classifyContext(input: {
  type: string;
  id: string;
  found: boolean;
  errored?: boolean;
  /** Names of the parts that loaded and carry content. */
  loaded?: readonly string[];
}): ContextEntry {
  const { type, id } = input;

  if (!isRetrievableType(type)) {
    return {
      type, id, outcome: "unsupported",
      detail: `ACT AI cannot load a ${type} as context.`,
    };
  }

  if (input.errored) {
    return {
      type, id, outcome: "failed",
      detail: "Reading this object failed. It was not included in the answer.",
    };
  }

  if (!input.found) {
    return {
      type, id, outcome: "unavailable",
      /* Both possibilities, neither claimed. See the header. */
      detail: "Not found, or no longer visible to you.",
    };
  }

  const loaded = (input.loaded ?? []).filter(part => part.trim().length > 0);
  if (loaded.length === 0) {
    return {
      type, id, outcome: "empty",
      detail: "Found, but nothing is recorded on it yet.",
    };
  }

  return { type, id, outcome: "resolved", loaded };
}

/**
 * The table that answers "does this object exist, for me".
 *
 * Used only to tell `empty` from `unavailable` once the builders have come
 * back with nothing -- never on the happy path, which already proved the
 * object exists by loading it. One `select id ... limit 1` under the
 * caller's own RLS, so it discloses nothing the reader could not already
 * read, and it is skipped entirely when there is nothing to disambiguate.
 */
export const CONTEXT_TABLE: Readonly<Record<string, string>> = Object.freeze({
  asset: "assets",
  portfolio: "portfolios",
  theme: "themes",
  note: "asset_notes",
});

/**
 * What the builders actually produced, named for the manifest.
 *
 * Pure, so the classification can be tested without a database. `kinds` are
 * the `SourceDocument.kind` values the document builder emitted; `textChars`
 * is the length of the embedded-string context for the providers that take
 * that path instead.
 *
 * A document with a kind but no text still counts: the builders already drop
 * empty bodies before pushing, so a pushed document means real content.
 */
export function describeLoaded(
  kinds: readonly string[],
  textChars: number,
): string[] {
  const counts = new Map<string, number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);

  const parts: string[] = [];
  for (const [kind, n] of counts) parts.push(n === 1 ? kind : `${n} ${kind}s`);

  /* The string path has no kinds to count, so its only evidence is that
     something was written at all. The threshold is deliberately low: a
     portfolio with a name and nothing else is still a portfolio that was
     found, and calling that `empty` would be wrong. */
  if (parts.length === 0 && textChars > 0) parts.push("summary");

  return parts;
}

/** Did everything the reader attached actually make it in? */
export function allResolved(entries: readonly ContextEntry[]): boolean {
  return entries.every(e => e.outcome === "resolved");
}

/**
 * The paragraph the model is given about its own gaps.
 *
 * ── Why the prompt carries this at all ──────────────────────────────────
 *
 * Without it the model's input is indistinguishable from a question that had
 * no context attached, so it answers generally and the reader cannot tell.
 * Naming the gap is what lets the answer say "the portfolio you attached
 * could not be read" instead of quietly answering something else.
 *
 * It is phrased as an instruction about honesty rather than a hint, because
 * a model told only that an object is missing will often fill the hole from
 * the question itself.
 *
 * Returns "" when everything resolved -- there is nothing to say, and a line
 * saying so spends tokens on every request to describe the normal case.
 */
export function contextGapPrompt(entries: readonly ContextEntry[]): string {
  const bad = entries.filter(e => e.outcome !== "resolved");
  if (bad.length === 0) return "";

  const lines = bad.map(e => {
    const what = `${e.type} ${e.id}`;
    switch (e.outcome) {
      case "empty":
        return `- ${what}: found, but nothing is recorded on it.`;
      case "unavailable":
        return `- ${what}: could not be read. It may have been deleted, or it may not be visible to this user.`;
      case "unsupported":
        return `- ${what}: this kind of object cannot be loaded as context.`;
      case "failed":
        return `- ${what}: reading it failed. This is a system fault, not an absence of data.`;
      default:
        return `- ${what}: unavailable.`;
    }
  });

  return [
    "ATTACHED CONTEXT THAT IS NOT AVAILABLE TO YOU:",
    ...lines,
    "",
    "The user attached these and can see them listed in the interface, so",
    "they believe you have them. You do not. Say plainly, early in your",
    "answer, which of them you could not read and what that means for what",
    "follows. Do not substitute general knowledge for an object you could",
    "not load, do not infer its contents from the question, and do not",
    "answer as though no context had been attached.",
  ].join("\n");
}

/**
 * One line per request for the function log.
 *
 * Grepping `context_gaps` in the log is how a retrieval regression gets
 * noticed before a reader reports it: the Large Cap Growth failure had been
 * live and invisible, and the only trace of it was a Postgres error about a
 * column, which named no conversation and no tag.
 */
export function manifestLogLine(entries: readonly ContextEntry[]): string {
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
  return JSON.stringify({
    attached: entries.length,
    ...counts,
    gaps: entries.filter(e => e.outcome !== "resolved").map(e => `${e.type}:${e.outcome}`),
  });
}
