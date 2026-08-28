/**
 * Personal coverage — what a professional says they follow.
 *
 * ── Why this is a separate module from CoverageManager ────────────────────
 *
 * CoverageManager is a 7,000-line governance surface: an analyst-by-asset
 * matrix, request approvals, workload analytics, bulk reassignment, node-level
 * admin fences. It answers "how does this firm allocate research responsibility",
 * and it answers it for somebody who has the authority to change the answer.
 *
 * This module answers a different and much smaller question: "what do I
 * follow?" — asked by a person about themselves, in the first two minutes of
 * their first session, quite possibly on a phone. Routing that through the
 * governance surface is what produced the state this replaces: 20 one-member
 * workspaces with zero coverage rows between them, because declaring coverage
 * required a `users.coverage_admin` flag that 2 of 26 accounts held.
 *
 * ── Two lanes, one table ──────────────────────────────────────────────────
 *
 * Personal coverage is not a second coverage system and deliberately not a
 * separate table. It is the same `coverage` rows every existing consumer
 * already reads — the asset page, thesis tabs, notifications, the org chart —
 * carrying `coverage_scope = 'personal'`. A solo professional's declaration
 * shows up everywhere firm-assigned coverage does, which is the entire point:
 * coverage is what makes the product relevant, so it has to be the same thing.
 *
 * The lane is enforced in RLS, not here. See
 * `20260828100000_coverage_self_service_foundation.sql`: a user may write only
 * `personal` rows, only for themselves, only in their current organization, and
 * may not convert a row between lanes in either direction. Everything in this
 * file could be bypassed by a hand-rolled PostgREST call and the boundary would
 * still hold. That is the test for whether a boundary is real.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * Not holdings. A position is a fact about a portfolio; coverage is a claim
 * about attention. They overlap constantly and are not the same signal — an
 * analyst covers names they do not own (that is most of the job) and portfolios
 * hold names nobody is actively working. Collapsing them would make "what
 * should I look at" unanswerable for exactly the users who most need it
 * answered. Holdings stay in `portfolio_holdings` and are read separately.
 */

import { supabase } from '../supabase'

/** The lane discriminator, mirrored from `coverage.coverage_scope`. */
export type CoverageScope = 'personal' | 'org'

export interface PersonalCoverageRow {
  id: string
  asset_id: string
  user_id: string
  organization_id: string
  analyst_name: string
  coverage_scope: CoverageScope
  is_active: boolean
  start_date: string | null
  notes: string | null
  created_at: string
  assets: {
    id: string
    symbol: string
    company_name: string | null
    sector: string | null
  } | null
}

/**
 * The columns every personal-coverage read needs.
 *
 * `assets` is embedded through the asset FK, which does exist. `users` is NOT
 * embedded: `coverage.user_id` carries no foreign key, so PostgREST cannot
 * traverse it, and asking it to returns an error rather than a null. The
 * display name comes from the denormalised `analyst_name` column instead —
 * the same thing every other coverage surface reads. MobileCoverage shipped
 * once with an embed through `user_id` and every analyst on the screen was
 * labelled with the literal fallback string.
 */
const SELECT_COLUMNS =
  'id, asset_id, user_id, organization_id, analyst_name, coverage_scope, ' +
  'is_active, start_date, notes, created_at, ' +
  'assets:asset_id(id, symbol, company_name, sector)'

export interface CoverageIdentity {
  userId: string
  orgId: string
  /** Denormalised display name. Falls back to the email local part. */
  analystName: string
}

/** Build the display name the same way every other coverage writer does. */
export function coverageAnalystName(user: {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
} | null | undefined): string {
  if (!user) return 'Unknown'
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  if (full) return full
  return user.email?.split('@')[0] || 'Unknown'
}

/**
 * Every active coverage row for one user in one organization, both lanes.
 *
 * Both lanes on purpose. A user invited into an already-configured team may
 * have org-assigned coverage and no personal rows at all; showing them an
 * empty "your coverage" screen and inviting them to build it from scratch
 * would be wrong twice over — it hides what they are actually responsible for,
 * and it asks them to redo work somebody already did. The caller distinguishes
 * the lanes by `coverage_scope` to decide what is editable.
 */
