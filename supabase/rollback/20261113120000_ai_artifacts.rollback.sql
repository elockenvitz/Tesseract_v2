-- =============================================================================
-- Rollback: ACT AI artifacts
--
-- Safe to run at any point, because nothing else references this table and it
-- holds no text of its own: every artifact is a pointer at a message that
-- stays where it is in `ai_conversations.messages`. Dropping this loses the
-- reader's titles and their choice of what to keep, and loses no answer.
--
-- The trigger and its function go with the table. The function is only ever
-- reached as a trigger, so nothing else can be depending on it.
-- =============================================================================

DROP TRIGGER IF EXISTS ai_artifacts_conversation_own ON public.ai_artifacts;
DROP TRIGGER IF EXISTS ai_artifacts_touch ON public.ai_artifacts;
DROP FUNCTION IF EXISTS public.ai_artifact_conversation_must_be_own();
DROP TABLE IF EXISTS public.ai_artifacts;
