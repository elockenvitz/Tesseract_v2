-- NEGATIVE FIXTURE: a tenancy helper whose body has drifted.
--
-- Applied on top of the production shape. The membership check loses its
-- `expires_at` term, so an expired membership starts reading as active —
-- a widening that is invisible in the name, the signature and the ACL, and
-- that every policy calling this helper inherits.
--
-- This is exactly what the original `CREATE OR REPLACE` would have
-- overwritten without a word. M2 must refuse instead: it cannot know whether
-- this is drift to be corrected or a deliberate change made elsewhere, and
-- guessing on a helper shared across ~25 migrations' worth of policies is
-- not a decision a Files migration gets to make.
--
-- Expected: M2 raises, names the function, and prints the live body.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.is_active_member_of_current_org()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
  );
$$;
