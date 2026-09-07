-- ============================================================
-- The holdings event ledger, and snapshots that can be trusted as history
-- ============================================================
--
-- The working book answers "what is held". It cannot answer "how did it get
-- that way", "what did it look like in April", or "who changed this and on
-- whose authority" — and a book you cannot answer those about is not a book
-- a desk can be audited on.
--
-- Three things are added, in the order they depend on each other:
--
--   1. portfolio_holdings_events   an immutable, append-only ledger of every
--                                  position-changing event
--   2. snapshot revisions          so a restated day is recorded rather than
--                                  overwritten
--   3. valuation provenance        so a historical market value can be
--                                  reproduced rather than re-derived from
--                                  today's prices
--
-- ── Why a new table, and not portfolio_trade_events ───────────────────────
--
-- portfolio_trade_events already carries portfolio, asset, quantity before /
-- after / delta and links to decisions. It looks like the ledger and must not
-- become one, because it is a WORKFLOW object: it has `status`
-- (pending_rationale → draft_rationale → complete → reviewed), `updated_by`
-- and `updated_at`, and the Decision Accountability surface exists to edit
-- it. A ledger that anything may edit is not a ledger.
--
-- It is also trade-shaped. Reconciliation adds, removes and restatements are
-- position-changing events with no trade behind them, and they have nowhere
-- to go in a table whose vocabulary is initiate/add/trim/exit.
--
-- So they coexist with different jobs: this ledger is the system of record
-- for how the book changed; portfolio_trade_events stays the workflow overlay
-- that attaches rationale and decisions to the subset of changes a PM has to
-- explain. Deriving the second from the first is a later, separate change.
--
-- ── What is deliberately NOT here ─────────────────────────────────────────
--
-- No historical rows in portfolio_holdings. That table stays one live row per
-- (portfolio_id, asset_id); putting versions back into it is what the whole
-- working-book lane existed to undo.
-- ============================================================

-- ============================================================
-- 1. The ledger
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio_holdings_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy is derived from the portfolio by trigger, never accepted from a
  -- caller — the same rule the positions table already follows.
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  portfolio_id      UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  -- No ON DELETE SET NULL: an event that cannot say which asset moved is not
  -- an event. Assets are not deleted in this product; they are lifecycled.
  asset_id          UUID NOT NULL REFERENCES assets(id),

  -- What happened to the position.
  event_type        TEXT NOT NULL CHECK (event_type IN (
                      'trade',
                      'reconcile_add',      -- present in the incoming book, absent from ours
                      'reconcile_remove',   -- absent from the incoming book, present in ours
                      'reconcile_change',   -- present in both, different size
                      'manual_correction',
                      'corporate_action'    -- reserved; nothing writes it yet
                    )),

  -- What operation produced it. `event_type` is the shape of the change;
  -- `source` is where the authority came from, and the two are independent —
  -- a reconcile_change can arrive from an upload, an API sync or an SFTP feed.
  source            TEXT NOT NULL CHECK (source IN (
                      'trade', 'upload', 'api_sync', 'sftp_sync',
                      'onboarding', 'reconciliation', 'manual'
                    )),

  -- The position, stated in full. `shares_delta` is null where the event
  -- states an absolute end position rather than an increment — a custodian
  -- file says what is held, not what moved — and before/after are ALWAYS
  -- present so no reader has to reconstruct one from the other.
  shares_before     NUMERIC NOT NULL,
  shares_delta      NUMERIC,
  shares_after      NUMERIC NOT NULL,
  price             NUMERIC,

  -- Two different times, and conflating them is how a late-arriving custodian
  -- file silently rewrites a week. `effective_at` is when the change is true
  -- in the book's own timeline; `recorded_at` is when this system learned it.
  effective_at      DATE NOT NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Provenance. Which trade, which ingested book, which grouped commit.
  --
  -- NO ACTION rather than SET NULL, and the distinction is the whole point:
  -- SET NULL is an UPDATE, and an append-only table cannot accept one. It
  -- would also be a lie — a trade that moved the book cannot stop having
  -- moved it because someone deleted the trade. NO ACTION (checked at the end
  -- of the statement, unlike RESTRICT) blocks that deletion while still
  -- letting a whole portfolio cascade away, which is the one case where
  -- removing the history is correct.
  accepted_trade_id UUID REFERENCES accepted_trades(id),
  snapshot_id       UUID REFERENCES portfolio_holdings_snapshots(id),
  batch_id          UUID,
  -- Deliberately NOT a foreign key. This records who acted, at the time they
  -- acted. Following a later change to the users table — a deletion, a merge —
  -- would restate the record of an act that did happen.
  actor_id          UUID,

  -- Replay identity.
  --
  -- Separate from `id` on purpose: `id` is which ROW this is, this is which
  -- REAL-WORLD EVENT it records. A retried trade and a re-sent custodian file
  -- must not double-write, and the unique constraint is what makes that a
  -- guarantee rather than a convention. Shapes:
  --
  --   trade:<accepted_trade_id>
  --   reconcile:<snapshot_id>:<asset_id>
  --   correction:<corrects_event_id>
  idempotency_key   TEXT NOT NULL,

  -- A correction does not erase what it corrects. Both rows stay, and the
  -- link is what lets a reader show the restatement rather than a rewrite.
  corrects_event_id UUID REFERENCES portfolio_holdings_events(id),

  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT portfolio_holdings_events_idempotency_key UNIQUE (idempotency_key),

  -- The arithmetic has to hold, or the ledger is decoration. Checked here
  -- rather than trusted from the writer, because a ledger nobody can verify
  -- against itself is not evidence.
  CONSTRAINT portfolio_holdings_events_arithmetic CHECK (
    shares_delta IS NULL OR shares_after = shares_before + shares_delta
  ),
  CONSTRAINT portfolio_holdings_events_non_negative CHECK (
    shares_before >= 0 AND shares_after >= 0
  ),
  -- A remove ends at nothing; an add starts from nothing. Stating those as
  -- constraints stops a mislabelled event from entering the record at all.
  CONSTRAINT portfolio_holdings_events_shape CHECK (
    (event_type <> 'reconcile_remove' OR shares_after = 0)
    AND (event_type <> 'reconcile_add' OR shares_before = 0)
  )
);

