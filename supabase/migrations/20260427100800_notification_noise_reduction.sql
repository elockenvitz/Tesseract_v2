-- ============================================================================
-- Notification noise reduction.
--
-- 1. Drop the duplicate `create_note_share_notification` trigger. Its insert
--    targets `related_id` / `related_type` columns that don't exist on
--    notifications — every fire silently fails. The working note-share
--    notification is `notify_note_sharing`. We drop the trigger and the
--    function (function is unused once trigger is gone).
--
-- 2. Add a 60-second debounce to create_asset_change_notification so a
--    single user toggling priority/stage twice in rapid succession (or
--    two coverage users editing within seconds) doesn't double-notify.
--    Uses md5 of (type, asset_id, payload) to detect duplicates within
--    the window.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_note_share_notification ON public.note_collaborations;
DROP FUNCTION IF EXISTS public.create_note_share_notification();

CREATE OR REPLACE FUNCTION public.create_asset_change_notification(
  asset_id_param        uuid,
  notification_type_param notification_type,
  title_param           text,
  message_param         text,
  context_data_param    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  notification_user RECORD;
  asset_info        RECORD;
  recent_dup        boolean;
BEGIN
  -- Defense in depth: refuse to fan out for system writes.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT symbol, company_name INTO asset_info
  FROM assets WHERE id = asset_id_param;

  FOR notification_user IN
    SELECT user_id FROM get_asset_notification_users(asset_id_param)
  LOOP
    -- 60-second debounce: skip if an identical (recipient, type, asset,
    -- payload) row was just created. Catches: same user editing twice
    -- in rapid succession, two coverage users both toggling, etc.
    SELECT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id      = notification_user.user_id
        AND n.type         = notification_type_param
        AND n.context_type = 'asset'
        AND n.context_id   = asset_id_param
        AND n.created_at   >= now() - interval '60 seconds'
        AND n.message      = message_param
    ) INTO recent_dup;

    IF recent_dup THEN
      CONTINUE;
    END IF;

    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      context_type,
      context_id,
      context_data
    ) VALUES (
      notification_user.user_id,
      notification_type_param,
      title_param,
      message_param,
      'asset',
      asset_id_param,
      context_data_param || jsonb_build_object(
        'asset_symbol', asset_info.symbol,
        'asset_name',   asset_info.company_name
      )
    );
  END LOOP;
END;
$function$;

-- Index supporting the debounce lookup (used on every asset notification).
CREATE INDEX IF NOT EXISTS idx_notifications_dedup_lookup
  ON public.notifications (user_id, type, context_id, created_at DESC)
  WHERE context_type = 'asset';
