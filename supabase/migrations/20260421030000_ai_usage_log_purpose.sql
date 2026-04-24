/**
 * Adds purpose column to ai_usage_log so cost dashboards can split AI spend
 * by call site (chat vs. AI columns vs. thesis analysis vs. smart-input).
 *
 * Values: 'chat' | 'column' | 'snippet' | 'analysis' | NULL (legacy/unknown).
 * The ai-chat edge function writes this when the caller passes a 'purpose'
 * field in the request body. Nothing enforces it, so older clients logging
 * NULL are fine.
 */

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS purpose text;

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_purpose_created
  ON public.ai_usage_log (purpose, created_at DESC) WHERE purpose IS NOT NULL;
