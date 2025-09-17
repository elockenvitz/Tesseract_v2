/*
  # Update Process Stage Enum

  Update the process_stage enum to include all new timeline stages:
  - Add 'outdated'
  - Add 'initiated'
  - Add 'prioritized'
  - Add 'in_progress'
  - Add 'recommend'
  - Add 'action'
  - Keep existing: 'analysis', 'archived', 'monitoring', 'research', 'review'
*/

-- Add new enum values to process_stage enum
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'outdated';
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'initiated';
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'prioritized';
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'in_progress';
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'recommend';
ALTER TYPE process_stage ADD VALUE IF NOT EXISTS 'action';