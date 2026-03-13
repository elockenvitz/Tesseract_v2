CREATE OR REPLACE FUNCTION is_portfolio_pm(p_portfolio_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN EXISTS(
    SELECT 1 FROM portfolio_memberships pm
    WHERE pm.portfolio_id = p_portfolio_id
      AND pm.user_id = p_user_id
      AND pm.is_portfolio_manager = true
  );
END;
$$;
