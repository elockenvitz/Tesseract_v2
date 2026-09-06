import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The guard has to be able to fail, or it is not a guard.
 *
 * `holdings-collapse-audit.mjs` walked `.ts` and `.tsx` only. For the life of
 * that check, `position_chart_payload` computed a position's weight from a
 * newest-row numerator over a SUM across every date — the identical collapse
 * the guard exists to stop — and every run reported PASS, because a plpgsql
 * function is not a file the guard had ever opened. Moving a query into the
 * database was a way out of the check.
 *
 * Two things are pinned here, and the second is the one that matters:
 *
 *   1. The SQL pass is LIVE. A run that scans zero functions would also
 *      report PASS, and the difference between "found nothing wrong" and
 *      "looked nowhere" is the whole value of the guard.
 *
 *   2. The SQL pass still DETECTS. A real defect is written to disk, the
 *      guard is run against it, and it has to fail. A regex that has quietly
 *      stopped matching cannot survive this.
 */

const run = (): { code: number; out: string } => {
  try {
    const out = execFileSync('node', ['scripts/holdings-collapse-audit.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const FIXTURE = join(
  process.cwd(),
  'supabase/migrations/29999999999999_holdings_ratchet_fixture.sql',
)

describe('the holdings guard reads SQL', () => {
  it('passes on the tree as it stands', () => {
    const { code, out } = run()
    expect(out).toContain('PASS')
    expect(code).toBe(0)
  })

  it('actually opened the SQL, rather than finding nothing to open', () => {
    const { out } = run()
    const files = Number(out.match(/SQL files scanned\s*:\s*(\d+)/)?.[1] ?? 0)
    const fns = Number(out.match(/functions \(final definition\)\s*:\s*(\d+)/)?.[1] ?? 0)
    const reads = Number(out.match(/holdings reads in SQL\s*:\s*(\d+)/)?.[1] ?? 0)

    expect(files).toBeGreaterThan(100)
    expect(fns).toBeGreaterThan(20)
    // Production has several. Zero would mean the table-name pattern broke.
    expect(reads).toBeGreaterThan(0)
  })

  it('fails on a function that narrows the working book to one date', () => {
    // The rule inverted with the working-book migration. `date` is now
    // provenance for a single line, so a book whose AAPL moved today and
    // whose other 34 names last moved in May has 35 dates in it and all 35
    // positions are current. Filtering returns whatever was touched last.
    writeFileSync(
      FIXTURE,
      `CREATE OR REPLACE FUNCTION public.ratchet_fixture_aum(p_portfolio_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $function$
DECLARE v numeric;
BEGIN
  SELECT COALESCE(SUM(ph.shares * ph.price), 0) INTO v
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id
    AND ph.date = CURRENT_DATE;
  RETURN v;
END;
$function$;
`,
    )
    try {
      const { code, out } = run()
      expect(code).toBe(1)
      expect(out).toContain('ratchet_fixture_aum')
      expect(out).toContain('filtering the working book by date')
    } finally {
      rmSync(FIXTURE, { force: true })
    }
    expect(existsSync(FIXTURE)).toBe(false)
  })

  it('accepts the same function reading the whole book', () => {
    // No date predicate, and none needed: the unique key guarantees one row
    // per position, so this sum is the book's value.
    writeFileSync(
      FIXTURE,
      `CREATE OR REPLACE FUNCTION public.ratchet_fixture_aum(p_portfolio_id uuid)
RETURNS numeric
LANGUAGE plpgsql
AS $function$
DECLARE v numeric;
BEGIN
  SELECT COALESCE(SUM(ph.shares * ph.price), 0) INTO v
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id;
  RETURN v;
END;
$function$;
`,
    )
    try {
      const { code, out } = run()
      expect(out).toContain('PASS')
      expect(code).toBe(0)
    } finally {
      rmSync(FIXTURE, { force: true })
    }
  })

  it('still allows ordering by date, which shows when a line last moved', () => {
    writeFileSync(
      FIXTURE,
      `CREATE OR REPLACE FUNCTION public.ratchet_fixture_recent(p_portfolio_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE v uuid;
BEGIN
  SELECT ph.asset_id INTO v
  FROM portfolio_holdings ph
  WHERE ph.portfolio_id = p_portfolio_id
  ORDER BY ph.date DESC
  LIMIT 1;
  RETURN v;
END;
$function$;
`,
    )
    try {
      const { code } = run()
      expect(code).toBe(0)
    } finally {
      rmSync(FIXTURE, { force: true })
    }
  })
})
