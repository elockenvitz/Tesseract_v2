/**
 * Renders public/social-preview.png — the image iMessage, Slack and the rest
 * show when someone sends a Tesseract link.
 *
 * ── Why a script and not a checked-in binary someone made once ───────────
 *
 * The output IS committed, because the preview has to exist as a plain static
 * asset with no build step behind it. But a 1200x630 PNG in git with no
 * source is a file nobody can safely change: the next person needing a tweak
 * either re-does the design from scratch or leaves it wrong. This is the
 * source, and re-running it reproduces the asset exactly.
 *
 *     node scripts/build-social-preview.mjs
 *
 * ── Why Chromium ─────────────────────────────────────────────────────────
 *
 * No image library is installed (no sharp, no PIL) and adding one to render a
 * single static asset is a dependency for nothing. Playwright's Chromium is
 * already here for the e2e guards, and it lays out type better than anything
 * we would otherwise reach for.
 *
 * ── The brand is reused, not invented ────────────────────────────────────
 *
 * The wordmark is the actual `Tesseract Logo.png`, so the letterforms and the
 * exact gold are the product's own rather than an approximation. The dark
 * ground and the amber glow come from `Tesseract Icon.png`. Nothing here is a
 * new visual language.
 *
 * ── What must NEVER go in this image ─────────────────────────────────────
 *
 * Invitation links carry a bearer token, and the preview is generated once,
 * statically, for every URL on the domain. It must therefore be generic:
 * no invitee address, no organisation or pilot name, no token, no portfolio
 * names, nothing read from the database. A crawler fetching an invite link
 * gets the same bytes as one fetching the home page.
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Inlined, because Chromium will not load file:// images into a data-URL page. */
const dataUri = (rel) =>
  `data:image/png;base64,${readFileSync(join(root, rel)).toString('base64')}`

const wordmark = dataUri('public/Tesseract Logo.png')
const icon = dataUri('public/Tesseract Icon.png')

/*
 * Sized for the smallest place it is read, not the largest.
 *
 * An iMessage preview is roughly 300px wide, so everything here is scaled as
 * if it will be seen at a quarter size: the wordmark takes a third of the
 * canvas, the tagline sits at 40px, and there is no third tier of text. A
 * layout that looks balanced at 1200px and unreadable at 300px is the usual
 * way these go wrong.
 */
const html = `
<!doctype html>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #0A0A0B;
    font-family: 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
    display: flex; align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  /* The icon's own glow, echoed as ambient light rather than pasted in as a
     second logo. Two marks competing at this size reads as clutter. */
  .glow {
    position: absolute; inset: -20% -10%;
    background-image: url('${icon}');
    background-size: 78% auto; background-position: 92% 50%;
    background-repeat: no-repeat;
    filter: blur(2px); opacity: 0.22;
    mask-image: radial-gradient(ellipse at 92% 50%, #000 0%, #000 42%, transparent 72%);
    -webkit-mask-image: radial-gradient(ellipse at 92% 50%, #000 0%, #000 42%, transparent 72%);
  }
  /* A hairline of warmth along the top, so the card does not read as a
     black rectangle in a dark-themed message list. */
  .rule {
    position: absolute; top: 0; left: 0; right: 0; height: 4px;
    background: linear-gradient(90deg, #E9C33D 0%, #E9C33D 38%, rgba(233,195,61,0) 88%);
  }
  .plate { position: relative; padding: 0 96px; width: 100%; }
  .wordmark { display: block; width: 420px; height: auto; }
  .tagline {
    margin-top: 34px; font-size: 40px; line-height: 1.28;
    color: #E8E8EA; font-weight: 400; letter-spacing: -0.015em;
    max-width: 620px;
  }
  .eyebrow {
    margin-top: 44px; font-size: 19px; letter-spacing: 0.17em;
    /* Bright enough to survive the ~300px-wide thumbnail iMessage actually
       renders. At #9A8A52 it disappeared there while looking fine at full
       size, which is the failure this whole file is scaled against. */
    text-transform: uppercase; color: #C2A85C; font-weight: 600;
  }
</style>
<div class="glow"></div>
<div class="rule"></div>
<div class="plate">
  <img class="wordmark" src="${wordmark}" alt="Tesseract">
  <p class="tagline">Decision intelligence<br>for investment teams.</p>
  <p class="eyebrow">Professional Early Access</p>
</div>
`

const browser = await chromium.launch()

const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  // 1x: the file is served as-is at 1200x630, which is what the OG tags
  // declare. A 2x render would be a 2400px image lying about its size.
  deviceScaleFactor: 1,
})
await page.setContent(html, { waitUntil: 'load' })
await page.evaluate(() => document.fonts.ready)
writeFileSync(join(root, 'public/social-preview.png'), await page.screenshot({ type: 'png' }))
await page.close()

/*
 * Favicon and touch icon, from the same source mark.
 *
 * `index.html` pointed at `/vite.svg`, which does not exist in `public/` —
 * so the request fell through the SPA catch-all and came back as 200 text/html.
 * The site has been shipping a broken favicon, not a default one.
 *
 * Downscaled here rather than pointing the tags at `Tesseract Icon.png`
 * directly: that file is 1024x1024 and 1.5MB, which is a lot to fetch on every
 * cold load to draw a 16px square.
 */
for (const [file, size] of [['favicon.png', 64], ['apple-touch-icon.png', 180]]) {
  const iconPage = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  })
  await iconPage.setContent(`
    <style>
      * { margin: 0; padding: 0; }
      html, body { width: ${size}px; height: ${size}px; background: #0A0A0B; }
      img { width: 100%; height: 100%; object-fit: cover; }
    </style>
    <img src="${icon}">
  `, { waitUntil: 'load' })
  writeFileSync(join(root, 'public', file), await iconPage.screenshot({ type: 'png' }))
  await iconPage.close()
}

await browser.close()
console.log('wrote public/social-preview.png, public/favicon.png, public/apple-touch-icon.png')
