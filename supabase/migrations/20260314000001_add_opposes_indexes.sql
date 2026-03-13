-- Partial indexes for efficient bidirectional counter-view lookups on trade ideas.
-- Covers: "find all ideas that oppose this idea" from either direction.
CREATE INDEX IF NOT EXISTS idx_object_links_opposes_source
    ON object_links (source_id, link_type)
    WHERE link_type = 'opposes' AND source_type = 'trade_idea';

CREATE INDEX IF NOT EXISTS idx_object_links_opposes_target
    ON object_links (target_id, link_type)
    WHERE link_type = 'opposes' AND target_type = 'trade_idea';
