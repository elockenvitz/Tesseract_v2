-- Add shortcut column to text_templates for dot command access
-- Example: shortcut "meeting" allows using .template.meeting

ALTER TABLE text_templates
ADD COLUMN IF NOT EXISTS shortcut TEXT;

-- Shortcut must be unique per user (can have same shortcut for different users)
CREATE UNIQUE INDEX IF NOT EXISTS idx_text_templates_user_shortcut
ON text_templates(user_id, shortcut)
WHERE shortcut IS NOT NULL;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_text_templates_shortcut
ON text_templates(shortcut)
WHERE shortcut IS NOT NULL;

COMMENT ON COLUMN text_templates.shortcut IS 'Short command name for .template.{shortcut} access';
