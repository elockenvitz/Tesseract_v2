import { chromium } from '@playwright/test'
const base = process.env.HARNESS_URL ?? 'http://localhost:5417/'
const b = await chromium.launch()
for (const width of [1920, 1440]) {
  const p = await b.newPage({ viewport: { width, height: 1080 } })
  await p.goto(`${base}?surface=dashboard&h=900`, { waitUntil: 'networkidle' })
  await p.waitForSelector('[data-testid="today-tile"]')
  await p.locator('[data-testid="today-tile"]').first()
    .getByRole('button', { name: /Confirm execution|Review|Advance/i }).first().click()
  await p.waitForSelector('[data-testid="focus-header"]')
  await p.waitForTimeout(300)
  const r = await p.evaluate(() => {
    const h = document.querySelector('[data-testid="focus-header"]')
    const rect = h.getBoundingClientRect()
    const claim = h.querySelector('p')
    return {
      height: Math.round(rect.height),
      claimTruncated: claim ? claim.scrollWidth > claim.clientWidth + 1 : null,
      text: h.innerText.replace(/\n/g, ' | ').slice(0, 160),
    }
  })
  console.log(`@${width}  header ${r.height}px  truncated=${r.claimTruncated}`)
  console.log(`         ${r.text}`)
  await p.close()
}
await b.close()
