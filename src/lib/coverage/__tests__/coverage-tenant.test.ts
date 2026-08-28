import { describe, expect, it } from 'vitest'
import {
  NO_COVERAGE_TENANT_MESSAGE,
  resolveCoverageTenant,
  stampCoverageTenant,
} from '../coverage-tenant'

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

describe('resolveCoverageTenant', () => {
  it('resolves a real organization', () => {
    expect(resolveCoverageTenant(ORG_A)).toEqual({ ok: true, organizationId: ORG_A })
  })

  /**
   * `currentOrgId` is typed `string | null`, but an empty string is what a
   * stale cache or half-initialised context produces — and it is not an
   * organization. Treating it as one would write a row whose tenant is `''`.
   */
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('refuses %s', (_label, value) => {
    expect(resolveCoverageTenant(value as any)).toEqual({
      ok: false,
      reason: 'no_organization',
    })
  })

  it('has a message, so no refusal can reach a user unexplained', () => {
    expect(NO_COVERAGE_TENANT_MESSAGE).toBeTruthy()
  })
})

describe('stampCoverageTenant', () => {
  it('adds the organization to every record', () => {
    const stamped = stampCoverageTenant(ORG_A, [{ a: 1 }, { a: 2 }, { a: 3 }])

    expect(stamped).toEqual([
      { a: 1, organization_id: ORG_A },
      { a: 2, organization_id: ORG_A },
      { a: 3, organization_id: ORG_A },
    ])
  })

  it('preserves every existing field', () => {
    const [stamped] = stampCoverageTenant(ORG_A, [
      { asset_id: 'x', notes: null, end_date: '2026-01-01', nested: { keep: true } },
    ])

    expect(stamped).toMatchObject({
      asset_id: 'x',
      notes: null,
      end_date: '2026-01-01',
      nested: { keep: true },
      organization_id: ORG_A,
    })
  })

  /**
   * The stamp is applied last in the spread. Nothing supplies its own
   * organization today; this is what keeps that from mattering if something
   * ever does — notably a CSV, which is user-supplied content.
   */
  it('overrides an organization_id already present on the record', () => {
    const [stamped] = stampCoverageTenant(ORG_A, [
      { asset_id: 'x', organization_id: ORG_B } as any,
    ])

    expect(stamped.organization_id).toBe(ORG_A)
  })

  it('does not mutate the input records', () => {
    const input = [{ asset_id: 'x' }]
    stampCoverageTenant(ORG_A, input)

    expect(input[0]).not.toHaveProperty('organization_id')
  })

  it('maps an empty list to an empty list', () => {
    expect(stampCoverageTenant(ORG_A, [])).toEqual([])
  })
})
