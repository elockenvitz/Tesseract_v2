/**
 * Real-browser validation of the asset Decision Memory timeline.
 *
 * Asserts the things a unit test cannot: that the distinctions are VISIBLE,
 * that the chronology reads causally, that the proof grades render with
 * different words, and that the empty case says something useful.
 *
 * Exits non-zero on failure so it can gate, rather than printing and passing.
 *
 *   node desktop-harness/probe-decision-memory.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const failures = []
const ok = []

function check(name, condition, detail = '') {
  if (condition) ok.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()

// ─── 1. The populated case, at the width the timeline actually gets ───────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const consoleErrors = []
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`))

  await page.goto(`${base}?surface=decision-timeline&h=2600`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness="decision-timeline"]')
  await page.waitForTimeout(300)

  /*
   * Expand first. DEFAULT_VISIBLE is 15 and the fixture carries 19, so four
   * rows sit behind "Show more" — including the recommendations. Asserting
   * before expanding measured the fold, not the surface.
   */
  for (let i = 0; i < 4; i++) {
    const more = page.getByRole('button', { name: /Show \d+ more events/ })
    if (!(await more.count())) break
    await more.first().click()
    await page.waitForTimeout(120)
  }

  const text = await page.evaluate(() => document.body.innerText)

  // The four states must each be nameable on screen.
  check('recommendation is visible', /RECOMMENDED/i.test(text))
  check('PM decision is visible', /DECIDED/i.test(text))
  check('commitment is visible', /COMMITTED/i.test(text))
  check('unfilled commitment is visible', /UNFILLED/i.test(text))
  check('execution is visible', /EXECUTED/i.test(text))
  check('review is visible', /REVIEWED/i.test(text))

  // Commitment and execution must not be the same word.
  check('committed and executed are different words',
    /COMMITTED/i.test(text) && /EXECUTED/i.test(text) && !/COMMITTED/.test('EXECUTED'))

  // The proof grades.
  for (const grade of ['Verified', 'Assumed', 'Attested', 'Backfilled', 'Unattributed']) {
    check(`proof grade rendered: ${grade}`, new RegExp(grade, 'i').test(text))
  }

  // Modification is distinguished from plain acceptance.
  check('accepted-with-modification is distinguished', /Accepted \(modified\)/i.test(text))
  // Withdrawal is not a rejection.
  check('withdrawal is its own state', /WITHDRAWN/i.test(text))
  check('deferral names its date', /Deferred until 2026-07-01/.test(text))

  // Causal order: within 2026-06-02 the recommendation precedes the decision
  // precedes the execution. The list renders newest-first, so in DOM order
  // the execution appears ABOVE the decision that caused it.
  const order = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('button')]
      .map(b => b.innerText.replace(/\n/g, ' '))
      .filter(t => /RECOMMENDED|DECIDED|COMMITTED|EXECUTED|UNFILLED|REVIEWED|OUTCOME|THESIS|IDEA|ESCALATED|WITHDRAWN|DEFERRED/i.test(t))
    return rows
  })
  const idx = (re) => order.findIndex(t => re.test(t))
  const iExec = idx(/EXECUTED.*\+45bps/i)
  const iDecision = idx(/DECIDED.*Add — Accepted/i)
  const iRec = idx(/RECOMMENDED.*2\.5%/i)
  check('same-day chronology is causal (newest first)',
    iExec >= 0 && iDecision >= 0 && iRec >= 0 && iExec < iDecision && iDecision < iRec,
    `exec=${iExec} decision=${iDecision} rec=${iRec}`)

  // Actors and portfolios are attributed.
  check('actor is attributed', /Priya Nair|Ana Bell/.test(text))
  check('portfolio is attributed', /Tech & Consumer Growth/.test(text))

  // The assumed-execution tooltip must say what it means.
  const assumedTitle = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[title]')]
      .find(e => e.textContent?.trim() === 'Assumed')
    return el?.getAttribute('title') ?? null
  })
  check('assumed execution explains itself',
    !!assumedTitle && /no system and no person observed/i.test(assumedTitle),
    assumedTitle ?? 'no title attribute')

  // Layout sanity: no horizontal overflow at this width.
  const overflow = await page.evaluate(() => {
    const el = document.querySelector('[data-harness="decision-timeline"]')
    return { scrollW: el.scrollWidth, clientW: el.clientWidth }
  })
  check('no horizontal overflow', overflow.scrollW <= overflow.clientW + 1,
    `scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`)

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  // Phase filters narrow the list.
  const allCount = await page.locator('[data-harness] button').count()
  const execFilter = page.getByRole('button', { name: /^Trades/ })
  if (await execFilter.count()) {
    await execFilter.first().click()
    await page.waitForTimeout(200)
    const t2 = await page.evaluate(() => document.body.innerText)
    check('execution filter hides recommendations', !/RECOMMENDED/i.test(t2))
    check('execution filter keeps executions', /EXECUTED/i.test(t2))
  } else {
    failures.push('execution phase filter not found')
  }
  void allCount

  await page.screenshot({
    path: 'artifacts/decision-memory-1440.png', fullPage: true,
  }).catch(() => {})
  await page.close()
}

