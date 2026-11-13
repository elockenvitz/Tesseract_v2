-- =============================================================================
-- ACT AI artifacts — an answer a reader keeps, findable outside its thread
--
-- NOT APPLIED. Authored for review. See the note at the bottom.
--
-- WHAT THIS IS
--
-- An artifact is an answer the reader decided is worth coming back to: a
-- bear and bull case, a comparison, a framing they want again next quarter.
-- Today the only way out of a thread is `AiKeep`, which promotes the text
-- into a canonical record -- a quick thought, a research note, a thesis
-- draft. That is the right path when the answer becomes research. It is the
-- wrong path when the answer is just an answer: filing a comparison table as
-- a "quick thought" asserts something about it that is not true, and the
-- alternative is leaving it buried in a 40-message thread.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
--
-- The text. There is no content column, and that is the whole design.
--
-- The answer is already durable in `ai_conversations.messages`, and this
-- schema holds a POINTER to it: the conversation, the message's own stable
-- id, and a title the reader wrote. Two reasons, both of which this
-- repository has already paid for once:
--
--   * `src/lib/ai/artifacts.ts` rejected a copy-holding table on the grounds
--     that it creates two versions of one sentence with no rule about which
--     is true. That reasoning has not changed.
--   * `stripStoredExcerpts` exists because a record's words copied into
--     `ai_conversations.messages` become a copy living outside that record's
--     own policy, which nothing re-checks when the original is restricted or
--     deleted. A content column here would reintroduce exactly that, one
--     level further out.
--
-- So an artifact cannot outlive its conversation, and `ON DELETE CASCADE`
-- says so honestly rather than leaving a titled pointer to nothing.
--
-- OWNERSHIP AND ISOLATION
--
-- Owner AND organization, both checked on every verb, which is the same
-- shape as `ai_project_folders` and for the same reasons.
--
-- Owner, because `ai_conversations` is strictly private
-- (`user_id = auth.uid()`) and carries no organization at all. An org-wide
-- read policy here would list a colleague a TITLE whose answer they cannot
-- open -- a disclosure of what someone is working on, with nothing behind
-- it. If these are ever to be shared, the conversation's own boundary has to
-- move first; that is a product decision, not a policy tweak.
--
-- Organization, because the title is user-authored text and a reader working
-- in two firms must not see one firm's titles while in the other. It is
-- stamped at write time, never derived from a mutable `current_org_id()` at
-- read time, and checked against LIVE membership, so losing membership
-- closes the artifact rather than leaving it readable.
--
-- THE CHILD GUARD
--
-- `conversation_id` could otherwise name ANY conversation, including another
-- reader's: this table's policy checks who owns the ARTIFACT, and a reader
-- can set that to themselves while pointing at a thread that is not theirs.
-- They still could not read the text -- `ai_conversations` would deny it --
-- but they could create a row claiming a relationship that does not exist,
-- and a later widening of either policy would turn that into a real leak.
--
-- The policies cannot see the conversation the way this needs: a policy
-- subquery runs under the caller's own RLS, which in this repository has both
-- hidden real holes and broken legitimate writes. So parentage is a
-- SECURITY DEFINER trigger that compares the conversation's owner to the
-- artifact's owner and raises 42501 -- a write that means something the
-- system will not do should fail, not half-succeed.
--
-- The trigger function is a trigger function only. Trigger execution does not
-- consult EXECUTE privileges, so EXECUTE is revoked from everyone: every
-- function in this schema is born anon-executable and REVOKE FROM PUBLIC
-- alone does not undo that.
--
-- DEPLOYMENT
--
-- This file has NOT been applied to any environment. Its regression test,
-- `supabase/tests/ai-artifacts-authorization.sql`, is authored and
-- UNEXECUTED for the same reason: the Management API connection available
-- here is read-only, so the suite cannot even create the table inside a
-- rolled-back transaction. Both the application and the test run belong to
-- the deployment approval, and no application code reads this table yet --
-- shipping a surface against an unapplied migration is how this repository
-- ended up with features that were unreachable dead code.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  -- `ChatMessage.id` from inside the conversation's `messages` jsonb. Text,
  -- because that id is client-generated and not always a uuid, and an ORDINAL
  -- would silently repoint if a turn were ever removed from the array.
  message_id      text NOT NULL,
  title           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_artifacts_title_present CHECK (btrim(title) <> ''),
  CONSTRAINT ai_artifacts_title_length  CHECK (length(title) <= 200),
  CONSTRAINT ai_artifacts_message_present CHECK (btrim(message_id) <> '')
);

-- Keeping the same answer twice is the same artifact, renamed.
CREATE UNIQUE INDEX IF NOT EXISTS ai_artifacts_unique_message
  ON public.ai_artifacts (user_id, conversation_id, message_id);

-- The list query: one reader's artifacts in one firm, newest first.
CREATE INDEX IF NOT EXISTS ai_artifacts_owner
  ON public.ai_artifacts (user_id, organization_id, created_at DESC);

-- Reached when a conversation is deleted, and by the artifacts panel of an
-- open thread.
CREATE INDEX IF NOT EXISTS ai_artifacts_conversation
  ON public.ai_artifacts (conversation_id);

DROP TRIGGER IF EXISTS ai_artifacts_touch ON public.ai_artifacts;
CREATE TRIGGER ai_artifacts_touch
  BEFORE UPDATE ON public.ai_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_artifacts ENABLE ROW LEVEL SECURITY;

-- No anon grant, ever. The publishable key is a valid JWT.
REVOKE ALL ON public.ai_artifacts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_artifacts TO authenticated;

-- Four verbs, named separately, so a later change to one cannot silently
-- widen the others.
DROP POLICY IF EXISTS ai_artifacts_select ON public.ai_artifacts;
CREATE POLICY ai_artifacts_select ON public.ai_artifacts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_artifacts_insert ON public.ai_artifacts;
CREATE POLICY ai_artifacts_insert ON public.ai_artifacts
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_artifacts_update ON public.ai_artifacts;
CREATE POLICY ai_artifacts_update ON public.ai_artifacts
  FOR UPDATE TO authenticated
  USING      (user_id = auth.uid() AND public.is_member_of_org(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_artifacts_delete ON public.ai_artifacts;
CREATE POLICY ai_artifacts_delete ON public.ai_artifacts
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_member_of_org(organization_id));

-- ─── Parentage ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ai_artifact_conversation_must_be_own()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_conversations c
     WHERE c.id = NEW.conversation_id
       AND c.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION
      'ai_artifacts.conversation_id must reference a conversation owned by the artifact owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ai_artifact_conversation_must_be_own() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_artifact_conversation_must_be_own() FROM anon;
REVOKE ALL ON FUNCTION public.ai_artifact_conversation_must_be_own() FROM authenticated;

DROP TRIGGER IF EXISTS ai_artifacts_conversation_own ON public.ai_artifacts;
CREATE TRIGGER ai_artifacts_conversation_own
  BEFORE INSERT OR UPDATE OF conversation_id, user_id ON public.ai_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.ai_artifact_conversation_must_be_own();

COMMENT ON TABLE public.ai_artifacts IS
  'Pointers to ACT AI answers a reader kept: conversation, message id and a reader-written title. Holds NO copy of the answer text, which stays the one copy in ai_conversations.messages. Private per user and scoped to one organization; not shared, because the conversation it points at is not.';
COMMENT ON COLUMN public.ai_artifacts.message_id IS
  'ChatMessage.id inside the conversation''s messages jsonb. Not an ordinal: an ordinal would repoint if a turn were removed.';
