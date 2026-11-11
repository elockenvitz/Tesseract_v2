/**
 * Which organization is a request acting for?
 *
 * The rest of the application answers this with `public.current_org_id()`:
 * the org on the user's own `users.current_organization_id` row, re-checked
 * against an active, unexpired membership. The org switcher writes that
 * column, Settings reads through it, and `set_org_ai_api_key` writes the
 * BYOK key into whatever org it names.
 *
 * `ai-chat` used to answer it differently -- "the membership with the most
 * recent `joined_at`" -- and for anyone in exactly one organization the two
 * agree, which is why it survived. For a user in two they diverge, and the
 * divergence is silent and total:
 *
 *   Settings  -> current_org_id()        -> org A, key configured
 *   ai-chat   -> newest joined_at        -> org B, no config at all
 *
 * The user is then told "AI not configured. Please add your API key in
 * Settings" about a key that is sitting in org A's Vault row, and no log
 * line says which org was asked. Measured on production 2026-11-11: joining
 * a second org in Oct 2026 silently disabled BYOK for an account whose key
 * had been configured since 2025.
 *
 * It also mis-attributed every `ai_usage_log` row and every rate-limit
 * decision to the wrong tenant, so this is a metering fix as well as a
 * functional one.
 *
 * Authority still comes from server-side data only. `current_org_id()` is
 * SECURITY DEFINER over `auth.uid()` -- it takes no argument, so a caller
 * cannot name an organization, and it returns NULL unless the caller holds an
 * active unexpired membership in the org their own row points at. Passing the
 * CALLER-SCOPED client is therefore load-bearing: called with a service-role
 * client `auth.uid()` is NULL and this returns NULL, which is why the
 * privileged client must never be handed to it.
 */

/**
 * The fluent subset of the postgrest builder used below. Spelling it out keeps
 * the contract narrow: this module can only make the one query it documents.
 */
export interface OrgMembershipQuery {
  select: (cols: string) => OrgMembershipQuery
  eq: (col: string, val: unknown) => OrgMembershipQuery
  is: (col: string, val: unknown) => OrgMembershipQuery
  order: (col: string, opts: { ascending: boolean; nullsFirst: boolean }) => OrgMembershipQuery
  limit: (n: number) => OrgMembershipQuery
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
}

/** The minimum surface this needs; the real client satisfies it structurally. */
export interface OrgScopedClient {
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  from: (table: string) => OrgMembershipQuery
}

/**
 * Resolve the acting organization for a verified user.
 *
 * @param supabase MUST be the caller-scoped client (the one carrying the
 *                 user's JWT). A service-role client makes `auth.uid()` NULL
 *                 and sends every caller down the fallback path.
 * @param userId   The verified user id, used only by the fallback query.
 */
export async function resolveOrgForRequest(
  supabase: OrgScopedClient,
  userId: string,
): Promise<string | null> {
  // The canonical answer, and the one the UI and the key writer both use.
  try {
    const { data, error } = await supabase.rpc('current_org_id')
    if (!error && typeof data === 'string' && data.length > 0) return data
  } catch {
    // Fall through. A transport failure here must not strand the request; the
    // membership query below is a strictly narrower claim about the same user.
  }

  /*
   * Fallback, for an account with no current org set -- a fresh signup whose
   * `current_organization_id` is still NULL, or someone whose membership in
   * that org lapsed. Picking the newest active membership is what this
   * function did for every caller before; it is kept as the last resort so
   * the change cannot take AI away from anyone it currently works for.
   *
   * Still RLS-scoped and still pinned to this verified user id, so it cannot
   * reach another account's memberships.
   */
  const { data: row } = await supabase
    .from('organization_memberships')
    .select('organization_id, joined_at, status')
    .eq('user_id', userId)
    .is('suspended_at', null)
    .order('joined_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  return (row as { organization_id?: string } | null)?.organization_id ?? null
}
