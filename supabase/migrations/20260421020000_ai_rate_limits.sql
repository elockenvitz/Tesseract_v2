/**
 * Adds per-user rate-limit/budget columns to AI config tables.
 *
 * Platform-wide defaults (platform_ai_config, single row):
 *   - daily_token_limit_per_user     (bigint, default 500_000)
 *   - monthly_budget_usd_per_user    (numeric, default 20)
 *   - max_tokens_per_request         (integer, default 4096)
 *
 * Per-user overrides (user_ai_config). NULL = use platform default.
 *   - daily_token_limit_override
 *   - monthly_budget_usd_override
 *   - daily_request_limit_override
 *
 * The ai-chat edge function enforces these pre-call: if a user is over their
 * daily token budget, monthly USD budget, or existing daily_request_limit,
 * the function returns 429 before any provider call is made.
 */

ALTER TABLE public.platform_ai_config
  ADD COLUMN IF NOT EXISTS daily_token_limit_per_user bigint DEFAULT 500000,
  ADD COLUMN IF NOT EXISTS monthly_budget_usd_per_user numeric(10,4) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS max_tokens_per_request integer DEFAULT 4096;

ALTER TABLE public.user_ai_config
  ADD COLUMN IF NOT EXISTS daily_token_limit_override bigint,
  ADD COLUMN IF NOT EXISTS monthly_budget_usd_override numeric(10,4),
  ADD COLUMN IF NOT EXISTS daily_request_limit_override integer;

UPDATE public.platform_ai_config
SET
  daily_token_limit_per_user  = COALESCE(daily_token_limit_per_user, 500000),
  monthly_budget_usd_per_user = COALESCE(monthly_budget_usd_per_user, 20),
  max_tokens_per_request      = COALESCE(max_tokens_per_request, 4096);
