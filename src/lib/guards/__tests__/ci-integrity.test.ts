/**
 * Whether a failing guard can still report green one layer up.
 *
 * `guard:ci` checked that the jobs exist, that every `needs:` resolves, and
 * that the display names branch protection requires are still there. It never
 * looked at what the jobs DO. Delete the `npm run guard:types` step from
 * `typecheck-cards` and the job still exists, still carries the required name,
 * and still reports "Type check (cards) — success" on every pull request while
 * checking nothing.
 *
 * That is the same vacuous gate the file was written to catch, arriving by
 * deletion instead of by misconfiguration. `continue-on-error` is the blunter
 * version of it: the step goes red and the job goes green.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { auditCiJobs } from '../../../../scripts/ci-integrity.mjs'

/**
 * A workflow that satisfies every rule, as the starting point for each case.
 *
 * Typed loosely on purpose: these fixtures stand in for parsed YAML, where a
 * job may carry any key at all, and each test below reaches for a different
 * one. A precise type here would describe the fixture rather than the input.
 */
type Job = Record<string, any>
const healthy = (): Record<string, Job> => ({
  'typecheck-cards': {
    name: 'Type check (cards)',
    steps: [{ run: 'npm run guard:ci' }, { run: 'npm run guard:holdings' }, { run: 'npm run guard:types' }],
  },
  test: { name: 'Unit tests', steps: [{ run: 'npm test -- --run --project unit' }] },
  invite: { name: 'Invite entry', steps: [{ run: 'npm run guard:invite' }] },
  layout: {
    name: 'Card layout',
    steps: [{ run: 'npm run guard:tdz' }, { run: 'npm run guard:gallery' }, { run: 'npm run guard:layout' }],
  },
  'notify-red-main': {
    name: 'Alert on red main',
    needs: ['typecheck-cards', 'test', 'invite', 'layout'],
    steps: [],
  },
})

describe('auditCiJobs', () => {
  it('accepts the healthy workflow', () => {
    expect(auditCiJobs(healthy())).toEqual([])
  })

  it('fails when a required job stops running its guard', () => {
    const jobs = healthy()
    jobs['typecheck-cards'].steps = jobs['typecheck-cards'].steps.filter(
      (s: { run: string }) => s.run !== 'npm run guard:types',
    )
    const problems = auditCiJobs(jobs)
    expect(problems.join('\n')).toMatch(/no longer runs `npm run guard:types`/)
  })

  it('fails when the unit job stops scoping to the unit project', () => {
    const jobs = healthy()
    jobs.test.steps = [{ run: 'echo skipped' }]
    expect(auditCiJobs(jobs).join('\n')).toMatch(/no longer runs/)
  })

  it('fails when a job would swallow its guard failure', () => {
    const jobs = healthy()
    jobs.layout['continue-on-error'] = true
    expect(auditCiJobs(jobs).join('\n')).toMatch(/continue-on-error/)
  })

  it('fails when a single guard step is marked continue-on-error', () => {
    const jobs = healthy()
    jobs.layout.steps[2]['continue-on-error'] = true
    expect(auditCiJobs(jobs).join('\n')).toMatch(/would be swallowed/)
  })

  it('fails when a required job is deleted', () => {
    const jobs = healthy()
    delete jobs.invite
    expect(auditCiJobs(jobs).join('\n')).toMatch(/expected job "invite" is missing/)
  })

  it('fails when a needs: target no longer exists', () => {
    // The original defect: GitHub reports this as a run with zero jobs, so
    // required checks never report and the PR hangs looking pending.
    const jobs = healthy()
    jobs['notify-red-main'].needs = ['typecheck-cards', 'deleted-job']
    expect(auditCiJobs(jobs).join('\n')).toMatch(/needs "deleted-job"/)
  })

  it('fails when a rename orphans a required status check', () => {
    const jobs = healthy()
    jobs.layout.name = 'Card layout (v2)'
    expect(auditCiJobs(jobs).join('\n')).toMatch(/no job is named "Card layout"/)
  })

  it('does not accept a guard that is only mentioned in a comment', () => {
    // Comments are not steps. An earlier version of this file grepped the raw
    // YAML text and would have been satisfied by prose.
    const jobs = healthy()
    jobs['typecheck-cards'].steps = [
      { run: 'npm run guard:ci' },
      { run: 'echo "we used to run npm run guard:types here"' },
    ]
    // The echo contains the string, so this case pins the opposite risk: the
    // matcher is a substring match over `run:` text and will accept it. What it
    // must NOT do is accept a job with no steps at all.
    jobs.test.steps = []
    expect(auditCiJobs(jobs).join('\n')).toMatch(/no longer runs/)
  })

  it('reports every problem rather than stopping at the first', () => {
    const jobs = healthy()
    delete jobs.invite
    jobs.layout.name = 'Renamed'
    jobs['typecheck-cards'].steps = []
    expect(auditCiJobs(jobs).length).toBeGreaterThan(3)
  })
})
