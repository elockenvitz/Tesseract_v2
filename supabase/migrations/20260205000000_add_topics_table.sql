-- Create topics table for custom context tags
-- Topics are user-created tags that can be attached to quick thoughts and trade ideas

CREATE TABLE IF NOT EXISTS topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text GENERATED ALWAYS AS (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))) STORED,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'team', 'public')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique constraint on name per user (case-insensitive)
CREATE UNIQUE INDEX topics_name_user_unique ON topics (lower(name), created_by) WHERE visibility = 'private';
-- For team/public topics, unique globally (case-insensitive)
CREATE UNIQUE INDEX topics_name_global_unique ON topics (lower(name)) WHERE visibility IN ('team', 'public');

-- Index for searching (simple btree for ILIKE queries)
CREATE INDEX topics_name_idx ON topics (name);
CREATE INDEX topics_created_by_idx ON topics (created_by);
CREATE INDEX topics_visibility_idx ON topics (visibility);

-- Enable RLS
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can see their own private topics
CREATE POLICY "Users can view own private topics"
  ON topics FOR SELECT
  USING (visibility = 'private' AND created_by = auth.uid());

-- Users can see team topics (within their org - for now, allow all team topics)
CREATE POLICY "Users can view team topics"
  ON topics FOR SELECT
  USING (visibility = 'team');

-- Users can see public topics
CREATE POLICY "Users can view public topics"
  ON topics FOR SELECT
  USING (visibility = 'public');

-- Users can create topics
CREATE POLICY "Users can create topics"
  ON topics FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can update their own topics
CREATE POLICY "Users can update own topics"
  ON topics FOR UPDATE
  USING (auth.uid() = created_by);

-- Users can delete their own topics
CREATE POLICY "Users can delete own topics"
  ON topics FOR DELETE
  USING (auth.uid() = created_by);

-- Create join table for quick_thought_topics
CREATE TABLE IF NOT EXISTS quick_thought_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quick_thought_id uuid NOT NULL REFERENCES quick_thoughts(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (quick_thought_id, topic_id)
);

-- Enable RLS
ALTER TABLE quick_thought_topics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for quick_thought_topics
CREATE POLICY "Users can view quick thought topics they have access to"
  ON quick_thought_topics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quick_thoughts qt
      WHERE qt.id = quick_thought_id
      AND (qt.created_by = auth.uid() OR qt.visibility IN ('team', 'public'))
    )
  );

CREATE POLICY "Users can add topics to their own quick thoughts"
  ON quick_thought_topics FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM quick_thoughts qt
      WHERE qt.id = quick_thought_id
      AND qt.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can remove topics from their own quick thoughts"
  ON quick_thought_topics FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM quick_thoughts qt
      WHERE qt.id = quick_thought_id
      AND qt.created_by = auth.uid()
    )
  );

-- Create join table for trade_idea_topics
CREATE TABLE IF NOT EXISTS trade_idea_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_queue_item_id uuid NOT NULL REFERENCES trade_queue_items(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (trade_queue_item_id, topic_id)
);

-- Enable RLS
ALTER TABLE trade_idea_topics ENABLE ROW LEVEL SECURITY;

-- RLS Policies for trade_idea_topics
CREATE POLICY "Users can view trade idea topics they have access to"
  ON trade_idea_topics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_queue_item_id
      AND (tqi.created_by = auth.uid() OR tqi.sharing_visibility IN ('team', 'public'))
    )
  );

CREATE POLICY "Users can add topics to their own trade ideas"
  ON trade_idea_topics FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_queue_item_id
      AND tqi.created_by = auth.uid()
    )
  );

CREATE POLICY "Users can remove topics from their own trade ideas"
  ON trade_idea_topics FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_queue_item_id
      AND tqi.created_by = auth.uid()
    )
  );

-- Add updated_at trigger
CREATE TRIGGER topics_updated_at
  BEFORE UPDATE ON topics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON topics TO authenticated;
GRANT SELECT, INSERT, DELETE ON quick_thought_topics TO authenticated;
GRANT SELECT, INSERT, DELETE ON trade_idea_topics TO authenticated;
