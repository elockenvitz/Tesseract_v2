import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A minimal PostgREST stand-in.
 *
 * Records the filters and payload each call built, so the tests can assert the
 * things that actually matter about these queries — that a read is scoped to
 * one user and one organization, that a write declares the personal lane, and
 * that "stop covering" retires rather than deletes.
 */
interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filters: Record<string, unknown>
  payload?: Record<string, unknown>
}

const calls: Call[] = []
let existingRow: unknown = null
let insertedRow: unknown = { id: 'new-row' }

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }
  const api: any = {
    select: () => api,
    insert: (payload: Record<string, unknown>) => {
      call.op = 'insert'
      call.payload = payload
      calls.push(call)
      return api
    },
    update: (payload: Record<string, unknown>) => {
      call.op = 'update'
      call.payload = payload
      calls.push(call)
      return Object.assign(Promise.resolve({ error: null }), api)
    },
    eq: (col: string, val: unknown) => {
      call.filters[col] = val
      return api
    },
    order: () => {
      if (call.op === 'select') calls.push(call)
      return Promise.resolve({ data: [], error: null })
    },
    maybeSingle: () => {
      if (call.op === 'select') calls.push(call)
      return Promise.resolve({ data: existingRow, error: null })
    },
    single: () => Promise.resolve({ data: insertedRow, error: null }),
  }
  return api
}

vi.mock('../../supabase', () => ({
  supabase: { from: (table: string) => builder(table) },
}))

import {
  addPersonalCoverage,
  addPersonalCoverageBulk,
  coverageAnalystName,
  fetchMyCoverage,
  removePersonalCoverage,
} from '../personal-coverage'

const identity = { userId: 'user-1', orgId: 'org-1', analystName: 'Ada Lovelace' }

beforeEach(() => {
  calls.length = 0
  existingRow = null
  insertedRow = { id: 'new-row' }
})

describe('coverageAnalystName', () => {
  it('prefers a full name', () => {
    expect(
      coverageAnalystName({ first_name: 'Ada', last_name: 'Lovelace', email: 'a@b.c' }),
    ).toBe('Ada Lovelace')
  })

  it('falls back to the email local part', () => {
    expect(coverageAnalystName({ email: 'ada@example.com' })).toBe('ada')
  })

  it('survives a user with neither', () => {
    expect(coverageAnalystName(null)).toBe('Unknown')
    expect(coverageAnalystName({})).toBe('Unknown')
  })
})

describe('fetchMyCoverage', () => {
  /**
   * Both the user and the organization, every time. A read filtered only by
   * user would return their coverage in every workspace they belong to, which
   * is the multi-org analyst case and the exact shape the org-scope guard
   * exists to catch.
   */
  it('scopes the read to one user in one organization', async () => {
    await fetchMyCoverage({ userId: 'user-1', orgId: 'org-1' })

    expect(calls[0].filters).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      is_active: true,
    })
  })

  /**
   * Objective: a user invited into an already-configured team. They arrive with
   * org-assigned rows and no personal ones; a read filtered to the personal
   * lane would report them as having no coverage and prompt them to redo work
   * somebody already did.
   */
  it('does not filter by lane, so assigned coverage is visible too', async () => {
    await fetchMyCoverage({ userId: 'user-1', orgId: 'org-1' })

    expect(calls[0].filters).not.toHaveProperty('coverage_scope')
  })
})

describe('addPersonalCoverage', () => {
  it('writes the personal lane, for the caller, in the caller’s org', async () => {
    await addPersonalCoverage(identity, 'asset-1')

    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).toMatchObject({
      asset_id: 'asset-1',
      user_id: 'user-1',
      organization_id: 'org-1',
      coverage_scope: 'personal',
      is_active: true,
    })
  })

  /**
   * A personal row carries no organizational authority. The CHECK constraint
   * enforces this independently, but sending the fields at all would mean the
   * client believed it could set them.
   */
  it('never sends team authority fields', async () => {
    await addPersonalCoverage(identity, 'asset-1')

    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).not.toHaveProperty('team_id')
    expect(insert.payload).not.toHaveProperty('is_lead')
  })

  /**
   * `coverage` has no unique constraint on (asset_id, user_id) — historical and
   * active rows coexist by design — so double-tapping a name would otherwise
   * produce two identical active rows.
   */
  it('returns the existing row instead of duplicating it', async () => {
    existingRow = { id: 'already-there' }

    const row = await addPersonalCoverage(identity, 'asset-1')

    expect(row).toEqual({ id: 'already-there' })
    expect(calls.some(c => c.op === 'insert')).toBe(false)
  })
})

describe('removePersonalCoverage', () => {
  /**
   * Retire, never delete. "I stopped following this in March" is information; a
   * DELETE throws away the date range and leaves a history row that cannot say
   * when coverage actually ran from.
   */
  it('retires the row rather than deleting it', async () => {
    await removePersonalCoverage(identity, 'asset-1')

    const call = calls.find(c => c.op === 'update')!
    expect(call.payload).toMatchObject({ is_active: false })
    expect(call.payload!.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(calls.some(c => c.op === 'delete')).toBe(false)
  })

  /**
   * An org-assigned row naming this user is somebody else's decision. RLS would
   * reject the write anyway; filtering here means the user gets a clean no-op
   * rather than an error for an action the UI should not have offered.
   */
  it('only ever targets the personal lane', async () => {
    await removePersonalCoverage(identity, 'asset-1')

    expect(calls.find(c => c.op === 'update')!.filters).toMatchObject({
      user_id: 'user-1',
      organization_id: 'org-1',
      coverage_scope: 'personal',
    })
  })
})

describe('addPersonalCoverageBulk', () => {
  it('reports what landed and what did not', async () => {
    const result = await addPersonalCoverageBulk(identity, ['a', 'b', 'c'])
    expect(result.added).toHaveLength(3)
    expect(result.failed).toEqual([])
  })

  /**
   * A partial failure keeps the successful rows. The user asked for five names
   * and got four — rolling back to zero would be a worse answer to a worse
   * question.
   */
  it('keeps the rows that succeeded when one fails', async () => {
    let n = 0
    insertedRow = { id: 'ok' }
    const original = console.error
    console.error = () => {}
    try {
      const result = await addPersonalCoverageBulk(
        {
          ...identity,
          // Force the second insert to throw by making `analystName` a getter
          // that fails once — the simplest way to fail exactly one iteration.
          get analystName() {
            n += 1
            if (n === 2) throw new Error('insert failed')
            return 'Ada Lovelace'
          },
        } as typeof identity,
        ['a', 'b', 'c'],
      )
      expect(result.added).toHaveLength(2)
      expect(result.failed).toEqual(['b'])
    } finally {
      console.error = original
    }
  })
})
