/*
  # Add Notes & Models Section Support

  This migration:
  1. Creates the `asset_models` table for storing financial models
  2. Extends `asset_notes` with columns for external sources (uploaded files, external links)

  Both support:
  - Uploaded files (Word, PDF, Excel, etc.) via Supabase Storage
  - External links (Google Docs, Google Sheets, Notion, etc.)
  - Sharing between team members (is_shared flag)
  - Soft delete (is_deleted flag)
*/

-- ============================================
-- 1. Create asset_models table
-- ============================================
CREATE TABLE IF NOT EXISTS asset_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('uploaded', 'external_link')),

  -- For uploaded files (Supabase Storage)
  file_path TEXT,           -- Storage path: models/{assetId}/{timestamp}_{randomId}.{ext}
  file_name TEXT,           -- Original filename
  file_size BIGINT,         -- File size in bytes
  file_type TEXT,           -- MIME type (e.g., 'application/vnd.ms-excel')

  -- For external links
  external_url TEXT,        -- Full URL to external resource
  external_provider TEXT,   -- 'google_sheets', 'airtable', 'excel_online', 'smartsheet', 'other'

  -- Metadata
  version INTEGER NOT NULL DEFAULT 1,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN NOT NULL DEFAULT false
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_asset_models_asset_id ON asset_models(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_models_created_by ON asset_models(created_by);
CREATE INDEX IF NOT EXISTS idx_asset_models_is_deleted ON asset_models(is_deleted);

-- Enable RLS
ALTER TABLE asset_models ENABLE ROW LEVEL SECURITY;

-- RLS Policies for asset_models (same pattern as asset_notes)
-- Users can view models for assets they have access to
CREATE POLICY "Users can view models for accessible assets"
  ON asset_models
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM assets a
      WHERE a.id = asset_models.asset_id
    )
  );

-- Users can create models
CREATE POLICY "Users can create models"
  ON asset_models
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Users can update their own models
CREATE POLICY "Users can update own models"
  ON asset_models
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by);

-- Users can delete their own models
CREATE POLICY "Users can delete own models"
  ON asset_models
  FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by);

-- ============================================
-- 2. Extend asset_notes table
-- ============================================
-- Add source_type column (platform = on-platform notes, uploaded = file, external_link = URL)
ALTER TABLE asset_notes
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'platform'
  CHECK (source_type IN ('platform', 'uploaded', 'external_link'));

-- Add columns for uploaded files
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS file_type TEXT;

-- Add columns for external links
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE asset_notes ADD COLUMN IF NOT EXISTS external_provider TEXT;

-- ============================================
-- 3. Updated timestamp trigger for models
-- ============================================
CREATE OR REPLACE FUNCTION update_asset_models_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS asset_models_updated_at ON asset_models;
CREATE TRIGGER asset_models_updated_at
  BEFORE UPDATE ON asset_models
  FOR EACH ROW
  EXECUTE FUNCTION update_asset_models_updated_at();

-- ============================================
-- 4. Comments for documentation
-- ============================================
COMMENT ON TABLE asset_models IS 'Financial models attached to assets - supports uploaded files and external links';
COMMENT ON COLUMN asset_models.source_type IS 'Type of model source: uploaded (file in Storage) or external_link (URL)';
COMMENT ON COLUMN asset_models.external_provider IS 'Provider for external links: google_sheets, airtable, excel_online, smartsheet, other';
COMMENT ON COLUMN asset_models.is_shared IS 'If true, model is visible to other team members viewing the asset';

COMMENT ON COLUMN asset_notes.source_type IS 'Type of note source: platform (created in app), uploaded (file), external_link (URL)';
COMMENT ON COLUMN asset_notes.external_provider IS 'Provider for external links: google_docs, notion, evernote, onenote, confluence, other';
