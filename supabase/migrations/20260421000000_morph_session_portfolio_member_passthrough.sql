/**
 * Let support admins morphing into a pilot user pass `user_is_portfolio_member`
 * checks for RLS-gated surfaces (trade_labs, simulations, lab_variants, etc.)
 * while the morph session is active. Without this, admins hit a "preparing
 * workbench" hang on the target's Trade Lab because they silently fail to
 * SELECT or INSERT trade-lab rows.
 *
 * Approach: `is_morphing_into_user(uuid)` helper + widened
 * `user_is_portfolio_member` that short-circuits to TRUE when the caller has
 * an active, unexpired morph session targeting a user who IS a direct member.
 * Morph sessions are time-boxed (max 60 min) and audited via the morph_sessions
 * table, so this is acceptable for support access.
 */

CREATE OR REPLACE FUNCTION public.is_morphing_into_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.morph_sessions ms
    WHERE ms.admin_user_id = auth.uid()
      AND ms.target_user_id = p_user_id
      AND ms.is_active = true
      AND ms.expires_at > now()
      AND ms.ended_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_portfolio_member(
  p_portfolio_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.portfolio_memberships pm
      WHERE pm.portfolio_id = p_portfolio_id
        AND pm.user_id = p_user_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.morph_sessions ms
      JOIN public.portfolio_memberships pm ON pm.user_id = ms.target_user_id
      WHERE ms.admin_user_id = auth.uid()
        AND ms.is_active = true
        AND ms.expires_at > now()
        AND ms.ended_at IS NULL
        AND pm.portfolio_id = p_portfolio_id
    );
$$;
