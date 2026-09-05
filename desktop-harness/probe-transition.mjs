/**
 * Drive the Dashboard -> workspace transition and report what actually happens.
 *
 * Not a screenshot script: this answers the audit questions -- does the origin
 * survive, does scroll survive, does the destination name the object, is there
 * a layout jump -- from the live DOM rather than from reading the source.
 */
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const width = Number(process.argv[2] ?? 1920)
const label = process.argv[3] ?? 'audit'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const dir = '.shots'
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 1080 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
// A short container, so the deck genuinely scrolls and the round trip
// can be checked rather than assumed.
await page.goto(`${base}?surface=dashboard&h=900`, { waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="today-tile"]')
await page.waitForTimeout(400)

const lead = page.locator('[data-testid="today-tile"]').first()
const before = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="today-tile"]')
  const r = t.getBoundingClientRect()
  const scroller = document.querySelector('[data-testid="dashboard-browse"] > div')
  return {
    handle: t.getAttribute('data-focus-source'),
    rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
    scrollTop: scroller ? scroller.scrollTop : null,
  }
})
await page.screenshot({ path: `${dir}/${label}-t0-dashboard-${width}.png` })

// Scroll the deck so we can prove the position survives the round trip.
await page.evaluate(() => {
  const s = document.querySelector('[data-testid="dashboard-browse"] > div')
  if (s) s.scrollTop = 220
})
await page.waitForTimeout(120)
const scrolledTo = await page.evaluate(() =>
  document.querySelector('[data-testid="dashboard-browse"] > div')?.scrollTop ?? null)

// What the motion actually costs, read from the element rather than claimed.
const motion = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="dashboard-focus"]')
  return el ? getComputedStyle(el).animationDuration : null
})

const t0 = Date.now()
await lead.getByRole('button', { name: /Confirm execution|Review|Advance/i }).first().click()

// Immediately after the click, before any animation could finish.
await page.waitForTimeout(60)
await page.screenshot({ path: `${dir}/${label}-t1-transition-${width}.png` })

await page.waitForSelector('[data-testid="dashboard-focus"]', { timeout: 5000 }).catch(() => {})
await page.waitForTimeout(700)
const elapsed = Date.now() - t0
await page.screenshot({ path: `${dir}/${label}-t2-workspace-${width}.png` })

const during = await page.evaluate(() => {
  const focus = document.querySelector('[data-testid="dashboard-focus"]')
  const cs = focus ? getComputedStyle(focus) : null
  const browse = document.querySelector('[data-testid="dashboard-browse"]')
  const surface = document.querySelector('[data-testid="work-surface"]')
  const originStill = document.querySelector('[data-focus-source]')
  return {
    focusMounted: !!focus,
    animationDuration: cs?.animationDuration ?? null,
    transformOrigin: cs?.transformOrigin ?? null,
    focusHeader: document.querySelector('[data-testid="focus-header"]')?.getAttribute('data-symbol') ?? null,
    browseStillLaidOut: !!browse && browse.getBoundingClientRect().height > 0,
    browseHidden: browse?.className.includes('invisible') ?? null,
    originNodeStillInDom: !!originStill,
    // What the destination says about the object, in its first 400 chars.
    destinationText: (surface?.innerText ?? '(no work-surface)').slice(0, 400),
  }
})

// Back.
await page.locator('[data-testid="workspace-back"]').first().click().catch(() => {})
await page.waitForTimeout(500)
await page.screenshot({ path: `${dir}/${label}-t3-back-${width}.png` })

const after = await page.evaluate(() => {
  const t = document.querySelector('[data-testid="today-tile"]')
  const r = t?.getBoundingClientRect()
  const scroller = document.querySelector('[data-testid="dashboard-browse"] > div')
  return {
    handle: t?.getAttribute('data-focus-source') ?? null,
    rect: r ? { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) } : null,
    scrollTop: scroller ? scroller.scrollTop : null,
    focusGone: !document.querySelector('[data-testid="dashboard-focus"]'),
  }
})

console.log(`\n=== transition audit @ ${width} ===`)
console.log('origin handle      :', before.handle)
console.log('origin rect        :', JSON.stringify(before.rect))
console.log('scrolled deck to   :', scrolledTo)
console.log('focus mounted      :', during.focusMounted)
console.log('animation duration :', during.animationDuration)
console.log('transform-origin   :', during.transformOrigin)
console.log('focus header names :', during.focusHeader)
console.log('browse still laid out:', during.browseStillLaidOut, '(hidden:', during.browseHidden, ')')
console.log('origin node in DOM during focus:', during.originNodeStillInDom)
console.log('probe wall time    :', elapsed, 'ms (includes the probe own waits)')
console.log('--- destination says ---')
console.log(during.destinationText)
console.log('--- after Back ---')
console.log('handle restored    :', after.handle, after.handle === before.handle ? '(SAME)' : '(DIFFERENT)')
console.log('rect restored      :', JSON.stringify(after.rect))
console.log('scrollTop restored :', after.scrollTop, after.scrollTop === scrolledTo ? '(PRESERVED)' : '(LOST)')
console.log('focus unmounted    :', after.focusGone)
if (errs.length) console.log('PAGE ERRORS:', errs.slice(0, 3))

await browser.close()
