-- ============================================================================
-- Per-user model preference.
--
-- BYOK is org-scoped (one API key per org), but users want to pick which
-- model that key calls — power users pick Opus, cost-sensitive users pick
-- Haiku, etc. Cost still flows to the org's one key; this is purely a
-- preference about which model to invoke.
--
-- Resolution chain in the edge function:
--   user_ai_config.preferred_model
--     → organization_ai_config.byok_model
--     → hardcoded default per provider
--
-- preferred_model is text rather than an enum so we don't have to migrate
-- the column every time a provider releases a new model. Validation that
-- the chosen model is supported happens in the edge function PRICING table.
-- ============================================================================

ALTER TABLE public.user_ai_config
  ADD COLUMN IF NOT EXISTS preferred_model text;

COMMENT ON COLUMN public.user_ai_config.preferred_model IS
  'Per-user model override. Falls back to organization_ai_config.byok_model when NULL. Validated against the edge function PRICING table at request time.';
