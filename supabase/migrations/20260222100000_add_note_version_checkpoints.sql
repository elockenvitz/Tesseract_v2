-- Add checkpoint support to note_versions
-- is_pinned: marks user-created "checkpoint" snapshots that should never be thinned
-- label: optional user-provided description for checkpoints

ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE note_versions ADD COLUMN IF NOT EXISTS label TEXT;

-- Update version_reason check to include 'checkpoint'
-- (version_reason is TEXT with no CHECK constraint, so no ALTER needed)

COMMENT ON COLUMN note_versions.is_pinned IS 'Whether this version is a user-pinned checkpoint (protected from auto-thinning)';
COMMENT ON COLUMN note_versions.label IS 'Optional user-provided label for checkpoint versions';
