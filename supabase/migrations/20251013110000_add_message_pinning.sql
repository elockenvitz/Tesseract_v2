/*
  # Add Message Pinning to Conversations

  1. Changes
    - Add is_pinned column to conversation_messages table
    - Add index for pinned messages

  2. Notes
    - This enables pinning messages in direct messages/conversations
    - Works alongside existing reply_to functionality
*/

-- Add is_pinned column to conversation_messages
ALTER TABLE conversation_messages
ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;

-- Add index for efficient querying of pinned messages
CREATE INDEX IF NOT EXISTS idx_conversation_messages_pinned
ON conversation_messages(conversation_id, is_pinned)
WHERE is_pinned = true;
