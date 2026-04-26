-- Fix the bug class where `<table>.organization_id` is NOT NULL but
-- the FK to organizations was declared `ON DELETE SET NULL`. When the
-- org is deleted, the cascade tries `UPDATE <table> SET
-- organization_id = NULL`, which violates the NOT NULL check and
-- aborts the whole org delete (this is what made deleting Octopus
-- Capital silently fail once seeded workflows existed). Switch these
-- to ON DELETE CASCADE so the child rows go with the org — they're
-- org-scoped data, useless without an org.

DO $$
DECLARE
  v_tables text[] := ARRAY[
    'custom_notebooks',
    'themes',
    'conversations',
    'workflows',
    'projects',
    'allocation_periods',
    'target_date_funds',
    'calendar_events',
    'coverage_roles',
    'text_templates',
    'case_templates',
    'captures',
    'topics',
    'bug_reports'
  ];
  v_table text;
  v_constraint_name text;
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    SELECT con.conname
    INTO v_constraint_name
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = 'public.organizations'::regclass
      AND con.conrelid = ('public.' || v_table)::regclass
    LIMIT 1;

    IF v_constraint_name IS NULL THEN
      RAISE NOTICE 'No org FK found on %; skipping', v_table;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      v_table, v_constraint_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE',
      v_table, v_constraint_name
    );
  END LOOP;
END $$;
