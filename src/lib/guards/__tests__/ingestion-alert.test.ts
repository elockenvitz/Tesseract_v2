/**
 * Whether a failure that nobody is told about can still look handled.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `ingest.yml`'s notifier read:
 *
 *   if (existing.data.length === 0) { await github.rest.issues.create(...) }
 *
 * So the FIRST nightly failure opened issue #248 on 2026-10-06, and the next
 * 24 failures did nothing at all. Market data went 35 days stale inside a
 * product that was showing GOOGL at 142.80 against a 338.24 close, and the
 * Actions tab was the only place that said so.
 *
 * ── Two things are tested here, and both are necessary ───────────────────
 *
 * The notifier's BEHAVIOUR: given an issue that already exists, it must
 * comment. That is the exact branch the old code skipped.
 *
 * The guard's ABILITY TO SEE the old shape: `auditFailureNotifiers` is fed a
 * fixture carrying the original `length === 0` and must reject it. A guard
 * written after the fact that cannot recognise the defect it was written for
 * is decoration (CLAUDE.md Standing Rule 3).
 */
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { auditFailureNotifiers } from '../../../../scripts/ci-integrity.mjs'

const require_ = createRequire(import.meta.url)
const alertOnFailure = require_(
  join(__dirname, '..', '..', '..', '..', '.github', 'scripts', 'alert-on-failure.cjs'),
) as (args: Record<string, unknown>) => Promise<{ action: string; number: number; report?: number }>

/** A github-script `context`, with only the fields the notifier reads. */
const context = {
  repo: { owner: 'elockenvitz', repo: 'Tesseract_v2' },
  serverUrl: 'https://github.com',
  runId: 42348062597,
}

/**
 * What the notifier passed to Octokit, as a bag of keys.
 *
 * `unknown`-valued rather than `any`: each assertion reads one field and
 * narrows it there, so the fixture type does not have to describe the whole
 * of Octokit's request shapes.
 */
type Recorded = Record<string, unknown>

/** An Octokit stand-in that records what the notifier asked it to do. */
const fakeGithub = (issues: Array<Record<string, unknown>>, comments: Array<{ body: string }> = []) => {
  const calls = { created: [] as unknown[], comments: [] as unknown[], updates: [] as unknown[] }
  return {
    calls,
    rest: {
      issues: {
        listForRepo: vi.fn(async () => ({ data: issues })),
        create: vi.fn(async (a: unknown) => { calls.created.push(a); return { data: { number: 999 } } }),
        createComment: vi.fn(async (a: unknown) => { calls.comments.push(a); return { data: {} } }),
        update: vi.fn(async (a: unknown) => { calls.updates.push(a); return { data: {} } }),
        listComments: vi.fn(async () => ({ data: comments })),
      },
    },
  }
}

const DETAIL = ['Check the credentials first.']

describe('the first failure', () => {
  it('opens one issue, with the label and the run link', async () => {
    const github = fakeGithub([])
    const r = await alertOnFailure({ github, context, subject: 'Nightly ingestion failed', label: 'ingestion', detail: DETAIL })

    expect(r.action).toBe('opened')
    expect(github.calls.created).toHaveLength(1)
    const arg = github.calls.created[0] as Recorded
    expect(arg.title).toBe('Nightly ingestion failed')
    expect(arg.labels).toEqual(['ingestion'])
    expect(String(arg.body)).toContain('actions/runs/42348062597')
    expect(String(arg.body)).toContain('Check the credentials first.')
    expect(github.calls.comments).toHaveLength(0)
  })
})

