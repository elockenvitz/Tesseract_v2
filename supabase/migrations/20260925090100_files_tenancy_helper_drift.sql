-- Ensure the two tenancy helpers Files V1 depends on exist with the expected
-- semantics. Change nothing that already matches.
--
-- ── What changed and why ───────────────────────────────────────────────────
--
-- The first version ran `CREATE OR REPLACE` on both helpers and then
-- `REVOKE ALL ... FROM PUBLIC` before re-granting. Its header claimed that
-- was a no-op on production. The bodies were — the preflight confirmed both
-- match this transcription exactly — but the grants were not:
--
--   current_org_id                      postgres=X anon=X authenticated=X service_role=X
--   is_active_member_of_current_org     =X/postgres  ← EXECUTE TO PUBLIC
--   is_active_org_admin_of_current_org  =X/postgres  ← EXECUTE TO PUBLIC
--
-- Both helpers currently grant EXECUTE to PUBLIC. The REVOKE would have
-- removed a live privilege from two functions called by policies across ~25
-- migrations. A policy whose function call is refused does not degrade to
-- "no rows" — it raises, and the query fails.
--
-- Tightening that is very likely correct, and it is not this rollout's
-- decision to make. Files V1 does not need it: these are reached as
-- `authenticated`, which is granted explicitly either way. So the privilege
-- change is removed entirely and deferred — see
-- docs/security/deferred-public-execute-grants.md.
--
-- This migration's responsibility is now exactly one thing: the two helpers
-- Files RLS calls exist and mean what Files assumes.
--
-- ── Behaviour ──────────────────────────────────────────────────────────────
--
--   matches → no CREATE OR REPLACE, no ACL change, no-op.
--   absent  → created from the verified definition, then granted the ACL
--             posture the existing production contract uses.
--   differs → RAISE EXCEPTION. These are shared helpers; silently
--             overwriting one changes the meaning of every policy that calls
--             it, from a migration nobody would think to read afterwards.
--
-- Comparison covers signature, return type, language, volatility, SECURITY
-- DEFINER posture, proconfig (search_path) and the body. Not the body alone:
-- a SECURITY INVOKER copy of identical text re-enters the `users` SELECT
-- policy that calls it and recurses, which is why these are DEFINER at all.
--
-- Rerunnable. Explicit BEGIN/COMMIT for the same `psql -f` reason as M1.

BEGIN;

DO $helpers$
DECLARE
  -- Transcribed from the live catalog on 2026-09-25, re-verified against
  -- production on 2026-09-27.
  c_member_body CONSTANT text := $body$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  );
$body$;

  -- Note the absent `expires_at` term. That asymmetry with the member helper
  -- is production's, preserved rather than quietly corrected: changing it
  -- would alter the meaning of every admin-gated policy.
  c_admin_body CONSTANT text := $body$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships
    WHERE user_id = auth.uid()
      AND organization_id = current_org_id()
      AND status = 'active'
      AND is_org_admin = true
  );
$body$;

  r_name     text;
  r_expected text;
  v_oid      oid;
  v_body     text;
  v_lang     text;
  v_volatile "char";
  v_secdef   boolean;
  v_config   text[];
  v_nargs    int;
  v_rettype  text;
  v_created  int := 0;
  v_matched  int := 0;
BEGIN
  FOREACH r_name IN ARRAY ARRAY['is_active_member_of_current_org',
                                'is_active_org_admin_of_current_org']
  LOOP
    r_expected := CASE r_name
      WHEN 'is_active_member_of_current_org' THEN c_member_body
      ELSE c_admin_body
    END;

    v_oid := NULL;
    SELECT p.oid, p.prosrc, l.lanname, p.provolatile, p.prosecdef, p.proconfig,
           p.pronargs, pg_catalog.format_type(p.prorettype, NULL)
      INTO v_oid, v_body, v_lang, v_volatile, v_secdef, v_config,
           v_nargs, v_rettype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language  l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.proname = r_name;

    -- ── Absent → create ───────────────────────────────────────────────────
    IF v_oid IS NULL THEN
      EXECUTE format(
        'CREATE FUNCTION public.%I() RETURNS boolean LANGUAGE sql STABLE '
        'SECURITY DEFINER SET search_path = public AS %L', r_name, r_expected);

      -- Runs ONLY on the create path: a function that did not exist a moment
      -- ago has no privileges to preserve. Nothing here revokes anything.
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I() TO anon, authenticated, service_role',
        r_name);

      v_created := v_created + 1;
      RAISE NOTICE 'Files V1 / helpers: created public.%() from the verified definition.', r_name;
      CONTINUE;
    END IF;

    -- ── Present → verify, never overwrite ─────────────────────────────────
    IF v_nargs <> 0 THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() takes % argument(s); expected 0. Refusing to touch a shared helper with an unexpected signature.', r_name, v_nargs;
    END IF;

    IF v_rettype <> 'boolean' THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() returns %; expected boolean.', r_name, v_rettype;
    END IF;

    IF v_lang <> 'sql' THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() is LANGUAGE %; expected sql.', r_name, v_lang;
    END IF;

    -- 's' = STABLE. VOLATILE would re-evaluate per row inside policies;
    -- IMMUTABLE would cache across a membership change.
    IF v_volatile <> 's' THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() volatility is %; expected STABLE (s).', r_name, v_volatile;
    END IF;

    IF NOT v_secdef THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() is SECURITY INVOKER; expected SECURITY DEFINER. An INVOKER copy re-enters the users SELECT policy that calls it and recurses.', r_name;
    END IF;

    IF v_config IS NULL OR NOT ('search_path=public' = ANY(v_config)) THEN
      RAISE EXCEPTION 'Files V1 / helpers: public.%() has proconfig %; expected search_path=public. A SECURITY DEFINER function without a pinned search_path is resolvable by its caller.', r_name, coalesce(v_config::text, '(none)');
    END IF;

    -- Whitespace-normalised only. Punctuation, operators and column names
    -- must match exactly — a difference there is the thing this detects.
    IF regexp_replace(v_body, '[[:space:]]+', '', 'g')
       <> regexp_replace(r_expected, '[[:space:]]+', '', 'g') THEN
      RAISE EXCEPTION
        'Files V1 / helpers: public.%() body differs from the verified '
        'definition. Refusing to overwrite a helper shared across the '
        'application — a silent replace changes the meaning of every policy '
        'that calls it. Live body: %', r_name, v_body;
    END IF;

    v_matched := v_matched + 1;
    RAISE NOTICE 'Files V1 / helpers: public.%() already matches — definition and privileges untouched.', r_name;
  END LOOP;

  RAISE NOTICE 'Files V1 / helpers: % matched, % created. No ACL modified on any pre-existing function.', v_matched, v_created;
END $helpers$;

COMMIT;