// ─── 2. Navigation targets ────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}?surface=decision-timeline&h=2600`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness="decision-timeline"]')

  // A recommendation row routes to the Ideas workspace, not a 'trade-queue' tab.
  for (let i = 0; i < 4; i++) {
    const more = page.getByRole('button', { name: /Show \d+ more events/ })
    if (!(await more.count())) break
    await more.first().click()
    await page.waitForTimeout(120)
  }
  const recRow = page.locator('button', { hasText: 'Recommendation submitted — 2.5%' }).first()
  await recRow.click()
  await page.waitForTimeout(150)
  const nav = await page.evaluate(() => document.body.getAttribute('data-last-nav'))
  check('recommendation click routes somewhere', !!nav, 'no data-last-nav recorded')
  if (nav) {
    const d = JSON.parse(nav)
    check('routes to ideas-v2, not trade-queue', d.id === 'ideas-v2', `got id=${d.id}`)
    check('carries the originating idea', d.data?.selectedIdeaId === 'idea-1',
      `got ${JSON.stringify(d.data)}`)
  }

  // A thesis change has no destination and must be inert.
  const thesisRow = page.locator('button', { hasText: 'Thesis — bull case edit' }).first()
  const disabled = await thesisRow.isDisabled().catch(() => null)
  check('thesis row is inert (no destination)', disabled === true, `disabled=${disabled}`)

  await page.close()
}

// ─── 3. Portfolio filtering ───────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}?surface=decision-timeline&h=2600&book=pf-income`,
    { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness="decision-timeline"]')
  await page.waitForTimeout(200)
  const text = await page.evaluate(() => document.body.innerText)

  check('scoped to the selected book', /Core Income/.test(text))
  check('other books are excluded', !/Tech & Consumer Growth/.test(text))
  // Asset-level facts survive a book filter: they are not a book's property.
  check('asset-level facts survive the book filter',
    /Thesis — bull case edit/.test(text) && /Price target hit/.test(text))

  await page.close()
}

// ─── 4. The empty case ────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}?surface=decision-timeline&h=900&asset=empty`,
    { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-harness="decision-timeline"]')
  await page.waitForTimeout(200)
  const text = await page.evaluate(() => document.body.innerText)

  check('empty state says something', text.trim().length > 0)
  /*
   * Count ROWS, not words. The empty state's copy legitimately contains
   * "decisions" and "executed trades" in a sentence explaining what will
   * appear here; matching body text flagged that explanation as fabricated
   * data. What must be zero is timeline rows.
   */
  const emptyRows = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-harness] button span')]
      .map(s => s.textContent?.trim() ?? '')
      .filter(t => /^(IDEA|ESCALATED|THESIS|RECOMMENDED|DECIDED|DEFERRED|WITHDRAWN|COMMITTED|UNFILLED|EXECUTED|OUTCOME|REVIEWED)$/.test(t))
    return chips.length
  })
  check('empty state does not fabricate rows', emptyRows === 0, `rows=${emptyRows}`)

  const h = await page.evaluate(() => {
    const el = document.querySelector('[data-harness="decision-timeline"] > div > div')
    return el ? Math.round(el.getBoundingClientRect().height) : null
  })
  check('empty state is compact', h === null || h < 220, `height=${h}px`)

  await page.screenshot({ path: 'artifacts/decision-memory-empty.png' }).catch(() => {})
  await page.close()
}

await browser.close()

console.log(`\n  PASS ${ok.length}`)
for (const o of ok) console.log(`    ok   ${o}`)
if (failures.length) {
  console.log(`\n  FAIL ${failures.length}`)
  for (const f of failures) console.log(`    FAIL ${f}`)
  process.exit(1)
}
console.log('\n  Decision Memory renders every distinction. No failures.')
