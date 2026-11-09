/**
 * Increment 2E — the eleven pilot journeys, in a real browser.
 *
 * One assertion per journey step, named after the journey so a failure says
 * which user story broke. Desktop where the journey is a desktop one, phone
 * where it applies.
 *
 * Nothing here writes. No production record is touched: every surface runs
 * against the harness fixtures, and the production checks that back these up
 * were read-only SQL inside aborting transactions.
 *
 *   node desktop-harness/probe-asset-journeys.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const failures = []
const ok = []
const check = (j, n, c, d = '') => {
  const label = `J${j}  ${n}`
  c ? ok.push(label) : failures.push(`${label}${d ? ` — ${d}` : ''}`)
}

const ENV = /ERR_NAME_NOT_RESOLVED|Failed to load resource|status of 40[13]/i
const browser = await chromium.launch()

const phone = () => browser.newPage({
  viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
})
const desk = () => browser.newPage({ viewport: { width: 1440, height: 1000 } })

// ── J1-J3: open a held security; understand belief/valuation/exposure; find work
{
  const p = await phone()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  p.on('console', m => { if (m.type() === 'error' && !ENV.test(m.text())) errs.push(m.text()) })

  await p.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(300)
  const t = await p.evaluate(() => document.body.innerText)

  check(1, 'a held security opens on the Snapshot', /AAPL/.test(t) && /POSITION/i.test(t))
  check(1, 'no uncaught errors on open', errs.length === 0, errs.slice(0, 2).join(' | '))

  /*
   * These anchored on the phone's old copy — "2.5%", "+16%", a Belief band
   * headlining the target. The Snapshot now opens with a conclusion band that
   * states exposure to two decimals and upside to one, and Belief headlines
   * the thesis because the band above owns the valuation. The journeys are
   * unchanged; only where each answer is found has moved.
   */
  check(2, 'exposure is stated', /2\.55%/.test(t) && /Tech & Consumer Growth/.test(t))
  check(2, 'belief is stated', /BELIEF/i.test(t) && /Services mix/.test(t))
  check(2, 'valuation is related to price', /\+15\.8% to spot/.test(t))
  check(2, 'the rating carries its n', /Buy/.test(t) && /3 of 5/.test(t))

  check(3, 'active work is findable', /ACTIVE WORK/i.test(t) && /open idea/i.test(t))
  await p.close()
}

// ── J4-J5: recommendation vs PM decision; accepted vs evidenced execution
{
  const p = await desk()
  await p.goto(`${base}?surface=decision-timeline&h=3000`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-harness="decision-timeline"]')
  for (let i = 0; i < 4; i++) {
    const more = p.getByRole('button', { name: /Show \d+ more events/ })
    if (!(await more.count())) break
    await more.first().click(); await p.waitForTimeout(100)
  }
  const t = await p.evaluate(() => document.body.innerText)

  check(4, 'recommendation is distinct from the ruling',
    /RECOMMENDED/i.test(t) && /DECIDED/i.test(t))
  check(4, 'the ruling names its author', /Priya Nair/.test(t))
  check(4, 'a modified acceptance is distinguished', /Accepted \(modified\)/i.test(t))
  check(4, 'a withdrawal is not a rejection', /WITHDRAWN/i.test(t))

  check(5, 'commitment and execution are different rows',
    /COMMITTED/i.test(t) && /EXECUTED/i.test(t))
  check(5, 'a commitment that never filled is visible', /UNFILLED/i.test(t))
  check(5, 'observed and assumed executions are labelled differently',
    /VERIFIED/i.test(t) && /ASSUMED/i.test(t))
  await p.close()
}

