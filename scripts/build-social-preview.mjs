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
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Inlined, because Chromium will not load file:// images into a data-URL page. */
const dataUri = (rel) =>
  `data:image/png;base64,${readFileSync(join(root, rel)).toString('base64')}`

const wordmark = dataUri('public/Tesseract Logo.png')
const glowIcon = dataUri('public/Tesseract Icon.png')

/**
 * The app's actual mark, lifted from the boot loader in `index.html`.
 *
 * ── Why this and not `Tesseract Icon.png` ────────────────────────────────
 *
 * The first version of this image used that PNG, which is a 1024px soft glow
 * on black. Scaled up to fill the canvas it stopped reading as a mark at all
 * and became a background texture — the preview looked like a photograph of a
 * cube rather than a product's icon.
 *
 * This is the wireframe the product itself draws: the resting frame of
 * `TesseractMark`, generated from `lib/brand/tesseract-geometry` and inlined
 * in `index.html` so the pre-JS splash can paint it. Reading it from there
 * means the preview shows the same figure the app shows, and cannot drift
 * from it — the alternative is a third hand-copied version of the geometry.
 */
function appMark() {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  const open = html.indexOf('<svg viewBox="0 0 100 100"')
  const close = html.indexOf('</svg>', open)
  if (open === -1 || close === -1) {
    throw new Error('app mark SVG not found in index.html — did the boot loader change?')
  }
  return html.slice(open, close + '</svg>'.length)
}

