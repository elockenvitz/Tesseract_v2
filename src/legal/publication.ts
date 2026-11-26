/**
 * The two gates: publication, and acceptance enforcement.
 *
 * ── Why these are separate ───────────────────────────────────────────────
 *
 * They fail differently and they are turned on at different times.
 *
 *   PUBLICATION  — may a visitor read the documents?
 *                  Turning this on too early publishes text naming an entity
 *                  that does not exist. That is a false statement.
 *
 *   ACCEPTANCE   — must a user tick a box and does that create a record?
 *                  Turning this on too early manufactures a record of users
 *                  accepting a document counsel has not read. That is worse
 *                  than having no record, because it looks like consent.
 *
 * A single flag would force both at once, and the correct sequence is
 * publication first, acceptance second, with counsel's approval between them.
 * `docs/legal/legal-release-checklist.md` is the sequence.
 *
 * ── Why both default to OFF, including in development ────────────────────
 *
 * A default of ON "for convenience in dev" is how a gate ends up on in
 * production: someone copies an env file, or a build runs without the
 * variable set and the fallback wins. The cost of defaulting to OFF is one
 * line in `.env.local` for anyone reviewing the pages. The cost of defaulting
 * to ON is a legal document published by accident.
 */

import { anyDocumentIsDraft, allAcceptanceDocumentsApproved } from './documents'
import { isEntityConfigured } from './entity'

/**
 * Read a boolean from the environment.
 *
 * Explicitly `'true'` only. Vite inlines every `VITE_*` value as a string, so
 * an unset variable is `undefined`, an empty one is `''`, and `'false'` is a
 * truthy string — which is exactly how a gate meant to be off reads as on.
 */
function envFlag(value: unknown): boolean {
  return value === 'true'
}

/**
 * Whether the legal document pages serve their text.
 *
 * When false the routes still exist and still render — a dead link in a footer
 * is its own defect — but they show a short "in preparation" notice instead of
 * document text. Nothing false is served, and nothing looks broken.
 */
export function isLegalPublicationEnabled(): boolean {
  return envFlag(import.meta.env.VITE_LEGAL_PUBLISHED)
}

/**
 * Whether a new account must affirmatively accept the terms.
 *
 * ── Three conditions, all required ───────────────────────────────────────
 *
 * The flag alone is not enough, and the two extra conditions are the point of
 * this function:
 *
 *  1. the flag is on;
 *  2. every acceptance-required document is `approved` — otherwise the
 *     record would say a user accepted a draft;
 *  3. publication is on — otherwise a user would be asked to accept a
 *     document they cannot open, which is both unfair and, in most
 *     jurisdictions, unenforceable.
 *
 * Condition 3 is the one a reviewer should check hardest. "Tick to accept
 * terms you may not read" is the defect this function exists to make
 * impossible, rather than something a release checklist has to remember.
 */
export function isTermsAcceptanceEnabled(): boolean {
  if (!envFlag(import.meta.env.VITE_LEGAL_ACCEPTANCE_ENABLED)) return false
  if (!allAcceptanceDocumentsApproved()) return false
  if (!isLegalPublicationEnabled()) return false
  return true
}

/** Why acceptance is off, for an operator reading a diagnostic. Never shown
 *  to a visitor — the configuration of this site is not a visitor's business,
 *  which is a rule this codebase has already broken once in public. */
export function acceptanceBlockers(): string[] {
  const out: string[] = []
  if (!envFlag(import.meta.env.VITE_LEGAL_ACCEPTANCE_ENABLED)) {
    out.push('VITE_LEGAL_ACCEPTANCE_ENABLED is not "true"')
  }
  if (!allAcceptanceDocumentsApproved()) {
    out.push('a document requiring acceptance is still status: draft')
  }
  if (!isLegalPublicationEnabled()) {
    out.push('publication is disabled, so the documents cannot be read')
  }
  return out
}

/**
 * Whether a reader should be warned that what they are looking at is a draft.
 *
 * True whenever any document is still a draft OR the entity is unconfigured.
 * The second condition matters independently: an "approved" document still
 * carrying `[LEGAL ENTITY NAME]` is not a document anyone should rely on, and
 * a status field cannot catch that on its own.
 */
export function shouldShowDraftWarning(): boolean {
  return anyDocumentIsDraft() || !isEntityConfigured()
}
