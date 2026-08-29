/**
 * No client query may request a restricted `assets` column.
 *
 * After C1-09b the table-wide grant on `assets` is replaced by a column grant,
 * so these nine columns are not merely unused — they are unreadable. Postgres
 * expands `SELECT *` to every column and then checks privileges on all of them,
 * which means a stale query does not return fewer fields, it FAILS ENTIRELY and
 * takes its whole feature with it.
 *
 * That failure mode is why this is a lint rather than a runtime test. Three of
 * the four blockers Main Control found on the first pass were exactly this
 * shape — `useScreenResults`, `PortfolioTab`, `useEntitySearch` — each a single
 * column name inside a select string that no type checker and no unit test
 * could see. A grep is the only thing that catches the fourth.
 *
 * Scope: `.from('assets')` queries and embedded `assets(...)` selects, across
 * src/. Comments are stripped first, so prose explaining the ban does not trip
 * it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The nine columns C1-09b revokes, plus quick_note's timestamp. */
const RESTRICTED = [
  'thesis', 'where_different', 'risks_to_thesis', 'quick_note',
  'quick_note_updated_at', 'thesis_references', 'completeness',
  'process_stage', 'priority', 'workflow_id',
]

const ROOT = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/** Strip comments so explanatory text naming a column is not a match. */
function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

interface Violation { file: string; line: number; column: string; kind: string }

function findViolations(file: string): Violation[] {
  const src = stripComments(readFileSync(file, 'utf8'))
  const rel = relative(process.cwd(), file).split(sep).join('/')
  const found: Violation[] = []
  const lineOf = (idx: number) => src.slice(0, idx).split('\n').length

  // .from('assets') … .select('<columns>')
  const direct = /from\('assets'\)([\s\S]{0,600}?)\.select\(\s*([`'"])([\s\S]*?)\2/g
  for (let m = direct.exec(src); m; m = direct.exec(src)) {
    for (const col of RESTRICTED) {
      if (new RegExp(`(^|[\\s,])${col}([\\s,]|$)`).test(m[3])) {
        found.push({ file: rel, line: lineOf(m.index), column: col, kind: 'select' })
      }
    }
  }

  // Embedded relationship select: assets( … ) / assets!fk( … )
  const embed = /\bassets\s*(?:!\w+\s*)?\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
  for (let m = embed.exec(src); m; m = embed.exec(src)) {
    for (const col of RESTRICTED) {
      if (new RegExp(`(^|[\\s,])${col}([\\s,]|$)`).test(m[1])) {
        found.push({ file: rel, line: lineOf(m.index), column: col, kind: 'embed' })
      }
    }
  }

  // A filter or ordering on a restricted column is equally fatal.
  const scoped = /from\('assets'\)([\s\S]{0,900}?)(?=from\('|$)/g
  for (let m = scoped.exec(src); m; m = scoped.exec(src)) {
    for (const col of RESTRICTED) {
      const f = new RegExp(`\\.(eq|neq|in|not|gt|gte|lt|lte|like|ilike|order|is)\\(\\s*['"]${col}['"]`)
      if (f.test(m[1])) {
        found.push({ file: rel, line: lineOf(m.index), column: col, kind: 'filter' })
      }
    }
  }

  return found
}

describe('assets restricted columns', () => {
  const violations = sourceFiles(ROOT).flatMap(findViolations)

  it('no client query selects, embeds or filters a restricted assets column', () => {
    const report = violations
      .map(v => `  ${v.file}:${v.line} ${v.kind} -> ${v.column}`)
      .join('\n')
    expect(
      violations.length === 0
        ? violations
        : new Error(
            `\n  These queries will FAIL after C1-09b revokes the column:\n${report}\n\n` +
            `  Read the proprietary half from the org-scoped model instead:\n` +
            `    research  -> src/lib/research/asset-research.ts\n` +
            `    overlay   -> src/lib/research/asset-overlay.ts\n` +
            `    workflow  -> asset_workflow_progress / asset_workflow_priorities\n`
          )
    ).toEqual([])
  })

  it('recognises a violation when one is introduced', () => {
    // Guards the lint itself: a scanner that silently matches nothing would
    // pass this suite forever while catching none of the four blockers.
    const sample = `
      const { data } = await supabase
        .from('assets')
        .select('id, symbol, thesis')
    `
    const hits = RESTRICTED.filter(col =>
      /from\('assets'\)[\s\S]{0,600}?\.select\(\s*'([^']*)'/.exec(sample)?.[1]
        ?.match(new RegExp(`(^|[\\s,])${col}([\\s,]|$)`)))
    expect(hits).toContain('thesis')
  })

  it('does not flag the reference columns that remain readable', () => {
    const sample = `
      const { data } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, current_price')
    `
    const cols = /\.select\(\s*'([^']*)'/.exec(sample)?.[1] ?? ''
    for (const col of RESTRICTED) {
      expect(new RegExp(`(^|[\\s,])${col}([\\s,]|$)`).test(cols)).toBe(false)
    }
  })
})