/*
 * Sized for the smallest place it is read, not the largest.
 *
 * An iMessage preview is roughly 300px wide, so everything here is scaled as
 * if it will be seen at a quarter size: the tagline sits at 42px and there is
 * no third tier of text. A layout that looks balanced at 1200px and
 * unreadable at 300px is the usual way these go wrong.
 *
 * The composition is a LOCKUP, not a scene: mark and wordmark on one baseline
 * at the proportions of a launcher icon beside its name, tagline beneath, all
 * on one left axis. It scans as a single object at thumbnail size.
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
    display: flex; align-items: center;
    position: relative; overflow: hidden;
  }
  /*
   * What is left of the old background icon: a wash, not a figure.
   *
   * It was the glow PNG at 78% width and 0.22 opacity, which dominated the
   * canvas and read as a photograph of a cube rather than as branding. Here
   * it is pushed off the right edge, heavily blurred and at 0.06, so it is a
   * warm cast on the panel rather than a second mark competing with the real
   * one. At thumbnail size it is barely perceptible, which is the point — it
   * exists only so the plate is not flat black.
   */
  .wash {
    position: absolute; top: -34%; right: -30%; width: 74%; height: 168%;
    background-image: url('${glowIcon}');
    background-size: contain; background-position: center; background-repeat: no-repeat;
    filter: blur(30px); opacity: 0.06;
  }
  /* A hairline of warmth along the top, so the card does not read as a
     black rectangle in a dark-themed message list. */
  .rule {
    position: absolute; top: 0; left: 0; right: 0; height: 4px;
    background: linear-gradient(90deg, #E9C33D 0%, #E9C33D 38%, rgba(233,195,61,0) 88%);
  }
  .plate { position: relative; padding: 0 104px; width: 100%; }
  /* Mark and wordmark on one baseline, the way an app presents itself. */
  .lockup { display: flex; align-items: center; gap: 30px; }
  .mark { width: 128px; height: 128px; flex: none; }
  .mark svg { width: 100%; height: 100%; display: block; }
  /* Height-matched to the mark rather than set by width, so the two scale
     together if either is ever resized. */
  .wordmark { display: block; height: 74px; width: auto; }
  .tagline {
    margin-top: 44px; font-size: 42px; line-height: 1.26;
    color: #E8E8EA; font-weight: 400; letter-spacing: -0.015em;
    max-width: 660px;
  }
  .eyebrow {
    margin-top: 40px; font-size: 19px; letter-spacing: 0.17em;
    /* Bright enough to survive the ~300px-wide thumbnail iMessage actually
       renders. At #9A8A52 it disappeared there while looking fine at full
       size, which is the failure this whole file is scaled against. */
    text-transform: uppercase; color: #C2A85C; font-weight: 600;
  }
</style>
<div class="wash"></div>
<div class="rule"></div>
<div class="plate">
  <div class="lockup">
    <div class="mark">${appMark()}</div>
    <img class="wordmark" src="${wordmark}" alt="Tesseract">
  </div>
  <p class="tagline">Decision intelligence<br>for investment teams.</p>
  <p class="eyebrow">Early Access</p>
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
/*
 * The preview is published under a filename carrying a hash of its own bytes,
 * and every reference to it is rewritten here rather than by hand.
 *
 * The reason is a bug that lasted from #240 until it was investigated: the
 * image shipped as `/social-preview.png`, was replaced 22 minutes later at
 * that same URL, and link-preview caches are keyed on the URL. Those caches
 * belong to Apple, Meta, Slack and WhatsApp; several ignore `Cache-Control`
 * and Apple's is effectively permanent. The deployed asset was correct the
 * whole time while every conversation that had already previewed a Tesseract
 * link kept showing the superseded one. A new URL is a new cache key, and it
 * is the only purge we can actually perform.
 *
 * Doing the rename by hand would work exactly once. Whoever next re-runs this
 * script to change the design would overwrite the bytes, leave the filename,
 * and reintroduce the same bug — so the script owns the name, the meta tags
 * and the redirect together, and `guard:social-preview` fails the build if
 * they ever disagree with the file on disk.
 */
const png = await page.screenshot({ type: 'png' })
const hash = createHash('sha256').update(png).digest('hex').slice(0, 8)
const previewName = `social-preview.${hash}.png`

// Remove superseded hashed copies, so `public/` does not accumulate one dead
// 70KB PNG per design tweak. The redirect below keeps the OLD UNVERSIONED url
// working; the old hashed ones were only ever referenced by a tag this script
// is about to rewrite.
for (const f of readdirSync(join(root, 'public'))) {
  if (/^social-preview\.[0-9a-f]{8}\.png$/.test(f) && f !== previewName) {
    unlinkSync(join(root, 'public', f))
  }
}
writeFileSync(join(root, 'public', previewName), png)
await page.close()

/*
 * Rewrite the references. Narrow regexes over the exact published filename
 * shape, so a stray `social-preview` in prose is not rewritten and a failure
 * to match is loud rather than silent.
 */
const NAME = /social-preview\.[0-9a-f]{8}\.png/g

const indexPath = join(root, 'index.html')
const indexHtml = readFileSync(indexPath, 'utf8')
const indexHits = (indexHtml.match(NAME) || []).length
if (indexHits !== 2) {
  throw new Error(
    `index.html should reference the preview twice (og:image, twitter:image), found ${indexHits}. `
    + 'Refusing to rewrite — the tags have moved and this script would leave them stale.')
}
writeFileSync(indexPath, indexHtml.replace(NAME, previewName))

const redirectsPath = join(root, 'public/_redirects')
const redirects = readFileSync(redirectsPath, 'utf8')
if (!NAME.test(redirects)) {
  throw new Error(
    'public/_redirects has no /social-preview.png rule. Without it the old URL '
    + 'falls through the SPA catch-all and answers 200 text/html, which breaks '
    + 'the preview outright for any cache that revalidates.')
}
writeFileSync(redirectsPath, redirects.replace(NAME, previewName))

/*
 * The browser-tab icons used to be generated here, and are not any more.
 *
 * They were downscales of the glow PNG on a solid black plate — which is not
 * the mark the application shows, and rendered as a dark square at 16px. They
 * now come from `scripts/build-favicon.mjs`, which draws the same wireframe
 * the top-left launcher draws, on a genuinely transparent ground.
 *
 * Deleted rather than left in place: this script and that one both wrote
 * `public/favicon.png`, so whichever ran last won. Re-running the social
 * preview would have quietly reinstated the black icon, which is precisely the
 * stale-reference trap the favicon work went looking for.
 */

await browser.close()
console.log(`wrote public/${previewName}, public/favicon.png, public/apple-touch-icon.png`)
console.log('updated index.html (og:image, twitter:image) and public/_redirects')
