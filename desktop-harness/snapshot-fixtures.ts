/**
 * The props `AssetTab` hands the desktop Snapshot, as fixtures.
 *
 * Coverage and thesis status are fetched by the tab and passed down so the
 * Snapshot adds no second read of the same rows; the live quote comes from the
 * tab's `['stock-quote', symbol]` entry. None of the three is behind a hook
 * this harness can stub, so they are supplied here.
 *
 * Two covering analysts, one of whom has NOT written a thesis, and one whose
 * thesis is stale. A fixture where everyone has written something recently
 * would make the coverage strip look correct no matter what it rendered.
 */

import type { CoverageRecord, ThesisStatus } from '../src/components/coverage/CoverageDisplay'

export const SNAPSHOT_COVERAGE: CoverageRecord[] = [
  {
    id: 'cov-1',
    user_id: 'u-rivera',
    analyst_name: 'Dana Rivera',
    role: 'Lead',
    portfolio_id: null,
    portfolio: null,
    created_at: '2026-03-02T10:00:00Z',
    updated_at: '2026-10-09T10:00:00Z',
  },
  {
    id: 'cov-2',
    user_id: 'u-okafor',
    analyst_name: 'Sam Okafor',
    role: 'Analyst',
    portfolio_id: null,
    portfolio: null,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-09-30T10:00:00Z',
  },
]

export const SNAPSHOT_THESIS_STATUS: ThesisStatus[] = [
  { userId: 'u-rivera', hasThesis: true, lastUpdated: '2026-10-09T10:00:00Z', isStale: false },
  // Covering, nothing written. The case the strip must not round up.
  { userId: 'u-okafor', hasThesis: false },
]

export const SNAPSHOT_QUOTE = {
  price: 231.4,
  changePercent: -1.24,
  timestamp: '2026-10-10T20:00:00Z',
}
