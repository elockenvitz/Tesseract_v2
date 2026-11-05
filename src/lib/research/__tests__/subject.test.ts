/**
 * The research subject registry.
 *
 * The descriptors in `subject.ts` claim to name the tables the research
 * stack actually reads. A descriptor that is merely plausible is worse than
 * no descriptor at all: the queries would keep working against their literals
 * and the theme page would silently read the wrong rows. So the asset
 * descriptor is checked against the SOURCE of the hooks it describes, in both
 * directions, and the theme descriptor against the migration that created its
 * tables.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import {
  ASSET_RESEARCH_SUBJECT,
  THEME_RESEARCH_SUBJECT,
  RESEARCH_SUBJECTS,
  assetSubject,
  themeSubject,
  researchSubjectOf,
  subjectQueryKey,
  type ResearchSubjectDescriptor,
} from '../subject'

const srcRoot = resolve(__dirname, '../../..')

/** The hooks and libs whose literals the asset descriptor claims to describe. */
const ASSET_QUERY_SOURCES = [
  'hooks/useUserAssetPagePreferences.ts',
  'hooks/useResearchFields.ts',
].map(p => readFileSync(join(srcRoot, p), 'utf8'))

/** Commentary stripped, so prose about a table cannot satisfy an assertion. */
const stripComments = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
   .replace(/\/\*[\s\S]*?\*\//g, '')

const assetCode = ASSET_QUERY_SOURCES.map(stripComments).join('\n')

const tableNamesIn = (code: string): Set<string> => {
  const out = new Set<string>()
  for (const m of code.matchAll(/\.from\(\s*'([a-z0-9_]+)'\s*\)/g)) out.add(m[1])
  return out
}

describe('the asset descriptor describes the queries that exist', () => {
  const d = ASSET_RESEARCH_SUBJECT

  it('names tables the asset hooks really read', () => {
    const read = tableNamesIn(assetCode)
    // Only the ones the descriptor is responsible for. `users`,
    // `team_memberships` and `org_chart_node_members` are read for names and
    // membership and are the same table for both subjects, which is why they
    // are not in the descriptor.
    for (const name of [d.tables.sections, d.tables.fields, d.tables.layouts,
                        d.tables.selections, d.tables.layoutCollaborations]) {
      expect(read, `the asset hooks no longer read ${name}`).toContain(name)
    }
  })

  it('leaves no subject-specific table out of the descriptor', () => {
    /* The direction that catches a MISSED table, which is the failure mode
       that would send the theme page at an asset table. Anything the hooks
       read whose name is asset- or research-specific has to be accounted
       for, either in the descriptor or in this allow list with a reason. */
    const sharedAcrossSubjects = new Set([
      'users',                    // display names, same table for both
      'team_memberships',         // membership, same table for both
      'org_chart_node_members',   // membership, same table for both
      'organization_memberships', // membership, same table for both
      'team_research_fields',     // team grants on the asset field library;
                                  // 0 rows, and themes have no equivalent
      'research_field_viewers',   // the same, 0 rows
      'research_field_access_requests',
    ])
    const described = new Set<string>(Object.values(d.tables))
    const unexplained = [...tableNamesIn(assetCode)]
      .filter(t => !described.has(t) && !sharedAcrossSubjects.has(t))
    expect(unexplained,
      `asset research reads tables the descriptor does not account for: ${unexplained.join(', ')}`,
    ).toEqual([])
  })

  it('records that asset layouts are NOT org scoped', () => {
    /* Not a preference. `user_asset_page_layouts` has no organization column,
       which is why its org-wide sharing grant reaches any tenant. Writing
       `organization_id` to that table is an error, so the flag has to be
       readable rather than assumed. */
    expect(d.layoutsAreOrgScoped).toBe(false)
    expect(assetCode, 'the asset layout insert now sends an organization_id')
      .not.toMatch(/user_asset_page_layouts[\s\S]{0,400}?organization_id/)
  })
})

describe('the theme descriptor describes the tables that were created', () => {
  const d = THEME_RESEARCH_SUBJECT
  const migrations = (() => {
    const dir = resolve(srcRoot, '../supabase/migrations')
    return readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .map(f => readFileSync(join(dir, f), 'utf8'))
      .join('\n')
  })()

  it('names tables a migration in this repo actually creates', () => {
    for (const name of [d.tables.layouts, d.tables.selections, d.tables.layoutCollaborations]) {
      expect(migrations, `no migration creates ${name}`)
        .toMatch(new RegExp(`create table if not exists public\\.${name}\\b`))
    }
    expect(migrations, `no migration creates ${d.tables.layoutAccessFn}`)
      .toMatch(new RegExp(`function public\\.${d.tables.layoutAccessFn}\\b`))
  })

  it('records that theme layouts ARE org scoped, and the migration agrees', () => {
    expect(d.layoutsAreOrgScoped).toBe(true)
    // The column the asset table lacks, declared NOT NULL on the theme one.
    expect(migrations).toMatch(
      /create table if not exists public\.user_theme_page_layouts[\s\S]*?organization_id uuid not null/,
    )
  })

  it('ships with a cross-org isolation test, per standing rule 5', () => {
    const dir = resolve(srcRoot, '../supabase/tests')
    const names = readdirSync(dir)
    expect(names).toContain('theme-page-layouts-tenant-isolation.sql')
    const sql = readFileSync(join(dir, 'theme-page-layouts-tenant-isolation.sql'), 'utf8')
    // Cross-org READ and WRITE both denied, and the legitimate case allowed.
    expect(sql).toMatch(/cross-org read/i)
    expect(sql).toMatch(/cross-org (update|insert|delete)/i)
    // The assertion that distinguishes this from the asset tables: an
    // organization-wide grant must not reach a different tenant.
    expect(sql).toMatch(/grant does NOT reach another organization/i)
    for (const t of [d.tables.layouts, d.tables.selections, d.tables.layoutCollaborations]) {
      expect(sql, `the isolation test never touches ${t}`).toContain(t)
    }
  })
})

describe('the two subjects cannot be confused for one another', () => {
  const pairs: [keyof ResearchSubjectDescriptor['tables'], string, string][] = [
    ['sections', ASSET_RESEARCH_SUBJECT.tables.sections, THEME_RESEARCH_SUBJECT.tables.sections],
    ['fields', ASSET_RESEARCH_SUBJECT.tables.fields, THEME_RESEARCH_SUBJECT.tables.fields],
    ['contributions', ASSET_RESEARCH_SUBJECT.tables.contributions, THEME_RESEARCH_SUBJECT.tables.contributions],
    ['layouts', ASSET_RESEARCH_SUBJECT.tables.layouts, THEME_RESEARCH_SUBJECT.tables.layouts],
    ['selections', ASSET_RESEARCH_SUBJECT.tables.selections, THEME_RESEARCH_SUBJECT.tables.selections],
    ['layoutCollaborations', ASSET_RESEARCH_SUBJECT.tables.layoutCollaborations, THEME_RESEARCH_SUBJECT.tables.layoutCollaborations],
    ['layoutAccessFn', ASSET_RESEARCH_SUBJECT.tables.layoutAccessFn, THEME_RESEARCH_SUBJECT.tables.layoutAccessFn],
  ]

  it('shares no table between the two subjects', () => {
    /* Every one of these must differ. A descriptor that accidentally points
       a theme at an asset table would read another subject's rows under the
       theme's RLS, which is the worst outcome this file guards against. */
    for (const [key, a, t] of pairs) {
      expect(a, `asset and theme share a table for ${String(key)}`).not.toBe(t)
    }
  })

  it('separates the two subjects in the query cache', () => {
    expect(ASSET_RESEARCH_SUBJECT.queryKeyPrefix)
      .not.toBe(THEME_RESEARCH_SUBJECT.queryKeyPrefix)
    expect(ASSET_RESEARCH_SUBJECT.subjectColumn)
      .not.toBe(THEME_RESEARCH_SUBJECT.subjectColumn)
  })

  it('puts the prefix first in every key it builds', () => {
    /* An asset id and a theme id are both uuids. Without the prefix a key of
       ['layout-selection', id] lets one subject's cached row answer the
       other's query. */
    const sameId = 'f0f0f0f0-0000-0000-0000-000000000000'
    const a = subjectQueryKey(assetSubject(sameId), 'layout-selection')
    const t = subjectQueryKey(themeSubject(sameId), 'layout-selection')
    expect(a[0]).toBe('asset-research')
    expect(t[0]).toBe('theme-research')
    expect(a).not.toEqual(t)
  })

  it('carries extra key parts after the subject id', () => {
    expect(subjectQueryKey(themeSubject('t1'), 'fields', 'u1', 3))
      .toEqual(['theme-research', 'fields', 't1', 'u1', 3])
  })

  it('tolerates a subject with no id yet, as both pages mount', () => {
    expect(subjectQueryKey(assetSubject(undefined), 'fields'))
      .toEqual(['asset-research', 'fields', undefined])
  })
})

describe('lookup by kind', () => {
  it('resolves the two kinds', () => {
    expect(researchSubjectOf('asset')).toBe(ASSET_RESEARCH_SUBJECT)
    expect(researchSubjectOf('theme')).toBe(THEME_RESEARCH_SUBJECT)
  })

  it('returns null for junk rather than a descriptor', () => {
    expect(researchSubjectOf('portfolio')).toBeNull()
    expect(researchSubjectOf('')).toBeNull()
    expect(researchSubjectOf(null)).toBeNull()
    expect(researchSubjectOf(undefined)).toBeNull()
  })

  it('uses hasOwnProperty, not `in`', () => {
    /* `'toString' in RESEARCH_SUBJECTS` is true for every object literal, so
       an `in` check would hand back Object.prototype.toString as a
       descriptor and the first `.tables` read would throw. */
    expect(researchSubjectOf('toString')).toBeNull()
    expect(researchSubjectOf('constructor')).toBeNull()
    expect(researchSubjectOf('hasOwnProperty')).toBeNull()
  })

  it('covers every kind in the registry', () => {
    expect(Object.keys(RESEARCH_SUBJECTS).sort()).toEqual(['asset', 'theme'])
    for (const [kind, d] of Object.entries(RESEARCH_SUBJECTS)) {
      expect(d.kind, `${kind} is filed under the wrong key`).toBe(kind)
    }
  })
})
