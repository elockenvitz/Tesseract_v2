-- Fix enforce_org_not_archived to handle tables without organization_id column.
--
-- Problem: the trigger is attached to tables like org_chart_node_members that
-- lack an organization_id column. Accessing NEW.organization_id crashes with
-- "record new has no field organization_id".
--
-- Fix: use to_jsonb(NEW) ->> 'organization_id' which returns NULL for missing
-- fields instead of raising an error. This works on ANY table.

CREATE OR REPLACE FUNCTION public.enforce_org_not_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
BEGIN
  -- Bypass during org deletion (privileged operation)
  IF current_setting('app.executing_org_deletion', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Extract organization_id dynamically via JSONB — returns NULL if column
  -- does not exist on this table, instead of raising an error.
  IF TG_OP = 'DELETE' THEN
    v_org_id := (to_jsonb(OLD) ->> 'organization_id')::uuid;
  ELSE
    v_org_id := (to_jsonb(NEW) ->> 'organization_id')::uuid;
  END IF;

  IF v_org_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF is_org_archived(v_org_id) THEN
    RAISE EXCEPTION 'Organization is archived. No modifications allowed.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
