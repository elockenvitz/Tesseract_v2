-- ============================================================================
-- Fill notification gaps, trade idea visibility fix, list suggestions,
-- list collaboration, new messages, and price target expiry scheduling
-- ============================================================================

-- ============================================================================
-- 0. Tighten trade_queue_items RLS to require portfolio membership
--    Previously: any org member could see non-private ideas across all portfolios
--    Now: must be creator, assigned_to, or a member of the idea's portfolio
-- ============================================================================
DROP POLICY IF EXISTS "Trade queue: org-scoped access" ON trade_queue_items;
CREATE POLICY "Trade queue: portfolio-scoped access" ON trade_queue_items FOR SELECT TO authenticated
USING (
  portfolio_in_current_org(portfolio_id)
  AND (
    -- 1. Creator of the idea
    created_by = auth.uid()
    -- 2. Assigned analyst or tagged collaborator
    OR assigned_to = auth.uid()
    OR collaborators @> jsonb_build_array(auth.uid()::text)
    -- 3. PM on the portfolio
    OR is_portfolio_pm(portfolio_id, auth.uid())
    -- 4. Covers the asset AND is a member of the portfolio
    OR (
      user_is_portfolio_member(portfolio_id)
      AND EXISTS (
        SELECT 1 FROM coverage c
        WHERE c.asset_id = trade_queue_items.asset_id
          AND c.user_id = auth.uid()
      )
    )
  )
);

-- 1. Add new notification_type enum values
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'list_suggestion_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'list_suggestion_accepted';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'list_suggestion_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'new_message';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'list_collaboration';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'trade_idea_created';

-- 2. Update context_type CHECK constraint to include 'conversation' and 'list'
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_context_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_context_type_check
  CHECK (context_type IN ('asset', 'note', 'portfolio', 'theme', 'list', 'workflow', 'project', 'price_target', 'conversation'));

-- ============================================================================
-- 3. DB trigger: list suggestion notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_list_suggestion_created()
RETURNS TRIGGER AS $$
DECLARE
  v_suggester_name text;
  v_asset_symbol text;
  v_list_name text;
