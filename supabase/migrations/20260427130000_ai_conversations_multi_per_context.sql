-- ============================================================================
-- AI conversations: support multiple per context.
--
-- The original table modelled one conversation per (user, context_type,
-- context_id) — switching back to AAPL reloaded the same thread, switching
-- contexts wiped the panel. Real research is multi-thread: "thesis review",
-- "Q4 earnings risk", "rebuttal to Bear thesis" — all about the same asset
-- but distinct conversations.
--
-- Changes
-- -------
-- 1. Drop the unique constraint on (user_id, context_type, context_id).
-- 2. Add `is_archived`, `is_pinned`, `last_message_at` for organization.
-- 3. Index on (user_id, last_message_at DESC) for sidebar list query.
-- 4. RLS: re-confirm user can only see their own conversations.
-- ============================================================================

ALTER TABLE public.ai_conversations
  DROP CONSTRAINT IF EXISTS unique_active_conversation;

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS is_archived     boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned       boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

-- Backfill last_message_at from updated_at (best-effort proxy for existing rows).
UPDATE public.ai_conversations SET last_message_at = updated_at WHERE last_message_at IS NULL;

-- Sidebar query: list user's conversations newest-first, optionally filtered
-- by context. Pinned should sort to the top — the UI handles the pinned
-- branch; this index covers the recency case.
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_recency
  ON public.ai_conversations (user_id, is_archived, last_message_at DESC NULLS LAST);

-- Make sure RLS exists. The original migration may or may not have set it
-- — being explicit here is harmless.
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own ai conversations" ON public.ai_conversations;
CREATE POLICY "Users manage their own ai conversations" ON public.ai_conversations
  FOR ALL USING (user_id = auth.uid())
              WITH CHECK (user_id = auth.uid());

COMMENT ON COLUMN public.ai_conversations.is_archived IS
  'Hidden from default sidebar view; can still be retrieved by ID. Use this rather than DELETE for audit/recovery.';
COMMENT ON COLUMN public.ai_conversations.is_pinned IS
  'Surfaces at top of the sidebar regardless of recency.';
COMMENT ON COLUMN public.ai_conversations.last_message_at IS
  'Updated on every saveConversation. Drives the sidebar sort order.';
