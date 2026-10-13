/**
 * `project_deliverables` has no `status` column. Nothing executed may ask for
 * one.
 *
 * ── The defect this exists to prevent ────────────────────────────────────
 *
 * `useDecisionEngine` selected `id, project_id, title, due_date, completed,
 * status, created_at`. PostgREST rejects the whole request with 42703 for an
 * unknown column, and the call site destructures only `data` — so
 * `deliverables` came back null and EVERY project reported zero outstanding
 * deliverables.
 *
 * It presented as a silent empty state, not as a failure. Active Work simply
 * looked finished. That is why it survived: there is no error banner to notice
 * and no test that asserted a populated result against a real schema.
 *
 * The live path is Asset page -> AssetDecisionView -> useDecisionEngine ->
 * selectForAsset, plus useViewWarnings, useAttentionFeed, useDashboardFeed and
 * TodayPage.
 *
 * ── Why this is a source test ────────────────────────────────────────────
 *
 * A mocked-Supabase unit test cannot catch it: the mock answers whatever
 * columns it is asked for. The defect only exists in the relationship between
 * a string in the client and the real table, so the string is what gets
 * asserted. Column list confirmed against production 2026-10-09.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'

const read = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

/** The real columns, from information_schema on production. */
const REAL_COLUMNS = [
  'id', 'project_id', 'title', 'description', 'completed', 'completed_by',
  'completed_at', 'created_at', 'updated_at', 'display_order', 'due_date',
  'assigned_to', 'source_comment_id',
]

/**
 * `useGlobalDecisionEngine` carries the same bad column and is deliberately
 * NOT fixed: it is imported by nothing, so it executes never, and editing
 * unreachable code is how a focused change becomes a broad one.
 *
 * That exemption is only honest while the file really is unreachable, so the
 * last test here asserts exactly that. Import it and this suite fails, which
 * is the point — the exemption cannot outlive the condition it rests on.
 */
const UNREACHABLE = 'hooks/useGlobalDecisionEngine.ts'

/** Modules that query project_deliverables and DO run. */
const EXECUTED = [
  'engine/decisionEngine/useDecisionEngine.ts',
  'hooks/useCommandCenter.ts',
  'hooks/useAttention.ts',
  'components/projects/UpcomingDeadlines.tsx',
  'components/projects/ProjectOverviewWidget.tsx',
] as const

/** The column list of every `.from('project_deliverables').select(...)` in a file. */
function deliverableSelects(src: string): string[] {
  const out: string[] = []
  const re = /from\(\s*'project_deliverables'\s*\)\s*\.?\s*select\(\s*([`'"])([\s\S]*?)\1\s*\)/g
  for (const m of src.matchAll(re)) out.push(m[2])
  return out
}

describe('no executed query selects a column project_deliverables lacks', () => {
  for (const file of EXECUTED) {
    it(`${file} asks only for real columns`, () => {
      for (const list of deliverableSelects(read(file))) {
        // Only the top level of the select belongs to this table; an embedded
        // resource like `projects!inner(id, title, status, ...)` legitimately
        // carries ITS own columns, including a real `status`.
        const topLevel = list.replace(/\w+!?\w*\s*\([\s\S]*?\)/g, '')
        const asked = topLevel.split(',').map(s => s.trim()).filter(s => s && s !== '*')
        for (const col of asked) {
          expect(REAL_COLUMNS, `${file} selects "${col}", which is not a column`)
            .toContain(col)
        }
      }
    })
  }

  it('in particular, nobody executed asks for `status`', () => {
    for (const file of EXECUTED) {
      for (const list of deliverableSelects(read(file))) {
        const topLevel = list.replace(/\w+!?\w*\s*\([\s\S]*?\)/g, '')
        expect(topLevel, `${file} selects project_deliverables.status`)
          .not.toMatch(/\bstatus\b/)
      }
    }
  })
})

describe('the unreachable-code exemption still holds', () => {
  it(`${UNREACHABLE} is imported by nothing`, () => {
    // Why a repo scan and not a hard-coded answer: the exemption above is a
    // claim about the whole repository, so only the whole repository can
    // confirm it.
    let hits = ''
    try {
      hits = execSync(
        'git grep -lE "useGlobalDecisionEngine" -- "src/**/*.ts" "src/**/*.tsx"',
        { encoding: 'utf8' },
      )
    } catch {
      hits = '' // git grep exits 1 when nothing matches
    }

    const importers = hits.split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      // its own definition, and tests that only name it in prose or assertions
      .filter(f => !f.endsWith('useGlobalDecisionEngine.ts'))
      .filter(f => !/\.test\.tsx?$|__tests__/.test(f))
      .filter(f => /import[^\n]*useGlobalDecisionEngine/.test(readFileSync(f, 'utf8')))

    expect(importers, 'useGlobalDecisionEngine is now executed — fix its '
      + 'project_deliverables select, which still asks for a nonexistent '
      + '`status` column, and move it into EXECUTED above').toEqual([])
  })
})
