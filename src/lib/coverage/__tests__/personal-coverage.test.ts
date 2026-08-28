import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A recording PostgREST stand-in, so the tests can assert the things that
 * matter about these queries: that reads and writes are scoped to one user in
 * one organization and one lane, that the owner is never taken from an
 * argument, and that "stop covering" retires rather than deletes.
 */
interface Call {
  table: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filters: Record<string, unknown>
  payload?: Record<string, unknown>
}

const calls: Call[] = []
let existingRow: unknown = null
let sessionUserId: string | null = 'session-user'
let sessionError: unknown = null

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} }
  const api: any = {
    select: () => api,
    insert: (payload: Record<string, unknown>) => {
      call.op = 'insert'; call.payload = payload; calls.push(call); return api
    },
    update: (payload: Record<string, unknown>) => {
      call.op = 'update'; call.payload = payload; calls.push(call)
      return Object.assign(Promise.resolve({ error: null }), api)
    },
    delete: () => { call.op = 'delete'; calls.push(call); return api },
    eq: (col: string, val: unknown) => { call.filters[col] = val; return api },
    order: () => { if (call.op === 'select') calls.push(call); return Promise.resolve({ data: [], error: null }) },
    maybeSingle: () => { if (call.op === 'select') calls.push(call); return Promise.resolve({ data: existingRow, error: null }) },
    single: () => Promise.resolve({ data: { id: 'new-row' }, error: null }),
  }
  return api
}

vi.mock('../../supabase', () => ({
  supabase: {
    from: (t: string) => builder(t),
    auth: {
      getUser: () => Promise.resolve({
        data: { user: sessionUserId ? { id: sessionUserId } : null },
        error: sessionError,
      }),
    },
  },
}))

import {
  addPersonalCoverage,
  coverageAnalystName,
  fetchMyCoverage,
  NoSessionError,
  NoTenantError,
  removePersonalCoverage,
  updatePersonalCoverageNotes,
} from '../personal-coverage'

const ORG = 'org-1'

beforeEach(() => {
  calls.length = 0
  existingRow = null
  sessionUserId = 'session-user'
  sessionError = null
})

