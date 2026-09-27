-- Give the signed-up reviewer an org and an active membership.
--
-- REVIEW DATABASE ONLY. Never run against production — it grants org-admin.
--
-- ── Why this is a separate step ───────────────────────────────────────────
--
-- It cannot run before you exist. `public.users.id` references
-- `auth.users(id)`, and the app's own sign-up is what creates that row — so
-- the order is: apply the bootstrap, sign up through the app at localhost,
-- then run this.
--
-- Doing it this way rather than minting an auth user directly keeps the
-- review honest: you reach Files through the same sign-up and session the
-- product uses, so a login or session defect shows up here instead of being
-- bypassed by a hand-made row.
--
-- Idempotent. Re-running it after a second sign-up adds that person too.
-- Seeds NO file rows: an empty repository is the correct starting state, and
-- fabricating files would make an upload defect invisible.

BEGIN;

-- One organisation for the review.
INSERT INTO public.organizations (id, name)
SELECT gen_random_uuid(), 'Review Org'
WHERE NOT EXISTS (SELECT 1 FROM public.organizations WHERE name = 'Review Org');

-- Mirror every auth user into public.users and point them at that org.
WITH org AS (
  SELECT id FROM public.organizations WHERE name = 'Review Org' LIMIT 1
)
INSERT INTO public.users (id, email, first_name, last_name, current_organization_id)
SELECT
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data ->> 'first_name', split_part(au.email, '@', 1)),
  COALESCE(au.raw_user_meta_data ->> 'last_name', 'Reviewer'),
  (SELECT id FROM org)
FROM auth.users au
ON CONFLICT (id) DO UPDATE
  SET current_organization_id = EXCLUDED.current_organization_id,
      email = EXCLUDED.email;

-- Active membership, org-admin so the archive override is exercisable.
WITH org AS (
  SELECT id FROM public.organizations WHERE name = 'Review Org' LIMIT 1
)
INSERT INTO public.organization_memberships
  (user_id, organization_id, status, is_org_admin, expires_at)
SELECT au.id, (SELECT id FROM org), 'active', true, NULL
FROM auth.users au
ON CONFLICT (user_id, organization_id) DO UPDATE
  SET status = 'active',
      is_org_admin = true,
      -- NULL, not a future date: current_org_id() and
      -- is_active_member_of_current_org() both test `expires_at > now()`, and
      -- a review that quietly expires mid-session looks like an RLS bug.
      expires_at = NULL;

COMMIT;

-- What you should see afterwards, signed in as yourself:
--   select current_org_id();                        -> the Review Org uuid
--   select is_active_member_of_current_org();       -> true
--   select is_active_org_admin_of_current_org();    -> true