COMMENT ON TABLE portfolio_holdings_events IS
  'Immutable, append-only record of every change to a portfolio''s working '
  'book. The system of record for how the book got to its current state. '
  'Never updated, never deleted — a correction is a new row pointing at the '
  'one it restates.';

CREATE INDEX IF NOT EXISTS idx_holdings_events_book
  ON portfolio_holdings_events (portfolio_id, asset_id, effective_at DESC, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_events_org
  ON portfolio_holdings_events (organization_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_events_trade
  ON portfolio_holdings_events (accepted_trade_id) WHERE accepted_trade_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_holdings_events_snapshot
  ON portfolio_holdings_events (snapshot_id) WHERE snapshot_id IS NOT NULL;

-- ── Tenancy, derived ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_holdings_event_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM portfolios WHERE id = NEW.portfolio_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'portfolio % has no organization', NEW.portfolio_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_holdings_event_org_id ON portfolio_holdings_events;
CREATE TRIGGER trg_enforce_holdings_event_org_id
  BEFORE INSERT ON portfolio_holdings_events
  FOR EACH ROW EXECUTE FUNCTION enforce_holdings_event_org_id();

-- ── Immutability, enforced twice ──────────────────────────────────────────
--
-- RLS grants no UPDATE or DELETE, which stops the application. A trigger
-- stops everything else, including service_role and the SQL editor, which RLS
-- does not. Only one of those is a real guarantee and it is the trigger; the
-- absent policies are there so the intent is visible where people look first.
-- ── One exception, and only one: the tenant going away ────────────────────
--
-- The FKs cascade from portfolios, so purging a portfolio — offboarding, a
-- data-subject request, an onboarding portfolio removed before it was ever
-- used — would otherwise be blocked forever by its own history. A ledger row
-- has no meaning without the book it describes, so it goes with it.
--
-- A cascade is distinguishable from an edit without guessing: Postgres
-- deletes the parent first, so inside the cascade the portfolio is already
-- gone. Any DELETE issued while the portfolio still exists is somebody
-- editing the record, and that is what this refuses.
CREATE OR REPLACE FUNCTION guard_holdings_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM portfolios WHERE id = OLD.portfolio_id)
  THEN
    RETURN OLD;  -- cascading from a portfolio that no longer exists
  END IF;

  RAISE EXCEPTION
    'portfolio_holdings_events is append-only: % is not permitted. Record a correcting row instead.',
    TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE OR REPLACE FUNCTION forbid_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Positions belong to a snapshot; the same cascade reasoning applies.
  IF TG_OP = 'DELETE'
     AND TG_TABLE_NAME = 'portfolio_holdings_positions'
     AND NOT EXISTS (SELECT 1 FROM portfolio_holdings_snapshots WHERE id = OLD.snapshot_id)
  THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    '% is append-only: % is not permitted. Record a correcting row instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_holdings_events_append_only ON portfolio_holdings_events;
CREATE TRIGGER trg_holdings_events_append_only
  BEFORE UPDATE OR DELETE ON portfolio_holdings_events
  FOR EACH ROW EXECUTE FUNCTION guard_holdings_event_mutation();

ALTER TABLE portfolio_holdings_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Holdings events: org members can read" ON portfolio_holdings_events;
CREATE POLICY "Holdings events: org members can read"
  ON portfolio_holdings_events FOR SELECT TO authenticated
  USING (organization_id = current_org_id() OR is_platform_admin());

-- No INSERT policy either. Events are written by the book operations, which
-- are SECURITY DEFINER and already gate on can_write_portfolio_book(). A
-- direct client insert would be an event nobody authorised.

-- ============================================================
-- 2. Snapshots become restatable rather than overwritable
-- ============================================================
--
-- UNIQUE (portfolio_id, snapshot_date) forced the only way to record a
-- corrected file for a day already loaded: overwrite the day. The API
-- function and the SFTP sync both did exactly that — upsert the snapshot,
-- delete its positions, insert the new ones — so the original was gone and
-- nothing recorded that a restatement had happened.
--
-- Revisions replace that. The original stays, marked superseded and pointing
-- at what replaced it. The partial unique index keeps the old invariant where
-- it mattered: still exactly one CURRENT snapshot per portfolio per day.
ALTER TABLE portfolio_holdings_snapshots
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by_id UUID REFERENCES portfolio_holdings_snapshots(id),
  -- The currency the totals on this row are expressed in. Stored on the
  -- snapshot, not read from the portfolio, so a historical valuation does not
  -- change meaning when a portfolio is later re-denominated.
  ADD COLUMN IF NOT EXISTS base_currency TEXT NOT NULL DEFAULT 'USD';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'portfolio_holdings_snapshots_portfolio_id_snapshot_date_key') THEN
    ALTER TABLE portfolio_holdings_snapshots
      DROP CONSTRAINT portfolio_holdings_snapshots_portfolio_id_snapshot_date_key;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_snapshots_revision
  ON portfolio_holdings_snapshots (portfolio_id, snapshot_date, revision);

