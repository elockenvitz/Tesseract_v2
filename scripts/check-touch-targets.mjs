/**
 * Touch-target check across every public surface, at phone width.
 *
 * jsdom has no layout, so a unit test cannot see this at all: the only
 * way to know a link is 19px tall is to measure a rendered one. This is
 * the script that found all six, and it is kept so the check is
 * repeatable rather than a thing that happened once.
 *
 * Exits non-zero when anything interactive is under 24px in either axis,
 * which is what makes it usable as a gate rather than a report.
 */
import { createRequire } from 'node:module'
const require = createRequire('file:///C:/dev/_wt-public-site/package.json')
const { chromium } = require('playwright')

const BASE = process.argv[2]
const MIN = 24

const ROUTES = ['/', '/login', '/signup', '/reset-password', '/invite/demo-token', '/legal', '/legal/privacy-policy']

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
const page = await ctx.newPage()

let bad = 0
for (const route of ROUTES) {
  await page.goto(BASE + route, { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  const small = await page.evaluate(min =>
    [...document.querySelectorAll('a, button, [role="tab"], input, select')]
      .map(el => {
        const r = el.getBoundingClientRect()
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          text: (el.textContent ?? '').trim().slice(0, 34) || el.tagName.toLowerCase(),
        }
      })
      .filter(o => o.w > 0 && o.h > 0 && (o.h < min || o.w < min)),
  MIN)

  console.log(`  ${route.padEnd(22)} ${small.length === 0 ? 'ok' : `${small.length} UNDER ${MIN}px`}`)
  for (const s of small) console.log(`       ${s.w}x${s.h}  "${s.text}"`)
  bad += small.length
}

await browser.close()
console.log(bad === 0 ? '\nPASS: every target is at least 24px' : `\nFAIL: ${bad} target(s) under ${MIN}px`)
process.exit(bad === 0 ? 0 : 1)