describe('coverageAnalystName', () => {
  it('prefers a full name, falls back to the email local part', () => {
    expect(coverageAnalystName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace')
    expect(coverageAnalystName({ email: 'ada@example.com' })).toBe('ada')
    expect(coverageAnalystName(null)).toBe('Unknown')
  })
})

describe('the owner comes from the session, never from an argument', () => {
  /**
   * The single most important property of this module. There is no signature
   * through which a caller can assign coverage to somebody else — not by
   * mistake, and not by passing a value that came from a list of colleagues.
   */
  it('uses the session user as the owner on insert', async () => {
    sessionUserId = 'the-real-user'
    await addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' })

    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).toMatchObject({ user_id: 'the-real-user' })
  })

  it.each([
    ['fetch', () => fetchMyCoverage(ORG)],
    ['remove', () => removePersonalCoverage(ORG, 'a1')],
    ['setNotes', () => updatePersonalCoverageNotes(ORG, 'a1', 'x')],
  ])('scopes %s to the session user', async (_label, run) => {
    sessionUserId = 'the-real-user'
    await run()
    expect(calls.every(c => c.filters.user_id === 'the-real-user')).toBe(true)
  })

  it('refuses every write when there is no session', async () => {
    sessionUserId = null
    await expect(addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' }))
      .rejects.toBeInstanceOf(NoSessionError)
    await expect(removePersonalCoverage(ORG, 'a1')).rejects.toBeInstanceOf(NoSessionError)
    await expect(updatePersonalCoverageNotes(ORG, 'a1', 'x')).rejects.toBeInstanceOf(NoSessionError)
    expect(calls.filter(c => c.op !== 'select')).toHaveLength(0)
  })
})

describe('the tenant is required and fails closed', () => {
  it.each([['null', null], ['undefined', undefined], ['empty string', '']])(
    'refuses writes when the organization is %s', async (_l, org) => {
      await expect(addPersonalCoverage({ organizationId: org as any, assetId: 'a1', analystName: 'Ada' }))
        .rejects.toBeInstanceOf(NoTenantError)
      await expect(removePersonalCoverage(org as any, 'a1')).rejects.toBeInstanceOf(NoTenantError)
      expect(calls).toHaveLength(0)
    })

  /**
   * A read with no organization is an empty result, not an error. There is
   * nothing unsafe about it and a surface that throws while the org context is
   * still resolving would flash an error on every cold load.
   */
  it('returns nothing rather than throwing on a read with no organization', async () => {
    await expect(fetchMyCoverage(null)).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('fetchMyCoverage', () => {
  it('scopes the read to one user in one organization', async () => {
    await fetchMyCoverage(ORG)
    expect(calls[0].filters).toMatchObject({
      user_id: 'session-user', organization_id: ORG, is_active: true,
    })
  })

  /**
   * Both lanes. A user invited into an already-configured team arrives with
   * org-assigned rows and no personal ones; filtering to the personal lane
   * would report them as covering nothing.
   */
  it('does not filter by lane, so assigned coverage is visible too', async () => {
    await fetchMyCoverage(ORG)
    expect(calls[0].filters).not.toHaveProperty('coverage_scope')
  })
})

describe('addPersonalCoverage', () => {
  it('writes the personal lane, for the session user, in the given org', async () => {
    await addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' })
    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).toMatchObject({
      asset_id: 'a1', user_id: 'session-user', organization_id: ORG,
      coverage_scope: 'personal', is_active: true,
    })
  })

  /**
   * A personal row carries no organizational authority. A CHECK constraint and
   * the RLS WITH CHECK both enforce this; sending the fields at all would mean
   * the client believed it could set them.
   */
  it('never sends team authority fields', async () => {
    await addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' })
    const insert = calls.find(c => c.op === 'insert')!
    expect(insert.payload).not.toHaveProperty('team_id')
    expect(insert.payload).not.toHaveProperty('is_lead')
  })

  it('returns the existing row instead of duplicating it', async () => {
    existingRow = { id: 'already-there' }
    const row = await addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' })
    expect(row).toEqual({ id: 'already-there' })
    expect(calls.some(c => c.op === 'insert')).toBe(false)
  })

  it('looks for the duplicate within the personal lane only', async () => {
    await addPersonalCoverage({ organizationId: ORG, assetId: 'a1', analystName: 'Ada' })
    expect(calls[0].filters).toMatchObject({ coverage_scope: 'personal', is_active: true })
  })
})

describe('removePersonalCoverage', () => {
  /**
   * Retire, never delete. "I stopped following this in March" is information; a
   * DELETE throws away the date range and leaves a history row that cannot say
   * when coverage ran from.
   */
  it('retires the row rather than deleting it', async () => {
    await removePersonalCoverage(ORG, 'a1')
    const call = calls.find(c => c.op === 'update')!
    expect(call.payload).toMatchObject({ is_active: false })
    expect(call.payload!.end_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(calls.some(c => c.op === 'delete')).toBe(false)
  })

  it('only ever targets the personal lane', async () => {
    await removePersonalCoverage(ORG, 'a1')
    expect(calls.find(c => c.op === 'update')!.filters).toMatchObject({
      user_id: 'session-user', organization_id: ORG, coverage_scope: 'personal',
    })
  })
})

describe('updatePersonalCoverageNotes', () => {
  /**
   * Notes only. The fields that decide what a row MEANS — asset, owner,
   * organization, lane — are not editable through this module. Offering an
   * update that could change them would invite a caller to try.
   */
  it('sends only the notes field', async () => {
    await updatePersonalCoverageNotes(ORG, 'a1', 'watching into print')
    const call = calls.find(c => c.op === 'update')!
    expect(Object.keys(call.payload!)).toEqual(['notes'])
  })

  it('scopes the write to the personal lane and the session user', async () => {
    await updatePersonalCoverageNotes(ORG, 'a1', null)
    expect(calls.find(c => c.op === 'update')!.filters).toMatchObject({
      user_id: 'session-user', organization_id: ORG,
      asset_id: 'a1', coverage_scope: 'personal',
    })
  })
})
