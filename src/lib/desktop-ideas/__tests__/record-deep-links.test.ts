import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'
import { pipelineTabFor, ideasTabFor } from '../navigate'

/**
 * A button that names a record must open that record.
 *
 * The defect: a deep link labelled "Open idea" dispatched a hand-written tab
 * descriptor — `{ id: 'trade-queue', title: 'Pipeline', type: 'trade-queue',
 * data: null }` — from inside the idea it claimed to open. `data: null` carries
 * no record, so the reader landed on the bare Pipeline WORKSPACE and had to
 * find the name again. It was copied into five places: both deep links in
 * IdeaDetail, the "View decision record" link in DecisionDetail, the "Decide in
 * Pipeline" button on a Lists row, and every idea row on the mobile asset page
 * (which discarded the `idea.id` it was iterating over).
 *
 * `DecisionTimeline` had already hit and fixed this once, settling the rule:
 * route through the typed opener, and when there is nothing to open make the
 * click inert rather than opening an empty tab.
 *
 * The guard below is written as a RULE over every workspace pane, not as a
 * list of the five files that happened to be wrong — a guard that names its
 * subjects stops catching the sixth. A generic destination (the launcher's
 * "Idea Pipeline" entry) legitimately carries no record and is not a pane, so
 * it is outside the sweep by construction.
 */

const SRC = resolve(__dirname, '../../..')

/** Comment-stripped, so a file that QUOTES the defect it removed stays clean. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

/**
 * Every pane that draws record deep links: the lens detail panes, plus the
 * other surfaces that route to a record by the same mechanism. Discovered by
 * walking the tree rather than listed, so a new lens is covered on arrival.
 */
function panesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) {
        if (entry !== '__tests__') walk(p)
      } else if (entry.endsWith('.tsx') && !entry.includes('.test.')) {
        out.push(p)
      }
    }
  }
  walk(resolve(SRC, dir))
  return out
}

const WORKSPACE_DIRS = [
  'components/decisions-v2',
  'components/ideas-v2',
  'components/research-v2',
  'components/portfolio-v2',
  'components/asset-v2',
  'components/lists',
  'components/mobile/asset',
]

const PANES = WORKSPACE_DIRS.flatMap(panesUnder)

describe('pipelineTabFor carries the record', () => {
  it('focuses the idea, under the spelling both receivers read', () => {
    // TradeQueuePage (desktop) and MobilePipeline (phone) both read
    // `data.focusIdeaId`; neither reads anything else.
    expect(pipelineTabFor('idea-7')).toEqual({
      id: 'trade-queue',
      title: 'Idea Pipeline',
      type: 'trade-queue',
      data: { focusIdeaId: 'idea-7' },
    })
  })

  it('reuses one Pipeline tab rather than stacking duplicates', () => {
    // The shell reuses a tab whose id already exists, so the id must be fixed.
    expect(pipelineTabFor('a')!.id).toBe(pipelineTabFor('b')!.id)
  })

  it('returns null with nothing to open, so a caller can decline', () => {
    // Opening an empty workspace is the defect; an inert click is the fix.
    expect(pipelineTabFor(null)).toBeNull()
    expect(pipelineTabFor(undefined)).toBeNull()
    expect(pipelineTabFor('')).toBeNull()
  })

  it('never produces the record-less payload the panes used to hand-roll', () => {
    expect(pipelineTabFor('idea-7')!.data).not.toBeNull()
    expect(ideasTabFor({ ideaId: 'idea-7' }).data.selectedIdeaId).toBe('idea-7')
  })
})

describe('no workspace pane hand-rolls a record-less tab', () => {
  it('found the panes to sweep', () => {
    // Without this, a bad path would make every case below vacuously pass.
    expect(PANES.length).toBeGreaterThan(10)
  })

  it.each(PANES.map(p => [relative(SRC, p), p]))(
    '%s dispatches no tab with data: null',
    (_name, path) => {
      const body = codeOf(path)
      // The exact shape that opened a bare workspace: a descriptor built
      // inline, carrying no record.
      expect(body).not.toMatch(/type:\s*'trade-queue'[^}]*data:\s*null/)
      expect(body).not.toMatch(/data:\s*null[^}]*type:\s*'trade-queue'/)
    },
  )

  it.each(PANES.map(p => [relative(SRC, p), p]))(
    '%s builds no Pipeline descriptor by hand',
    (_name, path) => {
      // Even a CORRECT hand-rolled descriptor is how the wrong ones got
      // written. `pipelineTabFor` is the one place this shape is spelled.
      const body = codeOf(path)
      const inline = body.match(/id:\s*'trade-queue'/g) ?? []
      expect(inline).toHaveLength(0)
    },
  )
})
