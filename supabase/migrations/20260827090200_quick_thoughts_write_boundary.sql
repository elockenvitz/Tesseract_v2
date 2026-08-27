-- ============================================================================
-- quick_thoughts — Stage A/2: organization_id becomes unforgeable
-- ============================================================================
--
-- ── What was wrong ────────────────────────────────────────────────────────
--
-- `set_quick_thoughts_org_id()` opened with:
--
--     IF NEW.organization_id IS NOT NULL THEN RETURN NEW; END IF;
--
-- A client that supplied an organization_id was believed. PostgREST exposes
-- every column of an INSERT, so:
--
--     POST /rest/v1/quick_thoughts  {"content":"…","organization_id":"<victim>"}
--
-- wrote a row into another tenant. The companion trigger,
-- `enforce_quick_thought_org_boundary()`, validated visibility_org_id,
-- visibility_team_id, visibility_portfolio_id and visibility_org_node_id
-- against `current_org_id()` — every pointer except the one that actually
-- decides which tenant owns the row.
--
-- Two further gaps: the fallback read `users.current_organization_id` directly
-- rather than the membership-validated `current_org_id()` (the exact bypass
-- 20260826100000 exists to close), and the trigger was BEFORE INSERT only, so
-- `organization_id` was freely mutable afterwards — the UPDATE policy carried
-- no WITH CHECK either.
--
-- ── The model now ─────────────────────────────────────────────────────────
--
-- Session writes (auth.uid() present — every ordinary client):
--   the organization is DERIVED from `current_org_id()`, never accepted from
--   the request. Supplying a foreign one is refused rather than silently
--   overwritten, because nothing in the application sends this column at all:
--   a mismatched value is by definition either a bug or an attack, and both
--   should be loud. No active membership means no write.
--
-- Non-session writes (auth.uid() NULL — service_role, postgres, psql, seeds):
--   there is no session tenant to derive from, so the caller must supply one
--   explicitly. This is the "privileged path is explicit" rule, not a hole:
--   reaching it already requires a credential that bypasses RLS entirely, and
--   the frontend never holds one (verified: the client bundles only the anon
--   key; service_role appears solely in netlify/functions).
--
-- After creation the column is immutable, for everyone, in both directions —
-- it cannot be moved to another organization and it cannot be cleared. The one
-- exemption is a non-session caller resolving a quarantined row whose org is
-- still NULL, which is how the two ambiguous legacy rows get fixed by hand.

CREATE OR REPLACE FUNCTION public.set_quick_thoughts_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_org    UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN

    IF v_caller IS NULL THEN
      -- Privileged, non-session write. No tenant to infer; demand one.
      IF NEW.organization_id IS NULL THEN
        RAISE EXCEPTION
          'quick_thoughts.organization_id must be supplied explicitly for non-session inserts'
          USING ERRCODE = 'P0031';
      END IF;
      RETURN NEW;
    END IF;

    v_org := public.current_org_id();

    IF v_org IS NULL THEN
      RAISE EXCEPTION
        'quick_thoughts: no active organization context for the current user'
        USING ERRCODE = 'P0031';
    END IF;

    IF NEW.organization_id IS NOT NULL AND NEW.organization_id <> v_org THEN
      RAISE EXCEPTION
        'Cross-org violation: cannot create a quick_thought in organization % from organization %',
        NEW.organization_id, v_org
        USING ERRCODE = 'P0031';
    END IF;

    NEW.organization_id := v_org;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      -- Only a privileged caller may fill in a quarantined row's organization.
      IF v_caller IS NULL AND OLD.organization_id IS NULL AND NEW.organization_id IS NOT NULL THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION
        'quick_thoughts.organization_id is immutable (attempted % -> %)',
        OLD.organization_id, NEW.organization_id
        USING ERRCODE = 'P0031';
    END IF;

    RETURN NEW;

  END IF;

  RETURN NEW;
END;
$$;

-- The trigger must now also cover UPDATE. Fires before
-- `trg_enforce_quick_thought_org` (BEFORE triggers run in name order, and
-- "set_" sorts before "trg_"), so the visibility_* checks in that function see
-- an organization_id that has already been derived and validated.

DROP TRIGGER IF EXISTS set_quick_thoughts_org_id_trigger ON public.quick_thoughts;

CREATE TRIGGER set_quick_thoughts_org_id_trigger
  BEFORE INSERT OR UPDATE ON public.quick_thoughts
  FOR EACH ROW EXECUTE FUNCTION public.set_quick_thoughts_org_id();
