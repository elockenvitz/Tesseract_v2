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
import { join, resolve, relative, sep } from 'node:path'

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
/* The curated asset set, so the asset half of the system-default block can
   be checked against the list itself rather than against a copy of it. */
import { SYSTEM_DEFAULT_FIELD_SLUGS } from '../layout-resolver'

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

  it('is how the hooks name their tables, not a parallel list of them', () => {
    /* REWRITTEN, not deleted.
     *
     * This used to grep the hooks for each of the descriptor's five table
     * names and require a bare `.from('user_asset_layout_selections')` to be
     * present. That was the right assertion while the descriptor was a
     * DESCRIPTION of literals living elsewhere -- it caught a descriptor
     * that had drifted from the queries.
     *
     * Those literals are now gone: the hooks read
     * `.from(S.tables.selections)`, which is the whole point of the subject
     * layer, so the old assertion fails BECAUSE the work it was guarding
     * landed. Keeping it would have meant keeping one literal per table
     * purely to satisfy it.
     *
     * The invariant that still matters, and is stronger, is the inverse: no
     * bare literal for a subject-specific table may reappear in these hooks,
     * because a single one is a query the theme page would send at an asset
     * table. The next test ("leaves no subject-specific table out of the
     * descriptor") is what catches a table that is read but unaccounted for.
     */
    /* Scoped to the file that IS parameterized.
     *
     * `useResearchFields.ts` is only partly subject-aware, and deliberately:
     * `createField` and `deleteField` follow the subject, while
     * `useResearchSections` and `useUserResearchLayout` are asset-only
     * because `team_research_fields`, `research_field_viewers`,
     * `research_field_access_requests` and `add_field_from_preset()` have no
     * theme twin in production. Those two hooks therefore still name
     * `research_sections` as a literal, correctly. Asserting over both files
     * would force either a false failure here or a fake parameterization
     * there. */
    const parameterized = stripComments(
      readFileSync(join(srcRoot, 'hooks/useUserAssetPagePreferences.ts'), 'utf8')
    )
    const read = tableNamesIn(parameterized)
    for (const name of [d.tables.sections, d.tables.fields, d.tables.layouts,
                        d.tables.selections, d.tables.layoutCollaborations]) {
      expect(
        read,
        `${name} is named as a literal again; it must come from the descriptor`
      ).not.toContain(name)
    }

    // And they are reached through the descriptor rather than by some third
    // route, so "no literal" cannot be satisfied by the query being deleted.
    for (const prop of ['tables.sections', 'tables.fields', 'tables.layouts',
                        'tables.selections', 'tables.layoutCollaborations']) {
      expect(parameterized, `nothing reads S.${prop}`).toContain(`S.${prop}`)
    }
  })

  it('names every PostgREST embed, because a wrong one is a 400 on everything', () => {
    /* An unknown embedded relation is HTTP 400 on the WHOLE request, not an
       empty embed, so one literal embed left behind does not degrade the
       theme page, it blanks it. That exact mistake shipped once on
       `theme_contributions_v2`.
       An embed also names a FOREIGN KEY CONSTRAINT, and those names are not
       derivable from the table names, which is why they are spelled out per
       subject rather than composed. */
    /* `useAffectedAssets` is excluded, and is asset-only by its nature
       rather than by omission: it answers "which assets would this template
       change", selecting `symbol` and `company_name` off `assets`. A theme
       equivalent would be a different question against a different table, so
       it keeps its asset literals. Everything BEFORE it is parameterized. */
    const whole = stripComments(
      readFileSync(join(srcRoot, 'hooks/useUserAssetPagePreferences.ts'), 'utf8')
    )
    const affectedAt = whole.indexOf('export function useAffectedAssets')
    expect(affectedAt, 'useAffectedAssets moved; this exclusion is now wrong')
      .toBeGreaterThan(-1)
    const parameterized = whole.slice(0, affectedAt)

    for (const embed of ['embeds.selectionLayout', 'embeds.fieldSection',
                         'embeds.collaborationLayout']) {
      expect(parameterized, `nothing reads S.${embed}`).toContain(`S.${embed}`)
    }
    // No hard-coded FK constraint name may survive in the parameterized file.
    expect(parameterized, 'a literal FK embed is back')
      .not.toMatch(/user_asset_layout_selections_layout_id_fkey/)
    expect(parameterized, 'a literal FK embed is back')
      .not.toMatch(/layout_collaborations_layout_id_fkey/)
    expect(parameterized, 'the catalogue embeds the asset section table by name')
      .not.toMatch(/research_sections!inner/)
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

/*
 * What is on the page when nothing says otherwise, per subject.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * `resolveLayout` read one shared constant for this: eight curated slugs in
 * `SYSTEM_DEFAULT_FIELD_SLUGS`. A curated slug list is ASSET vocabulary.
 * The theme catalogue slugs its risks field `risks`; the asset list spells
 * the same idea `risks_to_thesis`. So every theme page resolved
 * "Risks to Thesis" as INVISIBLE -- measured live, two of three fields
 * rendered -- while the field stayed in `theme_research_fields` and stayed
 * offered by the customizer. Nothing threw and nothing logged.
 *
 * These assertions are behavioural: they call the predicates rather than
 * reading source, because the defect was a wrong ANSWER, not a missing
 * call. Each was confirmed to fail with its fix reverted.
 */
describe('the system default is the subject’s answer, not one shared list', () => {
  const asset = ASSET_RESEARCH_SUBJECT.isInSystemDefault
  const theme = THEME_RESEARCH_SUBJECT.isInSystemDefault

  it('keeps the asset answer exactly as the curated list had it', () => {
    for (const slug of SYSTEM_DEFAULT_FIELD_SLUGS) {
      expect(asset({ slug }), `${slug} is on the asset default`).toBe(true)
    }
    // And nothing else is, which is the half that makes it curated.
    expect(asset({ slug: 'scorecard' })).toBe(false)
    expect(asset({ slug: 'risks' })).toBe(false)
  })

  it('does not consult is_system on an asset, where the list is the rule', () => {
    /* An asset catalogue holds system fields that are deliberately OFF the
       default page, so answering by `is_system` there would put them back. */
    expect(asset({ slug: 'scorecard', is_system: true })).toBe(false)
  })

  it('puts a theme’s risks field on the page, which is the bug', () => {
    /* The three seeded theme fields, by their real slugs. `risks` is the
       one the asset list cannot name. */
    expect(theme({ slug: 'thesis', is_system: true })).toBe(true)
    expect(theme({ slug: 'where_different', is_system: true })).toBe(true)
    expect(theme({ slug: 'risks', is_system: true })).toBe(true)
  })

  it('answers a theme by is_system rather than by a slug list', () => {
    /*
     * The anti-regression. A theme slug list would pass the test above and
     * still be the same trap: the next theme system field would be added to
     * the catalogue, render nowhere, and appear in the customizer. So a
     * slug this test has never heard of must be on the default when it is a
     * system field, and off it when it is not.
     */
    expect(theme({ slug: 'a-slug-nobody-has-authored-yet', is_system: true })).toBe(true)
    expect(theme({ slug: 'thesis', is_system: false })).toBe(false)
    /* Absent, not false: a field row that did not select the column must
       not be treated as a system field. */
    expect(theme({ slug: 'thesis' })).toBe(false)
  })

  it('is what the resolver is actually handed, not merely available', () => {
    /* The predicate existing on the descriptor is worth nothing if the
       query layer keeps reading the constant. Checked at the source. */
    const HOOK = readFileSync(
      join(process.cwd(), 'src/hooks/useUserAssetPagePreferences.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(HOOK).toContain('isInSystemDefault: S.isInSystemDefault')
    expect(HOOK).not.toContain('SYSTEM_DEFAULT_FIELD_SLUGS')
  })
})

/*
 * The ratchet on the defect class, not on the one instance of it.
 *
 * Fixing `resolveLayout` fixed the field that was hidden. It did not stop
 * the NEXT subject-generic module from importing the same asset-shaped
 * constant and failing the same silent way -- and silent is the whole
 * problem: a curated slug list applied to the other subject's vocabulary
 * neither throws nor logs, it just answers wrong.
 *
 * So the importers are an allowlist. Three modules may read it:
 *
 *   layout-resolver.ts   declares it, and uses it only as the DEFAULT when
 *                        a caller supplies no predicate
 *   subject.ts           hands it to the asset descriptor, which is the one
 *                        subject whose answer it is
 *   default-layout.ts    builds the asset Default TEMPLATE. Asset-only by
 *                        construction: both its importers
 *                        (`ResearchFieldsManager`, the mobile layout
 *                        editor) take no `ResearchSubject` and query
 *                        `research_fields` directly.
 *
 * A fourth importer is either a subject-generic site -- the bug again -- or
 * a new asset-only surface, in which case add it here WITH the reason it is
 * asset-only. Reading this constant from a module that also serves themes
 * is the defect, and the allowlist is the only place that distinction is
 * written down.
 */
describe('the curated asset slug list stays inside asset vocabulary', () => {
  const ALLOWED = new Set([
    'src/lib/research/layout-resolver.ts',
    'src/lib/research/subject.ts',
    'src/lib/research/default-layout.ts',
    /*
     * The Default-template editor. Asset-only the same way: it takes no
     * `ResearchSubject` and selects `research_fields` directly, and it
     * reads the list to mark which catalogue rows the Default template
     * ships with.
     */
    'src/components/templates/ResearchFieldsManager.tsx',
  ])

  /* Tests may reference it freely: asserting on a constant is not applying
     it to a subject. */
  const isTest = (p: string) =>
    p.includes('__tests__') || /\.(test|spec)\.tsx?$/.test(p)

  /*
   * `__tests__` is skipped at the DIRECTORY, and a test file before it is
   * read. Filtering after the read cost this gate a timeout: the first
   * version read every file under `src` and then threw most of them away,
   * which runs in 2s alone and over 5s under full-suite load -- the same
   * failure `holdings-parity.test.ts` already shows. The result is
   * identical; only the work is smaller.
   */
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const full = join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full)
      if (!/\.tsx?$/.test(e.name)) return []
      return isTest(e.name) ? [] : [full]
    })

  /* Still a whole-tree read, so it gets a budget rather than the 5s
     default: timing out is indistinguishable from the gate passing. */
  it('is imported only by the modules that are allowed to apply it', { timeout: 30_000 }, () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .map(full => ({
        rel: relative(process.cwd(), full).split(sep).join('/'),
        /*
         * Comments stripped FIRST. The note recording that this import was
         * removed sits inside the import's own braces in
         * `useUserAssetPagePreferences.ts`, so brace-scoping alone still
         * read the record of the fix as the defect.
         */
        src: readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, ''),
      }))
      /*
       * The import, not a mention: the comments left where it USED to be
       * read are the record of this fix and must not fail it.
       *
       * Scoped to ONE import statement's braces, which cannot contain `}`.
       * A looser `import[\s\S]*?SYSTEM_DEFAULT...[\s\S]*?from` spans the
       * whole file -- it matched `useUserAssetPagePreferences.ts`, whose
       * only mention is the comment recording that the import is gone.
       */
      .filter(f => /import\s*\{[^}]*\bSYSTEM_DEFAULT_FIELD_SLUGS\b[^}]*\}\s*from/.test(f.src))
      .map(f => f.rel)
      .filter(rel => !ALLOWED.has(rel))

    expect(
      offenders,
      'a new module imports the curated ASSET slug list. If it serves both '
        + 'subjects, use ResearchSubjectDescriptor.isInSystemDefault instead: '
        + 'the theme catalogue slugs its risks field `risks`, so the list '
        + 'silently hides it. If the module is asset-only, add it to ALLOWED '
        + 'with the reason.',
    ).toEqual([])
  })

  it('is not what the shared resolver reaches for on its own', () => {
    /* The default exists so an asset caller need not pass a predicate. It
       must stay a DEFAULT: a resolver that ignores the input is the bug
       with the seam built and unused. */
    const RESOLVER = readFileSync(
      join(process.cwd(), 'src/lib/research/layout-resolver.ts'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(RESOLVER).toMatch(
      /input\.isInSystemDefault \?\? \(f => SYSTEM_DEFAULT_FIELD_SLUGS\.has\(f\.slug\)\)/,
    )
    /* And exactly once, so no other branch of the resolver consults it. */
    expect(RESOLVER.match(/SYSTEM_DEFAULT_FIELD_SLUGS\.has/g)).toHaveLength(1)
  })
})