describe('every failure after the first', () => {
  it('COMMENTS on the existing issue instead of going quiet', async () => {
    // This is the case the old notifier skipped, 24 times.
    const github = fakeGithub([{ number: 248, title: 'Nightly ingestion failed', state: 'open' }])
    const r = await alertOnFailure({ github, context, subject: 'Nightly ingestion failed', label: 'ingestion', detail: DETAIL })

    expect(r.action).toBe('commented')
    expect(r.number).toBe(248)
    expect(github.calls.comments).toHaveLength(1)
    expect(github.calls.created).toHaveLength(0)
  })

  it('counts the consecutive reports, so five weeks reads differently from one night', async () => {
    const priorComments = Array.from({ length: 24 }, (_, i) => ({ body: `Still failing.\n\nRun: .../runs/${i}` }))
    const github = fakeGithub(
      [{ number: 248, title: 'Nightly ingestion failed', state: 'open' }],
      priorComments,
    )
    const r = await alertOnFailure({ github, context, subject: 'Nightly ingestion failed', label: 'ingestion', detail: DETAIL })

    // 24 prior reports + the issue body itself + this one.
    expect(r.report).toBe(26)
    expect(String((github.calls.comments[0] as Recorded).body)).toContain('Report 26')
  })

  it('reopens an issue that was closed while the job is still failing', async () => {
    // Closing an issue claims the thing is fixed. The next failure is
    // evidence it is not, and leaving it closed would be the old bug again.
    const github = fakeGithub([{ number: 248, title: 'Nightly ingestion failed', state: 'closed' }])
    await alertOnFailure({ github, context, subject: 'Nightly ingestion failed', label: 'ingestion', detail: DETAIL })

    expect(github.calls.updates).toHaveLength(1)
    expect(github.calls.updates[0]).toMatchObject({ issue_number: 248, state: 'open' })
    expect(github.calls.comments).toHaveLength(1)
  })

  it('still notifies when the comment count cannot be read', async () => {
    const github = fakeGithub([{ number: 248, title: 'Nightly ingestion failed', state: 'open' }])
    github.rest.issues.listComments = vi.fn(async () => { throw new Error('403') }) as never
    const r = await alertOnFailure({ github, context, subject: 'Nightly ingestion failed', label: 'ingestion', detail: DETAIL })

    // A failed count is a cosmetic loss. Swallowing the notification over it
    // would trade the whole point of the change for a number in a sentence.
    expect(r.action).toBe('commented')
    expect(github.calls.comments).toHaveLength(1)
  })
})

/**
 * An Octokit stand-in that FILTERS BY LABEL, the way the real API does.
 *
 * This exists because the previous version of this file tested subject
 * separation with `fakeGithub([])` -- an empty issue list. With nothing to
 * pick from, any implementation passes, so the test proved nothing about the
 * discrimination it claimed to prove. It passed vacuously while the notifier
 * carried a `?? found.data[0]` fallback that adopted an arbitrary same-label
 * issue. CLAUDE.md Standing Rule 3: a gate that cannot observe its own
 * failure mode is decoration.
 *
 * Every test below hands this fake a NON-EMPTY list, so there is always a
 * wrong issue available to be picked.
 */
const fakeGithubByLabel = (issues: Array<Record<string, unknown>>) => {
  const calls = { created: [] as unknown[], comments: [] as unknown[], updates: [] as unknown[] }
  return {
    calls,
    rest: {
      issues: {
        listForRepo: vi.fn(async ({ labels }: { labels: string }) => ({
          data: issues.filter((i) => ((i.labels as string[]) ?? []).includes(labels)),
        })),
        create: vi.fn(async (a: unknown) => { calls.created.push(a); return { data: { number: 999 } } }),
        createComment: vi.fn(async (a: unknown) => { calls.comments.push(a); return { data: {} } }),
        update: vi.fn(async (a: unknown) => { calls.updates.push(a); return { data: {} } }),
        listComments: vi.fn(async () => ({ data: [] as Array<{ body: string }> })),
      },
    },
  }
}

/** Issues that exist in the repo for these tests to be confused by. */
const INGESTION_ISSUE = { number: 248, title: 'Nightly ingestion failed', state: 'open', labels: ['ingestion'] }
const HUMAN_ISSUE = { number: 300, title: 'Investigate SSGA weight gaps', state: 'open', labels: ['market-data'] }
const STALE_ISSUE = { number: 301, title: 'Market data is stale', state: 'open', labels: ['market-data'] }
const CLOSED_WEIGHTS = { number: 302, title: 'Benchmark weights have stopped arriving', state: 'closed', labels: ['market-data'] }