export async function fetchMyCoverage(
  identity: Pick<CoverageIdentity, 'userId' | 'orgId'>,
): Promise<PersonalCoverageRow[]> {
  const { data, error } = await supabase
    .from('coverage')
    .select(SELECT_COLUMNS)
    .eq('user_id', identity.userId)
    .eq('organization_id', identity.orgId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as PersonalCoverageRow[]
}

/**
 * Declare coverage of one asset.
 *
 * Returns the created row. Idempotent from the caller's point of view: if an
 * active row already exists for this (user, org, asset) in the personal lane
 * it is returned unchanged rather than duplicated. `coverage` has no unique
 * constraint on (asset_id, user_id) — historical and active rows are allowed
 * to coexist by design — so uniqueness for *this* lane is the caller's job,
 * and doing it here means every caller gets it.
 */
export async function addPersonalCoverage(
  identity: CoverageIdentity,
  assetId: string,
  opts?: { notes?: string | null },
): Promise<PersonalCoverageRow> {
  const { data: existing } = await supabase
    .from('coverage')
    .select(SELECT_COLUMNS)
    .eq('user_id', identity.userId)
    .eq('organization_id', identity.orgId)
    .eq('asset_id', assetId)
    .eq('coverage_scope', 'personal')
    .eq('is_active', true)
    .maybeSingle()

  if (existing) return existing as unknown as PersonalCoverageRow

  // `as never` on the payload: the Supabase client is generated without
  // database types in this project, so every table resolves to `never` and
  // both `.insert()` and `.update()` reject any object literal. Same shape of
  // cast the rest of the codebase uses at these call sites.
  const { data, error } = await supabase
    .from('coverage')
    .insert({
      asset_id: assetId,
      user_id: identity.userId,
      organization_id: identity.orgId,
      analyst_name: identity.analystName,
      coverage_scope: 'personal',
      is_active: true,
      notes: opts?.notes ?? null,
      // team_id and is_lead are deliberately absent. A personal row carries no
      // organizational authority, and the CHECK constraint enforces that
      // independently of what any client sends.
    } as never)
    .select(SELECT_COLUMNS)
    .single()

  if (error) throw error
  return data as unknown as PersonalCoverageRow
}

/**
 * Stop covering an asset.
 *
 * Retires the row rather than deleting it. Coverage is a research record with
 * an audit trail (`coverage_history`), and "I stopped following this in March"
 * is information; a DELETE throws it away and leaves a `deleted` history row
 * that cannot say when coverage actually ran from. The row leaves every
 * "active coverage" read either way.
 *
 * Only personal rows are targeted. An org-assigned row naming this user is
 * somebody else's decision — RLS would reject the write anyway, but filtering
 * here means the caller gets a clean no-op instead of an error toast for an
 * action the UI should not have offered.
 */
export async function removePersonalCoverage(
  identity: Pick<CoverageIdentity, 'userId' | 'orgId'>,
  assetId: string,
): Promise<void> {
  const { error } = await supabase
    .from('coverage')
    .update({
      is_active: false,
      end_date: new Date().toISOString().slice(0, 10),
    } as never)
    .eq('user_id', identity.userId)
    .eq('organization_id', identity.orgId)
    .eq('asset_id', assetId)
    .eq('coverage_scope', 'personal')
    .eq('is_active', true)

  if (error) throw error
}

/**
 * Declare coverage of several assets at once.
 *
 * The first-session path adds a handful of names in one gesture. Doing that as
 * N round-trips makes the "establish coverage" step feel like work, which is
 * the thing this whole workstream exists to stop.
 *
 * Sequential rather than a single multi-row insert: `coverage` carries an
 * INSERT trigger chain (`end_previous_coverage`, `log_coverage_change`,
 * `notify_coverage_added_bulk`) and the dedupe above needs a read per asset.
 * A partial failure leaves the successful rows in place, which is the right
 * outcome — the user asked for five names and got four, not zero.
 */
export async function addPersonalCoverageBulk(
  identity: CoverageIdentity,
  assetIds: string[],
): Promise<{ added: PersonalCoverageRow[]; failed: string[] }> {
  const added: PersonalCoverageRow[] = []
  const failed: string[] = []

  for (const assetId of assetIds) {
    try {
      added.push(await addPersonalCoverage(identity, assetId))
    } catch {
      failed.push(assetId)
    }
  }

  return { added, failed }
}
