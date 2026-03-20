-- Reconstructed locally to match remote-applied migration. Original applied 2026-02-03.
-- Enables RLS and creates access policies for trade_proposals and decision_requests.

-- ============================================================================
-- trade_proposals RLS
-- ============================================================================
ALTER TABLE trade_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view proposals for accessible trade ideas"
  ON trade_proposals FOR SELECT
  TO public
  USING (
    (user_id = auth.uid()) OR (EXISTS (
      SELECT 1 FROM trade_queue_items tqi
      WHERE tqi.id = trade_proposals.trade_queue_item_id
        AND (
          tqi.created_by = auth.uid()
          OR tqi.assigned_to = auth.uid()
          OR EXISTS (
            SELECT 1 FROM portfolio_team pt
            WHERE pt.portfolio_id = tqi.portfolio_id AND pt.user_id = auth.uid()
          )
        )
    ))
  );

CREATE POLICY "Users can create their own proposals"
  ON trade_proposals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own proposals"
  ON trade_proposals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own proposals"
  ON trade_proposals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- decision_requests RLS
-- ============================================================================
ALTER TABLE decision_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_requests_select
  ON decision_requests FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM portfolio_team pt
      WHERE pt.portfolio_id = decision_requests.portfolio_id AND pt.user_id = auth.uid()
    )
  );

CREATE POLICY decision_requests_insert
  ON decision_requests FOR INSERT
  TO public
  WITH CHECK (
    (requested_by = auth.uid()) AND (EXISTS (
      SELECT 1 FROM portfolio_team pt
      WHERE pt.portfolio_id = decision_requests.portfolio_id AND pt.user_id = auth.uid()
    ))
  );

CREATE POLICY decision_requests_update
  ON decision_requests FOR UPDATE
  TO public
  USING (
    (requested_by = auth.uid()) OR (EXISTS (
      SELECT 1 FROM portfolio_team pt
      WHERE pt.portfolio_id = decision_requests.portfolio_id AND pt.user_id = auth.uid()
    ))
  );

CREATE POLICY decision_requests_delete
  ON decision_requests FOR DELETE
  TO public
  USING (requested_by = auth.uid());
