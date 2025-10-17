/*
  # Fix Conversation Participants RLS Policy

  Fix the infinite recursion issue when creating conversation participants.
  Allow users to insert participants for conversations they created.
*/

-- Drop existing policies that might cause recursion
DROP POLICY IF EXISTS "Users can insert conversation participants" ON conversation_participants;
DROP POLICY IF EXISTS "Users can create conversation participants" ON conversation_participants;

-- Allow users to insert participants for conversations they created
CREATE POLICY "Users can insert conversation participants for their conversations"
ON conversation_participants FOR INSERT
WITH CHECK (
  conversation_id IN (
    SELECT id FROM conversations
    WHERE created_by = auth.uid()
  )
);
