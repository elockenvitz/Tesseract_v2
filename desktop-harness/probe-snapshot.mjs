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
