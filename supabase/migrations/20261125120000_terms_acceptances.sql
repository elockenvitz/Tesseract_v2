-- =============================================================================
-- Terms acceptance records — provable, server-written, minimal
--
-- NOT APPLIED. Authored for review. See the note at the bottom.
--
-- WHAT THIS IS
--
-- One row per (user, document, version): the evidence that a specific person
-- accepted a specific text at a specific moment. Today there is no such
-- table -- verified 2026-11-25, nothing in `public` matches term/accept/
-- consent -- which means 28 users are using the product under no terms at
-- all, and there is no limitation of liability, no acceptable-use obligation
-- and no not-advice acknowledgement binding on anyone.
--
-- WHAT MAKES A RECORD WORTH ANYTHING
--
-- In a dispute the question is never "did the app show a checkbox". It is
-- "what can you prove this person agreed to, and when". So:
--
--   WHO      user_id, taken from auth.uid() by the RPC. NEVER from the
--            client. A record the client could address to an arbitrary user
--            id is not evidence of anything, and this repository's standing
--            rule is that a valid JWT is not authorization -- the
--            publishable key is itself a valid JWT.
--   WHICH    document_id AND document_version. The id alone cannot answer
--            "which words", which is the only thing a dispute is about.
--   WHEN     accepted_at defaults to now() IN THE DATABASE. A browser clock
--            is attacker-controlled and routinely just wrong.
--   HOW      method, so a user's own click is distinguishable from a later
--            signed-MSA or admin-on-behalf-of route rather than silently
--            merged with it.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--
-- No IP address. No user agent. Both are conventional in clickwrap records
-- and both are personal data needing a documented purpose. The purpose
-- usually offered -- "proving it was really them" -- is already established
-- better by an authenticated session than by an IP address, and collecting
-- personal data to strengthen evidence we already have, in a product whose
-- privacy policy must then disclose it, is a poor trade.
--
-- If counsel decides otherwise, the column is commented out below and the
-- privacy policy must be updated in the SAME change. Do not add it quietly.
--
-- ORGANIZATION, AND WHY IT IS NULLABLE
--
-- organization_id is stamped at write time, never derived from a mutable
-- current_org_id() at read time, because an acceptance is a historical fact:
-- it must not change meaning when the user switches organization.
--
-- It is NULLABLE because a signup can precede organization membership. A row
-- with a null organization is an individual's acceptance of the terms as an
-- Authorised User, which is exactly what application-terms §3 says an
-- individual's acceptance is -- and no more.
--
-- ORGANIZATION-LEVEL CONTRACTING IS NOT IN THIS TABLE
--
-- This is the most important design decision here and it is a legal one as
-- much as a technical one. A row in this table does NOT mean the user's
-- employer is bound. An ordinary user ticking a box does not commit a
-- regulated investment firm to a liability cap, an indemnity or a
-- dispute-resolution clause, and a schema that conflated the two would
-- invite exactly that claim.
--
-- Organization-level commitment is a signed Master Services Agreement, which
-- is a document in a filing cabinet, not a row written by a checkbox. If a
-- counter-signature ever needs recording, it belongs in its own table with
-- its own authority checks -- not as a nullable "is_org_acceptance" flag on
-- this one.
--
-- ISOLATION
--
-- A user reads and writes their own rows. An organization admin may read
-- their organization's rows, because "has everyone accepted the current
-- terms" is a question an admin legitimately needs answered, and because
-- Reg S-P-style diligence will ask it.
--
-- There is no UPDATE policy and no DELETE policy, for either role. An
-- acceptance record that can be edited is not evidence. Correcting a
-- mistake is a service_role operation with a human behind it.
-- =============================================================================

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Nullable: a signup may precede membership. See the header.
  organization_id   uuid REFERENCES public.organizations(id) ON DELETE SET NULL,

  -- Matches LegalDocumentId in src/legal/documents.ts. Deliberately text
  -- rather than an enum: adding a document should not need a migration, and
  -- the registry is the source of truth for which ids are real.
  document_id       text NOT NULL CHECK (length(document_id) BETWEEN 2 AND 64),

  -- The semantic version of the TEXT that was accepted.
  document_version  text NOT NULL CHECK (length(document_version) BETWEEN 1 AND 32),

  accepted_at       timestamptz NOT NULL DEFAULT now(),

  method            text NOT NULL DEFAULT 'clickwrap_checkbox'
                      CHECK (method IN ('clickwrap_checkbox', 'signed_agreement', 'admin_on_behalf')),

  -- Audit metadata about the row itself, not about the person.
  created_at        timestamptz NOT NULL DEFAULT now(),

  -- If counsel requires it, and only together with a privacy-policy update:
  -- ip_address     inet,
  -- user_agent     text,

  -- One acceptance per person per version. A second click is not a second
  -- fact, and ON CONFLICT DO NOTHING in the RPC relies on this.
  CONSTRAINT terms_acceptances_unique_per_version
    UNIQUE (user_id, document_id, document_version)
);

