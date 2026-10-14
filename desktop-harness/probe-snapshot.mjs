/**
 * Real-browser validation of the redesigned desktop Investment Snapshot.
 *
 * The unit tests assert what the conclusion band refuses to say. This asserts
 * the things only a rendered page can answer: that the conclusion is ABOVE
 * everything else, that no claim is printed twice, that the two columns are
 * roughly balanced rather than one running 400px past the other, and that the
 * whole surface still answers its four questions inside a screen and a half.
 *
 *   node desktop-harness/probe-snapshot.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const failures = []
const ok = []
const check = (name, cond, detail = '') => {
  if (cond) ok.push(name)
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch()

// ─── 1. The populated name ───────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

  await page.goto(`${base}?surface=snapshot&h=2200`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="investment-snapshot"]')
  await page.waitForTimeout(250)
  const text = await page.evaluate(() => document.body.innerText)

  // ── The four questions, answered ──
  check('the rating is stated with its n', /Buy/.test(text) && /3 of 5 analysts/.test(text))
  check('the target is stated with upside', /\$268\.00/.test(text) && /\+15\.8% to spot/.test(text))
  check('the valuation range is stated with skew',
    /\$168 – \$296/.test(text) && /-27\.4% \/ \+27\.9%/.test(text) && /1\.0:1/.test(text))
  check('exposure is stated', /2\.55%/.test(text) && /3 books/.test(text))
  check('the differentiated view is quoted', /contract term/.test(text))
  check('the quote is attributed', /WHERE WE DIFFER/i.test(text) && /Ana Bell/.test(text))

  // ── The conclusion leads ──
  const conclusionTop = await page.evaluate(() =>
    document.querySelector('[data-testid="investment-conclusion"]').getBoundingClientRect().top)
  const caseTop = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2,h3')].find(e => e.textContent.trim() === 'The case')
    return h ? h.getBoundingClientRect().top : Infinity
  })
  check('the conclusion sits above the argument', conclusionTop < caseTop,
    `conclusion ${Math.round(conclusionTop)}, case ${Math.round(caseTop)}`)
  check('the conclusion is in the first screen', conclusionTop < 400, `${Math.round(conclusionTop)}px`)

  /*
   * ── Nothing is said twice ──
   *
   * The band quotes the variant view and The case lists the sections. The
   * first build rendered `where_different` in both, so one paragraph appeared
   * twice in a single eyeful; a reader cannot tell whether two identical
   * quotes are one record or two.
   */
  const variantCount = (text.match(/Consensus treats the services take-rate/g) || []).length
  check('the variant view appears exactly once', variantCount === 1, `${variantCount} copies`)
  const thesisCount = (text.match(/Services mix is still being valued as hardware/g) || []).length
  check('the thesis appears exactly once', thesisCount === 1, `${thesisCount} copies`)

  /*
   * ── The contributor roster quotes nothing ──
   *
   * "Who has written" moved here out of the Research tab, and it sits
   * directly under "The case", which already renders one verbatim excerpt per
   * core section from the SAME contributions. Rendering both in full put the
   * thesis on screen twice. The roster reports coverage and disagreement
   * only — who wrote where, how many entries, where more than one analyst
   * wrote the same section.
   */
  const roster = await page.locator('[data-testid="our-view-roster"]').count()
  check('the contributor roster is present', roster === 1, `${roster} found`)
  if (roster === 1) {
    const rosterText = await page.locator('[data-testid="our-view-roster"]').innerText()
    check('the roster carries no prose',
      !/\. /.test(rosterText) && rosterText.length < 400,
      rosterText.slice(0, 160))
    check('the roster still reports disagreement', /views/i.test(rosterText), rosterText.slice(0, 120))
  }
  check('contributors are named with their counts',
    /5 contributors/i.test(text) && /Dana Rivera/.test(text))

  // Section headings must be reader-facing, not column names.
  check('section names are not raw column keys',
    !/where_different|risks_to_thesis/.test(text))
  check('the risks section is named for a reader', /Risks to the thesis/.test(text))

  // ── Balance ──
  const cols = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="investment-snapshot"] .grid')
    if (!grid) return null
    const kids = [...grid.children].map(c => Math.round(c.getBoundingClientRect().height))
    return kids
  })
  check('the page lays out in two columns', Array.isArray(cols) && cols.length === 2,
    JSON.stringify(cols))
  if (cols?.length === 2) {
    const diff = Math.abs(cols[0] - cols[1])
    const longer = Math.max(cols[0], cols[1])
    check('the columns are roughly balanced', diff / longer < 0.45,
      `${cols[0]} vs ${cols[1]} (${Math.round((diff / longer) * 100)}% apart)`)
  }

  // ── Density ──
  const h = await page.evaluate(() =>
    document.querySelector('[data-testid="investment-snapshot"]').getBoundingClientRect().height)
  check('the whole surface fits in about a screen and a half', h < 1500, `${Math.round(h)}px`)

  // ── Active work is reachable without reading the argument first ──
  const workTop = await page.evaluate(() => {
    const h = [...document.querySelectorAll('h2,h3')].find(e => e.textContent.trim() === 'Active work')
    return h ? h.getBoundingClientRect().top : Infinity
  })
  check('active work is above the fold of the second screen', workTop < 1200, `${Math.round(workTop)}px`)

  check('no console errors', errors.length === 0, errors.join(' | '))
  await page.close()
}

