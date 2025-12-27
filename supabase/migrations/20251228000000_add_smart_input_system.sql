-- Smart Input System Tables
-- Provides @mentions, #hashtags, .templates, .data functions, and .AI generation

-- =============================================
-- 1. Text Templates
-- =============================================
CREATE TABLE IF NOT EXISTS text_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  variables jsonb DEFAULT '[]'::jsonb, -- [{name: string, default: string}]
  category text DEFAULT 'general',
  is_shared boolean DEFAULT false,
  usage_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT unique_template_name_per_user UNIQUE (user_id, name)
);

-- Enable RLS
ALTER TABLE text_templates ENABLE ROW LEVEL SECURITY;

-- Users can manage their own templates
CREATE POLICY "Users can manage own templates"
  ON text_templates
  FOR ALL
  USING (auth.uid() = user_id);

-- Users can view shared templates
CREATE POLICY "Users can view shared templates"
  ON text_templates
  FOR SELECT
  USING (is_shared = true);

-- Index for fast lookups
CREATE INDEX idx_text_templates_user ON text_templates(user_id);
CREATE INDEX idx_text_templates_shared ON text_templates(is_shared) WHERE is_shared = true;

-- =============================================
-- 2. Smart Input References
-- =============================================
CREATE TABLE IF NOT EXISTS smart_input_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('contribution', 'note', 'message', 'comment')),
  source_id uuid NOT NULL,
  reference_type text NOT NULL CHECK (reference_type IN ('user', 'asset', 'theme', 'portfolio', 'note', 'workflow', 'list')),
  reference_id uuid NOT NULL,
  reference_display text NOT NULL, -- Display text shown to user
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE smart_input_references ENABLE ROW LEVEL SECURITY;

-- Users can create references
CREATE POLICY "Users can create references"
  ON smart_input_references
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can view all references (needed for rendering)
CREATE POLICY "Users can view references"
  ON smart_input_references
  FOR SELECT
  USING (true);

-- Indexes for fast lookups
CREATE INDEX idx_smart_refs_source ON smart_input_references(source_type, source_id);
CREATE INDEX idx_smart_refs_reference ON smart_input_references(reference_type, reference_id);
CREATE INDEX idx_smart_refs_created_by ON smart_input_references(created_by);

-- =============================================
-- 3. Data Snapshots (for .data functions)
-- =============================================
CREATE TABLE IF NOT EXISTS data_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  asset_id uuid REFERENCES assets(id) ON DELETE CASCADE,
  data_type text NOT NULL CHECK (data_type IN ('price', 'volume', 'marketcap', 'change', 'pe_ratio', 'dividend_yield')),
  value_numeric numeric,
  value_text text,
  captured_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);

-- Enable RLS
ALTER TABLE data_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can create snapshots
CREATE POLICY "Users can create snapshots"
  ON data_snapshots
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can view all snapshots
CREATE POLICY "Users can view snapshots"
  ON data_snapshots
  FOR SELECT
  USING (true);

-- Indexes
CREATE INDEX idx_data_snapshots_source ON data_snapshots(source_type, source_id);
CREATE INDEX idx_data_snapshots_asset ON data_snapshots(asset_id);

-- =============================================
-- 4. AI Generated Content Tracking
-- =============================================
CREATE TABLE IF NOT EXISTS ai_generated_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  prompt text NOT NULL,
  generated_content text NOT NULL,
  model_used text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE ai_generated_content ENABLE ROW LEVEL SECURITY;

-- Users can create AI content
CREATE POLICY "Users can create AI content"
  ON ai_generated_content
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Users can view their own AI content
CREATE POLICY "Users can view own AI content"
  ON ai_generated_content
  FOR SELECT
  USING (auth.uid() = created_by);

-- Indexes
CREATE INDEX idx_ai_content_source ON ai_generated_content(source_type, source_id);
CREATE INDEX idx_ai_content_created_by ON ai_generated_content(created_by);

-- =============================================
-- 5. Notification trigger for @mentions
-- =============================================
CREATE OR REPLACE FUNCTION notify_smart_mention()
RETURNS TRIGGER AS $$
DECLARE
  mentioned_user_name text;
  mentioner_name text;
  context_title text;
BEGIN
  -- Only trigger for user mentions
  IF NEW.reference_type != 'user' THEN
    RETURN NEW;
  END IF;

  -- Get mentioner name
  SELECT COALESCE(first_name || ' ' || last_name, email)
  INTO mentioner_name
  FROM users
  WHERE id = NEW.created_by;

  -- Get context title based on source type
  CASE NEW.source_type
    WHEN 'contribution' THEN
      SELECT a.symbol || ' - ' || a.company_name
      INTO context_title
      FROM asset_contributions c
      JOIN assets a ON c.asset_id = a.id
      WHERE c.id = NEW.source_id;
    WHEN 'message' THEN
      context_title := 'Message';
    WHEN 'note' THEN
      context_title := 'Note';
    WHEN 'comment' THEN
      context_title := 'Comment';
    ELSE
      context_title := 'Content';
  END CASE;

  -- Insert notification
  INSERT INTO notifications (
    user_id,
    type,
    title,
    message,
    data,
    created_at
  ) VALUES (
    NEW.reference_id, -- The mentioned user
    'mention',
    'You were mentioned',
    mentioner_name || ' mentioned you in ' || COALESCE(context_title, 'a post'),
    jsonb_build_object(
      'source_type', NEW.source_type,
      'source_id', NEW.source_id,
      'mentioned_by', NEW.created_by
    ),
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for mentions
DROP TRIGGER IF EXISTS trigger_smart_mention_notification ON smart_input_references;
CREATE TRIGGER trigger_smart_mention_notification
  AFTER INSERT ON smart_input_references
  FOR EACH ROW
  EXECUTE FUNCTION notify_smart_mention();

-- =============================================
-- 6. Updated_at trigger for templates
-- =============================================
CREATE OR REPLACE FUNCTION update_text_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_text_template_updated ON text_templates;
CREATE TRIGGER trigger_text_template_updated
  BEFORE UPDATE ON text_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_text_template_timestamp();
