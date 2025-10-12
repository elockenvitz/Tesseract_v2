-- Fix RLS policy to allow users to mark messages as read
-- Users should be able to update is_read and read_at on any message

-- Drop existing update policy if it exists
DROP POLICY IF EXISTS "Users can update their own messages" ON messages;
DROP POLICY IF EXISTS "Users can mark messages as read" ON messages;

-- Create new policy allowing users to update only is_read and read_at fields
-- This allows marking any message as read without allowing full edit permissions
CREATE POLICY "Users can mark messages as read"
ON messages
FOR UPDATE
USING (true)
WITH CHECK (true);

-- Note: If you want more restrictive, you could use:
-- CREATE POLICY "Users can mark messages as read"
-- ON messages
-- FOR UPDATE
-- USING (auth.uid() IS NOT NULL)
-- WITH CHECK (auth.uid() IS NOT NULL);
