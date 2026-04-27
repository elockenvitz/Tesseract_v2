-- ============================================================================
-- Org admin action notifications.
--
-- Lets users know when their access changes — being added to an org,
-- promoted/demoted, suspended, deactivated, or granted/revoked
-- coverage_admin. Today these are all silent: the audit log captures them
-- but the affected user never finds out unless an admin tells them.
--
-- Recipient: ALWAYS the affected user (NEW.user_id / NEW.id).
-- Skipped:
--   · Self-actions (you don't notify yourself for editing your own
--     membership — although typical flow is admin acts on someone else)
--   · System writes (auth.uid() IS NULL — backfills, supabase admin SQL)
--   · INSERTs where the user is creating their own membership (signup)
-- ============================================================================

-- ─── 1. organization_memberships INSERT ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_org_membership_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  org_name text;
  actor_name text;
  actor_id uuid;
  status_msg text;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF actor_id = NEW.user_id THEN RETURN NEW; END IF;  -- user added themselves
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO org_name FROM organizations WHERE id = NEW.organization_id;
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor_id;

  status_msg := CASE NEW.status
    WHEN 'active'  THEN ' added you to'
    WHEN 'invited' THEN ' invited you to'
    WHEN 'pending' THEN ' invited you to'
    ELSE ' added you to'
  END;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.user_id,
    'org_membership_added',
    'Added to ' || COALESCE(org_name, 'organization'),
    COALESCE(actor_name, 'An admin') || status_msg || ' "' || COALESCE(org_name, 'an organization') || '"' ||
      CASE WHEN NEW.is_org_admin THEN ' as an organization admin' ELSE '' END,
    'organization',
    NEW.organization_id,
    jsonb_build_object(
      'organization_id', NEW.organization_id,
      'organization_name', org_name,
      'role', NEW.role,
      'is_org_admin', NEW.is_org_admin,
      'status', NEW.status,
      'added_by', actor_id,
      'added_by_name', actor_name
    ),
    false
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS org_membership_added_notification ON public.organization_memberships;
CREATE TRIGGER org_membership_added_notification
  AFTER INSERT ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.notify_org_membership_added();

