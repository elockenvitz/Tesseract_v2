/**
 * Whether a `current_organization_id` that is missing from the cached
 * membership list is actually stale state, or just a stale cache.
 *
 * ── The defect this exists to prevent ────────────────────────────────────
 *
 * `OrganizationContext` healed a "stale" current org by writing the first
 * entry of `userOrgs` back through `set_current_org`. The list it consulted is
 * a React Query cache with a ten-minute `staleTime`, fed by a membership read
 * filtered to `status = 'active'`. A membership created moments earlier — by
 * ops provisioning a pilot org, say — is simply not in that cache yet.
 *
 * So absence was read as revocation, and the heal overwrote a perfectly good
 * durable org with an unrelated one. Two pilot workspaces were found in this
 * state with live data: the seeded portfolio and rows carried the pilot org,
 * the reader's durable column named a different org, and every org-scoped
 * query therefore returned nothing. The rows were correct, the policy was
 * correct, and the column had been moved out from under them.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * A cache may not be evidence for a WRITE. It is fine for choosing what to
 * render, and it is not enough to mutate durable state, because the failure
 * mode of a stale read is silent and the failure mode of the write is a reader
 * stranded in somebody else's workspace.
 *
 * So absence from the cache asks a question rather than answering one. Only an
 * authoritative read of that one membership can justify healing, and when it
 * confirms the membership is alive the right response is to refresh the cache,
 * not to change the org.
 *
 * ── Why a genuine heal still refuses to pick ─────────────────────────────
 *
 * `userOrgs[0]` is alphabetical, which is not a guess about intent; it is no
 * guess at all. With exactly one org left there is nothing to decide. With
 * several, the reader decides, through the selector that already exists.
 *
 * Pure: no React, no Supabase, no clock.
 */

export type HealDecision =
  /** The durable org is in the cached list, or there is nothing to check. */
  | { kind: 'none' }
  /**
   * Not in the cached list. Ask the database about this one membership
   * before touching anything.
   */
  | { kind: 'verify'; orgId: string }
  /** The membership is alive. Keep the org and refresh the stale cache. */
  | { kind: 'keep'; orgId: string }
  /** Genuinely gone, and exactly one org remains. Nothing to decide. */
  | { kind: 'heal'; target: string }
  /** Genuinely gone, and several remain. The reader chooses. */
  | { kind: 'choose' }
  /** Genuinely gone, and there is nowhere to go. */
  | { kind: 'stranded' }

export interface HealInput {
  /** `users.current_organization_id`, as the profile reports it. */
  rawCurrentOrgId: string | null
  /** Org ids from the cached membership list. */
  cachedOrgIds: string[]
  /** Whether that cached list is still loading. */
  isLoading: boolean
  /**
   * The result of the authoritative single-membership read, once it exists.
   *
   * `undefined` means it has not been asked yet, which is what distinguishes
   * "verify" from a decision. `true` and `false` are answers.
   */
  authoritativeIsActive?: boolean | undefined
}

export function healDecision(input: HealInput): HealDecision {
  const { rawCurrentOrgId, cachedOrgIds, isLoading, authoritativeIsActive } = input

  // Nothing to reason about until the list has loaded, and nothing to heal
  // for a user who has no durable org at all.
  if (isLoading) return { kind: 'none' }
  if (!rawCurrentOrgId) return { kind: 'none' }
  if (cachedOrgIds.includes(rawCurrentOrgId)) return { kind: 'none' }

  // Absent from the cache. That is a question.
  if (authoritativeIsActive === undefined) return { kind: 'verify', orgId: rawCurrentOrgId }
  if (authoritativeIsActive) return { kind: 'keep', orgId: rawCurrentOrgId }

  // Confirmed gone. Now, and only now, is a heal justified.
  const remaining = cachedOrgIds.filter(id => id !== rawCurrentOrgId)
  if (remaining.length === 0) return { kind: 'stranded' }
  if (remaining.length === 1) return { kind: 'heal', target: remaining[0] }
  return { kind: 'choose' }
}

/**
 * The org the app should operate in, given a decision.
 *
 * `null` means "ask the reader", which is the selector's cue. Note that a
 * `verify` keeps the durable org: the check is in flight, nothing has been
 * disproved, and dropping the reader out of their workspace while a query
 * resolves is the flicker this whole file exists to avoid.
 */
export function effectiveOrgId(
  decision: HealDecision,
  rawCurrentOrgId: string | null,
): string | null {
  switch (decision.kind) {
    case 'none':
      return rawCurrentOrgId
    case 'verify':
    case 'keep':
      return decision.orgId
    case 'heal':
      return decision.target
    case 'choose':
    case 'stranded':
      return null
  }
}