// ─── 1b. The loading -> loaded transition, in a real browser ─────────────
/*
 * This is the case that crashed the authenticated app:
 *
 *     Rendered more hooks than during the previous render.
 *
 * `InvestmentSnapshot` has `if (isLoading) return <SnapshotSkeleton />`
 * part-way down, and a `useMemo` had been placed BELOW it — so the loading
 * render ran seven hooks and the loaded render ran eight.
 *
 * Every other surface here mocks the query as already-resolved, which is
 * exactly why none of them could see it. `?loading=<ms>` makes the stub
 * resolve asynchronously like the real hook, so the transition actually
 * happens. Any React error fails this.
 */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const reactErrors = []
  page.on('pageerror', e => reactErrors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/ERR_NAME_NOT_RESOLVED|Failed to load resource|status of 40\d/i.test(t)) return
    reactErrors.push(t)
  })

  await page.goto(`${base}?surface=snapshot&loading=400&h=2400`, { waitUntil: 'domcontentloaded' })

  // The skeleton first — proof the loading branch was genuinely taken.
  await page.waitForSelector('[data-testid="snapshot-skeleton"]', { timeout: 3000 })
  check('the loading branch is actually entered', true)

  /*
   * Then the real surface, which is the render that used to throw.
   *
   * Caught rather than awaited bare: with the defect present the component
   * throws and never mounts, so a bare await dies with an opaque
   * `TimeoutError` and the probe reports nothing. Catching it turns the same
   * failure into a named check beside the React error that caused it.
   */
  let mounted = true
  try {
    await page.waitForSelector('[data-testid="investment-conclusion"]', { timeout: 8000 })
  } catch {
    mounted = false
  }
  await page.waitForTimeout(400)
  check('the Snapshot mounts after the query resolves', mounted,
    reactErrors.slice(0, 2).join(' | ') || 'never rendered, and React logged nothing')

  const hookErrors = reactErrors.filter(e =>
    /Rendered more hooks|Rendered fewer hooks|order of Hooks|Should have a queue/i.test(e))
  check('no hook-order error across the transition', hookErrors.length === 0, hookErrors.join(' | '))
  check('no React error of any kind across the transition',
    reactErrors.length === 0, reactErrors.slice(0, 2).join(' | '))

  // And it rendered, rather than merely not throwing.
  const text = await page.evaluate(() => document.body.innerText)
  check('the conclusion is present after loading', /OUR RATING/i.test(text))

  // The same transition on the empty security.
  const page2 = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errs2 = []
  page2.on('pageerror', e => errs2.push(e.message))
  await page2.goto(`${base}?surface=snapshot&asset=empty&loading=300&h=1600`, { waitUntil: 'domcontentloaded' })
  let mounted2 = true
  try {
    await page2.waitForSelector('[data-testid="investment-snapshot"]', { timeout: 8000 })
  } catch {
    mounted2 = false
  }
  await page2.waitForTimeout(300)
  check('the empty security survives the same transition',
    mounted2 && errs2.length === 0,
    mounted2 ? errs2.join(' | ') : 'never rendered')

  await page.close()
  await page2.close()
}

// ─── 2. The unwritten, unheld name ───────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  await page.goto(`${base}?surface=snapshot&asset=empty&h=1600`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="investment-snapshot"]')
  await page.waitForTimeout(200)
  const text = await page.evaluate(() => document.body.innerText)

  check('an absent rating says so rather than showing a neutral one', /Not set/.test(text))
  check('an absent case is named', /No investment case has been written for ZZZ/.test(text))
  check('an unheld name says so', /Not held/.test(text))
  /*
   * Scoped to the conclusion band, not the whole page.
   *
   * The first version of this check banned every `$<digit>` anywhere in the
   * document, which is not what "nothing is invented" means — Decision Memory
   * legitimately renders figures from records that DO exist on this security.
   * The claim being tested is that the band states no rating and no valuation
   * when none is on record, so it is asked of the band.
   */
  const band = await page.locator('[data-testid="investment-conclusion"]').innerText()
  check('the band invents no rating', !/\b(Buy|Hold|Sell)\b/i.test(band), band.slice(0, 120))
  check('the band invents no valuation', !/\$\d/.test(band), band.slice(0, 120))

  // The same sentence must not appear twice here either.
  const unheld = (text.match(/Not held in any book you can see/g) || []).length
  check('the held-nowhere fact is stated once', unheld <= 1, `${unheld} copies`)
  await page.close()
}

// ─── 3. Narrower desktop ─────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 } })
  await page.goto(`${base}?surface=snapshot&h=2400`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="investment-conclusion"]')
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal overflow at 1180px', overflow <= 1, `${overflow}px`)
  await page.close()
}

await browser.close()

console.log(`\n${ok.length} passed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
if (failures.length) {
  console.log(`\n${failures.length} failed`)
  process.exit(1)
}
console.log('Snapshot leads with the conclusion and repeats nothing.')
