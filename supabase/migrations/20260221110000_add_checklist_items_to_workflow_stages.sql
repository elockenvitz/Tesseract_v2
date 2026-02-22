-- Add checklist_items template column to workflow_stages
-- Stores checklist item templates as JSONB array, e.g. ["Review data", "Send report"]
-- Instantiated into general_checklist_items when a general-scope run is created.
ALTER TABLE workflow_stages
  ADD COLUMN checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb;
