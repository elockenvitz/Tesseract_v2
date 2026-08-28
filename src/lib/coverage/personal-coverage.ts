/**
 * Personal coverage — the data layer for what a professional says they follow.
 *
 * Stage 3 foundation ONLY. This is the data access the self-service surface
 * will sit on; it deliberately has no presentation, no onboarding awareness and
 * no telemetry. Nothing imports it yet except its own tests and `useMyCoverage`.
 *
 * ── Two lanes, one table ───────────────────────────────────────────────────
 *
 * Personal coverage is not a second coverage system and deliberately not a
 * separate table. It is the same `coverage` rows every existing consumer
 * already reads — the asset page, thesis tabs, notifications, the org chart —
 * carrying `coverage_scope = 'personal'`. A solo professional's declaration
 * shows up everywhere a firm-assigned one does, which is the entire point.
 *
 * ── Why this module cannot be handed an owner ──────────────────────────────
 *
 * `user_id` is never a parameter. It is read from the live Supabase session
 * inside each write, so there is no signature through which a caller could
 * assign coverage to somebody else — not by mistake, and not by passing a value
 * that came from a list of colleagues.
 *
 * The organization IS a parameter, because the client genuinely knows it and
 * this module has no access to React context. It is validated through the same
 * `resolveCoverageTenant` guard the two import paths use, and `useMyCoverage`
 * is the only intended caller, passing `useOrganization().currentOrgId`.
 *
 * ── What actually enforces all of this ─────────────────────────────────────
 *
 * Not this file. RLS is the boundary:
 *
 *   INSERT  coverage_scope = 'personal' AND user_id = auth.uid()
 *           AND organization_id = current_org_id() AND team_id IS NULL
 *           AND is_lead IS NOT TRUE
 *   UPDATE  the same, in USING *and* WITH CHECK, so a row can neither be moved
 *           between organizations nor converted between lanes
 *   DELETE  the same USING clause
 *
 * and `coverage_scope` is immutable for everyone via a trigger. Every function
 * below could be bypassed with a hand-rolled PostgREST call and the boundary
 * would still hold. That is the test for whether a boundary is real.
 *
 * ── What this is NOT ───────────────────────────────────────────────────────
 *
 * Not holdings. A position is a fact about a portfolio; coverage is a claim
 * about attention. They overlap constantly and are not the same signal — an
 * analyst covers names they do not own, and portfolios hold names nobody is
 * actively working. Holdings stay in `portfolio_holdings` and are read
 * separately.
 */

import { supabase } from '../supabase'
import { resolveCoverageTenant } from './coverage-tenant'

/** The lane discriminator, mirrored from `coverage.coverage_scope`. */
export type CoverageScope = 'personal' | 'org'

export interface MyCoverageRow {
  id: string
  asset_id: string
  user_id: string
  organization_id: string
  analyst_name: string
  coverage_scope: CoverageScope
  is_active: boolean
  start_date: string | null
  end_date: string | null
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
 * `assets` is embedded through the asset FK, which exists. `users` is NOT
 * embedded: `coverage.user_id` carries no foreign key, so PostgREST cannot
 * traverse it and asking it to returns an error rather than a null. The display
 * name comes from the denormalised `analyst_name` column, which is what every
 * other coverage surface reads. MobileCoverage shipped once with an embed
 * through `user_id` and every analyst on the screen was labelled with the
 * literal fallback string.
 */
const SELECT_COLUMNS =
  'id, asset_id, user_id, organization_id, analyst_name, coverage_scope, ' +
  'is_active, start_date, end_date, notes, created_at, ' +
  'assets:asset_id(id, symbol, company_name, sector)'

/** Raised when there is no authenticated session to attribute a write to. */
export class NoSessionError extends Error {
  constructor() {
    super('You are signed out. Sign in again to change your coverage.')
    this.name = 'NoSessionError'
  }
}

/** Raised when no organization can be resolved. Mirrors the import paths. */
export class NoTenantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoTenantError'
  }
}

/**
 * The acting user, from the session rather than from an argument.
 *
 * `getUser()` rather than `getSession()`: it validates the token against the
 * server instead of trusting whatever is in local storage, and a stale local
 * session is exactly the state in which a write would be attributed wrongly.
 */
async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  const id = data?.user?.id
  if (error || !id) throw new NoSessionError()
  return id
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
 * Every active coverage row naming this user in this organization, both lanes.
 *
 * Both lanes on purpose. A user invited into an already-configured team may
 * have org-assigned coverage and no personal rows at all; a read filtered to
 * the personal lane would report them as covering nothing and invite them to
 * rebuild from scratch work somebody already did. Callers distinguish the lanes
 * by `coverage_scope` to decide what is editable.
 *
 * The organization is in the filter as well as being enforced by RLS. RLS is
 * what makes it safe; the explicit filter is what makes the query honest about
 * its own scope and keeps it legible to the org-scope guard.
 */
