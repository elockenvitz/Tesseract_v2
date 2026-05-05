-- ============================================================================
-- Tag-based conversation organization.
--
-- Old model: each conversation had a single (context_type, context_id)
-- pinning it to one asset/portfolio/theme. Real research is multi-object
-- — "compare AAPL vs MSFT services growth" doesn't fit.
--
-- New model: conversations have N tags, each pointing at an asset /
-- portfolio / theme. Tags drive what data the AI loads (one document
-- block per tag for citations) and how the conversation list groups.
--
-- The old context_type / context_id columns stay for one cycle as a
-- deprecated read-only fallback, then get dropped.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_conversation_tags (
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  tag_type        text NOT NULL CHECK (tag_type IN ('asset', 'portfolio', 'theme', 'note')),
  tag_id          uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_type, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_conversation_tags_conv
  ON public.ai_conversation_tags (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversation_tags_target
  ON public.ai_conversation_tags (tag_type, tag_id);

ALTER TABLE public.ai_conversation_tags ENABLE ROW LEVEL SECURITY;

-- Tags inherit the conversation's owner — let users manage tags only on
-- their own conversations.
DROP POLICY IF EXISTS "Users manage tags on their own ai conversations"
  ON public.ai_conversation_tags;
CREATE POLICY "Users manage tags on their own ai conversations"
  ON public.ai_conversation_tags
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_conversation_tags.conversation_id
        AND c.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_conversation_tags.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- Backfill: every existing conversation with a context becomes a single-tag
-- conversation. ON CONFLICT DO NOTHING handles re-runs.
INSERT INTO public.ai_conversation_tags (conversation_id, tag_type, tag_id)
SELECT id, context_type, context_id
FROM public.ai_conversations
WHERE context_type IS NOT NULL
  AND context_id   IS NOT NULL
  AND context_type IN ('asset', 'portfolio', 'theme', 'note')
ON CONFLICT (conversation_id, tag_type, tag_id) DO NOTHING;

COMMENT ON TABLE public.ai_conversation_tags IS
  'Many-to-many tags on ai_conversations. Replaces the old single-context model. Each tag points at an asset / portfolio / theme / note that the AI should consider when responding in that conversation.';
