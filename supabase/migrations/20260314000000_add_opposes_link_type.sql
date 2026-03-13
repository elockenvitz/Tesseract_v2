-- Add 'opposes' to the link_relationship_type enum.
-- This enables trade idea counter-views via the existing object_links system.
-- Counter-views are separate trade ideas linked with link_type = 'opposes'.
ALTER TYPE link_relationship_type ADD VALUE IF NOT EXISTS 'opposes';
