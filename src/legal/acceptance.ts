/**
 * Recording that a user accepted the terms.
 *
 * ── What makes an acceptance record worth anything ───────────────────────
 *
 * In a dispute the question is not "did your app show a checkbox". It is
 * "what can you prove this person agreed to, and when". So the record has to
 * answer: WHO, WHICH DOCUMENT, WHICH TEXT, WHEN, and HOW.
 *
 * Three design consequences, each of which rules out a tempting shortcut:
 *
 *  1. **The server decides who.** `record_terms_acceptance` derives the user
 *     from `auth.uid()` and never accepts a user id from the client. A record
 *     the client could address to any user id is not evidence of anything —
 *     and this codebase's own standing rule is that a valid JWT is not
 *     authorisation, because the publishable key is itself a valid JWT.
 *
 *  2. **The server decides when.** `accepted_at` is `now()` in the database,
 *     not a timestamp from the browser. A client clock is attacker-controlled
 *     and, more mundanely, often just wrong.
 *
 *  3. **localStorage is not the record.** It cannot be: it is per-browser,
 *     per-device, clearable in two clicks, and invisible to us. It may be used
 *     to avoid re-prompting within a session, never as the evidence. The
 *     record lives in Postgres with RLS.
 *
 * ── What is deliberately NOT collected ───────────────────────────────────
 *
 * No IP address and no user agent.
 *
 * Both are conventional in clickwrap records and both are personal data whose
 * collection needs a documented purpose. The purpose usually offered is
 * "proving it was really them", which an authenticated session already
 * establishes better than an IP address does. Collecting an IP to strengthen
 * evidence we already have, in a product whose privacy policy must then
 * disclose it, is a poor trade. If counsel concludes otherwise, the migration
 * has a commented column and the reason to enable it belongs in the privacy
 * policy at the same time.
 *
 * ── Fail closed ──────────────────────────────────────────────────────────
 *
 * `recordAcceptance` returns a discriminated result and never throws past the
 * caller. The caller must treat anything other than `ok: true` as "not
 * accepted" and must not let the user proceed. There is no optimistic path,
 * no fire-and-forget, and no local fallback — a swallowed write would produce
 * exactly the failure this module exists to prevent: a user who believes they
 * accepted, and no record that they did.
 */

import { supabase } from '../lib/supabase'
import type { LegalDocument } from './documents'

/** How the acceptance was given. One value today; the column exists so that a
 *  later signed-MSA or admin-on-behalf-of route is distinguishable from a
 *  user's own click rather than being silently merged with it. */
export type AcceptanceMethod = 'clickwrap_checkbox'

export interface AcceptanceInput {
  document: LegalDocument
  /** The organisation the user is acting in, where one is known. Null for a
   *  signup that precedes organisation membership. */
  organizationId: string | null
  method?: AcceptanceMethod
}

export type AcceptanceResult =
  | { ok: true; recordedAt: string }
  | { ok: false; reason: 'not_authenticated' | 'write_failed' | 'not_enabled'; detail?: string }

/**
 * The RPC's name and shape, in one place.
 *
 * `p_` prefixes match the migration's parameter names; PostgREST matches named
 * arguments, so a rename on either side is a runtime failure rather than a
 * compile error. Keeping the call in one function means one place to fix.
 */
const RPC = 'record_terms_acceptance'

export async function recordAcceptance(input: AcceptanceInput): Promise<AcceptanceResult> {
  const { document, organizationId, method = 'clickwrap_checkbox' } = input

  /*
   * Belt and braces: the UI should not have offered the control at all if the
   * document is a draft, but a draft acceptance is the one record that must
   * never exist, so it is refused here too. A gate enforced only in the
   * component is a gate one refactor away from being gone.
   */
  if (document.status !== 'approved') {
    return { ok: false, reason: 'not_enabled', detail: 'document is not approved' }
  }

  const { data: authData, error: authError } = await supabase.auth.getUser()
  if (authError || !authData?.user) {
    return { ok: false, reason: 'not_authenticated' }
  }

  const { data, error } = await supabase.rpc(RPC, {
    p_document_id: document.id,
    p_document_version: document.version,
    p_organization_id: organizationId,
    p_method: method,
  })

  if (error) {
    return { ok: false, reason: 'write_failed', detail: error.message }
  }

  /*
   * The RPC returns the stored `accepted_at`. A null here means the statement
   * ran and stored nothing, which must not read as success — the most likely
   * cause is an RLS policy silently filtering the insert's RETURNING row.
   */
  const recordedAt = typeof data === 'string' ? data : (data?.accepted_at ?? null)
  if (!recordedAt) {
    return { ok: false, reason: 'write_failed', detail: 'no acceptance timestamp returned' }
  }

  return { ok: true, recordedAt }
}

/**
 * Which approved documents this user has NOT yet accepted.
 *
 * Read from the server, not from local state. An empty array from a failed
 * query would read as "everything accepted", so a read failure is returned as
 * an error and the caller must treat it as "unknown", never as "accepted".
 */
export async function fetchOutstandingAcceptances(
  documents: LegalDocument[],
): Promise<{ ok: true; outstanding: LegalDocument[] } | { ok: false; detail: string }> {
  const required = documents.filter(d => d.status === 'approved' && d.requiresAcceptance)
  if (required.length === 0) return { ok: true, outstanding: [] }

  const { data, error } = await supabase
    .from('terms_acceptances')
    .select('document_id, document_version')

  if (error) return { ok: false, detail: error.message }

  const accepted = new Set((data ?? []).map(r => `${r.document_id}@${r.document_version}`))
  return {
    ok: true,
    outstanding: required.filter(d => !accepted.has(`${d.id}@${d.version}`)),
  }
}
