-- ============================================================================
-- Trade-flow notification triggers.
--
-- Recipients model
-- ----------------
-- The user defined "people who worked on the idea" as:
--   · The trade idea OWNER (trade_queue_items.created_by)
--   · The CO-OWNER       (trade_queue_items.assigned_to)
--   · SUPPORTING ANALYSTS (trade_queue_items.collaborators jsonb array of user_ids)
-- An accepted_trade links to a trade idea via:
--   accepted_trade.decision_request_id → decision_request.trade_queue_item_id
-- We fan out to that team for committed trades, status changes, and comments.
--
-- Guards
-- ------
-- Every trigger:
--   · Skips system writes (auth.uid() IS NULL) — backfills must not page anyone
--   · Uses IS DISTINCT FROM on the watched fields where applicable
--   · Skips notifying the actor (you don't notify yourself of your own action)
-- ============================================================================

-- ─── Helper: idea team for a trade_queue_item ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_trade_idea_team(item_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
AS $function$
  WITH base AS (
    SELECT created_by AS user_id FROM trade_queue_items WHERE id = item_id
    UNION
    SELECT assigned_to FROM trade_queue_items WHERE id = item_id AND assigned_to IS NOT NULL
    UNION
    SELECT (jsonb_array_elements_text(collaborators))::uuid AS user_id
      FROM trade_queue_items
     WHERE id = item_id
       AND jsonb_typeof(collaborators) = 'array'
  )
  SELECT DISTINCT user_id FROM base WHERE user_id IS NOT NULL;
$function$;

-- ─── Helper: full recipient set for an accepted_trade ────────────────────
-- Returns the trade idea team (if linked), excluding `exclude_user`. The
-- portfolio team isn't included — adding a portfolio team here would notify
-- every PM/analyst on the portfolio for every routine commit, which is the
-- wrong level of signal. Trade-idea team is the right scope per the user.
CREATE OR REPLACE FUNCTION public.get_accepted_trade_recipients(at_id uuid, exclude_user uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
AS $function$
  SELECT DISTINCT t.user_id
  FROM accepted_trades at
  LEFT JOIN decision_requests dr ON dr.id = at.decision_request_id
  LEFT JOIN LATERAL get_trade_idea_team(dr.trade_queue_item_id) t ON true
  WHERE at.id = at_id
    AND t.user_id IS NOT NULL
    AND t.user_id IS DISTINCT FROM exclude_user;
$function$;

-- ============================================================================
-- 1. accepted_trades INSERT — committed trade
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_accepted_trade_committed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor       uuid;
  rec         RECORD;
  asset_sym   text;
  pf_name     text;
  actor_name  text;
BEGIN
  actor := COALESCE(NEW.accepted_by, auth.uid());
  IF actor IS NULL THEN
    RETURN NEW;  -- system write
  END IF;

  SELECT symbol INTO asset_sym FROM assets WHERE id = NEW.asset_id;
  SELECT name   INTO pf_name   FROM portfolios WHERE id = NEW.portfolio_id;
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor;

  FOR rec IN SELECT user_id FROM get_accepted_trade_recipients(NEW.id, actor) LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      rec.user_id,
      'accepted_trade_committed',
      'Trade committed: ' || COALESCE(asset_sym, 'unknown'),
      COALESCE(actor_name, 'A PM') || ' committed a ' || COALESCE(NEW.action, 'trade') ||
        ' on ' || COALESCE(asset_sym, 'an asset') ||
        CASE WHEN pf_name IS NOT NULL THEN ' for ' || pf_name ELSE '' END,
      'accepted_trade',
      NEW.id,
      jsonb_build_object(
        'accepted_trade_id', NEW.id,
        'asset_id',          NEW.asset_id,
        'asset_symbol',      asset_sym,
        'portfolio_id',      NEW.portfolio_id,
        'portfolio_name',    pf_name,
        'action',            NEW.action,
        'committed_by',      actor,
        'committed_by_name', actor_name,
        'batch_id',          NEW.batch_id
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS accepted_trade_committed_notification ON public.accepted_trades;
CREATE TRIGGER accepted_trade_committed_notification
  AFTER INSERT ON public.accepted_trades
  FOR EACH ROW EXECUTE FUNCTION public.notify_accepted_trade_committed();

-- ============================================================================
-- 2. accepted_trades UPDATE — execution_status changes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_accepted_trade_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor      uuid;
  rec        RECORD;
  asset_sym  text;
  actor_name text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.execution_status IS NOT DISTINCT FROM NEW.execution_status THEN RETURN NEW; END IF;

  actor := COALESCE(NEW.executed_by, auth.uid());
  SELECT symbol INTO asset_sym FROM assets WHERE id = NEW.asset_id;
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor;

  FOR rec IN SELECT user_id FROM get_accepted_trade_recipients(NEW.id, actor) LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      rec.user_id,
      'accepted_trade_status',
      'Trade ' || NEW.execution_status || ': ' || COALESCE(asset_sym, ''),
      COALESCE(actor_name, 'A PM') || ' marked the ' || COALESCE(asset_sym, 'trade') ||
        ' commitment as ' || NEW.execution_status,
      'accepted_trade',
      NEW.id,
      jsonb_build_object(
        'accepted_trade_id', NEW.id,
        'asset_id',          NEW.asset_id,
        'asset_symbol',      asset_sym,
        'old_status',        OLD.execution_status,
        'new_status',        NEW.execution_status,
        'changed_by',        actor,
        'changed_by_name',   actor_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS accepted_trade_status_notification ON public.accepted_trades;
CREATE TRIGGER accepted_trade_status_notification
  AFTER UPDATE ON public.accepted_trades
  FOR EACH ROW EXECUTE FUNCTION public.notify_accepted_trade_status();

-- ============================================================================
-- 3. accepted_trade_comments INSERT — comment on a committed trade
--    Recipients = idea team + everyone else who's commented on this trade,
--    minus the commenter themselves.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_accepted_trade_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  rec         RECORD;
  asset_sym   text;
  asset_id_v  uuid;
  author_name text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  SELECT a.symbol, a.id INTO asset_sym, asset_id_v
  FROM accepted_trades at
  JOIN assets a ON a.id = at.asset_id
  WHERE at.id = NEW.accepted_trade_id;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO author_name
  FROM users WHERE id = NEW.user_id;

  FOR rec IN
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM get_accepted_trade_recipients(NEW.accepted_trade_id, NEW.user_id)
      UNION
      SELECT user_id
        FROM accepted_trade_comments
       WHERE accepted_trade_id = NEW.accepted_trade_id
         AND user_id IS DISTINCT FROM NEW.user_id
    ) t
    WHERE user_id IS NOT NULL
  LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      rec.user_id,
      'accepted_trade_comment',
      'New comment on ' || COALESCE(asset_sym, 'a trade'),
      COALESCE(author_name, 'Someone') || ' commented: "' ||
        LEFT(COALESCE(NEW.content, ''), 120) || CASE WHEN length(NEW.content) > 120 THEN '…' ELSE '' END || '"',
      'accepted_trade',
      NEW.accepted_trade_id,
      jsonb_build_object(
        'accepted_trade_id', NEW.accepted_trade_id,
        'comment_id',        NEW.id,
        'asset_id',          asset_id_v,
        'asset_symbol',      asset_sym,
        'author_id',         NEW.user_id,
        'author_name',       author_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS accepted_trade_comment_notification ON public.accepted_trade_comments;
CREATE TRIGGER accepted_trade_comment_notification
  AFTER INSERT ON public.accepted_trade_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_accepted_trade_comment();

-- ============================================================================
-- 4. trade_batches UPDATE — status change (approved/rejected/etc.)
--    Recipients = batch creator + each underlying trade's idea team.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_trade_batch_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor      uuid;
  actor_name text;
  pf_name    text;
  rec        RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  actor := auth.uid();
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor;
  SELECT name INTO pf_name FROM portfolios WHERE id = NEW.portfolio_id;

  FOR rec IN
    SELECT DISTINCT t.user_id FROM (
      -- The batch creator
      SELECT NEW.created_by AS user_id WHERE NEW.created_by IS DISTINCT FROM actor
      UNION
      -- Each underlying trade's idea team
      SELECT idea.user_id
        FROM accepted_trades at
        LEFT JOIN decision_requests dr ON dr.id = at.decision_request_id
        LEFT JOIN LATERAL get_trade_idea_team(dr.trade_queue_item_id) idea ON true
       WHERE at.batch_id = NEW.id
         AND idea.user_id IS DISTINCT FROM actor
    ) t WHERE t.user_id IS NOT NULL
  LOOP
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      rec.user_id,
      'trade_batch_status',
      'Trade batch ' || NEW.status || ': ' || COALESCE(NEW.name, 'Unnamed'),
      COALESCE(actor_name, 'A PM') || ' marked batch "' || COALESCE(NEW.name, 'Unnamed') ||
        '"' || CASE WHEN pf_name IS NOT NULL THEN ' (' || pf_name || ')' ELSE '' END ||
        ' as ' || NEW.status,
      'trade_batch',
      NEW.id,
      jsonb_build_object(
        'batch_id',     NEW.id,
        'batch_name',   NEW.name,
        'portfolio_id', NEW.portfolio_id,
        'portfolio_name', pf_name,
        'old_status',   OLD.status,
        'new_status',   NEW.status,
        'changed_by',   actor,
        'changed_by_name', actor_name
      ),
      false
    );
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trade_batch_status_notification ON public.trade_batches;
CREATE TRIGGER trade_batch_status_notification
  AFTER UPDATE ON public.trade_batches
  FOR EACH ROW EXECUTE FUNCTION public.notify_trade_batch_status();

-- ============================================================================
-- 5. decision_requests UPDATE — cancelled / expired / returned
--    Acceptance + rejection are already notified client-side. This fills in
--    the silent paths so requesters always learn the outcome.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_decision_request_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor      uuid;
  actor_name text;
  asset_sym  text;
  msg        text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('cancelled','expired','returned','deferred') THEN RETURN NEW; END IF;
  IF NEW.requested_by IS NULL OR NEW.requested_by = auth.uid() THEN RETURN NEW; END IF;

  actor := auth.uid();
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor;

  SELECT a.symbol INTO asset_sym
  FROM trade_queue_items tqi
  JOIN assets a ON a.id = tqi.asset_id
  WHERE tqi.id = NEW.trade_queue_item_id;

  msg := CASE NEW.status
    WHEN 'cancelled' THEN COALESCE(actor_name, 'A PM') || ' cancelled your recommendation'
    WHEN 'expired'   THEN 'Your recommendation expired before review'
    WHEN 'returned'  THEN COALESCE(actor_name, 'A PM') || ' returned your recommendation for revisions'
    WHEN 'deferred'  THEN COALESCE(actor_name, 'A PM') || ' deferred your recommendation'
    ELSE 'Your recommendation status changed to ' || NEW.status
  END;
  IF asset_sym IS NOT NULL THEN
    msg := msg || ' on ' || asset_sym;
  END IF;
  IF NEW.decision_note IS NOT NULL AND length(NEW.decision_note) > 0 THEN
    msg := msg || ': "' || LEFT(NEW.decision_note, 100) || '"';
  END IF;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.requested_by,
    'decision_request_resolved',
    'Recommendation ' || NEW.status,
    msg,
    'trade_idea',
    NEW.trade_queue_item_id,
    jsonb_build_object(
      'decision_request_id', NEW.id,
      'trade_queue_item_id', NEW.trade_queue_item_id,
      'asset_symbol',        asset_sym,
      'old_status',          OLD.status,
      'new_status',          NEW.status,
      'changed_by',          actor,
      'changed_by_name',     actor_name,
      'decision_note',       NEW.decision_note
    ),
    false
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS decision_request_resolved_notification ON public.decision_requests;
CREATE TRIGGER decision_request_resolved_notification
  AFTER UPDATE ON public.decision_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_decision_request_resolved();

-- ============================================================================
-- 6. coverage_requests UPDATE — approved / rejected
--    The pending → admins case is already notified by notify_coverage_request.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_coverage_request_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  reviewer_name text;
  asset_sym     text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;
  IF NEW.requested_by IS NULL OR NEW.requested_by = auth.uid() THEN RETURN NEW; END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO reviewer_name
  FROM users WHERE id = COALESCE(NEW.reviewed_by, auth.uid());

  SELECT symbol INTO asset_sym FROM assets WHERE id = NEW.asset_id;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.requested_by,
    'coverage_request_resolved',
    'Coverage request ' || NEW.status || ': ' || COALESCE(asset_sym, 'asset'),
    COALESCE(reviewer_name, 'A coverage admin') || ' ' || NEW.status ||
      ' your ' || COALESCE(NEW.request_type, 'coverage') || ' request' ||
      CASE WHEN asset_sym IS NOT NULL THEN ' for ' || asset_sym ELSE '' END ||
      CASE WHEN NEW.reason IS NOT NULL AND length(NEW.reason) > 0
        THEN ': "' || LEFT(NEW.reason, 100) || '"' ELSE '' END,
    'asset',
    NEW.asset_id,
    jsonb_build_object(
      'coverage_request_id', NEW.id,
      'asset_id',            NEW.asset_id,
      'asset_symbol',        asset_sym,
      'request_type',        NEW.request_type,
      'old_status',          OLD.status,
      'new_status',          NEW.status,
      'reviewed_by',         NEW.reviewed_by,
      'reviewer_name',       reviewer_name,
      'reason',              NEW.reason
    ),
    false
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS coverage_request_resolved_notification ON public.coverage_requests;
CREATE TRIGGER coverage_request_resolved_notification
  AFTER UPDATE ON public.coverage_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_coverage_request_resolved();
