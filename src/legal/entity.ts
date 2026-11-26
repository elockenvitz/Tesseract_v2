/**
 * The legal entity's details — the ONE place they are configured.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * Every legal document needs the operator's name, address, jurisdiction and
 * contact addresses. Written inline, those details end up copied into a terms
 * page, a privacy page, a cookie notice, a disclosure page and five contract
 * templates — and then one of the copies is updated and the others are not.
 * A privacy policy naming a different entity than the terms is not a
 * cosmetic defect; it is two inconsistent statements about who holds the data.
 *
 * So: the documents carry `[PLACEHOLDER]` tokens, this module holds the
 * values, and `resolvePlaceholders()` substitutes them at render time.
 *
 * ── Why every value is null ──────────────────────────────────────────────
 *
 * As of 2026-11-25 there is NO legal entity. Nothing below is known, and
 * nothing below may be invented. A policy that names a company which does not
 * exist is a false statement, which is worse than a missing document — that
 * is the rule this whole directory follows, and it is why
 * `docs/legal/site/*.html` was never served.
 *
 * Filling these in is item P0.1 and P0.4 of
 * `docs/legal/operational-readiness.md`. Publication is blocked while any
 * value a published document needs is still null; see `publication.ts`.
 */

/**
 * A detail of the operating entity.
 *
 * `null` means "not established". It does NOT mean "none" — there is no value
 * that means "this company has no legal name".
 */
export type EntityDetail = string | null

export interface LegalEntity {
  /** Exact registered legal name, e.g. "Tesseract Software, Inc." */
  legalName: EntityDetail
  /** "corporation", "limited liability company", … */
  entityType: EntityDetail
  /** State or country of incorporation. */
  jurisdiction: EntityDetail
  /** Full postal address for notices. NOT a home address — see §B of the
   *  counsel register. */
  businessAddress: EntityDetail
  /** Monitored inbox for legal notices. */
  legalEmail: EntityDetail
  /** Monitored inbox for privacy requests. Required in practice by CalOPPA. */
  privacyEmail: EntityDetail
  /** Monitored inbox for support. */
  supportEmail: EntityDetail
  /** Governing law, e.g. "the State of Delaware". */
  governingLaw: EntityDetail
  /** Court venue for disputes. */
  venue: EntityDetail
}

/**
 * The live configuration. Every field is deliberately null.
 *
 * Do not read these from `import.meta.env`. They are not deployment
 * configuration — they are facts about a company, they change approximately
 * never, and putting them in an environment variable is how a staging deploy
 * ends up publishing a different operator than production.
 */
export const LEGAL_ENTITY: LegalEntity = {
  legalName: null,
  entityType: null,
  jurisdiction: null,
  businessAddress: null,
  legalEmail: null,
  privacyEmail: null,
  supportEmail: null,
  governingLaw: null,
  venue: null,
}

/**
 * Placeholder token → the entity field that fills it.
 *
 * The tokens match what the markdown drafts actually contain, in the
 * `[UPPER CASE]` convention the existing drafts already use. Keeping that
 * convention matters: `docs/legal` has a placeholder-reporting test that scans
 * for exactly this shape.
 */
export const PLACEHOLDER_MAP: Record<string, keyof LegalEntity> = {
  '[LEGAL ENTITY NAME]': 'legalName',
  '[LEGAL ENTITY]': 'legalName',
  '[ENTITY TYPE]': 'entityType',
  '[JURISDICTION OF INCORPORATION]': 'jurisdiction',
  '[JURISDICTION]': 'jurisdiction',
  '[BUSINESS ADDRESS]': 'businessAddress',
  // The privacy policy's own wording for the same field. Both spellings are
  // mapped rather than rewriting the document, because a notice address and a
  // notices address are the same fact and two tokens for one fact would be two
  // things to keep in step.
  '[POSTAL ADDRESS]': 'businessAddress',
  '[LEGAL CONTACT EMAIL]': 'legalEmail',
  '[PRIVACY CONTACT EMAIL]': 'privacyEmail',
  '[SUPPORT EMAIL]': 'supportEmail',
  '[GOVERNING LAW]': 'governingLaw',
  '[VENUE]': 'venue',
}

