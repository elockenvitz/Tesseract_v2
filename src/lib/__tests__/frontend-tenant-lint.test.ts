/**
 * Tests for the frontend tenant boundary linter's scan logic.
 *
 * Tests the core scanFile function with known-good and known-bad examples.
 */

import { describe, it, expect } from 'vitest'

// Re-implement scanFile logic here since the linter is an .mjs script
// This tests the same regex patterns used by the linter

const ORG_SCOPED_TABLES = new Set([
  'workflows', 'projects', 'themes', 'conversations', 'calendar_events',
  'teams', 'organization_memberships', 'organization_invites',
  'organization_audit_log', 'topics', 'captures', 'custom_notebooks',
])

const ORG_SCOPED_VIEWS = new Set([
  'organization_members_v',
  'org_workflows_v',
  'org_themes_v',
  'org_calendar_events_v',
  'org_topics_v',
  'org_captures_v',
  'org_projects_v',
])

const P0_TABLES = new Set([
  'workflows', 'projects', 'themes', 'conversations',
  'calendar_events', 'topics', 'captures',
])

const FROM_REGEX = /supabase\s*\.\s*from\(\s*['"`](\w+)['"`]\s*\)/g
const ORG_FILTER_REGEX = /\.eq\(\s*['"`]organization_id['"`]/
const MUTATION_REGEX = /\.(insert|update|upsert|delete)\s*\(/
const SAFE_FILTER_REGEX = /\.eq\(\s*['"`](id|workflow_id|team_id|project_id|conversation_id|theme_id|created_by|user_id|portfolio_id|node_id)['"`]/

function scanFile(content: string) {
  const violations: { line: number; table: string; isP0: boolean }[] = []
  const lines = content.split('\n')
  let match: RegExpExecArray | null

  FROM_REGEX.lastIndex = 0
  while ((match = FROM_REGEX.exec(content)) !== null) {
    const tableName = match[1]
    if (!ORG_SCOPED_TABLES.has(tableName)) continue
    if (ORG_SCOPED_VIEWS.has(tableName)) continue

    const afterFrom = content.slice(match.index, match.index + 400)
    if (ORG_FILTER_REGEX.test(afterFrom)) continue
    if (MUTATION_REGEX.test(afterFrom)) continue
    if (SAFE_FILTER_REGEX.test(afterFrom)) continue

    const beforeMatch = content.slice(0, match.index)
    const lineNum = beforeMatch.split('\n').length

    violations.push({ line: lineNum, table: tableName, isP0: P0_TABLES.has(tableName) })
  }
  return violations
}

describe('frontend-tenant-lint scanFile', () => {
  // ── Known-bad: should FAIL ─────────────────────────────────

  it('flags supabase.from(org_table) without organization_id filter', () => {
    const code = `
const { data } = await supabase
  .from('workflows')
  .select('*')
  .order('created_at')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(1)
    expect(violations[0].table).toBe('workflows')
    expect(violations[0].isP0).toBe(true)
  })

  it('flags multiple unfiltered calls in same file', () => {
    const code = `
const a = supabase.from('projects').select('*')
const b = supabase.from('themes').select('*')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(2)
    expect(violations.map(v => v.table)).toEqual(['projects', 'themes'])
  })

  it('flags org_memberships without org filter', () => {
    const code = `
supabase.from('organization_memberships').select('*').order('created_at')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(1)
    expect(violations[0].table).toBe('organization_memberships')
    expect(violations[0].isP0).toBe(false)
  })

  it('allows org_memberships with safe FK filter (user_id)', () => {
    const code = `
supabase.from('organization_memberships').select('*').eq('user_id', uid)
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(0)
  })

  // ── Known-good: should PASS ────────────────────────────────

  it('allows supabase.from(org_table) WITH organization_id filter', () => {
    const code = `
const { data } = await supabase
  .from('workflows')
  .select('*')
  .eq('organization_id', currentOrgId)
  .order('created_at')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(0)
  })

  it('allows non-org-scoped tables without filter', () => {
    const code = `
const { data } = await supabase.from('assets').select('*')
const prices = await supabase.from('price_history_cache').select('*')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(0)
  })

  it('allows org-scoped views (they handle filtering internally)', () => {
    const code = `
const { data } = await supabase
  .from('organization_members_v')
  .select('*')
  .eq('organization_id', orgId)
`
    // Even without org filter, the view is allowlisted
    const codeNoFilter = `
const { data } = await supabase.from('organization_members_v').select('*')
`
    expect(scanFile(code)).toHaveLength(0)
    expect(scanFile(codeNoFilter)).toHaveLength(0)
  })

  it('allows new Phase 9 org-scoped views', () => {
    const code = `
const w = supabase.from('org_workflows_v').select('*')
const t = supabase.from('org_themes_v').select('*')
const c = supabase.from('org_calendar_events_v').select('*')
const tp = supabase.from('org_topics_v').select('*')
const cp = supabase.from('org_captures_v').select('*')
const p = supabase.from('org_projects_v').select('*')
`
    expect(scanFile(code)).toHaveLength(0)
  })

  it('allows FK-chain tables (not in ORG_SCOPED_TABLES)', () => {
    const code = `
const { data } = await supabase
  .from('workflow_stages')
  .select('*')
  .eq('workflow_id', wfId)
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(0)
  })

  it('allows user-personal tables', () => {
    const code = `
const { data } = await supabase.from('user_preferences').select('*')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(0)
  })

  it('reports correct line numbers', () => {
    const code = `line1
line2
const x = supabase.from('projects').select('*')
line4`
    const violations = scanFile(code)
    expect(violations).toHaveLength(1)
    expect(violations[0].line).toBe(3)
  })

  it('classifies P0 vs P1 tables correctly', () => {
    const code = `
const a = supabase.from('workflows').select('*')
const b = supabase.from('teams').select('*')
`
    const violations = scanFile(code)
    expect(violations).toHaveLength(2)
    expect(violations[0].isP0).toBe(true)   // workflows = P0
    expect(violations[1].isP0).toBe(false)  // teams = P1
  })
})