export async function fetchMyCoverage(
  organizationId: string | null | undefined,
): Promise<MyCoverageRow[]> {
  const tenant = resolveCoverageTenant(organizationId)
  if (!tenant.ok) return []

  const userId = await requireUserId()

  const { data, error } = await supabase
    .from('coverage')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('organization_id', tenant.organizationId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as MyCoverageRow[]
}

export interface AddPersonalCoverageInput {
  organizationId: string | null | undefined
  assetId: string
  /** Denormalised display name for the row. Not an identity. */
  analystName: string
  notes?: string | null
}

/**
 * Declare coverage of one asset.
 *
 * Idempotent from the caller's point of view: if an active personal row already
 * exists for this (user, org, asset) it is returned unchanged rather than
 * duplicated. `coverage` has no unique constraint on (asset_id, user_id) —
 * historical and active rows coexist by design — so uniqueness within this lane
 * is the caller's job, and doing it here means every caller gets it.
 */
export async function addPersonalCoverage(
  input: AddPersonalCoverageInput,
): Promise<MyCoverageRow> {
  const tenant = resolveCoverageTenant(input.organizationId)
  if (!tenant.ok) throw new NoTenantError('No workspace is selected, so coverage cannot be saved.')

  const userId = await requireUserId()

  const { data: existing } = await supabase
    .from('coverage')
    .select(SELECT_COLUMNS)
    .eq('user_id', userId)
    .eq('organization_id', tenant.organizationId)
    .eq('asset_id', input.assetId)
    .eq('coverage_scope', 'personal')
    .eq('is_active', true)
    .maybeSingle()

  if (existing) return existing as unknown as MyCoverageRow

  // `as never` on the payload: the Supabase client is generated without
  // database types in this project, so every table resolves to `never` and
  // both `.insert()` and `.update()` reject an object literal.
  const { data, error } = await supabase
    .from('coverage')
    .insert({
      asset_id: input.assetId,
      user_id: userId,
      organization_id: tenant.organizationId,
      analyst_name: input.analystName,
      coverage_scope: 'personal',
      is_active: true,
      notes: input.notes ?? null,
      // team_id and is_lead are deliberately absent. A personal row carries no
      // organizational authority, and both the RLS WITH CHECK and a table
      // CHECK constraint enforce that independently of what any client sends.
    } as never)
    .select(SELECT_COLUMNS)
    .single()

  if (error) throw error
  return data as unknown as MyCoverageRow
}

/**
 * Edit the note on one's own personal coverage.
 *
 * Notes only. The fields that decide what a row MEANS — its asset, owner,
 * organization and lane — are not editable through this module, and RLS would
 * reject three of the four anyway. Offering an `update` that could change them
 * would invite a caller to try.
 */
export async function updatePersonalCoverageNotes(
  organizationId: string | null | undefined,
  assetId: string,
  notes: string | null,
): Promise<void> {
  const tenant = resolveCoverageTenant(organizationId)
  if (!tenant.ok) throw new NoTenantError('No workspace is selected, so coverage cannot be saved.')

  const userId = await requireUserId()

  const { error } = await supabase
    .from('coverage')
    .update({ notes } as never)
    .eq('user_id', userId)
    .eq('organization_id', tenant.organizationId)
    .eq('asset_id', assetId)
    .eq('coverage_scope', 'personal')
    .eq('is_active', true)

  if (error) throw error
}

/**
 * Stop covering an asset.
 *
 * Retires the row rather than deleting it. Coverage is a research record with
 * an audit trail, and "I stopped following this in March" is information; a
 * DELETE throws away the date range and leaves a `deleted` history row that
 * cannot say when coverage actually ran from. The row leaves every "active
 * coverage" read either way.
 *
 * Filtered to the personal lane. An org-assigned row naming this user is
 * somebody else's decision — RLS would reject the write, and filtering here
 * means the caller gets a clean no-op rather than an error for an action the
 * UI should not have offered.
 */
export async function removePersonalCoverage(
  organizationId: string | null | undefined,
  assetId: string,
): Promise<void> {
  const tenant = resolveCoverageTenant(organizationId)
  if (!tenant.ok) throw new NoTenantError('No workspace is selected, so coverage cannot be saved.')

  const userId = await requireUserId()

  const { error } = await supabase
    .from('coverage')
    .update({
      is_active: false,
      end_date: new Date().toISOString().slice(0, 10),
    } as never)
    .eq('user_id', userId)
    .eq('organization_id', tenant.organizationId)
    .eq('asset_id', assetId)
    .eq('coverage_scope', 'personal')
    .eq('is_active', true)

  if (error) throw error
}