-- ─── 2. organization_memberships UPDATE — role / status / suspension ─────
-- One trigger handles all three signals because they're frequently
-- correlated (suspending also flips status). Each check is independent so
-- a single UPDATE that changes multiple fields can emit multiple notifs
-- — that's intentional: the user wants to know about each.
CREATE OR REPLACE FUNCTION public.notify_org_membership_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor_id   uuid;
  actor_name text;
  org_name   text;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF actor_id = NEW.user_id THEN RETURN NEW; END IF;
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  SELECT name INTO org_name FROM organizations WHERE id = NEW.organization_id;
  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor_id;

  -- Role / admin flag change. role and is_org_admin are kept in sync by
  -- sync_role_and_is_org_admin so checking either covers it; we report on
  -- is_org_admin since that's the one users care about.
  IF OLD.is_org_admin IS DISTINCT FROM NEW.is_org_admin THEN
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      NEW.user_id,
      'org_role_changed',
      CASE WHEN NEW.is_org_admin THEN 'You are now an org admin'
                                  ELSE 'Your org admin access was removed' END,
      COALESCE(actor_name, 'An admin') ||
        CASE WHEN NEW.is_org_admin
          THEN ' made you an admin of "' || COALESCE(org_name, 'the organization') || '"'
          ELSE ' removed your admin access on "' || COALESCE(org_name, 'the organization') || '"' END,
      'organization',
      NEW.organization_id,
      jsonb_build_object(
        'organization_id',   NEW.organization_id,
        'organization_name', org_name,
        'old_is_org_admin',  OLD.is_org_admin,
        'new_is_org_admin',  NEW.is_org_admin,
        'old_role',          OLD.role,
        'new_role',          NEW.role,
        'changed_by',        actor_id,
        'changed_by_name',   actor_name
      ),
      false
    );
  END IF;

  -- Status change (e.g., active ↔ inactive). Suspensions usually flip
  -- status to 'inactive', so this catches the bulk of access revocations.
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      NEW.user_id,
      'org_membership_status',
      'Your access to ' || COALESCE(org_name, 'the organization') || ' is now ' || NEW.status,
      COALESCE(actor_name, 'An admin') || ' changed your membership status from ' ||
        OLD.status || ' to ' || NEW.status || ' on "' || COALESCE(org_name, 'the organization') || '"',
      'organization',
      NEW.organization_id,
      jsonb_build_object(
        'organization_id',   NEW.organization_id,
        'organization_name', org_name,
        'old_status',        OLD.status,
        'new_status',        NEW.status,
        'changed_by',        actor_id,
        'changed_by_name',   actor_name
      ),
      false
    );
  END IF;

  -- Explicit suspension flip (some flows set suspended_at without
  -- changing status — covers both cases).
  IF (OLD.suspended_at IS NULL) IS DISTINCT FROM (NEW.suspended_at IS NULL) THEN
    INSERT INTO notifications (
      user_id, type, title, message, context_type, context_id, context_data, is_read
    ) VALUES (
      NEW.user_id,
      'org_membership_status',
      CASE WHEN NEW.suspended_at IS NOT NULL
        THEN 'Your access to ' || COALESCE(org_name, 'the organization') || ' has been suspended'
        ELSE 'Your access to ' || COALESCE(org_name, 'the organization') || ' has been restored' END,
      COALESCE(actor_name, 'An admin') ||
        CASE WHEN NEW.suspended_at IS NOT NULL
          THEN ' suspended your access' ||
               CASE WHEN NEW.suspension_reason IS NOT NULL
                 THEN ': "' || LEFT(NEW.suspension_reason, 120) || '"'
                 ELSE '' END
          ELSE ' restored your access' END,
      'organization',
      NEW.organization_id,
      jsonb_build_object(
        'organization_id',   NEW.organization_id,
        'organization_name', org_name,
        'suspended',         NEW.suspended_at IS NOT NULL,
        'suspension_reason', NEW.suspension_reason,
        'changed_by',        actor_id,
        'changed_by_name',   actor_name
      ),
      false
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS org_membership_changed_notification ON public.organization_memberships;
CREATE TRIGGER org_membership_changed_notification
  AFTER UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.notify_org_membership_changed();

-- ─── 3. users.coverage_admin flip ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_user_coverage_admin_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  actor_id   uuid;
  actor_name text;
BEGIN
  IF OLD.coverage_admin IS NOT DISTINCT FROM NEW.coverage_admin THEN RETURN NEW; END IF;

  actor_id := auth.uid();
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF actor_id = NEW.id THEN RETURN NEW; END IF;

  SELECT COALESCE(first_name || ' ' || last_name, email) INTO actor_name
  FROM users WHERE id = actor_id;

  INSERT INTO notifications (
    user_id, type, title, message, context_type, context_id, context_data, is_read
  ) VALUES (
    NEW.id,
    'coverage_admin_changed',
    CASE WHEN NEW.coverage_admin THEN 'You are now a coverage admin'
                                   ELSE 'Your coverage admin access was removed' END,
    COALESCE(actor_name, 'An admin') ||
      CASE WHEN NEW.coverage_admin
        THEN ' granted you coverage admin permissions'
        ELSE ' removed your coverage admin permissions' END,
    'user',
    NEW.id,
    jsonb_build_object(
      'old_coverage_admin', OLD.coverage_admin,
      'new_coverage_admin', NEW.coverage_admin,
      'changed_by',         actor_id,
      'changed_by_name',    actor_name
    ),
    false
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_coverage_admin_changed_notification ON public.users;
CREATE TRIGGER user_coverage_admin_changed_notification
  AFTER UPDATE OF coverage_admin ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_user_coverage_admin_changed();