BEGIN
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_suggester_name
  FROM users WHERE id = NEW.suggested_by;

  SELECT symbol INTO v_asset_symbol
  FROM assets WHERE id = NEW.asset_id;

  SELECT name INTO v_list_name
  FROM asset_lists WHERE id = NEW.list_id;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.target_user_id,
    'list_suggestion_received',
    'New List Suggestion',
    v_suggester_name || ' suggested to ' || NEW.suggestion_type || ' ' || COALESCE(v_asset_symbol, 'an asset') || ' in "' || COALESCE(v_list_name, 'a list') || '"',
    'list',
    NEW.list_id,
    jsonb_build_object(
      'suggestion_id', NEW.id,
      'list_id', NEW.list_id,
      'list_name', v_list_name,
      'asset_id', NEW.asset_id,
      'asset_symbol', v_asset_symbol,
      'suggestion_type', NEW.suggestion_type,
      'suggested_by', NEW.suggested_by,
      'suggester_name', v_suggester_name,
      'notes', NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS list_suggestion_created_notification ON asset_list_suggestions;
CREATE TRIGGER list_suggestion_created_notification
  AFTER INSERT ON asset_list_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION notify_list_suggestion_created();

-- ============================================================================
-- 4. DB trigger: list suggestion accepted/rejected notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_list_suggestion_response()
RETURNS TRIGGER AS $$
DECLARE
  v_responder_name text;
  v_asset_symbol text;
  v_list_name text;
  v_notification_type notification_type;
  v_title text;
  v_action text;
BEGIN
  -- Only fire when status changes to accepted or rejected
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('accepted', 'rejected') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_responder_name
  FROM users WHERE id = NEW.target_user_id;

  SELECT symbol INTO v_asset_symbol
  FROM assets WHERE id = NEW.asset_id;

  SELECT name INTO v_list_name
  FROM asset_lists WHERE id = NEW.list_id;

  IF NEW.status = 'accepted' THEN
    v_notification_type := 'list_suggestion_accepted';
    v_title := 'Suggestion Accepted';
    v_action := 'accepted';
  ELSE
    v_notification_type := 'list_suggestion_rejected';
    v_title := 'Suggestion Declined';
    v_action := 'declined';
  END IF;

  -- Notify the original suggester
  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.suggested_by,
    v_notification_type,
    v_title,
    v_responder_name || ' ' || v_action || ' your suggestion to ' || NEW.suggestion_type || ' ' || COALESCE(v_asset_symbol, 'an asset') || ' in "' || COALESCE(v_list_name, 'a list') || '"',
    'list',
    NEW.list_id,
    jsonb_build_object(
      'suggestion_id', NEW.id,
      'list_id', NEW.list_id,
      'list_name', v_list_name,
      'asset_id', NEW.asset_id,
      'asset_symbol', v_asset_symbol,
      'suggestion_type', NEW.suggestion_type,
      'responded_by', NEW.target_user_id,
      'responder_name', v_responder_name,
      'response_notes', NEW.response_notes
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS list_suggestion_response_notification ON asset_list_suggestions;
CREATE TRIGGER list_suggestion_response_notification
  AFTER UPDATE ON asset_list_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION notify_list_suggestion_response();

-- ============================================================================
-- 5. DB trigger: list collaboration notifications
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_list_collaboration()
RETURNS TRIGGER AS $$
DECLARE
  v_inviter_name text;
  v_list_name text;
  v_permission text;
BEGIN
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_inviter_name
  FROM users WHERE id = NEW.invited_by;

  SELECT name INTO v_list_name
  FROM asset_lists WHERE id = NEW.list_id;

  v_permission := CASE NEW.permission
    WHEN 'admin' THEN 'Admin'
    WHEN 'write' THEN 'Write'
    ELSE 'Read'
  END;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.user_id,
    'list_collaboration',
    'List Shared With You',
    COALESCE(v_inviter_name, 'Someone') || ' shared the list "' || COALESCE(v_list_name, 'Untitled') || '" with you (' || v_permission || ' access)',
    'list',
    NEW.list_id,
    jsonb_build_object(
      'list_id', NEW.list_id,
      'list_name', v_list_name,
      'invited_by', NEW.invited_by,
      'inviter_name', v_inviter_name,
      'permission', NEW.permission
    ),
    false
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS list_collaboration_notification ON asset_list_collaborations;
CREATE TRIGGER list_collaboration_notification
  AFTER INSERT ON asset_list_collaborations
  FOR EACH ROW
  EXECUTE FUNCTION notify_list_collaboration();

-- ============================================================================
-- 6. DB trigger: new message notifications (non-mention)
--    Notifies all other participants in the conversation
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_name text;
  v_conversation_name text;
  v_is_group boolean;
  v_participant record;
BEGIN
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_sender_name
  FROM users WHERE id = NEW.user_id;

  SELECT name, is_group INTO v_conversation_name, v_is_group
  FROM conversations WHERE id = NEW.conversation_id;

  -- For each participant (except the sender), create a notification
  FOR v_participant IN
    SELECT cp.user_id
    FROM conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.user_id != NEW.user_id
  LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      v_participant.user_id,
      'new_message',
      CASE WHEN v_is_group AND v_conversation_name IS NOT NULL
        THEN 'New message in ' || v_conversation_name
        ELSE 'New message from ' || COALESCE(v_sender_name, 'Someone')
      END,
      COALESCE(v_sender_name, 'Someone') || ': ' || LEFT(NEW.content, 150),
      'conversation',
      NEW.conversation_id,
      jsonb_build_object(
        'conversation_id', NEW.conversation_id,
        'message_id', NEW.id,
        'sender_id', NEW.user_id,
        'sender_name', v_sender_name,
        'is_group', v_is_group,
        'conversation_name', v_conversation_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS new_message_notification ON conversation_messages;
CREATE TRIGGER new_message_notification
  AFTER INSERT ON conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();

-- ============================================================================
-- 7. Scheduled-ready function for price target expiry
--    Can be called via pg_cron or a Supabase edge function on a schedule
-- ============================================================================
CREATE OR REPLACE FUNCTION process_all_expired_price_targets()
RETURNS integer AS $$
DECLARE
  v_count integer := 0;
  v_target record;
BEGIN
  FOR v_target IN
    SELECT
      pt.id,
      pt.user_id,
      pt.asset_id,
      a.company_name AS asset_name,
      a.symbol AS asset_symbol,
      pt.scenario_name,
      pt.target_price,
      pt.target_date
    FROM price_targets pt
    JOIN assets a ON a.id = pt.asset_id
    WHERE pt.target_date < CURRENT_DATE
      AND pt.is_expired IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.type = 'price_target_expired'
          AND n.user_id = pt.user_id
          AND n.context_data->>'price_target_id' = pt.id::text
      )
  LOOP
    -- Mark as expired
    UPDATE price_targets SET is_expired = true WHERE id = v_target.id;

    -- Create notification
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      v_target.user_id,
      'price_target_expired',
      'Price Target Expired',
      'Your ' || COALESCE(v_target.scenario_name, 'price target') || ' for ' || v_target.asset_symbol || ' ($' || v_target.target_price || ') has expired',
      'price_target',
      v_target.asset_id,
      jsonb_build_object(
        'price_target_id', v_target.id,
        'asset_id', v_target.asset_id,
        'asset_name', v_target.asset_name,
        'asset_symbol', v_target.asset_symbol,
        'scenario_name', v_target.scenario_name,
        'target_price', v_target.target_price,
        'target_date', v_target.target_date
      ),
      false
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. DB trigger: trade idea created notifications
--    Notifies users who cover the asset AND are on the same portfolio team
--    (excluding the creator)
-- ============================================================================
CREATE OR REPLACE FUNCTION notify_trade_idea_created()
RETURNS TRIGGER AS $$
DECLARE
  v_creator_name text;
  v_asset_symbol text;
  v_asset_name text;
  v_action text;
  v_portfolio_name text;
  v_notify_user record;
BEGIN
  -- Only notify for non-null asset_id and portfolio_id
  IF NEW.asset_id IS NULL OR NEW.portfolio_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_creator_name
  FROM users WHERE id = NEW.created_by;

  SELECT symbol, company_name INTO v_asset_symbol, v_asset_name
  FROM assets WHERE id = NEW.asset_id;

  SELECT name INTO v_portfolio_name
  FROM portfolios WHERE id = NEW.portfolio_id;

  v_action := UPPER(COALESCE(NEW.action, 'TRADE'));

  -- Notify users who BOTH cover this asset AND are on the portfolio team
  FOR v_notify_user IN
    SELECT DISTINCT c.user_id
    FROM coverage c
    INNER JOIN portfolio_team pt ON pt.user_id = c.user_id AND pt.portfolio_id = NEW.portfolio_id
    WHERE c.asset_id = NEW.asset_id
      AND c.user_id != NEW.created_by
  LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      v_notify_user.user_id,
      'trade_idea_created',
      'New Trade Idea: ' || v_action || ' ' || COALESCE(v_asset_symbol, 'Unknown'),
      COALESCE(v_creator_name, 'Someone') || ' created a ' || LOWER(v_action) || ' idea for ' || COALESCE(v_asset_symbol, 'an asset') || ' in ' || COALESCE(v_portfolio_name, 'a portfolio'),
      'asset',
      NEW.asset_id,
      jsonb_build_object(
        'trade_idea_id', NEW.id,
        'asset_id', NEW.asset_id,
        'asset_symbol', v_asset_symbol,
        'asset_name', v_asset_name,
        'action', NEW.action,
        'portfolio_id', NEW.portfolio_id,
        'portfolio_name', v_portfolio_name,
        'created_by', NEW.created_by,
        'creator_name', v_creator_name,
        'rationale', LEFT(NEW.rationale, 200)
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trade_idea_created_notification ON trade_queue_items;
CREATE TRIGGER trade_idea_created_notification
  AFTER INSERT ON trade_queue_items
  FOR EACH ROW
  EXECUTE FUNCTION notify_trade_idea_created();
