-- ============================================================================
-- Notifications hardening — layer 1 (low-risk, high-value).
--
-- Driven by the AAPL/AMZN phantom notification incident and the broader
-- audit. Five fixes:
--   1. `create_asset_change_notification` — defense-in-depth: skip when
--      auth.uid() is NULL (system writes / backfills) rather than relying
--      on every caller trigger remembering to guard. This is what would
--      have prevented the AAPL/AMZN flood at layer 2.
--   2. `notify_asset_field_changes` — same auth.uid() guard so a future
--      backfill of priority/process_stage doesn't page coverage users.
--   3. `notify_comment_mention` — skip self-mentions.
--   4. `notify_task_assignment` — skip self-assignments.
--   5. `notify_stage_assignment` — skip self-assignments.
--   6. `notify_workflow_sharing` — skip self-shares (re-adding yourself).
-- ============================================================================

-- 1. Hardened fan-out helper
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
BEGIN
  -- Defense in depth: refuse to fan out notifications for changes that
  -- have no authenticated actor. Migrations, scheduled jobs, and admin
  -- SQL should not page coverage users about opaque server-side writes.
  -- Individual triggers should also guard, but this catches anything
  -- that slips through.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT symbol, company_name INTO asset_info
  FROM assets WHERE id = asset_id_param;

  FOR notification_user IN
    SELECT user_id FROM get_asset_notification_users(asset_id_param)
  LOOP
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

