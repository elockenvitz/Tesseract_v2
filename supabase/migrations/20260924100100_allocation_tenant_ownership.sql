-- Allocation: give the two tables that own nothing an organisation.
--
-- Ten tables make up the allocation domain. Eight of them carry `period_id`,
-- and `allocation_periods.organization_id` is already their tenant boundary —
-- it is derivable, and duplicating it onto each child would create a second
-- copy of the truth whose agreement with the first depends on application
-- code remembering to set it. Those tables get scoped policies in the next
-- migration instead, through their period.
--
-- Two tables have no such path:
--
--   * `asset_classes` hangs off nothing. Worse, `name` is globally UNIQUE, so
--     one firm's "Equities" collides with another's.
--   * `allocation_team_members` has neither a period nor an organisation, so
--     membership is currently global — a team member of one firm is a team
--     member of all 28.
--
-- Those two get a real `organization_id`.
--
-- Backfill is proven, not assumed. An asset class is assigned only if every
-- piece of allocation data referencing it resolves to exactly one
-- organisation; zero or more than one aborts the whole migration rather than
-- picking. Verified against production on 2026-09-24: 8 asset classes, each
-- resolving to exactly 1 organisation, 0 ambiguous.
--
-- Ids and foreign keys are untouched. No row is rewritten beyond gaining the
-- new column.

-- ── asset_classes ──────────────────────────────────────────────────────────

-- Wrapped in an explicit transaction. Without it, a runner that autocommits
-- per statement — `psql -f` does — leaves the added column behind when the
-- backfill guard aborts, so a migration that refuses to run has still changed
-- the schema. Postgres does DDL transactionally; the only thing missing was
-- saying so. Demonstrated by the zero-org abort case, which left a stray
-- nullable `organization_id` on `asset_classes` before this was added.
BEGIN;

ALTER TABLE asset_classes ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
DECLARE
  v_bad int;
BEGIN
  -- Every table that names an asset class, unioned, resolved through the
  -- period to an organisation. An asset class no allocation data references
  -- resolves to zero and is just as fatal as one that resolves to two: in
  -- both cases we do not know who owns it.
  CREATE TEMP TABLE _ac_owner ON COMMIT DROP AS
  WITH refs AS (
    SELECT asset_class_id, period_id FROM official_allocation_views
    UNION ALL SELECT asset_class_id, period_id FROM allocation_cell_notes
    UNION ALL SELECT asset_class_id, period_id FROM allocation_history
    UNION ALL SELECT asset_class_id, period_id FROM individual_allocation_views
    UNION ALL SELECT asset_class_id, period_id FROM allocation_votes
    UNION ALL SELECT asset_class_id, period_id FROM allocation_comments
                WHERE asset_class_id IS NOT NULL
  )
  -- `min()` has no uuid overload, so the single resolved organisation is
  -- taken out of the distinct set instead. Safe precisely because the guard
  -- below refuses to continue unless that set has exactly one member; an
  -- orphan aggregates to {NULL} and is caught by the same guard.
  SELECT ac.id AS asset_class_id,
         count(DISTINCT p.organization_id)        AS org_count,
         (array_agg(DISTINCT p.organization_id))[1] AS organization_id
  FROM asset_classes ac
  LEFT JOIN refs r         ON r.asset_class_id = ac.id
  LEFT JOIN allocation_periods p ON p.id = r.period_id
  GROUP BY ac.id;

  SELECT count(*) INTO v_bad FROM _ac_owner WHERE org_count <> 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Aborting: % asset class(es) do not resolve to exactly one organisation. '
      'Resolve ownership by hand before re-running; this migration will not guess.',
      v_bad;
  END IF;

  UPDATE asset_classes ac
     SET organization_id = o.organization_id
    FROM _ac_owner o
   WHERE o.asset_class_id = ac.id
     AND ac.organization_id IS NULL;
END $$;

DO $$
DECLARE v_null int;
BEGIN
  SELECT count(*) INTO v_null FROM asset_classes WHERE organization_id IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'Aborting: % asset class(es) still have no organisation.', v_null;
  END IF;
END $$;

ALTER TABLE asset_classes ALTER COLUMN organization_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_classes_organization_id_fkey') THEN
    ALTER TABLE asset_classes
      ADD CONSTRAINT asset_classes_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_asset_classes_organization ON asset_classes(organization_id);

-- A global unique name is itself a tenant leak: it tells one firm that another
-- already uses a name, and stops them using their own.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_classes_name_key') THEN
    ALTER TABLE asset_classes DROP CONSTRAINT asset_classes_name_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_classes_org_name_key') THEN
    ALTER TABLE asset_classes
      ADD CONSTRAINT asset_classes_org_name_key UNIQUE (organization_id, name);
  END IF;
END $$;

-- New rows land in the caller's organisation without the client being trusted
-- to say so. Same pattern already used by `allocation_periods`.
DROP TRIGGER IF EXISTS trg_stamp_org_id ON asset_classes;
CREATE TRIGGER trg_stamp_org_id
  BEFORE INSERT ON asset_classes
  FOR EACH ROW EXECUTE FUNCTION stamp_organization_id();

-- ── allocation_team_members ────────────────────────────────────────────────
-- Zero rows in production, so there is nothing to backfill and NOT NULL is
-- safe immediately.

ALTER TABLE allocation_team_members ADD COLUMN IF NOT EXISTS organization_id uuid;

DO $$
DECLARE v_null int;
BEGIN
  SELECT count(*) INTO v_null FROM allocation_team_members WHERE organization_id IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION
      'Aborting: % allocation team member row(s) predate organisation scoping '
      'and cannot be assigned automatically.', v_null;
  END IF;
END $$;

ALTER TABLE allocation_team_members ALTER COLUMN organization_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_team_members_organization_id_fkey') THEN
    ALTER TABLE allocation_team_members
      ADD CONSTRAINT allocation_team_members_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
  -- One membership row per person per organisation.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allocation_team_members_org_user_key') THEN
    ALTER TABLE allocation_team_members
      ADD CONSTRAINT allocation_team_members_org_user_key UNIQUE (organization_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_allocation_team_members_org_user
  ON allocation_team_members(organization_id, user_id) WHERE is_active;

COMMIT;
