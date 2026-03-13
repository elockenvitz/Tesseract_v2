-- ============================================================
-- Portfolio Log Threading
--
-- Threads link REAL platform objects (quick_thoughts,
-- portfolio_notes, trade_queue_items, trade_proposals)
-- into chains of reasoning.
--
-- portfolio_log_thread_members is a pure linkage table.
-- All content is derived from source objects — the thread
-- layer stores no content, titles, or bodies.
-- ============================================================

-- 1. Thread container
CREATE TABLE IF NOT EXISTS portfolio_log_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  title text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_threads_portfolio
  ON portfolio_log_threads(portfolio_id, updated_at DESC);

-- 2. Thread members — pure linkage to real platform objects
CREATE TABLE IF NOT EXISTS portfolio_log_thread_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES portfolio_log_threads(id) ON DELETE CASCADE,
  source_object_type text NOT NULL CHECK (source_object_type IN (
    'quick_thought', 'portfolio_note', 'trade_queue_item', 'trade_proposal'
  )),
  source_object_id uuid NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  added_by uuid NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now()
);

-- Each source object can belong to at most one thread
CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_members_source_unique
  ON portfolio_log_thread_members(source_object_type, source_object_id);

CREATE INDEX IF NOT EXISTS idx_thread_members_thread
  ON portfolio_log_thread_members(thread_id, position);

-- 3. RLS
ALTER TABLE portfolio_log_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_log_thread_members ENABLE ROW LEVEL SECURITY;

-- Threads
CREATE POLICY "Portfolio members can view log threads"
  ON portfolio_log_threads FOR SELECT
  USING (user_is_portfolio_member(portfolio_id));

CREATE POLICY "Portfolio members can create log threads"
  ON portfolio_log_threads FOR INSERT
  WITH CHECK (user_is_portfolio_member(portfolio_id));

CREATE POLICY "Portfolio members can update log threads"
  ON portfolio_log_threads FOR UPDATE
  USING (user_is_portfolio_member(portfolio_id));

CREATE POLICY "Portfolio members can delete log threads"
  ON portfolio_log_threads FOR DELETE
  USING (user_is_portfolio_member(portfolio_id));

-- Thread members: access derived from parent thread
CREATE POLICY "Portfolio members can view thread members"
  ON portfolio_log_thread_members FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM portfolio_log_threads t
    WHERE t.id = thread_id AND user_is_portfolio_member(t.portfolio_id)
  ));

CREATE POLICY "Portfolio members can manage thread members"
  ON portfolio_log_thread_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM portfolio_log_threads t
    WHERE t.id = thread_id AND user_is_portfolio_member(t.portfolio_id)
  ));

CREATE POLICY "Portfolio members can delete thread members"
  ON portfolio_log_thread_members FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM portfolio_log_threads t
    WHERE t.id = thread_id AND user_is_portfolio_member(t.portfolio_id)
  ));

-- 4. Auto-update thread.updated_at when members change
CREATE OR REPLACE FUNCTION update_log_thread_timestamp()
RETURNS trigger AS $$
BEGIN
  UPDATE portfolio_log_threads
  SET updated_at = now()
  WHERE id = COALESCE(NEW.thread_id, OLD.thread_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_thread_member_update_ts
  AFTER INSERT OR UPDATE OR DELETE ON portfolio_log_thread_members
  FOR EACH ROW EXECUTE FUNCTION update_log_thread_timestamp();
