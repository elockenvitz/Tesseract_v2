/**
 * Adds cache-token columns to ai_usage_log so we can track Anthropic prompt-
 * caching effectiveness (hit rate, savings). The main ai_usage_log row now
 * also gets populated by the ai-chat edge function with real token counts
 * and estimated_cost — previously the function only wrote response_time_ms.
 */

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created
  ON public.ai_usage_log (user_id, created_at DESC);