// ── J6-J7: navigate into a workflow, and return with context
{
  const p = await desk()
  await p.goto(`${base}?surface=decision-timeline&h=3000`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-harness="decision-timeline"]')
  for (let i = 0; i < 4; i++) {
    const more = p.getByRole('button', { name: /Show \d+ more events/ })
    if (!(await more.count())) break
    await more.first().click(); await p.waitForTimeout(100)
  }
  await p.locator('button', { hasText: 'Recommendation submitted — 2.5%' }).first().click()
  await p.waitForTimeout(150)
  const nav = await p.evaluate(() => document.body.getAttribute('data-last-nav'))
  check(6, 'a decision row opens its originating workflow', !!nav)
  if (nav) {
    const d = JSON.parse(nav)
    check(6, 'it opens Ideas, not a dead tab id', d.id === 'ideas-v2', `id=${d.id}`)
    check(6, 'it carries the originating idea', !!d.data?.selectedIdeaId)
  }
  await p.close()
}
{
  // Return context: the phone keeps its book scope across a tab round trip.
  const p = await phone()
  await p.goto(`${base}?surface=mobile-asset&book=pf-income`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(250)
  const before = await p.evaluate(() => document.body.innerText)
  await p.locator('[data-testid="mobile-asset-tab-decisions"]').click()
  await p.waitForTimeout(250)
  await p.locator('[data-testid="mobile-asset-tab-snapshot"]').click()
  await p.waitForTimeout(250)
  const after = await p.evaluate(() => document.body.innerText)
  check(7, 'book scope survives a tab round trip',
    /Core Income/.test(before) && /Core Income/.test(after))
  await p.close()
}

// ── J8: switch books and verify filtering
{
  const p = await phone()
  await p.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(250)
  const all = await p.evaluate(() => document.body.innerText)
  check(8, 'organization-wide is the default', /All portfolios/.test(all))
  check(8, 'unscoped shows the largest position', /LARGEST POSITION/i.test(all))

  await p.goto(`${base}?surface=mobile-asset&book=pf-income`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(250)
  const scoped = await p.evaluate(() => document.body.innerText)
  check(8, 'scoping changes the position shown', /Core Income/.test(scoped))
  check(8, 'scoping retitles it', !/LARGEST POSITION/i.test(scoped))
  check(8, 'scoping suppresses the coverage note',
    !(await p.locator('[data-testid="decision-memory-coverage-note"]').count()))
  await p.close()
}

// ── J9: an unheld security with little or no history
{
  const p = await phone()
  const errs = []
  p.on('pageerror', e => errs.push(e.message))
  await p.goto(`${base}?surface=mobile-asset&asset=empty`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(250)
  const t = await p.evaluate(() => document.body.innerText)

  check(9, 'unheld says it is unheld', /Not held in any book you can see/i.test(t))
  // "No target set" was the old Belief headline; the band now reports the
  // absence of a CASE, which is the more useful statement and matches desktop.
  check(9, 'no case says so', /No investment case has been written/i.test(t))
  check(9, 'an unrated name gets no rating', !/\b(Buy|Hold|Sell)\b/.test(t))
  check(9, 'no work says so', /Nothing in flight/i.test(t))
  check(9, 'no history says so', /No decision has been recorded/i.test(t))
  check(9, 'it invents no exposure', !/% of /.test(t))
  check(9, 'it does not error', errs.length === 0, errs.slice(0, 2).join(' | '))
  await p.close()
}

// ── J10: loading, empty, error and partial-data behaviour
{
  const p = await desk()
  await p.goto(`${base}?surface=decision-timeline&h=900&asset=error`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-harness="decision-timeline"]')
  await p.waitForTimeout(200)
  const t = await p.evaluate(() => document.body.innerText)
  check(10, 'a failed read says it failed', /could not be loaded/i.test(t))
  check(10, 'a failed read is NOT reported as no history',
    !/No decision history yet/i.test(t))
  await p.close()
}
{
  // Partial data: executions present, none of them observed.
  const p = await desk()
  await p.goto(`${base}?surface=decision-timeline&h=3000`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-harness="decision-timeline"]')
  await p.waitForTimeout(200)
  const t = await p.evaluate(() => document.body.innerText)
  check(10, 'rows with no provenance say UNATTRIBUTED', /UNATTRIBUTED/i.test(t))
  check(10, 'rows written by a migration say BACKFILLED', /BACKFILLED/i.test(t))
  await p.close()
}

// ── J11: organization and portfolio authorization boundaries
{
  const p = await phone()
  await p.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="mobile-snapshot"]')
  await p.waitForTimeout(400)

  const note = await p.evaluate(() =>
    document.querySelector('[data-testid="decision-memory-coverage-note"]')
      ?.textContent?.replace(/\s+/g, ' ').trim() ?? null)
  check(11, 'the org/team authorization gap is disclosed',
    !!note && /covers the \d+ you have decision access to/.test(note), note ?? 'no note')
  check(11, 'the note counts rather than naming inaccessible books',
    !!note && !/Special Opportunities/.test(note), note ?? '')

  // The execution caveat is the other half of honesty about what is known.
  const caveat = await p.evaluate(() =>
    document.querySelector('[data-testid="decision-memory-unobserved-caveat"]')
      ?.textContent?.replace(/\s+/g, ' ').trim() ?? null)
  check(11, 'unobserved executions are disclosed',
    !!caveat && /not evidenced by an observed fill/i.test(caveat), caveat ?? 'no caveat')
  await p.close()
}

await browser.close()

console.log(`\n  PASS ${ok.length}`)
for (const o of ok) console.log(`    ok   ${o}`)
if (failures.length) {
  console.log(`\n  FAIL ${failures.length}`)
  for (const f of failures) console.log(`    FAIL ${f}`)
  process.exit(1)
}
console.log('\n  All eleven journeys pass.')
