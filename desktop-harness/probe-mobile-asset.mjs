/**
 * Real-browser validation of the mobile asset page (Increment 2C).
 *
 * Runs at three real phone widths, because "works on mobile" is a claim about
 * dimensions and jsdom has none. Checks the four domains render, that the
 * truth semantics match desktop, that tap targets are thumb-sized, that
 * nothing overflows horizontally, and that the unheld/no-history security
 * says so instead of inventing content.
 *
 *   node desktop-harness/probe-mobile-asset.mjs
 */
import { chromium } from '@playwright/test'

const base = process.env.HARNESS_URL ?? 'http://localhost:5418/'
const failures = []
const ok = []
const check = (n, c, d = '') => { c ? ok.push(n) : failures.push(`${n}${d ? ` — ${d}` : ''}`) }

/** iPhone SE, iPhone 14/15, iPhone 15 Pro Max. The narrowest matters most. */
const PHONES = [
  { name: 'iPhone SE', w: 375, h: 667 },
  { name: 'iPhone 14', w: 390, h: 844 },
  { name: 'iPhone 15 Pro Max', w: 430, h: 932 },
]

const browser = await chromium.launch()

// ─── 1. Each phone width ──────────────────────────────────────────────────
for (const phone of PHONES) {
  const page = await browser.newPage({
    viewport: { width: phone.w, height: phone.h },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  })
  /*
   * Genuine errors only.
   *
   * The harness has no backend, so `TickerQuoteBadge` and anything else that
   * reaches Supabase logs ERR_NAME_NOT_RESOLVED or a 401. Those are facts
   * about this environment, not defects in the surface, and counting them
   * would make the probe permanently red and therefore permanently ignored.
   * A JS exception or any other console error still fails.
   *
   * The cost of this exclusion: quote freshness cannot be validated here.
   * That is recorded as unverified rather than quietly assumed.
   */
  const ENVIRONMENTAL = /ERR_NAME_NOT_RESOLVED|Failed to load resource|status of 401|status of 403/i
  const errs = []
  page.on('pageerror', e => errs.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (ENVIRONMENTAL.test(text)) return
    errs.push(text)
  })

  await page.goto(`${base}?surface=mobile-asset&vh=${phone.h}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')
  await page.waitForTimeout(250)

  const t = await page.evaluate(() => document.body.innerText)

  /*
   * ── Parity with the desktop conclusion ──
   *
   * The phone used to open on Position and reduce the whole of belief to
   * "$268 target +16%" — no rating, no range, no edge — so the two shells
   * answered different questions about one name. These assert the four
   * conclusions are on the phone's first screen, and that none of them is
   * then repeated by a band below.
   */
  check(`${phone.name}: conclusion band is first`, /OUR RATING/i.test(t))
  check(`${phone.name}: rating with its n`, /Buy/.test(t) && /3 of 5/.test(t))
  check(`${phone.name}: target with upside`, /\$268/.test(t) && /\+15\.8% to spot/.test(t))
  check(`${phone.name}: bear\/bull with skew`, /\$168 – \$296/.test(t) && /1\.0:1/.test(t))
  check(`${phone.name}: exposure`, /2\.55%/.test(t))
  check(`${phone.name}: the differentiated view is quoted`,
    /WHERE WE DIFFER/i.test(t) && /contract term|policy variable/.test(t))

  // Nothing above may be restated by a band below it.
  const targetCopies = (t.match(/\$268/g) || []).length
  check(`${phone.name}: the target is stated once`, targetCopies === 1, `${targetCopies} copies`)
  const weightCopies = (t.match(/2\.5{1,2}%/g) || []).length
  check(`${phone.name}: the weight is stated once`, weightCopies === 1, `${weightCopies} copies`)

  const conclusionTop = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="mobile-conclusion"]')
    const pos = document.querySelector('[data-testid="mobile-band-position"]')
    return el && pos
      ? [Math.round(el.getBoundingClientRect().top), Math.round(pos.getBoundingClientRect().top)]
      : null
  })
  check(`${phone.name}: the conclusion sits above Position`,
    !!conclusionTop && conclusionTop[0] < conclusionTop[1], JSON.stringify(conclusionTop))

  // The four domains.
  check(`${phone.name}: Position band`, /LARGEST POSITION|POSITION/i.test(t))
  check(`${phone.name}: Belief band`, /BELIEF/i.test(t))
  check(`${phone.name}: Active work band`, /ACTIVE WORK/i.test(t))
  check(`${phone.name}: Decision memory band`, /DECISION MEMORY/i.test(t))

  // Identity and quote freshness.
  check(`${phone.name}: identity`, /AAPL/.test(t))

  // Snapshot is the landing tab.
  const landed = await page.evaluate(() =>
    !!document.querySelector('[data-testid="mobile-snapshot"]'))
  check(`${phone.name}: lands on Snapshot`, landed)

  // No horizontal overflow anywhere in the phone frame.
  const of = await page.evaluate(() => {
    const frame = document.querySelector('[data-harness="mobile-asset"]')
    const worst = [...frame.querySelectorAll('*')]
      .map(e => ({ t: e.tagName, over: e.scrollWidth - e.clientWidth }))
      .filter(x => x.over > 1)
      .sort((a, b) => b.over - a.over)[0] ?? null
    return { frameOver: frame.scrollWidth - frame.clientWidth, worst }
  })
  check(`${phone.name}: no horizontal overflow`, of.frameOver <= 1,
    `frame over by ${of.frameOver}px; worst ${JSON.stringify(of.worst)}`)

  // Tap targets. The sub-page tabs opt out of the global rule via
  // `no-touch-target`; everything this increment adds must not.
  const small = await page.evaluate(() => {
    const frame = document.querySelector('[data-harness="mobile-asset"]')
    return [...frame.querySelectorAll('[data-testid^="mobile-band"] button, [data-testid$="-action"], [data-testid$="-toggle"], [data-testid="mobile-memory-more"]')]
      .map(b => ({
        id: b.getAttribute('data-testid') ?? b.textContent?.trim().slice(0, 24),
        h: Math.round(b.getBoundingClientRect().height),
      }))
      .filter(x => x.h > 0 && x.h < 40)
  })
  check(`${phone.name}: tap targets >= 40px`, small.length === 0, JSON.stringify(small))

  check(`${phone.name}: no console errors`, errs.length === 0, errs.slice(0, 2).join(' | '))

  if (phone.w === 390) {
    await page.screenshot({ path: 'artifacts/mobile-asset-390.png', fullPage: false }).catch(() => {})
  }
  await page.close()
}

// ─── 2. Truth semantics match desktop ─────────────────────────────────────
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  await page.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="decision-memory-summary"]')
  const t = await page.evaluate(() => document.body.innerText)

  // The states are counted, and named with the same words as desktop.
  check('mobile names Recommended', /Recommended/.test(t))
  check('mobile names Decided', /Decided/.test(t))
  check('mobile names Unfilled', /Unfilled/.test(t))
  check('mobile names Executed', /Executed/.test(t))
  check('mobile names Reviewed', /Reviewed/.test(t))

  // The caveat, which is the whole point: an execution count that mixes
  // observed fills with assumed ones must say so.
  const caveat = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="decision-memory-unobserved-caveat"]')
    return el?.textContent ?? null
  })
  check('mobile flags unobserved executions', !!caveat && /not\s+evidenced by an observed fill/i.test(caveat),
    caveat ?? 'caveat element absent')
  check('mobile names which grades', !!caveat && /assumed/i.test(caveat), caveat ?? '')

  // The headline must not claim more than the data supports.
  check('headline does not overstate execution',
    !/\b5 executed, all observed\b/.test(t),
    'claimed all observed when 4 of 5 are not')

  await page.close()
}

// ─── 3. Decision Memory on the Decisions tab ──────────────────────────────
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  await page.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')

  await page.locator('[data-testid="mobile-asset-tab-decisions"]').click()
  await page.waitForSelector('[data-testid="mobile-decision-memory"]')
  await page.waitForTimeout(250)
  const t = await page.evaluate(() => document.body.innerText)

  check('decisions tab shows the timeline', /DECISION MEMORY/i.test(t))
  // Proof grades render per row, with the same words.
  for (const g of ['VERIFIED', 'ASSUMED', 'ATTESTED']) {
    check(`mobile row proof grade ${g}`, new RegExp(g, 'i').test(t))
  }
  // Rows paginate rather than rendering 19 cards at once.
  const moreBtn = await page.locator('[data-testid="mobile-memory-more"]').count()
  check('mobile timeline paginates', moreBtn === 1, `more buttons=${moreBtn}`)

  // Expanding works and does not overflow.
  if (moreBtn) {
    await page.locator('[data-testid="mobile-memory-more"]').click()
    await page.waitForTimeout(200)
    const of = await page.evaluate(() => {
      const f = document.querySelector('[data-harness="mobile-asset"]')
      return f.scrollWidth - f.clientWidth
    })
    check('no overflow after expanding', of <= 1, `over by ${of}px`)
  }

  await page.screenshot({ path: 'artifacts/mobile-decisions-390.png' }).catch(() => {})
  await page.close()
}

// ─── 4. Portfolio scope ───────────────────────────────────────────────────
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  await page.goto(`${base}?surface=mobile-asset&book=pf-income`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')
  await page.waitForTimeout(250)
  const t = await page.evaluate(() => document.body.innerText)

  check('scoped Position names the selected book', /Core Income/.test(t))
  check('scoped title says Position, not Largest position',
    /\bPOSITION\b/i.test(t) && !/LARGEST POSITION/i.test(t))

  await page.close()
}

// ─── 5. Unheld security with no history ───────────────────────────────────
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  const errs = []
  page.on('pageerror', e => errs.push(e.message))
  await page.goto(`${base}?surface=mobile-asset&asset=empty`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')
  await page.waitForTimeout(250)
  const t = await page.evaluate(() => document.body.innerText)

  check('unheld says so', /Not held in any book you can see/i.test(t))
  /*
   * The Belief band used to headline the target, so an empty name read "No
   * target set." It headlines the THESIS now — the conclusion band above owns
   * the valuation — so the absence it reports is the absence of a case, which
   * is the more useful statement and the one the desktop makes.
   */
  check('no case says so', /No investment case has been written/i.test(t))
  check('an unrated name is not given a rating',
    /Not set/.test(t) && !/\b(Buy|Hold|Sell)\b/.test(t), t.slice(0, 160))
  check('nothing in flight says so', /Nothing in flight/i.test(t))
  check('no decision history says so', /No decision has been recorded/i.test(t))

  // It must not invent numbers.
  check('unheld invents no weight', !/%\s+of\s+/.test(t), t.slice(0, 200))
  check('unheld shows no book filter', (await page.locator('[data-testid="mobile-snapshot-book-filter"]').count()) === 0)
  check('unheld: no console errors', errs.length === 0, errs.slice(0, 2).join(' | '))

  // The empty page should not be taller than a screen and a half.
  const h = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="mobile-snapshot"]')
    return Math.round(el.getBoundingClientRect().height)
  })
  check('empty snapshot is compact', h < 900, `height=${h}px`)

  await page.screenshot({ path: 'artifacts/mobile-asset-empty.png' }).catch(() => {})
  await page.close()
}

// ─── 6. Navigation into deeper workflows ──────────────────────────────────
{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  })
  await page.goto(`${base}?surface=mobile-asset`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="mobile-snapshot"]')

  // Belief's action opens the Case tab, in place, without leaving the asset.
  await page.locator('[data-testid="mobile-band-belief-action"]').click()
  await page.waitForTimeout(250)
  const onCase = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="mobile-asset-tab-"][aria-current="true"]')]
      .map(b => b.getAttribute('data-testid')))
  check('Belief action opens the Case tab', onCase.some(x => /tab-case/.test(x ?? '')),
    JSON.stringify(onCase))

  // And back to Snapshot, preserving the surface.
  await page.locator('[data-testid="mobile-asset-tab-snapshot"]').click()
  await page.waitForTimeout(200)
  check('returns to Snapshot',
    (await page.locator('[data-testid="mobile-snapshot"]').count()) === 1)

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
console.log('\n  Mobile asset page works at phone dimensions. No failures.')
