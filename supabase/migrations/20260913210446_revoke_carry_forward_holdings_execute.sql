-- carry_forward_holdings runs SECURITY DEFINER, so it bypasses RLS on the
-- snapshot tables, and every signed-in or anonymous caller could execute it
-- with any p_target_date: one call copies the prior day's snapshot for every
-- portfolio in every organization, and repeated calls chain forward without
-- bound. Nothing in the app, no cron job and no other function calls it.
-- Execution is restricted to the owner and service_role. The body is unchanged.
REVOKE EXECUTE ON FUNCTION public.carry_forward_holdings(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.carry_forward_holdings(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.carry_forward_holdings(date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.carry_forward_holdings(date) TO service_role;
