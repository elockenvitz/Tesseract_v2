/*
  # Add Checklist Item Comments Thread

  1. New Table
    - `checklist_item_comments` - Thread of comments for checklist items

  2. Changes
    - Migrate existing comments from asset_checklist_items.comment to new table
    - Keep comment column for backward compatibility initially

  3. Security
    - Enable RLS
    - Add policies for authenticated users
*/

-- Create checklist_item_comments table
CREATE TABLE IF NOT EXISTS checklist_item_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_item_id uuid NOT NULL REFERENCES asset_checklist_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment_text text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_edited boolean DEFAULT false
);

-- Enable RLS
ALTER TABLE checklist_item_comments ENABLE ROW LEVEL SECURITY;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_checklist_item_comments_item ON checklist_item_comments(checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_checklist_item_comments_user ON checklist_item_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_checklist_item_comments_created ON checklist_item_comments(created_at);

-- RLS Policies
CREATE POLICY "Users can read comments"
  ON checklist_item_comments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create comments"
  ON checklist_item_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own comments"
  ON checklist_item_comments
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own comments"
  ON checklist_item_comments
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Migrate existing comments to new table
INSERT INTO checklist_item_comments (checklist_item_id, user_id, comment_text, created_at)
SELECT
  id,
  COALESCE(created_by, (SELECT id FROM users LIMIT 1)), -- Use created_by or fallback to first user
  comment,
  updated_at
FROM asset_checklist_items
WHERE comment IS NOT NULL AND comment != '';