describe('separate subjects stay separate', () => {
  it('ignores an issue under a different label', async () => {
    // The freshness watchdog uses the `market-data` label precisely so a
    // stale-data alert does not land on an ingestion-failure issue: the two
    // have different fixes.
    const github = fakeGithubByLabel([INGESTION_ISSUE])
    const r = await alertOnFailure({ github, context, subject: 'Market data is stale', label: 'market-data', detail: DETAIL })

    expect(r.action).toBe('opened')
    expect(github.calls.comments).toHaveLength(0)
    expect((github.calls.created[0] as Recorded).labels).toEqual(['market-data'])
  })

  it('does not hijack a HUMAN issue filed under the same label', async () => {
    // The regression. With `?? found.data[0]` the watchdog commented on
    // "Investigate SSGA weight gaps" and never opened an issue of its own,
    // so the stale-data alert was buried in someone else's thread.
    const github = fakeGithubByLabel([HUMAN_ISSUE])
    const r = await alertOnFailure({ github, context, subject: 'Market data is stale', label: 'market-data', detail: DETAIL })

    expect(r.action).toBe('opened')
    expect(r.number).not.toBe(300)
    expect(github.calls.comments).toHaveLength(0)
    expect((github.calls.created[0] as Recorded).title).toBe('Market data is stale')
  })

  it('does not let one watchdog subject swallow another sharing its label', async () => {
    // The second half of the regression: two subjects, one label. The newer
    // subject was reported as a comment on the older subject's issue.
    const github = fakeGithubByLabel([STALE_ISSUE])
    const r = await alertOnFailure({ github, context, subject: 'Benchmark weights have stopped arriving', label: 'market-data', detail: DETAIL })

    expect(r.action).toBe('opened')
    expect(r.number).not.toBe(301)
    expect(github.calls.comments).toHaveLength(0)
    expect((github.calls.created[0] as Recorded).title).toBe('Benchmark weights have stopped arriving')
  })

  it('still finds its OWN issue among several sharing the label', async () => {
    // The other direction has to keep working, or the fix above would have
    // traded one silence for a pile of duplicates. Three same-label issues
    // are present and only the matching title may be commented on.
    const github = fakeGithubByLabel([HUMAN_ISSUE, STALE_ISSUE, CLOSED_WEIGHTS])
    const r = await alertOnFailure({ github, context, subject: 'Market data is stale', label: 'market-data', detail: DETAIL })

    expect(r.action).toBe('commented')
    expect(r.number).toBe(301)
    expect(github.calls.created).toHaveLength(0)
    expect(github.calls.comments).toHaveLength(1)
    expect(github.calls.updates).toHaveLength(0)
  })

  it('reopens its own CLOSED issue rather than the newest same-label one', async () => {
    // #301 is open and newer; #302 is this subject's issue and closed. The
    // closed one is the correct target.
    const github = fakeGithubByLabel([HUMAN_ISSUE, STALE_ISSUE, CLOSED_WEIGHTS])
    const r = await alertOnFailure({ github, context, subject: 'Benchmark weights have stopped arriving', label: 'market-data', detail: DETAIL })

    expect(r.action).toBe('commented')
    expect(r.number).toBe(302)
    expect(github.calls.updates).toMatchObject([{ issue_number: 302, state: 'open' }])
    expect(github.calls.created).toHaveLength(0)
  })
})

/** CLAUDE.md Standing Rule 3, applied to the guard rather than the notifier. */
describe('auditFailureNotifiers sees the original defect', () => {
  const wf = (script: string) => ({ jobs: { 'notify-failure': { steps: [{ with: { script } }] } } })
  const good = 'const alert = require(`${process.env.GITHUB_WORKSPACE}/.github/scripts/alert-on-failure.cjs`)\nawait alert({ github, context })'

  it('accepts a notifier that routes through the shared module', () => {
    expect(auditFailureNotifiers([['ingest.yml', wf(good)]])).toEqual([])
  })

  it('rejects the exact code that kept 24 failures silent', () => {
    const original = `
      const existing = await github.rest.issues.listForRepo({ state: 'open', labels: 'ingestion' })
      if (existing.data.length === 0) { await github.rest.issues.create({ title, body }) }
    `
    const problems = auditFailureNotifiers([['ingest.yml', wf(original)]])
    expect(problems.join('\n')).toMatch(/skips the notification when an issue already exists/)
  })

  it('rejects the near-spellings of the same dedupe', () => {
    for (const shape of [
      'if (existing.data.length < 1) { create() }',
      'if (!existing.data.length) { create() }',
    ]) {
      expect(auditFailureNotifiers([['x.yml', wf(`${good}\n${shape}`)]]).join('\n'))
        .toMatch(/skips the notification/)
    }
  })

  it('rejects a workflow with no notifier script at all', () => {
    expect(auditFailureNotifiers([['x.yml', { jobs: { a: { steps: [{ run: 'echo hi' }] } } }]]).join('\n'))
      .toMatch(/no failure-notification script/)
  })

  it('rejects a notifier that hand-rolls its own issue logic', () => {
    expect(auditFailureNotifiers([['x.yml', wf('await github.rest.issues.create({ title })')]]).join('\n'))
      .toMatch(/does not route through/)
  })
})
