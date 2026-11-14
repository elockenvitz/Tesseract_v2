-- ACT AI 2.4 -- the folder-ownership guard learns the organisation boundary.
--
-- ============================================================================
-- STATUS: PREPARED, NOT APPLIED. Requires explicit authorization.
-- ============================================================================
--
-- ── First, a correction to the 2.4 report ───────────────────────────────────
--
-- That report listed "`ai_conversations.folder_id` has no ownership check" as
-- an open finding. That is wrong, and the record is corrected here rather
-- than quietly: the check exists, in production, and has since
-- 20261112120000_ai_project_folders.sql. Verified against the live database:
--
--   trigger   ai_conversations_folder_own
--             BEFORE INSERT OR UPDATE OF folder_id ON public.ai_conversations
--             FOR EACH ROW EXECUTE FUNCTION ai_conversation_folder_must_be_own()
--   function  SECURITY DEFINER, search_path pinned to public, pg_temp,
--             EXECUTE held by service_role only -- not anon, not authenticated
--   raises    42501 for a folder that is not the conversation owner's
--
-- It is also indistinguishable in the way it needs to be: the check is one
-- existence-AND-ownership read, so "that folder is somebody else's" and "that
-- folder does not exist" raise the same error. A reader cannot use the control
-- as an oracle for whether an arbitrary uuid is a real folder. The FK would
-- have distinguished them (foreign_key_violation versus 42501); the BEFORE
-- trigger runs first, so it does not get the chance.
--
-- The report's claim came from reading the POLICIES and stopping there. The
-- two policies on `ai_conversations` check `user_id = auth.uid()` and nothing
-- about `folder_id`, which is true and is exactly why the trigger exists.
--
-- ── What this migration actually fixes ──────────────────────────────────────
--
-- One residual gap, and a narrow one. The trigger checks that the folder
-- belongs to the conversation's owner. It does not check that the owner is
-- still a MEMBER of the organisation the folder is scoped to.
--
-- `ai_project_folders` carries `organization_id NOT NULL`, and all four of
-- its policies require `is_member_of_org(organization_id)` as well as
-- ownership -- so losing a seat closes the folder rather than leaving it
-- readable. The trigger reads the table as a definer and therefore bypasses
-- that, which means a reader who has left an organisation can still file a
-- conversation into a folder in it: their own folder, which they can no
-- longer see.
--
-- Impact, stated honestly so the decision to apply this is an informed one:
--   - No data belonging to anyone else is reachable. The folder is the
--     reader's and the conversation is the reader's.
--   - `ai_conversations` has no organisation column at all (by design -- see
--     the ACT AI notes), so nothing crosses a tenant boundary here.
--   - The visible effect is that the thread appears unfiled to its owner,
--     because the sidebar can no longer read the folder that holds it. The
--     list already handles that case deliberately: `AIConversationList`
--     treats "inside a project the reader cannot currently open" as loose
--     rather than filtering on `folder_id IS NULL`, precisely so a thread
--     cannot vanish from both places at once.
--
-- So this is a tightening, not a breach being closed. It is here because a
-- conversation should not be assignable to a folder the writer cannot read,
-- and because `is_member_of_org` is the predicate the folder's own policies
-- already use -- so after this, "can file into it" and "can see it" are the
-- same question rather than two that can disagree.
--
-- ── Why the predicate is spelled out rather than inherited ─────────────────
--
-- The function stays SECURITY DEFINER and keeps reading the table directly.
-- An invoker-rights trigger would get the org check for free from the
-- folder's SELECT policy, and would be the wrong trade: the guard would then
-- depend on a policy somebody could widen later without noticing it was also
-- a write gate. Deriving authority from trusted server-side data, written
-- out, is the standing rule for privileged code in this repository.
--
-- `is_member_of_org` is itself a definer helper, which is why it works inside
-- one: a plain subquery against the membership table would run under the
-- caller's RLS, and this codebase has a note on exactly that trap -- a policy
-- subquery under the caller's RLS hides real holes and breaks inline-EXISTS
-- fixes.
--
-- ── The one way this could be wrong, checked ────────────────────────────────
--
-- `is_member_of_org(p_org_id)` answers for the CALLER (auth.uid()), not for
-- `NEW.user_id`. Inside this trigger those are the same person, because both
-- policies on `ai_conversations` require `user_id = auth.uid()` -- a writer
-- can only write their own rows. But they would NOT be the same for a
-- `service_role` write, where `auth.uid()` is null: the helper would answer
-- false and this trigger would refuse a legitimate server-side filing.
--
-- Verified before writing this: no Edge Function references
-- `ai_conversations` at all, let alone `folder_id`. The client, as the
-- authenticated reader, is the only writer. If that ever changes, this
-- predicate has to take the owner as an argument rather than assume the
-- caller is the owner -- so it is recorded here rather than left to be
-- rediscovered by an outage.
--
-- ── RLS posture ─────────────────────────────────────────────────────────────
--
-- No new table, no new policy, no policy widened, no grant added. One
-- function body replaced; the trigger that calls it is unchanged and is
-- re-created only so this file is idempotent. The REVOKEs are repeated
-- because `CREATE OR REPLACE FUNCTION` does not reset privileges but a fresh
-- `CREATE` would be born PUBLIC-executable, and this file must be safe to run
-- against a database where the function is absent.
--
-- ── Validation sequence, in an authorized environment ───────────────────────
--
-- 1. Apply this file.
-- 2. Run supabase/tests/ai-conversation-folder-authorization.sql in full.
--    Every assertion must pass. It runs inside BEGIN/ROLLBACK, so it leaves
--    nothing behind -- see the note on user-delete cascade cost for why a
--    fixture teardown here would otherwise be slow.
-- 3. Run the two deliberate breakages named in that file's header and
--    confirm each fails the assertions it is supposed to. A suite nobody has
--    seen fail is decoration.
-- 4. Confirm the legitimate path still works: a member filing a conversation
--    into their own folder in their own organisation.
-- 5. Obtain separate approval before applying to production.

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_conversation_folder_must_be_own()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.folder_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- One read, three conditions, ONE error. Splitting this into separate
  -- checks with separate messages would make the control an oracle: the
  -- reader would learn whether an id they guessed is a real folder from
  -- which refusal they got. "Not yours", "does not exist" and "you have left
  -- that firm" are all the same sentence to a writer.
  IF NOT EXISTS (
    SELECT 1 FROM public.ai_project_folders f
     WHERE f.id = NEW.folder_id
       AND f.user_id = NEW.user_id
       -- New in 2.4. The folder's own four policies all require this, so
       -- without it the definer read here was the one path that could reach
       -- a folder in an organisation the owner has left.
       AND public.is_member_of_org(f.organization_id)
  ) THEN
    RAISE EXCEPTION
      'ai_conversations.folder_id must reference a folder owned by the conversation owner'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.ai_conversation_folder_must_be_own() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_conversation_folder_must_be_own() FROM anon;
REVOKE ALL ON FUNCTION public.ai_conversation_folder_must_be_own() FROM authenticated;

DROP TRIGGER IF EXISTS ai_conversations_folder_own ON public.ai_conversations;
CREATE TRIGGER ai_conversations_folder_own
  BEFORE INSERT OR UPDATE OF folder_id ON public.ai_conversations
  FOR EACH ROW EXECUTE FUNCTION public.ai_conversation_folder_must_be_own();

COMMENT ON COLUMN public.ai_conversations.folder_id IS
  'The folder this conversation is filed under, or NULL for unfiled. ON DELETE SET NULL: removing a folder never removes a conversation. Guarded by ai_conversations_folder_own, which refuses any folder the conversation owner does not own OR that sits in an organization they are no longer a member of, with one indistinguishable 42501 for every refusal.';

COMMIT;
