import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
/* The registry, so the footer-link case asserts against the real document
   list rather than a copy of it that can go stale. */
import { LEGAL_DOCUMENTS, legalPath } from '../../legal/documents'

/**
 * The public landing page, and the claims it is not allowed to make.
 *
 * ── THE RULE CHANGED DIRECTION. READ THIS BEFORE EDITING ─────────────────
 *
 * This suite used to REQUIRE status confessions on the page: a "Planned"
 * badge, a "Not yet built" column, "early-stage", "pre-release", and a note
 * saying no screenshots existed. Nine cases asserted that language was
 * present.
 *
 * The founder removed all of it by instruction: the page describes what the
 * product does and says nothing about what is unfinished.
 *
 * Those nine cases were NOT deleted. Each one was INVERTED, because
 * deleting a gate leaves the rule unenforced, and the rule has not gone
 * away, it has reversed. `describe('no status confessions on the page')`
 * below is the same requirement pointed the other way, and it is a strictly
 * larger net than the tests it replaces: it denies a whole vocabulary of
 * roadmap language rather than checking for four specific strings.
 *
 * ── WHAT THE PAGE STILL MAY NOT DO, AND THIS IS THE IMPORTANT PART ───────
 *
 * Removing the disclaimers is not permission to claim the things they
 * qualified. The honest way to comply was to DELETE those capabilities from
 * the page, not reword them, and that is what happened: platform-provisioned
 * AI, proactive surfacing of prior decisions and firm-level pattern analysis
 * are gone. `does not claim the capabilities whose disclaimers were removed`
 * is the case that holds that line, and it is the single most important test
 * in this file. If a future edit adds "platform-provisioned AI" back as a
 * feature, that test fails, which is the entire point.
 *
 * The permanent prohibitions are unchanged: no invented customers, logos,
 * statistics, testimonials, metrics, valuations or performance figures, and
 * nothing that can be mistaken for a capture of a real tenant.
 *
 * These cases are deliberately about RENDERED TEXT rather than source
 * shape, because the failure mode is what a visitor reads, and a source
 * regex has passed here before while the thing it described was dead
 * (PR #319).
 */

/**
 * Render the page under one contact configuration.
 *
 * Both variables are read at module scope, so the module has to be
 * re-evaluated per branch rather than imported once at the top.
 */
