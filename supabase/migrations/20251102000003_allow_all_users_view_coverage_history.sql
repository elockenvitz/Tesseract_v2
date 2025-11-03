/*
  # Allow All Users to View Coverage History

  Updates the RLS policy on coverage_history to allow all authenticated users
  to view coverage history, not just admins or users with coverage on that asset.
*/

-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Users can view coverage history" ON coverage_history;

-- Create a new policy that allows all authenticated users to view coverage history
CREATE POLICY "All authenticated users can view coverage history"
  ON coverage_history
  FOR SELECT
  TO authenticated
  USING (true);
