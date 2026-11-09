/**
 * Real-browser validation of the Our View firm summary.
 *
 * The unit tests assert the rules; this asserts that the rendered surface
 * obeys them and is actually readable — that the summary is SHORT, that no
 * analyst's prose is reproduced in full, that a single contributor does not
 * read as a firm position, and that aliased sections appear at all.
 *
 * Exits non-zero on failure so it can gate.
 *
 *   node desktop-harness/probe-our-view.mjs
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

// ─── 1. The populated firm view ──────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))

  await page.goto(`${base}?surface=our-view&h=2400`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="our-view-summary"]')
  await page.waitForTimeout(200)

  const text = await page.evaluate(() => document.body.innerText)

  /*
   * ── Attribution ──
   *
   * Case-insensitive throughout: the counts are styled `uppercase`, so
   * `innerText` returns "5 CONTRIBUTORS". The first version of this probe
   * matched the source casing and failed a correct surface.
   *
   * Five, not four: Wei Chen's thesis row is markup-only and excluded, but
   * their Catalysts row is live, so they are still a contributor. The
   * exclusion rule is about blank EXCERPTS, not about erasing a person who
   * wrote elsewhere.
   */
  check('contributors are counted', /5 contributors/i.test(text), text.slice(0, 160))
  check('the covering analyst is marked', /Dana Rivera/.test(text) && /covering/i.test(text))
  check('the viewer is marked as themselves', /Sam Okafor \(you\)/.test(text))
  check('an unresolved author reads as unknown, not as the firm',
    /Unknown analyst/.test(text))

  // ── No fabricated firm position ──
  check('never claims a firm conclusion',
    !/the firm (thinks|believes|rates)/i.test(text)
    && !/our rating is/i.test(text)
    && !/consensus view/i.test(text))
  check('says excerpts are verbatim and attributed',
    /verbatim and attributed/i.test(text))

  // ── Disagreement shown, not collapsed ──
  check('flags the field four analysts wrote in',
    await page.locator('[data-testid="our-view-multiple-investment-thesis"]').count() > 0)
  const flag = await page.locator('[data-testid="our-view-multiple-investment-thesis"]').innerText()
  check('the flag counts the views', /4 views/i.test(flag), flag)
  check('overflow links out rather than printing the fourth view',
    /1 more in the individual views/.test(text))
  check('the dissenting view is one of the ones shown',
    /less constructive/.test(text))

  // ── Aliased section keys ──
  /*
   * `key-risks` maps to ['risks_to_thesis', 'risks'] and the fixture stores
   * one analyst's risk prose under each. Both must appear in the one card.
   */
  const risks = await page.locator('[data-testid="our-view-section-key-risks"]').innerText()
  check('risk prose under the alias is included', /App Store remedies/.test(risks), risks)
  check('risk prose under the primary key is included', /China/.test(risks), risks)
  check('both risk authors are attributed',
    /Sam Okafor/.test(risks) && /Mia Lindqvist/.test(risks))

  // ── Freshness ──
  check('the newest update is dated', /newest update/.test(text))
  check('stale research is called stale', /6mo ago/.test(text))

  // ── Exclusions ──
  check('an archived contribution is excluded', !/Superseded/.test(text))
  check('an unwritten template field renders no card',
    await page.locator('[data-testid="our-view-section-competitive-position"]').count() === 0)
  const thesisCard = await page.locator('[data-testid="our-view-section-investment-thesis"]').innerText()
  check('a markup-only contribution adds no blank excerpt',
    !/Wei Chen\s*\n\s*\n/.test(thesisCard), thesisCard)

  // ── It is a SUMMARY: the thing that was wrong before ──
  const chars = text.replace(/\s+/g, ' ').length
  check('the whole summary is short', chars < 2600, `${chars} chars`)

  const h = await page.evaluate(() =>
    document.querySelector('[data-testid="our-view-summary"]').getBoundingClientRect().height)
  check('it fits in about two screens, not twenty', h < 1400, `${Math.round(h)}px`)

  // No single excerpt may run to a paragraph — that is the document returning.
  const excerptLengths = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="our-view-section-"] li span.block')]
      .map(e => e.innerText.trim().length))
  check('every excerpt is one sentence-ish',
    excerptLengths.length > 0 && Math.max(...excerptLengths) <= 195,
    JSON.stringify(excerptLengths))
  /*
   * The long fixture runs ~470 characters over five sentences. Its closing
   * sentences must not be on screen — that is what "summary" means here. An
   * earlier version of this check asserted the SECOND sentence was absent
   * too, which was wrong: filling the budget with whole sentences is the
   * deliberate behaviour, because clipping to one dropped the actual claim
   * out of every entry.
   */
  check('no excerpt reproduces a full contribution',
    !/another three years in it on our numbers/.test(text))
  check('the second sentence of a long contribution is kept',
    /what makes the cash flow underwritable/.test(text))

  // ── Navigation into the full document ──
  await page.locator('[data-testid="our-view-author-u-lindqvist"]').click()
  await page.waitForTimeout(120)
  const nav = await page.evaluate(() => document.body.getAttribute('data-last-nav'))
  check('a contributor opens their own research', nav === '{"analyst":"u-lindqvist"}', String(nav))

  check('no console errors', errors.length === 0, errors.join(' | '))
  await page.close()
}

// ─── 2. One contributor must not read as the firm ────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${base}?surface=our-view&view=single&h=900`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="our-view-summary"]')
  const text = await page.evaluate(() => document.body.innerText)

  check('singular wording',
    /1 contributor\b/i.test(text) && !/1 contributors/i.test(text), text.slice(0, 120))
  check('no disagreement flag with one view',
    await page.locator('[data-testid^="our-view-multiple-"]').count() === 0)
  check('one opinion is not presented as the firm position',
    !/the firm/i.test(text) && !/we (believe|rate|conclude)/i.test(text))
  await page.close()
}

// ─── 3. Nothing written says so, and does not invent a view ──────────────
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${base}?surface=our-view&view=empty&h=600`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="our-view-empty"]')
  const text = await page.evaluate(() => document.body.innerText)

  check('the empty case names the gap', /No one has written a view on AAPL yet/.test(text))
  check('the empty case disclaims generating one',
    /does not generate one/.test(text))
  check('the empty case is not an error', !/could not be loaded|error/i.test(text))
  await page.close()
}

// ─── 4. Phone width ──────────────────────────────────────────────────────
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(`${base}?surface=our-view&h=2800`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="our-view-summary"]')
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal overflow at 390px', overflow <= 1, `${overflow}px`)
  await page.close()
}

await browser.close()

console.log(`\n${ok.length} passed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
if (failures.length) {
  console.log(`\n${failures.length} failed`)
  process.exit(1)
}
console.log('all checks passed')