async function renderLanding(opts: { url?: string; email?: string } = {}) {
  vi.stubEnv('VITE_ACCESS_REQUEST_URL', opts.url ?? '')
  vi.stubEnv('VITE_ACCESS_REQUEST_EMAIL', opts.email ?? '')
  vi.resetModules()
  const { LandingPage } = await import('../LandingPage')
  render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

/** The common case: a mailbox configured, which most cases do not care about. */
const renderConfigured = () => renderLanding({ email: 'demo@example.test' })

const pageText = () => document.body.textContent ?? ''

beforeEach(() => { vi.resetModules() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('the positioning a visitor reads in the first screen', () => {
  it('leads with the headline the product is positioned on', async () => {
    await renderConfigured()
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Every investment decision has a story')
    expect(screen.getByRole('heading', { level: 1 }).textContent)
      .toContain('Make sure your firm remembers it')
  })

  /*
   * CATEGORY POSITIONING IS NOT A STATUS CONFESSION, and this test is the
   * reason the distinction has to be written down somewhere.
   *
   * "Not a market-data terminal" says which category the product is in. A
   * PM who learns that at minute forty of a demo has spent forty minutes
   * answering the wrong question, so it stays, above the fold.
   *
   * "Early-stage with a working core workflow", which this test used to
   * require in the same breath, says the product is unfinished. That was
   * removed, and `no status confessions on the page` now forbids it.
   */
  it('says which category it is in, on the hero rather than in a footnote', async () => {
    await renderConfigured()
    const hero = document.getElementById('top')
    expect(hero?.textContent).toMatch(/not a market-data terminal/i)
    expect(hero?.textContent).toMatch(/execution system/i)
    expect(hero?.textContent).toMatch(/why\s+you did what you did/i)
  })

  it('offers both calls to action named in the brief', async () => {
    await renderConfigured()
    expect(screen.getAllByText(/request a demo/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/explore the platform/i)).toBeTruthy()
  })
})

describe('the decision lifecycle is complete and closes', () => {
  /*
   * Five stages, not four.
   *
   * This asserted Research, Recommend, Decide, Review and passed, which is
   * how the page shipped with an incomplete lifecycle: it went from a PM
   * saying yes straight to grading the outcome. EXECUTE was missing, and it
   * is the stage that makes the chain real, because `accepted_trades` is
   * the only object in this system representing a committed trade and it
   * carries whether the fill was assumed or confirmed.
   */
  it('states the five lifecycle stages as the central story', async () => {
    await renderConfigured()
    for (const stage of ['Research', 'Recommend', 'Decide', 'Execute', 'Review']) {
      expect(screen.getByRole('heading', { name: stage, level: 3 }), stage).toBeTruthy()
    }
  })

  /*
   * The loop is the argument. A lifecycle drawn as a line that stops
   * describes a filing system; the product's claim is that the review feeds
   * the next decision. If the return leg is ever dropped, this fails.
   */
  it('closes the loop back to research rather than ending at review', async () => {
    await renderConfigured()
    expect(pageText()).toMatch(/the review returns to the note/i)
  })

  /*
   * The linkage, shown rather than only asserted. Every version of this
   * page claimed "typed records that point at the one before" in prose and
   * then showed nothing. These are the reference fields the diagram draws.
   */
  it('shows how each record references the one before it', async () => {
    await renderConfigured()
    const t = pageText()
    expect(t).toMatch(/version pinned at submission/i)
    expect(t).toMatch(/references the frozen version/i)
    expect(t).toMatch(/authorized by the decision/i)
    expect(t).toMatch(/graded against the original case/i)
  })

  /*
   * REWRITTEN, and the requirement is narrower than it was.
   *
   * This asserted ten `dt` elements: a "Keeps" and a "So" term under each of
   * the five stages. That structure is gone. `keeps` named what the stage
   * retains, which is exactly what `RecordChain` draws immediately beside
   * this list, so the section stated the diagram's content a second time in
   * prose with a definition list wrapped around it. At 407 words it was
   * double the next-heaviest section on the page.
   *
   * What has to survive is the part that made a stage an explanation rather
   * than an assertion: the CONSEQUENCE. This now pins that each stage
   * carries a second line beyond its description, and that the three
   * consequences doing the most work are still stated. Narrower than the old
   * case, deliberately, because the old case would have failed on a change
   * that improved the page.
   *
   * Not vacuous: a stage reduced back to a single line drops its paragraph
   * count to 1 and fails on that stage by name.
   */
  it('gives every stage a consequence, not just a description', async () => {
    await renderConfigured()
    const lifecycle = document.getElementById('lifecycle')
    const stages = lifecycle?.querySelectorAll('[data-lifecycle-stage]') ?? []
    /*
     * Six, not five. `Develop` was added between Research and Recommend: the
     * lifecycle previously implied a note becomes a recommendation as soon as
     * it is written, and skipped the pipeline where an analyst spends the
     * weeks before one.
     *
     * Raised rather than loosened to `>= 5`, because the exact number is the
     * point: a stage disappearing is the regression this catches. The new
     * stage's own consequence is pinned below, so it is covered by the same
     * requirement as the other five rather than merely tolerated by a bigger
     * number.
     */
    expect(stages.length, 'six stages').toBe(6)
    for (const li of stages) {
      expect(
        li.querySelectorAll('p').length,
        `${li.querySelector('h3')?.textContent ?? '?'} needs a description AND a consequence`,
      ).toBeGreaterThanOrEqual(2)
    }
    expect(lifecycle?.textContent).toMatch(/ideas the firm declined stay as retrievable/i)
    expect(lifecycle?.textContent).toMatch(/freezes the reasoning behind it/i)
    expect(lifecycle?.textContent).toMatch(/rejections and deferrals become records/i)
    expect(lifecycle?.textContent).toMatch(/judgement becomes separable from luck/i)
  })

})

/*
 * ── The one section that says what you OPEN ─────────────────────────────
 *
 * The page argues a lifecycle and a set of record types at length. The
 * `#product` section is the only place that answers the reader's actual next
 * question, which is what appears on screen, and it sat five sections down
 * under the abstract heading "The product".
 *
 * The names are asserted as an EXACT, ORDERED set rather than loosely
 * matched. Each is a surface the application really opens, so a typo or a
 * well-meant rename here is a claim about software that does not exist under
 * that name, and the prospect discovers it in the demo. An exact set also
 * makes adding a seventh surface a deliberate act rather than a drive-by.
 */
describe('the page says what a user actually opens', () => {
  it('names six real screens, in order, each with what it holds', async () => {
    await renderConfigured()
    const section = document.querySelector('#product')
    expect(section, 'the product section must render').toBeTruthy()

    const named = [...(section?.querySelectorAll('[data-surface]') ?? [])]
      .map(el => el.getAttribute('data-surface'))
    expect(named).toEqual([
      'Asset workspace',
      'Idea Pipeline',
      'Recommendation',
      'Decision Inbox',
      'Trade Book',
      'Outcomes',
    ])

    /* A bare name is a nav menu. Each needs the line saying what it holds. */
    for (const el of section?.querySelectorAll('[data-surface]') ?? []) {
      expect(
        (el.querySelector('p')?.textContent ?? '').trim().length,
        `${el.getAttribute('data-surface')} needs a line saying what it holds`,
      ).toBeGreaterThan(30)
    }
  })

  /*
   * The heading has to ask the reader's question. "The product" described
   * the section's subject to somebody already persuaded; a visitor skimming
   * had no reason to stop at the one concrete answer on the page.
   */
  it('heads that section with the question a reader is actually asking', async () => {
    await renderConfigured()
    const section = document.querySelector('#product')
    expect(section?.textContent).toMatch(/what you actually work in/i)
    expect(section?.textContent).toMatch(/six screens/i)
  })

  /*
   * Coverage has almost no adoption, and Trade Lab's sharing tiers are
   * unpopulated. Both are real tabs. Naming either here would be the page
   * writing a cheque the demo cannot cash, which is a worse failure than
   * saying too little.
   */
  it('does not advertise the surfaces the product has not earned yet', async () => {
    await renderConfigured()
    const section = document.querySelector('#product')
    expect(section?.textContent).not.toMatch(/\bTrade Lab\b/)
    expect(
      [...(section?.querySelectorAll('[data-surface]') ?? [])]
        .map(el => el.getAttribute('data-surface')),
    ).not.toContain('Coverage')
  })
})

/*
 * ── Reading load ────────────────────────────────────────────────────────
 *
 * The report was that the copy overwhelmed and confused, and the cause was
 * measurable rather than a matter of taste. The page was 1,603 words across
 * 31 headed items, and the sections were re-arguing each other: "the version
 * the PM read is frozen" was asserted NINE times and "a rejection is a
 * record" five. A reader does not experience that as thorough, they
 * experience it as being unable to tell what is new.
 *
 * Four bounds, because they fail differently. A page can be short overall
 * and still unreadable in its lists, and it can have short bullets that all
 * say the same thing.
 */
describe('the page stays readable', () => {
  /*
   * A RATCHET, not a round number, in the spirit of this repo's type-error
   * ceiling. It permits a sentence or two and fails on a new section.
   *
   * The metric matters. The "1,603 words" figure in the comment above was
   * measured in the browser over the nine content sections only; this reads
   * `document.body.textContent`, which also includes the nav and footer. The
   * two numbers are not directly comparable, so the bound is set against
   * what THIS assertion measures rather than against the browser figure.
   *
   * ── Authorized to 1600 on 2026-11-27, and NOT USED ─────────────────────
   *
   * The page owner approved raising this to 1,600 to pay for a section
   * naming the screens the product actually opens. That section already
   * existed, five sections down the page under the heading "The product",
   * so the work became making it land rather than writing it again. No
   * words were added and the ceiling stays where it was.
   *
   * Recorded because the authorization is real and still open: a future
   * section with genuinely new information may spend it. Restatement may
   * not, which is what this ratchet has caught every time so far.
   */
  it('holds the total word count to a ratchet', async () => {
    await renderConfigured()
    const words = (pageText().match(/\S+/g) ?? []).length
    expect(words, `${words} words, ceiling 1250. Cut something before raising this.`)
      .toBeLessThan(1250)
  })

  /*
   * ONE SENTENCE PER BULLET, which is the rule that was actually broken:
   * 20 of the page's items carried two or more.
   *
   * Headed items only. The section leads and the closing arguments are
   * exempt by design, because those are prose a reader has chosen to enter
   * and the problem was never the paragraphs.
   */
  it('keeps every bullet to a single sentence', async () => {
    await renderConfigured()
    const offenders: string[] = []
    for (const h of document.querySelectorAll('h3')) {
      const text = h.parentElement?.querySelector('p')?.textContent ?? ''
      const sentences = (text.match(/[.?!](\s|$)/g) ?? []).length
      if (sentences > 1) offenders.push(`${h.textContent}: ${text}`)
    }
    expect(offenders, `multi-sentence bullets:\n${offenders.join('\n')}`).toHaveLength(0)
  })

  /*
   * The repetition bound, COUNTED IN SECTIONS rather than in occurrences.
   *
   * My first version counted raw matches across the page and failed at 4,
   * which was the gate measuring the wrong unit rather than the page being
   * wrong. Three of those four were inside `RecordChain`, where the record
   * is named once as a row and once as the next row's reference field —
   * that is the diagram DRAWING the link, which is its entire job, and no
   * bound on raw occurrences can tell it apart from a fourth section
   * re-arguing the point.
   *
   * The defect was always "each section restates the previous one", so the
   * unit is the section. Three is the bound because a claim legitimately
   * appears where it is motivated (`problem`), where it is owned
   * (`lifecycle`), and where its day-to-day mechanism lives (`research`).
   * A fourth section is the page repeating itself.
   *
   * The patterns deliberately include PARAPHRASE. A gate that only matched
   * the word "frozen" would be defeated by writing "preserved exactly as
   * the PM received it", which is what the product section actually said,
   * and this gate caught it there.
   */
  it('does not argue the same claim in four different sections', async () => {
    await renderConfigured()
    const SECTIONS = ['top', 'problem', 'lifecycle', 'research', 'product', 'memory', 'act-ai']
    const CLAIMS: [string, RegExp][] = [
      ['the case is frozen at submission', /frozen|freezes|pinned as a version|versions instead of overwrites|preserved (exactly )?as the PM received|version the PM actually read|immune to later editing/i],
      ['a rejection is a record', /rejections? (and|or) (deferrals?|a deferral)|reject and defer|accept, reject/i],
      ['the records are linked', /linked record|points at the one before|typed record rather than a document|linked records/i],
    ]
    for (const [claim, pattern] of CLAIMS) {
      const inSections = SECTIONS.filter(id =>
        pattern.test(document.getElementById(id)?.textContent ?? ''))
      expect(inSections.length, `"${claim}" is argued in ${inSections.length} sections: ${inSections.join(', ')}`)
        .toBeLessThanOrEqual(3)
    }
  })

  /*
   * NUMBERS MEAN SEQUENCE. There were three numbered lists, which made the
   * page read as one long enumerated document and implied an order that two
   * of the three did not have. Only the lifecycle is numbered now, so a
   * reader can trust a numeral when they see one.
   */
  it('numbers only the list that has an order', async () => {
    await renderConfigured()
    /*
     * `/\b0[1-9]\b/` was the first spelling and it is VACUOUS. `textContent`
     * concatenates with no separator, so a numeral renders as "01Research",
     * where the digit is followed by a word character and the trailing `\b`
     * never holds. The positive assertion failing is what exposed it; the
     * four negative assertions would have passed with the numerals still on
     * the page, which is this file's recurring defect class.
     *
     * No bare digits appear anywhere else in the page's copy, so an
     * unanchored pattern is safe here.
     */
    const NUMERAL = /0[1-9]/
    for (const id of ['problem', 'product', 'memory', 'act-ai', 'research']) {
      const text = document.getElementById(id)?.textContent ?? ''
      expect(text, `${id} is numbered, which implies a sequence it does not have`)
        .not.toMatch(NUMERAL)
    }
    expect(document.getElementById('lifecycle')?.textContent, 'the lifecycle keeps its numerals')
      .toMatch(NUMERAL)
  })
})

/*
 * ── The capture layer, which the founder asked for by name ───────────────
 *
 * The lifecycle section explains what the FIRM gets. An analyst reading
 * only that has no idea what their own day looks like, and the record only
 * assembles itself if capture sits where an analyst already works. This
 * section answers "what am I doing all day".
 *
 * Everything asserted here is a surface that exists. If an aspirational
 * item is ever added to round the list out, it will fail the status-
 * confession suite or the capability suite, not this one, so this one only
 * checks the section is present and substantive.
 */
describe('the research and capture section', () => {
  it('explains capture as part of the work rather than as documentation', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    expect(research, 'the research section must exist').not.toBeNull()
    expect(research?.textContent).toMatch(/document their decisions a second time/i)
    expect(research?.textContent).toMatch(/typed record rather than a document/i)
  })

  it('names the capture surfaces an analyst actually touches', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    const headings = [...(research?.querySelectorAll('h3') ?? [])].map(h => h.textContent ?? '')
    expect(headings.length).toBeGreaterThanOrEqual(6)
    expect(headings.join(' | ')).toMatch(/notes that belong to the name/i)
    expect(headings.join(' | ')).toMatch(/versions instead of overwrites/i)
  })

  /*
   * The visual brief was that a dark background alone is not interesting,
   * and the structural answer was to invert one band to near-white. That is
   * a layout decision, so it is asserted as one: the section carries its
   * own light background rather than relying on a `dark:` variant, which on
   * a signed-out page would be dead (`darkMode: 'class'`).
   */
  it('inverts to a light band, without depending on a theme class', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    const html = research?.outerHTML ?? ''
    expect(html).toMatch(/bg-\[#f7f8fa\]/)
    expect(html).toMatch(/text-slate-900/)
    expect(html, 'a dark: variant here would be dead on a public page').not.toMatch(/\bdark:/)
  })
})

/*
 * ── The background, which took three rounds ──────────────────────────────
 *
 * "The background still needs to be more interesting" was said twice. The
 * first attempt was a dot grid at 1.5% white, which is below the threshold
 * where a person sees it, so the page was effectively flat. These cases pin
 * the layers that replaced it, and the two constraints that came with the
 * second round, because the constraints are the part most likely to be
 * undone by a later edit that reaches for a purple gradient out of habit.
 */
describe('the background is built, not just dark', () => {
  it('carries no purple anywhere, in a wash, a gradient or an accent', async () => {
    await renderConfigured()
    const html = document.getElementById('root')?.innerHTML ?? document.body.innerHTML
    for (const pattern of [
      /\bviolet-/,
      /\bfuchsia-/,
      /\bpurple-/,
      /rgba?\(\s*139\s*,\s*92\s*,\s*246/,
      /rgba?\(\s*99\s*,\s*102\s*,\s*241/,
      /rgba?\(\s*168\s*,\s*85\s*,\s*247/,
      /#(8b5cf6|a855f7|6366f1|7c3aed)/i,
    ]) {
      expect(html, `purple: ${String(pattern)}`).not.toMatch(pattern)
    }
  })

  /*
   * The tesseract field, which the founder asked for by name: the brand
   * geometry behind the content, lightly. It is anchored to the DOCUMENT
   * rather than the viewport on purpose, so the geometry behind the text
   * changes as you scroll; a fixed field shows the same shapes for the
   * whole page, which was the flaw in the version before it.
   */
  it('puts the tesseract geometry behind the page, lightly and still', async () => {
    await renderConfigured()
    /*
     * Selected by `data-tesseract-field`, not by `[style*="opacity"]`.
     *
     * The first version of this did the latter, and in a real browser it
     * also matched an unrelated mark whose inline `animation` shorthand
     * contains the substring "opacity": five elements, one at full opacity.
     * jsdom matched only four, so this test went green while the assertion
     * it makes was false on the page a visitor sees. That is the "gate
     * green for the wrong reason" failure this codebase has a standing rule
     * about, and it is why the hook is explicit now.
     */
    const hosts = [...document.querySelectorAll<HTMLElement>('[data-tesseract-field]')]
    expect(hosts.length, 'the background field must render marks').toBeGreaterThanOrEqual(4)

    for (const host of hosts) {
      expect(host.querySelector('svg'), 'each field slot renders the mark').not.toBeNull()
      // Lightly: well under 15%, and never fully transparent either, since
      // a field at 0 is the same as no field at all.
      const o = Number.parseFloat(host.style.opacity)
      expect(o, `opacity ${o} is not "lightly"`).toBeLessThan(0.15)
      expect(o, 'a field at zero opacity is not a field').toBeGreaterThan(0)
    }

    // Still. The founder's standing instruction is that the mark moves on
    // hover only, and four rotating wireframes behind the text would be the
    // exact tell this whole exercise has been removing.
    for (const mark of document.querySelectorAll('[data-animating]')) {
      expect(mark.getAttribute('data-animating')).toBe('false')
    }
  })

  it('aligns a column grid to the same gutter as the text', async () => {
    await renderConfigured()
    /*
     * The grid must use the shared GUTTER rather than its own padding, or
     * the outer two lines drift off the text edge at one breakpoint only,
     * which is the kind of thing nobody notices until a screenshot.
     *
     * The rail carrying `justify-between` is the INNER element; the outer
     * one centres it with `justify-center`. My first version of this test
     * looked for aria-hidden + justify-between on one element and matched
     * nothing, so it failed for the wrong reason.
     */
    const rails = [...document.querySelectorAll('div.justify-between')]
      .filter(el => el.querySelectorAll(':scope > .w-px').length >= 4)
    expect(rails.length, 'a column grid layer must exist').toBeGreaterThanOrEqual(2)
    for (const rail of rails) {
      expect(rail.className).toMatch(/px-6/)
      expect(rail.className).toMatch(/sm:px-8/)
      expect(rail.className).toMatch(/lg:px-12/)
      expect(rail.className).toMatch(/max-w-7xl/)
      expect(rail.querySelectorAll(':scope > .w-px').length).toBe(5)
    }
  })

  /*
   * INVERTED from 'disables the drift under prefers-reduced-motion'.
   *
   * That test required `@keyframes tsrAurora` plus a reduced-motion guard
   * naming both animated classes. It was the correct gate for a page with
   * a drifting aurora on it, and the aurora is gone: the colours read as
   * vibe coded, and the drift went with them, because a luminance gradient
   * that slides around is a lighting rig with a loose bolt.
   *
   * Rather than delete the case, it asserts the stronger property that now
   * holds: NOTHING on this page animates unless a pointer asks it to. That
   * subsumes the old requirement (no ambient animation needs no
   * reduced-motion exception) and it enforces the founder's standing
   * instruction that the mark moves on hover only, which the background
   * previously did not follow.
   *
   * Twinkling stars are the specific thing this is here to prevent. With a
   * starfield on the page it is the obvious next idea and it would make the
   * whole thing look cheap instantly.
   */
  it('has no ambient motion at all, so hover is the only trigger', async () => {
    await renderConfigured()

    /*
     * SCOPED TO THE PAGE'S OWN SUBTREE, and the first version was not.
     *
     * It read every `<style>` in the document and asserted no `@keyframes`
     * anywhere. That passed in jsdom, which loads no stylesheets, and is
     * FALSE in a real browser: Chrome reports two such blocks on this page,
     * `src/index.css` injected by Vite (bounce, ping, pulse, spin and a
     * dozen more the app uses) and `tesseract-boot-breathe` from
     * index.html. Neither is this page's, and neither should make this
     * gate fail or pass.
     *
     * Third time this exact mistake has come up in this file, so the rule
     * is worth stating: a gate written against `document` in jsdom is
     * asserting something about an EMPTY environment. Scope to the subtree
     * under test, or assert a property the environment actually models.
     *
     * What is checked now: the page contributes no stylesheet of its own
     * (it used to inject one for the aurora drift, which is gone), and no
     * element inside it declares an animation inline, which is how a
     * twinkling star would arrive. Verified separately in the browser with
     * `document.getAnimations().length === 0`, which is the authoritative
     * check and cannot be done in jsdom.
     */
    const page = document.querySelector('.min-h-screen')
    expect(page, 'the page root must be found for this to mean anything').not.toBeNull()

    const own = [...(page?.querySelectorAll('style') ?? [])]
    expect(own, 'this page injects no stylesheet of its own').toHaveLength(0)

    const inline = [...(page?.querySelectorAll<HTMLElement>('[style]') ?? [])]
      .map(el => el.getAttribute('style') ?? '')
      .filter(s => /animation/.test(s))
    expect(inline, `inline animation found: ${inline[0] ?? ''}`).toHaveLength(0)
  })

  /*
   * REPLACES the dot-grid half of 'pitches its texture where a person can
   * actually see it'.
   *
   * The dot grid is gone: the starfield does its job properly, so a 26px
   * lattice of faint dots on top of it would be two competing textures.
   * The requirement it encoded was never "a dot grid"; it was that texture
   * must be pitched ABOVE the threshold where a person sees it, which is
   * the specific mistake that shipped twice at 1.5% white. Grain carries
   * that now and is asserted below.
   */
  it('keeps its grain where a person can actually see it', async () => {
    await renderConfigured()
    // jsdom has no #root: testing-library renders into its own container
    // under body, so this reads body. My first version read #root, got
    // null, and failed against an empty string.
    const html = document.body.innerHTML
    expect(html, 'grain comes from an inline SVG turbulence filter').toMatch(/feTurbulence/)

    const grainLayers = [...document.querySelectorAll<HTMLElement>('[style*="svg+xml"]')]
    expect(grainLayers.length, 'the dark page and the light band each grain').toBeGreaterThanOrEqual(2)
    for (const layer of grainLayers) {
      const o = Number.parseFloat(getComputedStyle(layer).opacity || '1')
      expect(o, `grain at ${o} is below the visibility threshold`).toBeGreaterThanOrEqual(0.02)
      expect(o, `grain at ${o} would be a visible pattern, not a texture`).toBeLessThan(0.1)
    }
  })

  /*
   * ── The sky ────────────────────────────────────────────────────────────
   *
   * SEEDED, not random, and this is a correctness property rather than an
   * aesthetic one. `Math.random()` would give a different sky on every
   * mount: stars jumping on re-render, a different arrangement per visitor,
   * and nothing any visual check could ever be compared against.
   */
  it('renders a seeded starfield that is identical across renders', async () => {
    /*
     * Scoped to `[data-starfield]`. A bare `circle` selector also picks up
     * the vertex circles inside the tesseract marks in the nav and footer,
     * so the fill assertion below failed on a logo node rather than on a
     * star. Same class of mistake as the `[style*="opacity"]` selector two
     * rounds ago, which is why both hooks are now explicit.
     */
    const sky = () => [...document.querySelectorAll('[data-starfield] circle')]
      .map(c => `${c.getAttribute('cx')},${c.getAttribute('cy')},${c.getAttribute('r')}`)

    await renderConfigured()
    const first = sky()
    expect(first.length, 'the sky needs enough stars to read as a sky').toBeGreaterThanOrEqual(150)

    cleanup()
    await renderConfigured()
    expect(sky(), 'the sky must not change between renders').toEqual(first)
  })

  /*
   * The distribution is the part that makes it a sky rather than noise.
   * Uniform points at uniform brightness is what a CSS starfield looks
   * like; a real one is heavily skewed, with most stars faint and small.
   */
  it('varies star brightness and size instead of drawing uniform dots', async () => {
    await renderConfigured()
    const stars = [...document.querySelectorAll('[data-starfield] circle')]
    expect(stars.length).toBeGreaterThanOrEqual(150)
    const radii = new Set(stars.map(c => c.getAttribute('r')))
    const opacities = new Set(stars.map(c => c.getAttribute('opacity')))
    expect(radii.size, 'uniform radii read as a dot grid, not a sky').toBeGreaterThan(20)
    expect(opacities.size, 'uniform brightness is the giveaway').toBeGreaterThan(20)

    // Skewed, not flat: most stars must be in the dim half of the range.
    const vals = stars.map(c => Number.parseFloat(c.getAttribute('opacity') ?? '0'))
    const mid = (Math.min(...vals) + Math.max(...vals)) / 2
    const dim = vals.filter(v => v < mid).length
    expect(dim / vals.length, 'a real magnitude curve is faint-heavy').toBeGreaterThan(0.6)

    // White only. A coloured star is how a nebula palette gets in.
    for (const c of stars) expect(c.getAttribute('fill')).toBe('#fff')
  })

  /*
   * Gargantua. The concept the founder asked for, and the four restraints
   * in `BlackHole`'s own comment are what keep it from being a poster. Two
   * of them are testable: the ring must stay a warm WHITE rather than
   * turning into fire, and the event horizon must be DARKER than the page,
   * because a hole that is the same value as the sky is not a hole.
   */
  it('puts the mark inside a black hole, without lighting it on fire', async () => {
    await renderConfigured()
    const hero = document.getElementById('top')
    const html = hero?.innerHTML ?? ''

    // The event horizon, darker than the #050710 base.
    expect(html, 'the horizon must be darker than the page').toMatch(/#01020a/)

    // The ring is near-white. Anything with a red/blue spread this wide is
    // amber, which is the poster version rather than the film's.
    const rings = [...(html.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/g) ?? [])]
    for (const ring of rings) {
      const [r, g, b] = ring.replace(/rgba?\(/, '').split(',').map(n => Number.parseInt(n, 10))
      if (r === 0 && g === 0 && b === 0) continue
      expect(r - b, `${ring} is amber, not warm white`).toBeLessThanOrEqual(30)
      expect(Math.abs(r - g), `${ring} is too saturated for this`).toBeLessThanOrEqual(20)
    }
  })

  /*
   * The mark must be INSIDE the hole, and the hole must stay modest.
   *
   * Both halves of this were real defects. The first version positioned the
   * mark as a sibling of the hole with hand-matched offsets, so the two
   * were concentric at one size only and any change to either knocked them
   * apart. The second was simply too big at 44rem: it stopped reading as a
   * distant object and became a shape competing with the headline.
   *
   * Nesting makes concentricity structural, and this asserts the structure
   * rather than the pixels, since jsdom has no layout: the mark must be a
   * DESCENDANT of the hole, and the hole's size must stay within a range
   * that reads as distant. A sibling with matching offsets would pass a
   * coordinate check and fail this one, which is the right way round.
   */
  it('nests the mark inside the hole, at a restrained size', async () => {
    await renderConfigured()
    const horizon = document.querySelector('[class*="#01020a"]')
    expect(horizon, 'the event horizon must render').not.toBeNull()

    const hole = horizon?.parentElement
    expect(hole?.querySelector('svg'), 'the mark must be a DESCENDANT of the hole').not.toBeNull()

    // 28rem. Anything at or above 40rem is the version that was too large.
    const size = hole?.className.match(/h-\[(\d+(?:\.\d+)?)rem\]/)?.[1]
    expect(size, 'the hole must declare an explicit size').toBeDefined()
    expect(Number.parseFloat(size ?? '0')).toBeLessThan(36)
    expect(Number.parseFloat(size ?? '0')).toBeGreaterThan(16)

    // And it is absent at phone width, where it would sit on the headline.
    expect(hole?.className).toMatch(/hidden/)
    expect(hole?.className).toMatch(/md:block/)
  })
})

/*
 * ── The inverted rule: no status confessions ──────────────────────────────
 *
 * REPLACES, by inversion, five cases that REQUIRED this language:
 *   'labels current capabilities available and the rest planned'
 *   'says platform-provisioned AI is not built and BYOK is what exists'
 *   'calls it an evaluation rather than production access'
 *   'keeps each scope disclosure in the place a reader meets it'
 *   'carries the pre-release disclaimer in the footer'  (partly; see below)
 *
 * The founder's instruction was that no reference to what is not built yet
 * appears on the page. A gate that merely stopped checking would leave that
 * unenforced and the language would drift back. This denies the vocabulary.
 *
 * `pre-release` is in the list, and the footer case below now asserts only
 * the legal line, which is a different thing: "nothing here is an offer of
 * securities, investment advice, or a performance representation" is a
 * necessary disclaimer about what the PAGE is, not a confession about what
 * the product is.
 */
describe('no status confessions on the page', () => {
  it('uses no roadmap, pre-release or unfinished-status language anywhere', async () => {
    await renderConfigured()
    const t = pageText()
    for (const pattern of [
      /not yet built/i,
      /\bnot built\b/i,
      /coming soon/i,
      /\bpre-?release\b/i,
      /early-?stage/i,
      /\broadmap\b/i,
      /\bplanned\b/i,
      /in development|under development/i,
      /\bwork in progress\b/i,
      /capture pending/i,
      /\bplaceholder\b/i,
      /\bprototype\b/i,
      /\bwe (are building|plan to|intend to|will soon)\b/i,
      /\bdoes not exist yet\b/i,
      /\bonce (we|it) (build|ship|launch)/i,
    ]) {
      expect(t, `status confession: ${String(pattern)}`).not.toMatch(pattern)
    }
  })

  /*
   * THE MOST IMPORTANT TEST IN THIS FILE.
   *
   * Removing a disclaimer is not permission to claim the thing it
   * qualified. These three capabilities were listed under "Not yet built"
   * and were DELETED from the page rather than reworded, which is the only
   * honest way to comply with "no reference to what isn't built".
   *
   * If a later edit reintroduces any of them as a feature, the page starts
   * claiming something that does not work, with no disclaimer left to catch
   * it. That is a materially worse failure than the one the instruction was
   * aimed at, and this is the gate that prevents it.
   */
  it('does not claim the capabilities whose disclaimers were removed', async () => {
    await renderConfigured()
    const t = pageText()
    for (const pattern of [
      /platform-provisioned/i,
      /we provision (the )?ai|ai is provisioned/i,
      /per-organization budgets?/i,
      /usage accounting/i,
      /proactively surfaces?|proactive surfacing/i,
      /surfaces a (prior|previous|similar) decision/i,
      /firm-level pattern analysis|pattern analysis across/i,
    ]) {
      expect(t, `claims a removed capability: ${String(pattern)}`).not.toMatch(pattern)
    }
  })

  /*
   * The configuration leak, which is what the founder actually saw on
   * screen: the page printed the string "VITE_ACCESS_REQUEST_EMAIL" to
   * every visitor, inside a panel headed "Contact route not configured".
   *
   * That is an internal deployment note on the public front door, and it is
   * the worst single thing that was on this page. Nothing about how the
   * site is configured may ever be rendered to a visitor again.
   */
  it('never shows a visitor anything about its own configuration', async () => {
    for (const opts of [{}, { email: 'demo@example.test' }, { url: 'https://example.test/f' }]) {
      cleanup()
      await renderLanding(opts)
      const t = pageText()
      for (const pattern of [
        /VITE_/,
        /import\.meta/,
        /not configured/i,
        /\benv(ironment)? variable\b/i,
        /\bnetlify\b/i,
        /\bdeployment\b/i,
        /\bset the\b.*\bto turn\b/i,
      ]) {
        expect(t, `${String(pattern)} leaked with ${JSON.stringify(opts)}`).not.toMatch(pattern)
      }
    }
  })
})

describe('no fabricated social proof, ever', () => {
  it('shows no customer names, logos, testimonials or counts', async () => {
    await renderConfigured()
    const t = pageText()
    // There are no customers. Anything in this shape would be invented.
    for (const pattern of [
      /trusted by/i,
      /customers? (say|love|trust)/i,
      /testimonial/i,
      /\bour clients\b/i,
      /used by \d/i,
      /\d+\s*(firms|funds|customers|clients|teams) (use|trust|rely)/i,
      /\$\d+\s*(billion|bn|trillion|million)\s*(in\s*)?(aum|assets)/i,
    ]) {
      expect(t, String(pattern)).not.toMatch(pattern)
    }
  })

  it('makes no performance claim', async () => {
    await renderConfigured()
    const t = pageText()
    for (const pattern of [
      /improve (your )?returns/i,
      /outperform/i,
      /\balpha generation\b/i,
      /\d+%\s*(better|more|higher|improvement)/i,
    ]) {
      expect(t, String(pattern)).not.toMatch(pattern)
    }
    // And says so explicitly rather than merely omitting it.
    expect(t).toMatch(/does not promise better returns/i)
  })

  it('does not present itself as a replacement for the incumbents', async () => {
    await renderConfigured()
    expect(pageText()).not.toMatch(/bloomberg|factset|capital iq/i)
  })

  it('never claims market-data coverage or free usage it does not have', async () => {
    await renderConfigured()
    const t = pageText()
    expect(t).not.toMatch(/real-?time (market )?data|full market coverage/i)
    expect(t).not.toMatch(/licensed (market )?data|data included/i)
    expect(t).not.toMatch(/free (market )?data|unlimited ai|unlimited usage/i)
  })
})

/*
 * ── Nothing may be mistaken for a capture of real data ───────────────────
 *
 * The page no longer TELLS a visitor that screenshots are absent, because
 * that was a status report. The underlying guarantee is unchanged and is
 * now carried entirely by structure rather than by a sentence:
 *
 *   - zero <img>, which is the real backstop
 *   - every figure is a labelled schema, with a figcaption
 *   - no figure contains a currency amount, a percentage or a ticker-shaped
 *     token, so the one diagram on the page cannot drift into looking like
 *     a rendering of a tenant's book
 *
 * The third assertion is new and is stricter than anything the previous
 * version had: the old test only checked that each figure repeated a
 * disclaimer, which a figure full of invented numbers would also have
 * passed.
 */
describe('nothing on the page imitates real data', () => {
  it('renders no images at all', async () => {
    await renderConfigured()
    expect(document.querySelectorAll('img').length).toBe(0)
  })

  it('labels every figure as a schema and puts no data in it', async () => {
    await renderConfigured()
    const figures = screen.getAllByRole('figure')
    expect(figures.length).toBeGreaterThan(0)
    for (const f of figures) {
      expect(f.querySelector('figcaption'), 'every figure needs a caption').not.toBeNull()
      const text = f.textContent ?? ''
      /*
       * NO DIGITS AND NO CURRENCY, which is blunt on purpose.
       *
       * The first version of this checked for a currency amount, a
       * percentage and a ticker-shaped token separately. The ticker pattern
       * `\b[A-Z]{2,5}\b` matched "PM" in "what the PM actually read", which
       * is a legitimate acronym, and loosening it to avoid that would have
       * let through anything short enough.
       *
       * A schema diagram has no numbers in it. Invented data essentially
       * always does. So the rule is simply that a figure carries no digit
       * and no currency symbol, which is unambiguous, has no false
       * positives on prose, and is strictly harder to satisfy than the
       * three patterns it replaces.
       *
       * If a figure ever legitimately needs a number, change this gate
       * deliberately and say why. Do not widen it to go green.
       */
      expect(text, 'a figure must contain no digits').not.toMatch(/\d/)
      expect(text, 'a figure must contain no currency symbol').not.toMatch(/[$£€¥]/)
    }
  })

  /*
   * Two headings were SHORTENED here, and the test follows rather than the
   * page being held to an old label:
   *
   *   'Recommendation and frozen reasoning' → 'Recommendation'
   *   'Historical decision record'          → 'Decision record'
   *
   * This section is a map of surfaces, and a heading that carries a
   * guarantee ("frozen reasoning") was restating the lifecycle stage that
   * owns it, which the repetition gate above caught independently. The count
   * is unchanged at six: nothing was dropped, only renamed.
   *
   * ── 2026-11-27: three renames and ONE REPLACEMENT ──────────────────────
   *
   *   'Idea pipeline'   → 'Idea Pipeline'   casing, to match the tab title
   *   'Decision inbox'  → 'Decision Inbox'  casing, to match the tab title
   *   'Outcome review'  → 'Outcomes'        to match the tab title
   *   'Decision record' → 'Trade Book'      NOT a rename. A REPLACEMENT.
   *
   * 'Decision record' was not a screen. It described the same rows the
   * 'Decision Inbox' entry above already describes, read historically, while
   * the firm's committed trades were missing from the map entirely. Trade
   * Book is a real tab and the only surface that says what the firm ACTUALLY
   * DID rather than what it decided to do.
   *
   * The count stays six and `the page says what a user actually opens`
   * below pins the full set in order, which is the stricter assertion.
   */
  it('still names every product surface', async () => {
    await renderConfigured()
    for (const surface of [
      'Asset workspace',
      'Idea Pipeline',
      'Recommendation',
      'Decision Inbox',
      'Trade Book',
      'Outcomes',
    ]) {
      expect(screen.getByRole('heading', { name: surface }), surface).toBeTruthy()
    }
    expect(
      document.getElementById('product')?.querySelectorAll('h3').length,
      'six surfaces, renamed but not reduced',
    ).toBe(6)
  })
})

describe('the assistant is described by what it does', () => {
  it('states the three capabilities that exist today', async () => {
    await renderConfigured()
    const actAi = document.getElementById('act-ai')
    expect(actAi?.textContent).toMatch(/it knows where you are/i)
    expect(actAi?.textContent).toMatch(/reads the record, not the internet/i)
    expect(actAi?.textContent).toMatch(/cites what it used/i)
  })

  /*
   * BYOK is a FACT about how it runs, and it is stated as one. The previous
   * version said this inside a "Not yet built" column as the reason
   * platform-provisioned AI was missing, which turned a reasonable
   * architectural position (the firm keeps control of its own key and spend)
   * into an apology.
   */
  it('states the provider-key position as control, not as a gap', async () => {
    await renderConfigured()
    const actAi = document.getElementById('act-ai')
    expect(actAi?.textContent).toMatch(/own provider key/i)
    // Was /keeps control of which model/. The sentence was shortened to
    // "the firm controls which model its reasoning reaches", so the pattern
    // now accepts either verb. The requirement is unchanged: the BYOK line
    // has to read as the firm being in control, not as a missing feature.
    expect(actAi?.textContent).toMatch(/(keeps control of|controls) which model/i)
  })

  it('does not claim the assistant manages portfolios or trades', async () => {
    await renderConfigured()
    expect(pageText()).toMatch(/does not\s+manage portfolios, place orders/i)
  })
})

/*
 * ── Where a request goes ─────────────────────────────────────────────────
 *
 * TWO branches now, and the change was a bug fix. An external intake form if
 * one is configured; otherwise the on-page request box. No URL is set, so the
 * live page is the box, and the box gets the most coverage.
 *
 * ── What was wrong, and why these cases are inverted rather than deleted ─
 *
 * The third branch used to send every CTA to `/login`. The founder reported
 * it in one line: "request access goes to login screen and not a request
 * access box."
 *
 * The code's own comment claimed `/login` was "a real page with a real
 * access-request path on it", and both halves were false. The affordance
 * lives in `EarlyAccessNotice`, which renders on `/signup`; and even there it
 * is wrapped in `{ACCESS_REQUEST_EMAIL && ...}`, so with the variable unset,
 * which is the live state, it renders nothing at all. A stranger clicking
 * "Request a demo" reached a password prompt with no way to ask for anything.
 *
 * This suite PASSED throughout, because it asserted `href === '/login'` and
 * stopped there. That is the lesson worth keeping: an href is a destination,
 * not an outcome, and checking one proves only that a link points somewhere.
 * So the cases below are inverted in place rather than removed, and they now
 * assert the outcome, which is that a box opens and can be filled in.
 *
 * The mailbox branch is gone as a CTA mode for a separate reason: a mailto
 * asks a prospect to compose a cold email from nothing, while the box asks
 * five short questions. The address is now the box's failure fallback, which
 * `src/components/landing/__tests__/access-request-dialog.test.tsx` covers.
 */
describe('the contact route', () => {
  it('sends every CTA to the intake form when a form URL is set', async () => {
    await renderLanding({ url: 'https://tally.example.test/r/abc123' })
    const ctas = [...document.querySelectorAll('a[data-contact-mode]')]
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const a of ctas) {
      expect(a.getAttribute('data-contact-mode')).toBe('form')
      expect(a.getAttribute('href')).toBe('https://tally.example.test/r/abc123')
      // An external destination must not hijack the tab, and must not leak
      // the referrer of a page a prospect is browsing privately.
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noreferrer')
    }
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
  })

  it('prefers the form over a mailbox when both are set', async () => {
    await renderLanding({ url: 'https://tally.example.test/r/abc123', email: 'demo@example.test' })
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    expect(pageText()).not.toContain('demo@example.test')
  })

  /*
   * INVERTED. This used to require two or more mailto links when a mailbox
   * was set, and the per-path subject lines in their hrefs.
   *
   * A configured mailbox no longer turns the CTAs into mailto links. It is
   * the box's fallback if the POST fails, so an address reaches the page only
   * when a visitor is already looking at an error. The requirement it
   * protected has not gone away: the founder still has to be able to tell a
   * demo request from a partnership enquiry. That is now the `topic` field in
   * the submission, asserted in the dialog's own suite.
   */
  it('does not turn a configured mailbox into the call to action', async () => {
    await renderLanding({ email: 'partners@example.test' })
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    // Not rendered anywhere a scraper reading the page would find it.
    expect(pageText()).not.toContain('partners@example.test')
    // And the CTAs are still the box, not a dead control.
    const ctas = [...document.querySelectorAll('[data-contact-mode]')]
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const cta of ctas) expect(cta.getAttribute('data-contact-mode')).toBe('inline')
  })

  /**
   * THE case, and it has now been wrong twice.
   *
   * First the page rendered a panel reading "Contact route not configured.
   * Set VITE_ACCESS_REQUEST_EMAIL ...", so clicking "Request a demo" showed
   * the visitor an instruction meant for the site's own operator.
   *
   * Then it sent every CTA to `/login`, a password prompt with no
   * access-request path on it, which is what the founder reported next.
   *
   * Now it opens a box. The assertion is the outcome rather than the href,
   * because asserting the href is exactly what let the second bug through.
   */
  it('opens a request box, not a sign-in screen, when nothing is configured', async () => {
    const user = userEvent.setup()
    await renderLanding()

    const ctas = [...document.querySelectorAll('[data-contact-mode]')]
    expect(ctas.length).toBeGreaterThanOrEqual(3)
    for (const cta of ctas) {
      expect(cta.getAttribute('data-contact-mode')).toBe('inline')
      // A control that opens a dialog is a button. A link that does not
      // navigate misleads the status bar and the accessibility tree alike.
      expect(cta.tagName).toBe('BUTTON')
      expect(cta.getAttribute('href')).toBeNull()
    }
    expect(document.querySelectorAll('a[href^="mailto:"]').length).toBe(0)
    expect(screen.queryByTestId('contact-unconfigured')).toBeNull()
    // Nothing is open until a visitor asks for it.
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /request a demo/i })[0])

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('Request a demo')
    // The fields a reply actually needs. If this renders and these are
    // missing, the box is decoration.
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Work email')).toBeTruthy()
    expect(screen.getByRole('button', { name: /send request/i })).toBeTruthy()
  })

  it('opens the partnership box from the design-partner section', async () => {
    const user = userEvent.setup()
    await renderLanding()

    await user.click(screen.getByRole('button', { name: /become a design partner/i }))

    // A different heading, because the two CTAs ask for different things and
    // a box that says "Request a demo" to someone who clicked "Become a
    // design partner" reads as a dead end.
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Become a design partner')
  })

  it('never falls back to a guessed address', async () => {
    await renderLanding()
    const t = pageText()
    // The one hard-coded address in this codebase lives in
    // `AIConfigurationSection` and points at a domain that is not ours.
    expect(t).not.toContain('sales@tesseract.com')
    expect(t).not.toMatch(/@tesseract\.com/)
    expect(document.body.innerHTML).not.toMatch(/mailto:/)
  })
})

/*
 * ── Every link goes somewhere real ───────────────────────────────────────
 *
 * The `/login` bug was one control pointing at a page that could not do what
 * the control promised, and the only reason it survived review is that
 * nothing checked destinations against what is actually at them. These two
 * cases are the general form of that check.
 *
 * The anchors are the easy half to get wrong: renaming a section's `id`
 * leaves the nav link pointing at nothing, the click does nothing at all,
 * and no error appears anywhere.
 */
describe('every link on the page resolves', () => {
  it('points every in-page anchor at a section that exists and has content', async () => {
    await renderLanding()
    const anchors = [...document.querySelectorAll('a[href^="#"]')]
    expect(anchors.length).toBeGreaterThanOrEqual(5)

    for (const a of anchors) {
      const id = (a.getAttribute('href') ?? '').slice(1)
      const target = document.getElementById(id)
      expect(target, `no element with id "${id}" for ${a.textContent?.trim()}`).not.toBeNull()
      // Present but empty is the same dead end as absent: the page scrolls
      // to a blank band and the visitor concludes the site is broken.
      expect((target?.textContent ?? '').trim().length, `#${id} is empty`).toBeGreaterThan(40)
    }
  })

  it('links no route outside the set this suite covers', async () => {
    await renderLanding()
    // `legalPath`, not a constructed string: the registry owns the shape of
    // a legal URL, and duplicating it here is how the two drift apart.
    const allowed = new Set(['/login', ...LEGAL_DOCUMENTS.map(d => legalPath(d.id))])
    const offsite = [...document.querySelectorAll('a[href]')]
      .map(a => a.getAttribute('href') ?? '')
      .filter(href => href.startsWith('/'))
      .filter(href => !allowed.has(href))

    /*
     * A new link to a route nobody has checked fails here rather than in
     * production. `/login` is covered by the sign-in case below; the legal
     * paths are generated from the registry and covered in both directions.
     * Adding a destination means adding a case for it, not an entry here.
     */
    expect(offsite).toEqual([])
  })
})

describe('the page is reachable and accessible by keyboard', () => {
  it('offers sign-in for someone who already has an account', async () => {
    await renderConfigured()
    const signIn = screen.getAllByText(/sign in/i).map(el => el.closest('a')?.getAttribute('href'))
    expect(signIn).toContain('/login')
  })

  it('uses one h1 and a single heading hierarchy under it', async () => {
    await renderConfigured()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(7)
  })

  it('names its navigation landmark', async () => {
    await renderConfigured()
    expect(screen.getByRole('navigation', { name: /main/i })).toBeTruthy()
  })

  /*
   * The footer keeps ONE line, and it is a legal disclaimer about what the
   * page is, not a confession about what the product is. "Pre-release."
   * used to open it and was removed; `no status confessions on the page`
   * now forbids it from returning.
   */
  it('carries the securities disclaimer, and nothing about release status', async () => {
    await renderConfigured()
    const footer = document.querySelector('footer')
    expect(footer?.textContent).toMatch(/offer of securities/i)
    expect(footer?.textContent).toMatch(/performance representation/i)
    expect(footer?.textContent).not.toMatch(/pre-?release/i)
  })

  /*
   * What the PRODUCT is not, which is a different statement from what the
   * PAGE is not.
   *
   * The line above says nothing on the page is advice or an offer. That does
   * not tell a compliance reviewer whether the software they are being shown
   * is an investment adviser, and that is the question they are actually
   * asking. The auth-page footer has carried this sentence from the start;
   * the public page, which is the one a stranger reads first, did not.
   */
  it('says what the product is not, not only what the page is not', async () => {
    await renderConfigured()
    const footer = document.querySelector('footer')
    expect(footer?.textContent).toMatch(/not an investment adviser or a broker-dealer/i)
    expect(footer?.textContent).toMatch(/gives no investment advice/i)
    expect(footer?.textContent).toMatch(/places no orders/i)
  })

  /*
   * The legal links, and that they come from the registry.
   *
   * Asserted against LEGAL_DOCUMENTS rather than against five hard-coded
   * hrefs, so the test cannot pass while the page lists four of five
   * documents -- which is what a hand-written list does the first time a
   * document is added.
   */
  it('links every legal document, generated from the registry', async () => {
    await renderConfigured()
    const nav = screen.getByTestId('landing-legal-links')

    for (const doc of LEGAL_DOCUMENTS) {
      const link = nav.querySelector(`[data-legal-document="${doc.id}"]`)
      expect(link, `${doc.id} is not linked in the landing footer`).toBeTruthy()
      expect(link?.getAttribute('href')).toBe(`/legal/${doc.id}`)
      expect(link?.textContent?.trim().length, `${doc.id} has an empty label`)
        .toBeGreaterThan(0)
    }

    /* And no MORE than the registry: a stale link to a retired document is
       the other half of the same failure. */
    expect(nav.querySelectorAll('[data-legal-document]')).toHaveLength(
      LEGAL_DOCUMENTS.length,
    )
  })

  it('does not serve any legal text itself', async () => {
    /*
     * The landing page links to the documents; it must not quote them. A
     * paraphrased policy on a marketing page is a second, uncontrolled copy
     * of legal text, which is the divergence that retiring
     * docs/legal/site/*.html was meant to end.
     *
     * Checks the structural giveaways rather than wording, because wording is
     * what a paraphrase changes.
     */
    await renderConfigured()
    const body = pageText()
    expect(body).not.toMatch(/last updated:/i)
    expect(body).not.toMatch(/effective date/i)
    expect(body).not.toMatch(/by using this (site|service)/i)
    expect(body).not.toMatch(/we collect the following/i)
  })
})
