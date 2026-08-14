import { describe, it, expect } from 'vitest'
import {
  assetsPath,
  orgOfAssetsPath,
  isOrgScopedAssetsPath,
  MissingOrgScopeError,
} from './asset-paths'

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
const ASSET = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

describe('assetsPath', () => {
  it('puts the org first — that segment is the tenant boundary', () => {
    expect(assetsPath(ORG, 'models', ASSET, 'f.xlsx')).toBe(`${ORG}/models/${ASSET}/f.xlsx`)
  })

  it('refuses to build a path without an org', () => {
    // Uploading to an unscoped path would succeed and then be unreadable
    // under the org-prefix policy, so this has to fail loudly at the source.
    expect(() => assetsPath(null, 'models', ASSET)).toThrow(MissingOrgScopeError)
    expect(() => assetsPath(undefined, 'models')).toThrow(MissingOrgScopeError)
    expect(() => assetsPath('', 'models')).toThrow(MissingOrgScopeError)
  })

  it('keeps a user-supplied filename from escaping into extra nesting', () => {
    // DecisionItemCard interpolates file.name straight into the path.
    expect(assetsPath(ORG, 'attachments', 'a/b.pdf')).toBe(`${ORG}/attachments/a_b.pdf`)
    expect(assetsPath(ORG, 'attachments', 'a\\b.pdf')).toBe(`${ORG}/attachments/a_b.pdf`)
  })

  it('drops empty segments rather than emitting a double slash', () => {
    expect(assetsPath(ORG, 'models', '', 'f.xlsx')).toBe(`${ORG}/models/f.xlsx`)
  })

  it('accepts the numeric segments call sites pass (Date.now())', () => {
    expect(assetsPath(ORG, 'models', 1755123456)).toBe(`${ORG}/models/1755123456`)
  })
})

describe('orgOfAssetsPath / isOrgScopedAssetsPath', () => {
  it('reads the org back off a scoped path', () => {
    expect(orgOfAssetsPath(assetsPath(ORG, 'models', 'f.xlsx'))).toBe(ORG)
    expect(isOrgScopedAssetsPath(`${ORG}/models/f.xlsx`)).toBe(true)
  })

  it('rejects every legacy literal prefix', () => {
    for (const legacy of [
      'models/x/f.xlsx',
      'documents/x/f.pdf',
      'references/x/f.pdf',
      'notes/x/f.xlsx',
      'attachments/note/x/f.png',
      'model-templates/x/f.xlsx',
    ]) {
      expect(isOrgScopedAssetsPath(legacy)).toBe(false)
      expect(orgOfAssetsPath(legacy)).toBeNull()
    }
  })

  it('cannot distinguish legacy checklist evidence by shape alone', () => {
    // `<assetId>/<workflowId>/<stageId>/<itemId>/<file>` also starts with a
    // uuid, so this predicate reports true for it. That is why the backfill
    // resolves ownership through the referencing table rather than trusting
    // the path — asserted here so the limitation is not rediscovered later.
    expect(isOrgScopedAssetsPath(`${ASSET}/wf/stage/item/f.pdf`)).toBe(true)
    expect(orgOfAssetsPath(`${ASSET}/wf/stage/item/f.pdf`)).toBe(ASSET)
  })
})