-- One CURRENT book per portfolio per day. A reader that forgets to filter
-- superseded rows still cannot see two live snapshots for one date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_holdings_snapshots_current_day
  ON portfolio_holdings_snapshots (portfolio_id, snapshot_date)
  WHERE superseded_at IS NULL;

-- `source` gains the values the new mechanisms use.
--
-- ONE vocabulary from here on: the same words the book operations already use
-- for `p_source`, plus `eod_close` for the daily close. A snapshot written by
-- an upload now says `upload`, not `manual_upload`, because two spellings for
-- one thing is how a reader ends up filtering on the wrong one.
--
-- The three legacy values are retained ONLY so the 30 rows already in
-- production stay valid. Nothing writes them any more.
DO $$
BEGIN
  ALTER TABLE portfolio_holdings_snapshots DROP CONSTRAINT IF EXISTS portfolio_holdings_snapshots_source_check;
  ALTER TABLE portfolio_holdings_snapshots ADD CONSTRAINT portfolio_holdings_snapshots_source_check
    CHECK (source IN (
      -- current
      'upload', 'api_sync', 'sftp_sync', 'onboarding', 'reconciliation', 'eod_close',
      -- legacy, existing rows only
      'manual_upload', 'custodian_feed', 'carry_forward'
    ));
END;
$$;

COMMENT ON COLUMN portfolio_holdings_snapshots.revision IS
  'Restatement counter within a (portfolio, snapshot_date). Revision 1 is the '
  'first book recorded for that day; a corrected file supersedes it rather '
  'than overwriting it.';
COMMENT ON COLUMN portfolio_holdings_snapshots.superseded_at IS
  'Set when a later revision replaced this one. NULL means this is the book '
  'of record for its date — the reader''s filter.';

