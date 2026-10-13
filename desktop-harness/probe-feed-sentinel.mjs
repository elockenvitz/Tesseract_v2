/**
 * Reproduces the pilot report: the mobile Ideas feed stops advancing after
 * you navigate away and come back.
 *
 *   node desktop-harness/probe-feed-sentinel.mjs
 *
 * Runs the reported sequence against both attachment styles in a real
 * browser, with real scrolling, at phone dimensions:
 *
 *   1. open the feed, scroll to the bottom  -> pagination fires, more tiles
 *   2. go to Explore, come back
 *   3. scroll to the bottom again           -> does it still fire?
 *
 * `attach=ref` is the shipped code's shape and must FAIL step 3. `attach=state`
 * is the fix and must pass it. A probe that only exercised the fix could not
 * tell a fix from a coincidence.
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

async function run(attach, query = '') {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  })
  await page.goto(`${base}?surface=feed-sentinel&attach=${attach}${query}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-testid="feed-scroller"]')

  const loads = () => page.locator('[data-testid="loads"]').innerText()
  const tiles = () => page.locator('[data-feed-tile]').count()

  /** Scroll to the bottom the way a thumb does, then let the observer settle. */
  const toBottom = async () => {
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="feed-scroller"]')
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(350)
  }

  const before = await tiles()
  await toBottom()
  const afterFirst = await tiles()
  const loadsFirst = await loads()

  // Navigate away and back — the reported sequence.
  await page.locator('[data-testid="go-explore"]').click()
  await page.waitForSelector('[data-testid="explore"]')
  await page.locator('[data-testid="go-feed"]').click()
  await page.waitForSelector('[data-testid="feed-scroller"]')
  await page.waitForTimeout(150)

  await toBottom()
  const afterReturn = await tiles()
  const loadsReturn = await loads()

  // And again, because the report said it stayed broken.
  await page.locator('[data-testid="go-explore"]').click()
  await page.waitForSelector('[data-testid="explore"]')
  await page.locator('[data-testid="go-feed"]').click()
  await page.waitForSelector('[data-testid="feed-scroller"]')
  await toBottom()
  const afterSecondReturn = await tiles()

  await page.close()
  return { before, afterFirst, afterReturn, afterSecondReturn, loadsFirst, loadsReturn }
}

/* ── The shipped shape: must reproduce the bug ─────────────────────────── */
const broken = await run('ref')
check('ref: pagination works on first load', broken.afterFirst > broken.before,
  `${broken.before} -> ${broken.afterFirst}`)
check('ref: REPRODUCED — pagination is dead after returning',
  broken.afterReturn === broken.afterFirst,
  `expected no growth, got ${broken.afterFirst} -> ${broken.afterReturn}`)
check('ref: still dead after a second return',
  broken.afterSecondReturn === broken.afterFirst,
  `${broken.afterFirst} -> ${broken.afterSecondReturn}`)

/* ── The fix: must not ─────────────────────────────────────────────────── */
const fixed = await run('state')
check('state: pagination works on first load', fixed.afterFirst > fixed.before,
  `${fixed.before} -> ${fixed.afterFirst}`)
check('state: pagination still works after returning', fixed.afterReturn > fixed.afterFirst,
  `${fixed.afterFirst} -> ${fixed.afterReturn}`)
check('state: and after a second return', fixed.afterSecondReturn > fixed.afterReturn,
  `${fixed.afterReturn} -> ${fixed.afterSecondReturn}`)

/* ── Degenerate feeds: the fix must not invent tiles ───────────────────── */

/*
 * An empty feed and a one-tile feed are where a careless "make scrolling
 * work" fix shows itself. The requirement was explicit: do not manufacture
 * filler. So these assert the OPPOSITE of growth — the fix re-arms the
 * observer, and an observer with nothing to fetch adds nothing.
 */
const empty = await run('state', '&tiles=0&exhausted=1')
check('empty feed stays empty through a return cycle',
  empty.before === 0 && empty.afterReturn === 0 && empty.afterSecondReturn === 0,
  JSON.stringify(empty))

const one = await run('state', '&tiles=1&exhausted=1')
check('a one-tile feed does not grow a second tile',
  one.before === 1 && one.afterFirst === 1 && one.afterSecondReturn === 1,
  JSON.stringify(one))

const exhausted = await run('state', '&tiles=8&exhausted=1')
check('an exhausted feed presents an end rather than growing',
  exhausted.afterFirst === 8 && exhausted.afterSecondReturn === 8,
  JSON.stringify(exhausted))
check('an exhausted feed still re-arms its observer after a return',
  // It fires and declines, which is what distinguishes "finished" from
  // "broken". A dead observer and a finished feed look identical on screen;
  // this is the assertion that tells them apart.
  Number(exhausted.loadsReturn.split('=')[1]) > Number(exhausted.loadsFirst.split('=')[1]),
  `${exhausted.loadsFirst} -> ${exhausted.loadsReturn}`)

await browser.close()

console.log(`\nref  : ${JSON.stringify(broken)}`)
console.log(`state: ${JSON.stringify(fixed)}\n`)
console.log(`${ok.length} passed`)
for (const f of failures) console.log(`  FAIL  ${f}`)
if (failures.length) {
  console.log(`\n${failures.length} failed`)
  process.exit(1)
}
console.log('The bug reproduces on the shipped shape and does not on the fix.')
