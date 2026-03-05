-- The focus_check constraint predates the multi-focus feature (comma-separated values)
-- and is missing many valid focus options. Focus validation is handled by the UI
-- via ROLE_FOCUS_OPTIONS in roles-config.ts.
ALTER TABLE portfolio_team DROP CONSTRAINT IF EXISTS portfolio_team_focus_check;
