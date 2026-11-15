-- =============================================================================
-- ACT AI project folders — a place to put a conversation
--
-- WHAT THIS IS
--
-- `ai_conversations` is a flat list of up to two hundred private threads per
-- user, ordered by recency. Research is not flat: "Earnings season", "the
-- Apple case", "IC prep" are real groupings a reader keeps in their head and
-- the sidebar cannot express. This adds the smallest durable home for that:
-- a named folder, owned by one user inside one organization, and a nullable
-- `folder_id` on the conversation.
--
-- WHAT IT IS NOT
--
-- Not a second Projects system. Tesseract Projects are work-management
-- objects with assignments and workflows; this is a filing cabinet for
-- conversational work, and the two are deliberately unrelated tables. A
-- conversation has at most ONE folder, so there is no membership table and
-- no duplicate-copy semantics; cross-cutting relationships stay in
-- `ai_conversation_tags`, which already models "this thread is about AAPL".
--
-- OWNERSHIP AND ISOLATION
--
-- `ai_conversations` is strictly private (`user_id = auth.uid()`) and carries
-- no organization. Folders are private the same way AND stamped with an
-- organization, for one reason: a folder NAME is user-authored text, and a
-- reader working in two firms must not see "Project Condor" from the other
-- one in their list. The organization is set at write time and checked
-- against live membership on every verb, so losing membership closes the
-- folder rather than leaving it readable.
--
-- `folder_id` is `ON DELETE SET NULL`. Removing a folder files its threads
-- back under "unfiled"; it never deletes a conversation. Archiving is a flag
-- and touches nothing else.
--
-- THE CHILD GUARD
--
-- A conversation could otherwise name ANY folder id, including another
-- user's, because its own policy only checks who owns the conversation. The
-- policies cannot see the folders table the way this needs (a policy
-- subquery runs under the caller's own RLS, which is a trap this repository
-- has been bitten by), so ownership is enforced by a definer trigger that
-- compares the folder's owner to the conversation's owner. It raises 42501
-- rather than silently nulling the column: a write that means something the
-- system will not do should fail, not half-succeed.
--
-- The trigger function is a trigger function only. Trigger execution does
-- not consult EXECUTE privileges, so EXECUTE is revoked from everyone --
-- every function in this schema is born anon-executable and REVOKE FROM
-- PUBLIC alone does not undo that.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ai_project_folders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id)      ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  is_archived     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_project_folders_name_present CHECK (btrim(name) <> ''),
  CONSTRAINT ai_project_folders_name_length  CHECK (length(name) <= 120)
);

-- One name per reader per organization, case- and space-insensitively. Two
-- folders called "Earnings" and "earnings " are the same shelf.
CREATE UNIQUE INDEX IF NOT EXISTS ai_project_folders_unique_name
  ON public.ai_project_folders (user_id, organization_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS ai_project_folders_owner
  ON public.ai_project_folders (user_id, organization_id, is_archived);

DROP TRIGGER IF EXISTS ai_project_folders_touch ON public.ai_project_folders;
CREATE TRIGGER ai_project_folders_touch
  BEFORE UPDATE ON public.ai_project_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ai_project_folders ENABLE ROW LEVEL SECURITY;

-- No anon grant, ever. The publishable key is a valid JWT.
REVOKE ALL ON public.ai_project_folders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_project_folders TO authenticated;

-- Four verbs, named separately, so a later change to one cannot silently
-- widen the others.
DROP POLICY IF EXISTS ai_project_folders_select ON public.ai_project_folders;
CREATE POLICY ai_project_folders_select ON public.ai_project_folders
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_project_folders_insert ON public.ai_project_folders;
CREATE POLICY ai_project_folders_insert ON public.ai_project_folders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_project_folders_update ON public.ai_project_folders;
CREATE POLICY ai_project_folders_update ON public.ai_project_folders
  FOR UPDATE TO authenticated
  USING      (user_id = auth.uid() AND public.is_member_of_org(organization_id))
  WITH CHECK (user_id = auth.uid() AND public.is_member_of_org(organization_id));

DROP POLICY IF EXISTS ai_project_folders_delete ON public.ai_project_folders;
CREATE POLICY ai_project_folders_delete ON public.ai_project_folders
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_member_of_org(organization_id));

-- ─── The conversation's shelf ───────────────────────────────────────────────

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES public.ai_project_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_conversations_folder
  ON public.ai_conversations (user_id, folder_id)
  WHERE folder_id IS NOT NULL;

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

  IF NOT EXISTS (
    SELECT 1 FROM public.ai_project_folders f
     WHERE f.id = NEW.folder_id
       AND f.user_id = NEW.user_id
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

COMMENT ON TABLE public.ai_project_folders IS
  'Private per-user folders for organizing ACT AI conversations, scoped to one organization. Not a Tesseract Project: no assignments, no workflow, no sharing.';
COMMENT ON COLUMN public.ai_conversations.folder_id IS
  'The folder this conversation is filed under, or NULL for unfiled. ON DELETE SET NULL: removing a folder never removes a conversation. Guarded by ai_conversations_folder_own so it can only name a folder the conversation owner owns.';