-- ============================================================
-- 3. Valuation provenance on positions
-- ============================================================
--
-- What must be STORED is anything that cannot be recovered later. The price
-- struck at the time and the FX rate applied to it are both gone by tomorrow,
-- so a market value recomputed from today's data answers a different question
-- from the one the snapshot was taken to answer.
--
-- `weight_pct` stays stored for the same reason, and it is not a duplicate of
-- a derivable number: it is the weight AS THE BOOK WAS STRUCK, and a later
-- change to how this product defines weight must not silently restate three
-- years of history. Anything a reader wants in today's terms is derived at
-- read time from the working book, never by rewriting a snapshot.
ALTER TABLE portfolio_holdings_positions
  ADD COLUMN IF NOT EXISTS currency TEXT,
  ADD COLUMN IF NOT EXISTS fx_rate_to_base NUMERIC,
  -- Kept even though it is on the snapshot too: joining every position row to
  -- its parent to learn what currency it is denominated in is how a valuation
  -- query gets written wrong.
  ADD COLUMN IF NOT EXISTS base_currency TEXT;

COMMENT ON COLUMN portfolio_holdings_positions.fx_rate_to_base IS
  'Rate applied to convert this position''s native currency into the '
  'snapshot''s base currency, as of the snapshot. Stored because it is not '
  'recoverable afterwards. NULL means the position was already in base.';
COMMENT ON COLUMN portfolio_holdings_positions.market_value IS
  'Value in the snapshot''s base currency, as struck. Historical fact, not a '
  'derived figure — never recompute it from current prices.';

-- ── Snapshots and their positions are immutable too ───────────────────────
--
-- Except for the supersede stamp, which is metadata ABOUT a snapshot rather
-- than a restatement of its contents: the book it recorded is unchanged, and
-- what changes is only that a later book replaced it.
CREATE OR REPLACE FUNCTION forbid_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Same single exception as the ledger: a portfolio being purged takes its
    -- history with it, and inside that cascade the parent is already gone.
    IF NOT EXISTS (SELECT 1 FROM portfolios WHERE id = OLD.portfolio_id) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION
      'portfolio_holdings_snapshots is immutable: supersede the snapshot instead of deleting it'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (NEW.portfolio_id, NEW.snapshot_date, NEW.revision, NEW.source,
      NEW.total_market_value, NEW.total_positions, NEW.base_currency)
     IS DISTINCT FROM
     (OLD.portfolio_id, OLD.snapshot_date, OLD.revision, OLD.source,
      OLD.total_market_value, OLD.total_positions, OLD.base_currency)
  THEN
    RAISE EXCEPTION
      'portfolio_holdings_snapshots is immutable: record a new revision instead of editing %',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_holdings_snapshots_immutable ON portfolio_holdings_snapshots;
CREATE TRIGGER trg_holdings_snapshots_immutable
  BEFORE UPDATE OR DELETE ON portfolio_holdings_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_snapshot_mutation();

DROP TRIGGER IF EXISTS trg_holdings_positions_immutable ON portfolio_holdings_positions;
CREATE TRIGGER trg_holdings_positions_immutable
  BEFORE UPDATE OR DELETE ON portfolio_holdings_positions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

-- The accepted-trade path used to upsert into the newest snapshot's positions
-- in place, which is why the one artifact that looked like history was not.
-- That writer is already gone; this makes its return impossible rather than
-- merely unlikely.

-- ============================================================
-- 4. Backfill: what the existing rows become
-- ============================================================
--
-- Every existing snapshot is revision 1 and not superseded, which the column
-- defaults already give. Positions get their base currency stamped so a
-- valuation query does not have to special-case rows written before this
-- migration; USD is the only currency this product has ever booked in, and
-- recording that explicitly is better than leaving it unstated.
UPDATE portfolio_holdings_positions
   SET base_currency = 'USD'
 WHERE base_currency IS NULL;

UPDATE portfolio_holdings_positions p
   SET currency = COALESCE(a.currency, 'USD')
  FROM assets a
 WHERE a.id = p.asset_id
   AND p.currency IS NULL;

-- No ledger backfill.
--
-- The ledger records what changed and on whose authority. For everything
-- before this migration that information does not exist: the working book was
-- overwritten in place, and 28 superseded rows in
-- portfolio_holdings_superseded are all that survives of its history.
-- Manufacturing events from them would put invented provenance into the one
-- table whose entire value is that it was not invented. The ledger starts
-- empty and starts being true.
