#!/usr/bin/env bash
#
# Working-book concurrency proofs.
#
# Two overlapping transactions cannot be expressed inside a plpgsql DO block,
# so the races that 20260908100000 fixes are driven from two real psql
# sessions instead. This is the script that found them, kept so the proofs can
# be re-run rather than believed.
#
# NOT part of `npm run guard`: it needs a throwaway Postgres it may write to
# and two concurrent connections, and each case deliberately sleeps inside a
# transaction. Run it against a scratch cluster or a shadow database, never
# against production.
#
#   PGHOST=127.0.0.1 PGPORT=54333 PGUSER=postgres PGDATABASE=postgres \
#     bash scripts/holdings-book-concurrency.sh
#
# Expects the fixture tables and the working-book migrations to be present.
# The four cases and their measured before/after values are documented in the
# migration header.

set -u

PSQL="psql -q -v ON_ERROR_STOP=1 -t -A"
FAIL=0

BOOK="${BOOK:-}"
AAPL="${AAPL:-}"
MSFT="${MSFT:-}"
NVDA="${NVDA:-}"

if [ -z "$BOOK" ]; then
  BOOK=$($PSQL -c "SELECT id FROM portfolios ORDER BY created_at NULLS LAST LIMIT 1" 2>/dev/null \
       || $PSQL -c "SELECT id FROM portfolios LIMIT 1")
fi
if [ -z "$AAPL" ]; then
  AAPL=$($PSQL -c "SELECT id FROM assets ORDER BY symbol LIMIT 1")
  MSFT=$($PSQL -c "SELECT id FROM assets WHERE id <> '$AAPL' ORDER BY symbol LIMIT 1")
  NVDA=$($PSQL -c "SELECT id FROM assets WHERE id NOT IN ('$AAPL','$MSFT') ORDER BY symbol LIMIT 1")
fi

if [ -z "$BOOK" ] || [ -z "$NVDA" ]; then
  echo "SKIP: needs a portfolio and three assets in the target database"
  exit 0
fi

echo "book=$BOOK"
echo

reset_book() { $PSQL -c "DELETE FROM portfolio_holdings WHERE portfolio_id='$BOOK'" >/dev/null; }
as_server()  { echo "SET test.role='service_role';"; }

check() { # name expected actual
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 — expected [$2], got [$3]"
    FAIL=$((FAIL + 1))
  fi
}

# ---------------------------------------------------------------------------
# 1. Two delta trades OPENING the same position.
#
# Before the advisory lock this was a silent lost update: FOR UPDATE locks
# nothing when there is no row, both transactions read zero, and the second
# ON CONFLICT DO UPDATE overwrote the first with its own total. Both reported
# applied=true. Measured 100 where 200 was correct.
# ---------------------------------------------------------------------------
reset_book
{ as_server; echo "BEGIN; SELECT apply_trade_to_book('$BOOK','$AAPL',NULL,100,10); SELECT pg_sleep(2); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
{ as_server; echo "SELECT pg_sleep(0.5); BEGIN; SELECT apply_trade_to_book('$BOOK','$AAPL',NULL,100,10); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
wait
GOT=$($PSQL -c "SELECT coalesce(max(shares)::text,'none') FROM portfolio_holdings WHERE portfolio_id='$BOOK' AND asset_id='$AAPL'")
check "two trades opening one position compose" "200" "$GOT"

# ---------------------------------------------------------------------------
# 2. Two delta trades on an EXISTING position.
#
# Already correct before the fix — FOR UPDATE blocks and READ COMMITTED
# re-reads the committed row — and asserted so the lock cannot regress it.
# ---------------------------------------------------------------------------
reset_book
$PSQL -c "SET test.role='service_role'; SELECT apply_trade_to_book('$BOOK','$AAPL',1000,NULL,10)" >/dev/null
{ as_server; echo "BEGIN; SELECT apply_trade_to_book('$BOOK','$AAPL',NULL,100,10); SELECT pg_sleep(2); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
{ as_server; echo "SELECT pg_sleep(0.5); BEGIN; SELECT apply_trade_to_book('$BOOK','$AAPL',NULL,100,10); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
wait
GOT=$($PSQL -c "SELECT coalesce(max(shares)::text,'none') FROM portfolio_holdings WHERE portfolio_id='$BOOK' AND asset_id='$AAPL'")
check "two trades on a live position compose" "1200" "$GOT"

# ---------------------------------------------------------------------------
# 3. Two complete reconciles at once.
#
# The clearest defect of the four. Each says "this is the whole book"; each
# DELETE ran against a snapshot taken before the other's inserts existed, so
# they MERGED. Measured AAPL+MSFT where exactly one book was correct.
# ---------------------------------------------------------------------------
reset_book
{ as_server; echo "BEGIN; SELECT reconcile_portfolio_book('$BOOK', jsonb_build_array(jsonb_build_object('asset_id','$AAPL','shares',111,'price',10,'cost',10)), current_date,'upload'); SELECT pg_sleep(2); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
{ as_server; echo "SELECT pg_sleep(0.5); BEGIN; SELECT reconcile_portfolio_book('$BOOK', jsonb_build_array(jsonb_build_object('asset_id','$MSFT','shares',222,'price',10,'cost',10)), current_date,'upload'); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
wait
GOT=$($PSQL -c "SELECT count(*) FROM portfolio_holdings WHERE portfolio_id='$BOOK'")
check "concurrent complete reconciles do not merge" "1" "$GOT"

# ---------------------------------------------------------------------------
# 4. The lock actually blocks.
#
# Without this the three cases above could pass by scheduling luck. A trade
# arriving 0.5s into a 2s reconcile must WAIT for it, not race it.
# ---------------------------------------------------------------------------
reset_book
$PSQL -c "SET test.role='service_role'; SELECT reconcile_portfolio_book('$BOOK', jsonb_build_array(jsonb_build_object('asset_id','$AAPL','shares',1000,'price',10,'cost',10)), current_date,'upload')" >/dev/null
{ as_server; echo "BEGIN; SELECT reconcile_portfolio_book('$BOOK', jsonb_build_array(jsonb_build_object('asset_id','$AAPL','shares',1000,'price',10,'cost',10)), current_date,'upload'); SELECT pg_sleep(2); COMMIT;"; } | $PSQL >/dev/null 2>&1 &
sleep 0.5
WAITED=$( { as_server; echo "SELECT clock_timestamp() AS t \\gset
BEGIN; SELECT apply_trade_to_book('$BOOK','$NVDA',NULL,300,5); COMMIT;
SELECT CASE WHEN clock_timestamp() - :'t' > interval '0.8 second' THEN 'blocked' ELSE 'raced' END;"; } | $PSQL | tail -1)
wait
check "a trade waits for an in-flight reconcile" "blocked" "$WAITED"

echo
if [ "$FAIL" -gt 0 ]; then
  echo "=== $FAIL concurrency invariant(s) FAILED"
  exit 1
fi
echo "=== all concurrency invariants hold"