-- "Which of my users have not accepted the current version" -- the admin
-- question, and the one the signup gate asks on every sign-in.
CREATE INDEX IF NOT EXISTS terms_acceptances_user_document_idx
  ON public.terms_acceptances (user_id, document_id);

CREATE INDEX IF NOT EXISTS terms_acceptances_org_idx
  ON public.terms_acceptances (organization_id)
  WHERE organization_id IS NOT NULL;

-- ─── Grants ─────────────────────────────────────────────────────────────────

-- Every public function and table in this project is born anon-accessible
-- unless revoked, which this repository has been bitten by before. Deny
-- first, then grant exactly what the policies are written for.
REVOKE ALL ON TABLE public.terms_acceptances FROM PUBLIC;
REVOKE ALL ON TABLE public.terms_acceptances FROM anon;

-- SELECT only. Inserts go through the RPC so that user_id and accepted_at
-- are server-decided; UPDATE and DELETE are not granted at all.
GRANT SELECT ON TABLE public.terms_acceptances TO authenticated;

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;
-- Belt and braces: a table owner bypasses RLS unless FORCE is set, and this
-- table's whole value is that nobody edits it quietly.
ALTER TABLE public.terms_acceptances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_acceptances_select_own ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select_own ON public.terms_acceptances
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ─── The admin predicate, as a definer helper ───────────────────────────────
--
-- An admin may read their own organization's acceptances, because "has
-- everyone accepted the current terms" is a question an admin legitimately
-- needs answered and a diligence questionnaire will ask it.
--
-- TWO THINGS THIS GOT WRONG FIRST, both caught by reading the live catalogue
-- rather than supabase/migrations/, which does not describe production:
--
--   * The columns. There is no is_admin and no is_active. Production has
--     `is_org_admin boolean` and `status text DEFAULT 'active'`. A policy
--     naming absent columns fails loudly rather than quietly -- but it would
--     have failed on production, part-way through the migration.
--
--   * The inline subquery. A policy's own subquery runs under the CALLER's
--     RLS, so `EXISTS (SELECT 1 FROM organization_memberships ...)` here is
--     filtered by whatever policy guards that table. In this repository that
--     pattern has both hidden real holes and broken legitimate reads. The fix
--     is a SECURITY DEFINER helper, which is how is_member_of_org() and
--     is_active_org_admin_of_current_org() are already written.
--
-- Parameterised rather than reusing is_active_org_admin_of_current_org(),
-- because an acceptance row's organization is a historical fact and is not
-- necessarily the caller's CURRENT organization. Checking the current org
-- would hide rows an admin should see merely because they had switched
-- context.
--
-- Membership is checked LIVE, so a removed or suspended admin loses the view
-- immediately rather than retaining it because a row still carries their
-- organization.
CREATE OR REPLACE FUNCTION public.is_active_org_admin_of(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships m
    WHERE m.organization_id = p_org_id
      AND m.user_id = auth.uid()
      AND coalesce(m.status, 'active') = 'active'
      AND m.is_org_admin = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_org_admin_of(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_org_admin_of(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_active_org_admin_of(uuid) TO authenticated;

COMMENT ON FUNCTION public.is_active_org_admin_of(uuid) IS
  'Whether the calling user is an ACTIVE org admin of the given organization. Parameterised sibling of is_active_org_admin_of_current_org(), for rows whose organization is a historical fact rather than the caller''s current context. SECURITY DEFINER because a policy subquery would otherwise run under the caller''s own RLS on organization_memberships.';

DROP POLICY IF EXISTS terms_acceptances_select_org_admin ON public.terms_acceptances;
CREATE POLICY terms_acceptances_select_org_admin ON public.terms_acceptances
  FOR SELECT TO authenticated
  USING (
    organization_id IS NOT NULL
    AND public.is_active_org_admin_of(organization_id)
  );

-- No INSERT policy: writes are the RPC's job, and a policy would let a client
-- choose its own user_id and accepted_at.
-- No UPDATE policy and no DELETE policy, for anyone. See the header.

-- ─── The write path ─────────────────────────────────────────────────────────

-- SECURITY DEFINER, because the caller must not be able to write a row for
-- anyone but themselves and must not be able to set the timestamp.
--
-- Authorization happens BEFORE anything is written, and a denied call changes
-- nothing: the organization check raises rather than inserting a row with a
-- null organization, because silently downgrading "accepted on behalf of org
-- X" to "accepted individually" would produce a record that misstates what
-- happened.
CREATE OR REPLACE FUNCTION public.record_terms_acceptance(
  p_document_id       text,
  p_document_version  text,
  p_organization_id   uuid DEFAULT NULL,
  p_method            text DEFAULT 'clickwrap_checkbox'
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_accepted timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- A user may only record an acceptance against an organization they are
  -- actually in. Without this, any authenticated user could attach their
  -- acceptance to any organization's id.
  IF p_organization_id IS NOT NULL
     AND NOT public.is_member_of_org(p_organization_id) THEN
    RAISE EXCEPTION 'not a member of organization %', p_organization_id
      USING ERRCODE = '42501';
  END IF;

  -- 'admin_on_behalf' and 'signed_agreement' are not self-service. They exist
  -- in the CHECK constraint for an operator path, and allowing a user to
  -- claim either would let them manufacture a stronger record than they have.
  IF p_method <> 'clickwrap_checkbox' THEN
    RAISE EXCEPTION 'method % may not be self-recorded', p_method
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.terms_acceptances
    (user_id, organization_id, document_id, document_version, method)
  VALUES
    (v_user, p_organization_id, p_document_id, p_document_version, p_method)
  ON CONFLICT (user_id, document_id, document_version) DO NOTHING
  RETURNING accepted_at INTO v_accepted;

  -- A second click is idempotent, and the caller still needs a timestamp
  -- back: returning null would read as a write failure, and the client
  -- deliberately treats a null as failure.
  IF v_accepted IS NULL THEN
    SELECT accepted_at INTO v_accepted
    FROM public.terms_acceptances
    WHERE user_id = v_user
      AND document_id = p_document_id
      AND document_version = p_document_version;
  END IF;

  RETURN v_accepted;
END
$$;

REVOKE ALL ON FUNCTION public.record_terms_acceptance(text, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_terms_acceptance(text, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_terms_acceptance(text, text, uuid, text) TO authenticated;

-- ─── Documentation ──────────────────────────────────────────────────────────

COMMENT ON TABLE public.terms_acceptances IS
  'One row per (user, document, version): who accepted which text, when, and how. Written only by record_terms_acceptance(), which takes the user from auth.uid() and the timestamp from now(). No UPDATE or DELETE policy exists for any role -- an editable acceptance record is not evidence. Deliberately stores no IP address or user agent; see the migration header.';

COMMENT ON COLUMN public.terms_acceptances.organization_id IS
  'The organization the user was acting in, stamped at write time and never derived from current_org_id() at read time -- an acceptance is a historical fact and must not change meaning on an org switch. NULL where signup preceded membership. A row here does NOT mean the organization is contractually bound: that is a signed MSA, not a checkbox.';

COMMENT ON COLUMN public.terms_acceptances.document_version IS
  'Semantic version of the document TEXT, from LEGAL_DOCUMENTS in src/legal/documents.ts. The document id alone cannot answer "which words did they accept", which is the only question a dispute is about.';

COMMENT ON FUNCTION public.record_terms_acceptance(text, text, uuid, text) IS
  'Records the CALLING user''s acceptance. Derives user_id from auth.uid() and accepted_at from now(); refuses an organization the caller is not a member of, and refuses any method other than clickwrap_checkbox. Idempotent per version.';

-- =============================================================================
-- STATUS: NOT APPLIED
--
-- Authored 2026-11-25 for review. Deliberately not applied, for two reasons:
--
--  1. Migrations in this project are never applied through MCP, and
--     production is the only database.
--  2. More importantly, the feature this supports is GATED OFF. The terms it
--     would record acceptance of are counsel-review drafts. Applying the
--     migration is harmless; turning the gate on before counsel has approved
--     the documents would manufacture a record of users accepting a draft,
--     which is worse than having no record because it looks like consent.
--
-- WHAT WAS EXECUTED
--
-- This migration and its tenant-isolation suite were run against a
-- disposable local PostgreSQL 17 cluster seeded by
-- scripts/sql/isolated/00-harness.sql -- see
-- supabase/tests/terms-acceptances-tenant-isolation.sql and the test output
-- recorded in the pull request. That is isolation testing, not production
-- validation: the harness reproduces roles, auth.uid(), organizations,
-- organization_memberships and is_member_of_org() read out of the live
-- catalogue, but it is not production and does not prove the migration
-- applies cleanly there.
--
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.record_terms_acceptance(text, text, uuid, text);
--   DROP TABLE IF EXISTS public.terms_acceptances;
--   DROP FUNCTION IF EXISTS public.is_active_org_admin_of(uuid);
--
-- In that order: the table's policy depends on is_active_org_admin_of(), so
-- dropping the function first fails. Nothing else in the schema references any
-- of the three.
--
-- Note that is_active_org_admin_of() is a general-purpose helper and a later
-- change may come to use it. Check for other dependants before dropping it;
-- the first two statements are sufficient to undo this feature.
-- =============================================================================