-- 2. Asset field-change trigger — keep IS DISTINCT FROM guards, add the
-- auth.uid() guard so backfills can't page coverage users.
CREATE OR REPLACE FUNCTION public.notify_asset_field_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- System writes (backfills, scheduled jobs) shouldn't notify.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.priority IS DISTINCT FROM NEW.priority THEN
    PERFORM create_asset_change_notification(
      NEW.id,
      'asset_priority_change',
      'Priority Changed: ' || NEW.symbol,
      'Priority changed from ' || COALESCE(OLD.priority, 'none') || ' to ' || COALESCE(NEW.priority, 'none'),
      jsonb_build_object(
        'old_priority', OLD.priority,
        'new_priority', NEW.priority,
        'changed_by',   auth.uid()
      )
    );
  END IF;

  IF OLD.process_stage IS DISTINCT FROM NEW.process_stage THEN
    PERFORM create_asset_change_notification(
      NEW.id,
      'asset_stage_change',
      'Stage Changed: ' || NEW.symbol,
      'Stage changed from ' || COALESCE(OLD.process_stage, 'none') || ' to ' || COALESCE(NEW.process_stage, 'none'),
      jsonb_build_object(
        'old_stage',  OLD.process_stage,
        'new_stage',  NEW.process_stage,
        'changed_by', auth.uid()
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Comment mentions — skip self-mention noise
CREATE OR REPLACE FUNCTION public.notify_comment_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_mentioner_name text;
  v_asset_symbol   text;
  v_item_text      text;
BEGIN
  IF NEW.mentioned_user_id = NEW.mentioned_by THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_mentioner_name
  FROM users WHERE id = NEW.mentioned_by;

  SELECT a.symbol, ci.item_text
    INTO v_asset_symbol, v_item_text
  FROM asset_checklist_items ci
  JOIN assets a ON ci.asset_id = a.id
  WHERE ci.id = NEW.checklist_item_id;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.mentioned_user_id,
    'mention',
    'You were mentioned in a comment',
    v_mentioner_name || ' mentioned you in a comment on "' || COALESCE(v_item_text, 'checklist task') ||
      CASE WHEN v_asset_symbol IS NOT NULL THEN '" for ' || v_asset_symbol ELSE '"' END,
    'workflow',
    NEW.checklist_item_id,
    jsonb_build_object(
      'checklist_item_id', NEW.checklist_item_id,
      'mentioned_by',      NEW.mentioned_by,
      'mentioner_name',    v_mentioner_name,
      'comment_text',      NEW.comment_text,
      'asset_symbol',      v_asset_symbol,
      'item_text',         v_item_text
    ),
    false
  );

  RETURN NEW;
END;
$function$;

-- 4. Task assignment — skip self-assign
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_assigner_name  text;
  v_asset_symbol   text;
  v_asset_id       uuid;
  v_item_text      text;
  v_workflow_name  text;
  v_workflow_id    uuid;
  v_stage_id       text;
BEGIN
  IF NEW.assigned_user_id = NEW.assigned_by THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users WHERE id = NEW.assigned_by;

  SELECT a.id, a.symbol, ci.item_text, ci.workflow_id, ci.stage_id, w.name
    INTO v_asset_id, v_asset_symbol, v_item_text, v_workflow_id, v_stage_id, v_workflow_name
  FROM asset_checklist_items ci
  JOIN assets a ON ci.asset_id = a.id
  LEFT JOIN workflows w ON ci.workflow_id = w.id
  WHERE ci.id = NEW.checklist_item_id;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.assigned_user_id,
    'task_assigned',
    'New Task Assignment',
    v_assigner_name || ' assigned you to "' || COALESCE(v_item_text, 'checklist task') ||
      CASE WHEN v_asset_symbol IS NOT NULL THEN '" for ' || v_asset_symbol ELSE '"' END,
    'workflow',
    NEW.checklist_item_id,
    jsonb_build_object(
      'checklist_item_id', NEW.checklist_item_id,
      'assigned_by',       NEW.assigned_by,
      'assigner_name',     v_assigner_name,
      'asset_id',          v_asset_id,
      'asset_symbol',      v_asset_symbol,
      'item_text',         v_item_text,
      'workflow_id',       v_workflow_id,
      'workflow_name',     v_workflow_name,
      'stage_id',          v_stage_id,
      'due_date',          NEW.due_date,
      'notes',             NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$function$;

-- 5. Stage assignment — skip self-assign
CREATE OR REPLACE FUNCTION public.notify_stage_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_assigner_name text;
  v_asset_symbol  text;
  v_workflow_name text;
  v_stage_label   text;
BEGIN
  IF NEW.assigned_user_id = NEW.assigned_by THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_assigner_name
  FROM users WHERE id = NEW.assigned_by;

  SELECT a.symbol, w.name
    INTO v_asset_symbol, v_workflow_name
  FROM assets a
  LEFT JOIN workflows w ON a.workflow_id = w.id
  WHERE a.id = NEW.asset_id;

  SELECT stage_label INTO v_stage_label
  FROM workflow_stages
  WHERE workflow_id = NEW.workflow_id AND stage_key = NEW.stage_id
  LIMIT 1;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.assigned_user_id,
    'stage_assigned',
    'New Stage Assignment',
    v_assigner_name || ' assigned you to the "' || COALESCE(v_stage_label, NEW.stage_id) || '" stage' ||
      CASE WHEN v_asset_symbol IS NOT NULL THEN ' for ' || v_asset_symbol ELSE '' END,
    'workflow',
    NEW.asset_id,
    jsonb_build_object(
      'asset_id',       NEW.asset_id,
      'workflow_id',    NEW.workflow_id,
      'stage_id',       NEW.stage_id,
      'stage_label',    v_stage_label,
      'assigned_by',    NEW.assigned_by,
      'assigner_name',  v_assigner_name,
      'asset_symbol',   v_asset_symbol,
      'workflow_name',  v_workflow_name,
      'due_date',       NEW.due_date,
      'notes',          NEW.notes
    ),
    false
  );

  RETURN NEW;
END;
$function$;

-- 6. Workflow share — skip self-share (re-adding yourself)
CREATE OR REPLACE FUNCTION public.notify_workflow_sharing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_workflow_name text;
  v_inviter_name  text;
  v_permission    text;
BEGIN
  IF NEW.user_id = NEW.invited_by THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_workflow_name FROM workflows WHERE id = NEW.workflow_id;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO v_inviter_name
  FROM users WHERE id = NEW.invited_by;

  v_permission := CASE NEW.permission
    WHEN 'admin' THEN 'Admin'
    WHEN 'write' THEN 'Write'
    ELSE 'Read'
  END;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.user_id,
    'workflow_invitation',
    'Workflow Access Granted',
    v_inviter_name || ' invited you to collaborate on "' || v_workflow_name || '" with ' || v_permission || ' access',
    'workflow',
    NEW.workflow_id,
    jsonb_build_object(
      'workflow_id',   NEW.workflow_id,
      'workflow_name', v_workflow_name,
      'invited_by',    NEW.invited_by,
      'inviter_name',  v_inviter_name,
      'permission',    NEW.permission
    ),
    false
  );

  RETURN NEW;
END;
$function$;