/** A placeholder found in a document, and whether this module can fill it. */
export interface UnresolvedPlaceholder {
  token: string
  /** The entity field that would fill it, or null if the token is not an
   *  entity detail at all (a commercial term like `[LIABILITY CAP]`). */
  field: keyof LegalEntity | null
}

/**
 * The pattern a placeholder matches.
 *
 * ── Two decisions in this regex, both found by being wrong first ─────────
 *
 * **Internal newlines are ALLOWED.** The documents are hard-wrapped markdown,
 * so a token near a line end is written across two lines. A pattern excluding
 * newlines would be blind to exactly the tokens most likely to go unresolved,
 * and there is one: `[PRIVACY CONTACT EMAIL]` in the privacy policy is split
 * after "CONTACT".
 *
 * **The first WORD must be upper case, two characters or more.** An earlier
 * version required only an initial capital, which matched markdown link labels
 * such as `[Website Terms of Use]` and reported them as unresolved
 * placeholders. Two of those turned up in the application terms. Placeholders
 * in these documents are upper case by convention, so requiring the first word
 * to be upper case separates a placeholder from a link label without needing a
 * list of exceptions.
 */
const PLACEHOLDER_PATTERN = /\[([A-Z][A-Z0-9]+(?:[^\][]{0,58})?)\]/g

/**
 * Collapse a token's internal whitespace so a line-wrapped token is the same
 * token as an unwrapped one.
 *
 * Without this, `[PRIVACY CONTACT\nEMAIL]` is not a key in PLACEHOLDER_MAP and
 * would survive into a published page — visible, but only to whoever read that
 * paragraph.
 */
function normalizeToken(inner: string): string {
  return `[${inner.replace(/\s+/g, ' ').trim()}]`
}

/**
 * Every `[PLACEHOLDER]` still present in some text.
 *
 * Reported rather than thrown, because the answer is a list for an operator to
 * work through, and because a commercial placeholder (`[LIABILITY CAP]`) is a
 * different kind of problem from a missing entity name.
 *
 * Tokens come back normalized, so a caller comparing them against
 * PLACEHOLDER_MAP gets the same answer whether or not the document wrapped.
 */
export function findUnresolvedPlaceholders(text: string): UnresolvedPlaceholder[] {
  const out: UnresolvedPlaceholder[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(PLACEHOLDER_PATTERN)) {
    const token = normalizeToken(match[1])
    if (seen.has(token)) continue
    seen.add(token)
    out.push({ token, field: PLACEHOLDER_MAP[token] ?? null })
  }
  return out
}

/**
 * Substitute every known entity detail into some text.
 *
 * A token whose value is null is LEFT IN PLACE, on purpose. Replacing it with
 * an empty string would turn "operated by [LEGAL ENTITY NAME]" into "operated
 * by", which reads as a rendering bug rather than as an unfinished document,
 * and which a reader could mistake for a complete sentence. Leaving the token
 * visible is unmistakable, and the document page styles it conspicuously.
 */
export function resolvePlaceholders(text: string): string {
  /*
   * One pass over the matches rather than one string-split per known token.
   * The split approach cannot see a line-wrapped token at all, which is the
   * defect this function had: `[PRIVACY CONTACT\nEMAIL]` in the privacy policy
   * would never have been substituted.
   */
  return text.replace(PLACEHOLDER_PATTERN, (whole, inner: string) => {
    const field = PLACEHOLDER_MAP[normalizeToken(inner)]
    if (!field) return whole
    return LEGAL_ENTITY[field] ?? whole
  })
}

/** The entity details that are still null. Empty means fully configured. */
export function missingEntityDetails(): (keyof LegalEntity)[] {
  return (Object.keys(LEGAL_ENTITY) as (keyof LegalEntity)[])
    .filter(k => !LEGAL_ENTITY[k])
}

/** Whether the entity is configured enough to publish anything at all. */
export function isEntityConfigured(): boolean {
  return missingEntityDetails().length === 0
}
