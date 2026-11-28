import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
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
  /* Returned so a test can unmount deliberately — the phone scroll-lock
     test needs to observe the cleanup, not just the mount. */
  return render(<MemoryRouter><LandingPage /></MemoryRouter>)
}

/** The common case: a mailbox configured, which most cases do not care about. */
const renderConfigured = () => renderLanding({ email: 'demo@example.test' })

const pageText = () => document.body.textContent ?? ''

beforeEach(() => { vi.resetModules() })
afterEach(() => { cleanup(); vi.unstubAllEnvs() })

describe('the positioning a visitor reads in the first screen', () => {
  /*
   * ── RETARGETED 2026-11-27, and this one is a POSITIONING change ───────
   *
   * This used to pin "Every investment decision has a story / Make sure
   * your firm remembers it". That headline was deliberately kept once
   * before, so changing it needs a reason rather than a preference.
   *
   * The reason: it is an imperative about recordkeeping. It asks the
   * reader to accept a duty before offering them anything, and the duty
   * it names is the LAST of the three things that sell this product
   * (people start for their own day, firms pay for the team, firms stay
   * for the compounding). The line now opens the institutional
   * intelligence section, where remembering is the subject.
   *
   * What this test pins now is the SHAPE, not the words: the headline
   * must promise an outcome in two horizons, a near one and a far one.
   * That is the structure the positioning depends on, and it is the thing
   * that would be lost if someone later trimmed the headline back to a
   * single clause about decisions.
   */
  /*
   * ── RETARGETED AGAIN, 2026-11-27, AND THE KIND OF GATE CHANGED ────────
   *
   * This pinned the SHAPE of the headline: a near horizon and a far one,
   * the far one about the firm. That was the right gate for a headline I
   * had written, where the words were mine and only the argument needed
   * protecting.
   *
   * The hero is now APPROVED BRAND COPY, signed off with an explicit
   * instruction not to rewrite or substitute any of it. When the exact
   * words are the requirement, a gate on the shape is the weaker test: it
   * would pass happily while someone "improved" the phrasing, which is
   * exactly the failure worth catching.
   *
   * So this pins the strings. All of them, in the elements they belong to,
   * because the hero is a hierarchy and folding the subheadline into the
   * headline would also be a substitution.
   */
  it('renders the approved hero copy exactly, in its own hierarchy', async () => {
    await renderConfigured()
    const hero = document.getElementById('top')

    /* The eyebrow. "The", not "A": the definite article is the
       positioning, and it is part of the approved line. */
    expect(hero?.textContent).toContain(
      'The decision operating system for investment teams',
    )

    /* One h1, carrying BOTH sentences, because they are one headline. */
    const h1 = screen.getByRole('heading', { level: 1 }).textContent ?? ''
    expect(h1).toContain('Every investment decision has a story.')
    expect(h1).toContain('Leverage the intelligence behind it.')

    /* The subheadline and the supporting copy, as their own paragraphs
       rather than folded into the headline. */
    const paras = [...(hero?.querySelectorAll('p') ?? [])]
      .map(p => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    expect(paras).toContain('Better decisions start with Tesseract.')
    expect(paras).toContain(
      'A better environment for investment thinking, a stronger foundation ' +
        'for decision-making, and a lasting source of institutional intelligence.',
    )

    /* And the headline must not go back to leading with the record. */
    expect(h1).not.toMatch(/remember|archive|never lose/i)
  })

  /*
   * THE ACCENT IS THE SECOND SENTENCE, AND IT IS NOT A GRADIENT.
   *
   * The brief asks that the two sentences read as one cohesive headline
   * with the second emphasised through the gold accent. That is a visual
   * requirement, so it is asserted as one.
   *
   * It is deliberately NOT a gradient, and that half is the part most
   * likely to be undone by a later edit reaching for something fancier.
   * See the `ACCENT_TEXT` tombstone in `LandingPage.tsx`: a
   * `bg-gradient-to-br` clipped to text puts its faintest value at the end
   * of the last line, which on a line this long faded out the words the
   * positioning turns on. A solid value puts the emphasis where it was
   * written to go and keeps it there at every width.
   */
  it('emphasises the second sentence of the headline with a solid accent', async () => {
    await renderConfigured()
    const h1 = screen.getByRole('heading', { level: 1 })
    const accent = [...h1.querySelectorAll('span')].find(s =>
      (s.textContent ?? '').includes('Leverage the intelligence'))
    expect(accent, 'the accent sentence must be its own span inside the h1').toBeTruthy()
    expect(accent?.className, 'the accent is a warm solid, not slate').toMatch(/text-amber-\d{3}/)
    expect(
      accent?.className,
      'a clipped gradient fades out the end of the line — see the ACCENT_TEXT note',
    ).not.toMatch(/bg-gradient|bg-clip-text/)
    expect(h1.className).not.toMatch(/bg-clip-text/)
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
  /*
   * ── The third assertion was RETARGETED on 2026-11-27, not dropped ──────
   *
   * It used to pin the exact words "why you did what you did", which lived
   * in a 13px grey paragraph at the bottom of the hero. That paragraph is
   * gone: it stated the most confident thing on the page in the smallest
   * type on the page, so it read as a caveat.
   *
   * The REQUIREMENT behind the assertion is that the hero says what the
   * product keeps, not merely what it is not, so that the two negatives
   * above are not the whole of the positioning. That requirement is intact
   * and this now pins it by meaning rather than by one phrasing: the hero
   * must still claim the record of WHY the firm acted.
   */
  /*
   * ── INVERTED 2026-11-27, AND THIS ONE IS ME BEING OVERRULED ───────────
   *
   * I argued for "Not a market-data terminal. Not an execution system. The
   * record of why your firm acted." on the hero, twice, and wrote this
   * test to hold it there. The argument was that a PM who discovers the
   * category at minute forty of a demo has wasted forty minutes.
   *
   * That argument is right about the SENTENCE and wrong about the
   * POSITION, which is what the review said. Three problems, all of them
   * real:
   *
   *   It defines the product by two absences, as the third thing a
   *   stranger reads.
   *   Its one positive clause, "the record of why your firm acted",
   *   reduces Tesseract to an account of something already finished.
   *   Tesseract improves the work BEFORE the decision, the decision, and
   *   what is learned after it.
   *   It sends the reader back to a recordkeeping reading of the product
   *   at the exact moment the hero has just promised them something
   *   larger.
   *
   * So the gate is inverted rather than deleted, and it is now STRONGER
   * than it was, because it pins two things instead of one:
   *
   *   1. the clarification still exists somewhere on the page, so this
   *      is a move and not a quiet deletion of an honest claim; and
   *   2. it is NOT in the hero, so a future edit cannot drift it back
   *      above the fold.
   *
   * It lives in the platform section now, beside the figure that shows
   * what Tesseract is, which is where a reader asking "how does this sit
   * next to my terminal" actually is.
   */
  /*
   * ── INVERTED 2026-11-28, and the net got larger ───────────────────────
   *
   * This case used to REQUIRE "not a market-data terminal" in the platform
   * section, on the argument that a reader needs to be told which category
   * the product is in. The page owner removed that copy: three absences
   * and a disclaimer printed directly under the product reveal hand a
   * visitor an objection they had not raised, and define the product by
   * what it sits outside of.
   *
   * Deleting the case would leave the rule unenforced, so it is pointed
   * the other way, which is the same move this file already made for the
   * status confessions. It now denies a VOCABULARY of defining-by-absence
   * across the whole page rather than checking one sentence, and it
   * requires that the accurate execution statement still exists in the
   * footer, where it moved. Both halves matter: without the second,
   * deleting the disclosure outright would pass.
   */
  const DEFENSIVE: [RegExp, string][] = [
    [/not a market-data terminal/i, 'Not a market-data terminal.'],
    [/\bdoes not replace\b/i, 'and it does not replace one'],
    [/\bis not an order management\b/i, 'It is not an order management system'],
    [/\bis not an execution\b/i, 'It is not an execution venue'],
    [/\bunlike a (terminal|spreadsheet|chat)\b/i, 'Unlike a terminal, Tesseract keeps the reasoning'],
  ]

  it('has a defensive-copy list that actually matches the copy it forbids', () => {
    for (const [pattern, sample] of DEFENSIVE) {
      expect(sample, `this pattern is inert, it cannot match ${JSON.stringify(sample)}`)
        .toMatch(pattern)
    }
  })

  it('defines the product by what it does, not by what it is not', async () => {
    await renderConfigured()
    const hero = document.getElementById('top')?.textContent ?? ''
    const platform = document.getElementById('platform')?.textContent ?? ''
    const footer = document.querySelector('footer')?.textContent ?? ''

    for (const [pattern] of DEFENSIVE) {
      expect(pageText(), `the page defines Tesseract by an absence: ${pattern}`)
        .not.toMatch(pattern)
    }

    expect(
      platform,
      'the affirmative statement has to stand where the denial used to',
    ).toMatch(/unified investment environment/i)
    expect(platform).toMatch(/research informs judgement/i)

    expect(
      footer,
      'the execution statement is still owed to a compliance reader, and the footer is where it went',
    ).toMatch(/places no orders/i)

    expect(
      hero,
      'defining the product by an absence is not what the hero is for',
    ).not.toMatch(/record of why/i)
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
  /*
   * The role changed from `heading` to `tab` when the lifecycle became a
   * walk. Only the selected stage renders a heading now, so `heading` would
   * find exactly one of the five and fail on the rest. The requirement is
   * untouched: all five stage names must be present and addressable as the
   * section's own navigation.
   */
  it('states the five lifecycle stages as the central story', async () => {
    await renderConfigured()
    for (const stage of ['Research', 'Recommend', 'Decide', 'Execute', 'Review']) {
      expect(screen.getByRole('tab', { name: new RegExp(`\\b${stage}\\b`) }), stage).toBeTruthy()
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

    /*
     * ── This test now CLICKS, and that is the point of the change ────────
     *
     * The lifecycle used to render all six stages at once, so reading
     * `lifecycle.textContent` once saw every consequence. It is now a
     * tablist showing one stage at a time, and a single read would see the
     * first panel and silently stop covering the other five. That is the
     * exact vacuity that hit the screens gate twice.
     *
     * So each stage is selected and asserted on its own. The requirement is
     * unchanged and is now stronger: every stage must carry a description
     * AND a consequence, and this proves it for all six rather than for
     * whichever one happens to render first.
     */
    const consequences = [
      /the version that justified the position stays readable/i,
      /ideas the firm declined stay as retrievable/i,
      /nobody argues later about which draft/i,
      /rejections and deferrals become records/i,
      /a position traces back to the argument/i,
      /judgement becomes separable from luck/i,
    ]

    for (let i = 0; i < stages.length; i++) {
      await userEvent.click(stages[i] as HTMLElement)
      const panel = document.getElementById('stage-panel')
      expect(panel, 'the selected stage must render a panel').not.toBeNull()

      const label = (stages[i].textContent ?? '').trim()
      expect(
        panel?.querySelectorAll('p').length,
        `${label} needs a description AND a consequence`,
      ).toBeGreaterThanOrEqual(2)
      expect(panel?.textContent, `${label} must state its consequence`).toMatch(consequences[i])
    }

    /*
     * The frozen-reasoning claim is the Recommend stage's description
     * rather than its consequence, so it is checked where it actually is.
     */
    await userEvent.click(stages[2] as HTMLElement)
    expect(document.getElementById('stage-panel')?.textContent).toMatch(
      /freezes the reasoning behind it/i,
    )
  })

  /*
   * The lifecycle rail makes the same `role="tablist"` promise the screens
   * do, so it owes the same keyboard contract. Without this the section
   * would have been the one tablist on the page nobody checked.
   */
  it('walks the lifecycle with the arrow keys, from one tab stop', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const rail = document.getElementById('lifecycle')
    const tabs = within(rail as HTMLElement).getAllByRole('tab')
    expect(tabs.length, 'six stages on the rail').toBe(6)
    expect(
      tabs.filter(t => t.getAttribute('tabindex') === '0').length,
      'exactly one tab stop for the lifecycle',
    ).toBe(1)

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1], 'ArrowRight selects the next stage').toHaveAttribute('aria-selected', 'true')
    expect(tabs[1], 'and moves focus to it').toHaveFocus()

    await user.keyboard('{End}')
    expect(tabs[5], 'End jumps to Review').toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowRight}')
    expect(tabs[0], 'and it wraps back to Research').toHaveAttribute('aria-selected', 'true')
  })

  /*
   * The linkage claim, which is the reason this section is a walk rather
   * than a list: every stage after the first must name the record it hangs
   * off, and the first must say it is where the chain starts.
   */
  it('names the record each stage points back at', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const rail = document.getElementById('lifecycle')
    const tabs = within(rail as HTMLElement).getAllByRole('tab')

    await user.click(tabs[0])
    expect(
      document.getElementById('stage-panel')?.textContent,
      'the first stage must say the chain starts there',
    ).toMatch(/where the chain starts/i)

    const upstream = ['Research note', 'Idea', 'Recommendation', 'Decision', 'Accepted trade']
    for (let i = 1; i < tabs.length; i++) {
      await user.click(tabs[i])
      const panel = document.getElementById('stage-panel')?.textContent ?? ''
      expect(panel, `stage ${i + 1} must point back at the ${upstream[i - 1]}`).toContain(
        upstream[i - 1],
      )
      expect(panel, `stage ${i + 1} must say it points back`).toMatch(/points back at/i)
    }
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
/*
 * ── White on white, which every other assertion passed straight over ─────
 *
 * The capture section is the page's one LIGHT band, #f7f8fa with its own
 * self-contained palette. A figure added to it reused the surface the dark
 * sections use, `bg-white/[0.025]` with `text-white`, and the whole card
 * rendered invisible: white text on 2.5% white over near-white.
 *
 * Nothing caught it. Every content assertion about that section passed,
 * because the text was in the DOM and perfectly legible to a test. It was
 * found by looking at a screenshot.
 *
 * jsdom does not resolve Tailwind classes to computed colours, so a true
 * contrast check is not available here. What IS checkable is the structural
 * rule the band already documents: inside the light band, white text is
 * legitimate only on an opaque dark surface. Anything else is this bug.
 */
describe('the light band stays legible', () => {
  const OPAQUE_DARK = /\bbg-(slate|gray|zinc|neutral)-(8|9)00\b|\bbg-\[#0[0-9a-f]{5}\]/

  it('puts white text in the light band only on an opaque dark surface', async () => {
    await renderConfigured()
    const band = document.getElementById('research')
    expect(band, 'the light band must render').toBeTruthy()

    const offenders: string[] = []
    for (const el of band?.querySelectorAll('[class*="text-white"]') ?? []) {
      let onDark = false
      for (let n: Element | null = el; n && n !== band?.parentElement; n = n.parentElement) {
        if (OPAQUE_DARK.test(n.getAttribute('class') ?? '')) { onDark = true; break }
      }
      if (!onDark) {
        offenders.push(
          `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 40)}"`,
        )
      }
    }

    expect(
      offenders,
      `white text on a light background in the capture band:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/*
 * ── This suite used to own the #product section, which no longer exists ──
 *
 * That section was a tablist of six screens against the lifecycle's six
 * stages, one to one and in the same order, so it restated the lifecycle
 * with the nouns swapped. The screens and their figures moved onto the
 * matching stage, and the section was deleted.
 *
 * The REQUIREMENT this suite exists to protect is untouched and is the
 * reason it was retargeted rather than deleted with the section: the page
 * must still say what a user opens, name all six screens, show each one,
 * and change what is on screen when a visitor picks a different one. All
 * of that now happens in `#lifecycle`.
 */
describe('the page says what a user actually opens', () => {
  it('names six real screens, in order, each with what it holds', async () => {
    const user = userEvent.setup()
    await renderConfigured()
    const section = document.querySelector('#lifecycle')
    expect(section, 'the lifecycle section must render').toBeTruthy()

    const named = [...(section?.querySelectorAll('[data-screen]') ?? [])]
      .map(el => el.getAttribute('data-screen'))
    expect(named).toEqual([
      'Asset workspace',
      'Idea Pipeline',
      'Recommendation',
      'Decision Inbox',
      'Trade Book',
      'Outcomes',
    ])

    /*
     * A bare name is a nav menu. Each stage must reach a panel that names
     * the screen it opens and draws it, so this CLICKS all six: reading the
     * panel once would cover the first stage and silently skip five.
     */
    const tabs = [...(section?.querySelectorAll('[role="tab"]') ?? [])]
    for (let i = 0; i < tabs.length; i++) {
      await user.click(tabs[i] as HTMLElement)
      const panel = document.getElementById('stage-panel')
      const wanted = named[i] as string
      expect(panel, `${wanted} must reach its panel`).toBeTruthy()
      expect(panel?.textContent, `the panel must name ${wanted}`).toContain(wanted)
      expect(
        panel?.querySelectorAll('figure').length,
        `${wanted} must be drawn, not only named`,
      ).toBeGreaterThan(0)
    }
  })

  /*
   * The interaction has to actually change what is on screen. A tablist
   * whose panel never updates is six buttons with an aria role painted on.
   */
  it('shows a different screen when a visitor picks one', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const decide = screen.getByRole('tab', { name: 'Decide' })
    expect(decide).toHaveAttribute('aria-selected', 'false')

    await user.click(decide)

    expect(decide).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('tab', { name: 'Research' }),
      'picking one must deselect the others',
    ).toHaveAttribute('aria-selected', 'false')

    /* The figure changed too, not just the highlight. */
    expect(
      document.getElementById('stage-panel')?.textContent,
      'the Decision Inbox figure must be on screen',
    ).toMatch(/a rejection is a decision/i)
  })

  /*
   * `moves between screens with the arrow keys, from one tab stop` was
   * here. It tested the #product tablist's roving tabindex, and there is
   * now exactly one tablist on the page, whose keyboard contract is
   * covered by `walks the lifecycle with the arrow keys, from one tab
   * stop` in the lifecycle suite. Keeping both would be the same
   * assertion run twice against the same six buttons.
   *
   * Worth remembering if a second tablist is ever added: that test asserted
   * ONE tab stop using a page-wide `getAllByRole('tab')`, which is wrong
   * the moment a second widget exists, because two independent tablists
   * should have one stop EACH. Scope any such gate to its own widget.
   */

  /*
   * ── The figure column must reserve room for the TALLEST screen ─────────
   *
   * Picking a screen was resizing the section under the cursor, because the
   * six figures run 236px to 387px. On a tab control that is the worst
   * available behaviour: the reader's next click target moves because of
   * their last click.
   *
   * jsdom has no layout, so this cannot measure heights. What it CAN check
   * is that the reservation exists at all, which is the thing that went
   * missing — the first fix used a floor shorter than one of the six
   * figures, so the shift survived on one tab in six. The measured heights
   * live in a comment beside the class, and the number here is the floor
   * those measurements require.
   */
  it('reserves a fixed height for the figure column, so picking a screen cannot resize the section', async () => {
    await renderConfigured()
    /*
     * Targeted by NAME, not by a class pattern. The first version of this
     * took the first `[class*="min-h-"]` under the panel's parent, which
     * matched the TABPANEL — it has a 76px floor of its own for the
     * description text — and read 76 where it meant to read 390. It failed
     * loudly rather than passing on the wrong element, which is the only
     * reason it was cheap to find, but a selector that can resolve to two
     * different things is the same defect as a position-based one.
     */
    const column = document.querySelector('#lifecycle [data-figure-column]')
    expect(column, 'the figure column must reserve a minimum height').not.toBeNull()

    const cls = column?.getAttribute('class') ?? ''
    const floor = Number(/min-h-\[(\d+)px\]/.exec(cls)?.[1] ?? 0)
    expect(
      floor,
      'the floor must clear the tallest figure, measured at 387px',
    ).toBeGreaterThanOrEqual(387)
  })

  /*
   * `heads that section with the question a reader is actually asking` was
   * here, requiring the #product heading to address the reader and not to
   * count the screens. The section it governed is gone, and a heading
   * requirement cannot be retargeted onto a section with a different job:
   * the lifecycle's heading names the six stages, which is what that
   * section is for.
   *
   * The count rule is kept below as a page-wide one, because the mistake it
   * caught — announcing how many screens there are, which reads as a
   * ceiling to anyone who has not seen the product — is a thing any future
   * section could do again.
   */
  it('never advertises how many screens the product has', async () => {
    await renderConfigured()
    expect(
      pageText(),
      'a screen count reads as a ceiling to a reader who cannot judge it',
    ).not.toMatch(/\b(six|seven|eight|6|7|8)\s+screens?\b/i)
  })

  /*
   * Coverage has almost no adoption, and Trade Lab's sharing tiers are
   * unpopulated. Both are real tabs. Naming either here would be the page
   * writing a cheque the demo cannot cash, which is a worse failure than
   * saying too little.
   */
  it('does not advertise the surfaces the product has not earned yet', async () => {
    await renderConfigured()
    /*
     * Widened from `#product` to the WHOLE PAGE when that section was
     * deleted. Scoping it to one section was always the weaker form: it
     * only ever stopped the claim appearing in the one place somebody
     * happened to be editing, and Trade Lab named anywhere else on the page
     * is the same cheque the demo cannot cash.
     */
    expect(pageText(), 'Trade Lab sharing tiers have zero rows').not.toMatch(/\bTrade Lab\b/)
    expect(
      [...document.querySelectorAll('[data-screen]')].map(el => el.getAttribute('data-screen')),
      'Coverage has almost no adoption',
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
describe('the page can actually be scrolled on a phone', () => {
  /*
   * ── THIS SHIPPED, AND IT WAS LIVE ────────────────────────────────────
   *
   * Measured against the PRODUCTION site at 390x844, not just locally:
   *
   *     body overflow 'hidden', scrollHeight 844 against ~19,000px of
   *     content, and window.scrollY stayed 0 after scrollTo(0, 99999)
   *
   * Every visitor on a phone saw the hero and could not reach one call to
   * action below it.
   *
   * The cause is a correct rule aimed at the wrong page: index.css locks
   * html/body/#root to height 100% and overflow hidden under
   * max-width 767px, so the authenticated shell's inner containers own
   * scrolling and its header cannot be displaced. The public page has no
   * inner scroller, so it simply froze.
   *
   * ── What this test can and cannot see ────────────────────────────────
   *
   * jsdom applies no stylesheet and has no layout, so it CANNOT check
   * that the page scrolls. What it can check is the mechanism: that the
   * opt-out attribute is set while the page is mounted and handed back
   * when it unmounts. The handback is the half that would break the app
   * shell, which makes it the half most worth pinning.
   *
   * The scrolling itself was verified in a real browser at 390x844,
   * before and after, and the lock was verified to return on navigating
   * to /login and to come back on navigating back.
   */
  it('releases the phone scroll lock while it is mounted', async () => {
    const { unmount } = await renderConfigured()

    expect(
      document.documentElement.hasAttribute('data-public-scroll'),
      'without this the page is frozen at one screen on every phone',
    ).toBe(true)

    unmount()

    expect(
      document.documentElement.hasAttribute('data-public-scroll'),
      'the app shell needs the lock back, or its header scrolls away on a phone',
    ).toBe(false)
  })
})

describe('the trust section claims only what was verified', () => {
  /*
   * ── THIS IS THE SECTION WHERE OVERCLAIMING HAS CONSEQUENCES ───────────
   *
   * An institutional buyer asks about certifications on the first call.
   * A page that implies one it does not have loses the second call, and
   * a security claim is the kind a founder cannot walk back as a
   * misunderstanding.
   *
   * What the copy says was checked against production, read-only, before
   * it was written: 296 of 296 public tables have rowsecurity enabled,
   * organization_ai_config exists and is org-scoped, and the assistant's
   * read scope is a stored setting.
   *
   * What it must NEVER say is below. Note that "RLS is enabled on every
   * table" is NOT proof the policies are correct — this repo's own notes
   * record that the audit is partial — so the copy describes what is
   * enforced and where, never that it is complete or audited.
   */
  /*
   * A `not.toMatch` list is the single easiest gate to ship dead: a regex
   * with a typo, an escape that never matches, or a pattern aimed at
   * wording nobody would use, and every assertion passes forever while
   * the page says whatever it likes.
   *
   * Normally this would be proven by injecting the claim into the page.
   * Writing "Tesseract is SOC 2 compliant" into a real source file is not
   * something to do even for a minute, so each pattern is instead proven
   * against a sample of the exact sentence it exists to stop. A pattern
   * that cannot match its own example fails here rather than sleeping.
   */
  const FORBIDDEN: [RegExp, string][] = [
    [/\bSOC\s*2\b/i, 'Tesseract is SOC 2 certified'],
    [/\bISO\s*27001\b/i, 'Certified to ISO 27001'],
    [/\bGDPR\s+compliant\b/i, 'Fully GDPR compliant'],
    [/\bHIPAA\b/i, 'HIPAA ready'],
    [/\bpenetration[- ]tested\b/i, 'Independently penetration-tested'],
    [/\bbank[- ]grade\b/i, 'Bank-grade encryption'],
    [/\bmilitary[- ]grade\b/i, 'Military-grade security'],
    [/\bfully\s+(audited|compliant|secure)\b/i, 'Our platform is fully audited'],
    [/\bguarantee[sd]?\s+(security|privacy|compliance)\b/i, 'We guarantee security'],
    [/\bimmutable\b/i, 'Decisions are stored in an immutable ledger'],
    [/\bnever\s+used\s+for\s+training\b/i, 'Your research is never used for training'],
    [/\bzero[- ]knowledge\b/i, 'A zero-knowledge architecture'],
  ]

  it('has a forbidden list that actually matches the claims it forbids', () => {
    for (const [pattern, sample] of FORBIDDEN) {
      expect(sample, `this pattern is inert — it cannot match ${JSON.stringify(sample)}`)
        .toMatch(pattern)
    }
  })

  it('names no certification, compliance posture or audit it does not hold', async () => {
    await renderConfigured()
    const text = pageText()
    for (const [forbidden] of FORBIDDEN) {
      expect(text, `unverifiable security claim on the page: ${forbidden}`)
        .not.toMatch(forbidden)
    }
  })

  it('states plainly that there is no certification yet', async () => {
    await renderConfigured()
    const trust = document.getElementById('trust')
    expect(trust, 'the trust section must exist').toBeTruthy()
    expect(
      trust?.textContent,
      'a buyer asks this on the first call; answering it here is what survives diligence',
    ).toMatch(/no security certification/i)
  })

  /*
   * ── INVERTED 2026-11-28 ───────────────────────────────────────────────
   *
   * This required the words "database" and "per row" in the trust
   * section, because the mechanism really is enforced below the
   * application and saying so is stronger than saying "we filter
   * carefully". That reasoning holds for a security questionnaire. It does
   * not hold on a page a portfolio manager reads: "one firm cannot read
   * another" makes a reader picture the failure, and the sentence after it
   * explained row-level enforcement to someone who has not asked.
   *
   * So the requirement moves up a level. The three pillars must be present
   * as customer outcomes, and the implementation vocabulary must be
   * absent. The mechanism is unchanged and is still documented where a
   * diligence reader will look for it.
   *
   * NOT ABSOLUTE, and this is checked too. "cannot read" and "guarantee"
   * are forbidden by `FORBIDDEN` above, which is what keeps the softer
   * wording from drifting back into a promise.
   */
  const IMPLEMENTATION: [RegExp, string][] = [
    [/\brow[- ]level\b/i, 'Row-level security on every table'],
    [/\bper row\b/i, 'enforced per row, by the database'],
    [/\bdatabase\b/i, 'isolation is enforced by the database'],
    [/\bSQL\b/i, 'SQL policies decide what you see'],
    [/\bAPI key\b/i, 'your own API key, held encrypted'],
    [/\bprovider account\b/i, 'your organization’s own provider account'],
    [/\bRLS\b/, 'RLS is enabled on every table'],
  ]

  it('has an implementation-vocabulary list that matches the copy it forbids', () => {
    for (const [pattern, sample] of IMPLEMENTATION) {
      expect(sample, `this pattern is inert, it cannot match ${JSON.stringify(sample)}`)
        .toMatch(pattern)
    }
  })

  it('states the controls as outcomes, not as implementation', async () => {
    await renderConfigured()
    const trust = document.getElementById('trust')?.textContent ?? ''

    expect(trust, 'the confidentiality pillar is the one a buyer asks about first')
      .toMatch(/institutional confidentiality/i)
    expect(trust).toMatch(/controlled access/i)
    expect(trust).toMatch(/firm-specific ai context/i)

    for (const [pattern] of IMPLEMENTATION) {
      expect(trust, `the trust section explains the plumbing: ${pattern}`)
        .not.toMatch(pattern)
    }
  })
})

describe('the role section is three answers, not one answer three times', () => {
  /*
   * ── THE BUG THIS EXISTS TO PREVENT HAS ALREADY SHIPPED ONCE ───────────
   *
   * A section called "what you actually work in" turned out to be the
   * lifecycle section with the nouns swapped — same six items, same order,
   * Research/Research note -> Asset workspace, Develop/Idea -> Idea
   * Pipeline, and so on. Two commits tried to fix it by rewriting the
   * heading. No heading fixes a section whose content is another
   * section's content, and it was eventually deleted.
   *
   * A role selector is the easiest place to make that mistake again,
   * because three tabs of the same component with different strings looks
   * like three audiences and is one.
   */
  it('names the three seats that actually decide', async () => {
    await renderConfigured()
    const seats = [...document.querySelectorAll('[data-role-seat]')]
      .map(el => el.getAttribute('data-role-seat'))
    expect(seats).toEqual(['Analysts', 'Portfolio managers', 'Investment leadership'])
  })

  it('gives each role a different shape of artifact', async () => {
    await renderConfigured()
    const shapes = [...document.querySelectorAll('[data-role-shape]')]
      .map(el => el.getAttribute('data-role-shape'))

    expect(shapes.length).toBe(3)
    expect(
      new Set(shapes).size,
      `all three roles render the same shape (${shapes.join(', ')}) — that is the ` +
        'duplicate-section bug this page already shipped once',
    ).toBe(3)
  })

  it('says something different to each role, not the same claim reworded', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const panelsSeen: string[] = []
    for (const seat of ['Analysts', 'Portfolio managers', 'Investment leadership']) {
      await user.click(screen.getByRole('tab', { name: seat }))
      const panel = document.getElementById('role-panel')
      expect(panel?.textContent ?? '').not.toHaveLength(0)
      panelsSeen.push((panel?.textContent ?? '').toLowerCase())
    }

    /*
     * Each panel must carry a figure, so no role is sold on prose alone.
     */
    expect(document.querySelectorAll('[data-role-figure]').length).toBeGreaterThan(0)

    /*
     * And the three panels must not be near-identical text. Compared on
     * word overlap rather than string equality, because three reworded
     * versions of one claim is exactly the failure mode and they would
     * never be byte-equal.
     */
    for (let a = 0; a < panelsSeen.length; a++) {
      for (let b = a + 1; b < panelsSeen.length; b++) {
        const wa = new Set(panelsSeen[a].match(/[a-z]{5,}/g) ?? [])
        const wb = new Set(panelsSeen[b].match(/[a-z]{5,}/g) ?? [])
        const shared = [...wa].filter(w => wb.has(w)).length
        const overlap = shared / Math.min(wa.size, wb.size)
        expect(
          overlap,
          `role panels ${a} and ${b} share ${Math.round(overlap * 100)}% of their ` +
            'vocabulary — they are arguing the same thing twice',
        ).toBeLessThan(0.5)
      }
    }
  })

  it('reserves a fixed height so picking a role cannot resize the section', async () => {
    await renderConfigured()
    /*
     * Same defect as the lifecycle section, where the container had been
     * sized from whichever figure happened to be open when it was built,
     * and one tab in six then jumped the page by 41px.
     */
    const col = document.querySelector('[data-role-figure-column]')
    const min = /min-h-\[(\d+)px\]/.exec(col?.getAttribute('class') ?? '')?.[1]
    expect(min, 'the figure column must reserve a measured minimum height').toBeTruthy()
    expect(Number(min)).toBeGreaterThanOrEqual(452)
  })

  it('walks the roles with the arrow keys, from one tab stop', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const list = document.querySelector('[role="tablist"][aria-label="Who Tesseract is for"]')
    const tabs = [...(list?.querySelectorAll('[role="tab"]') ?? [])] as HTMLElement[]
    expect(tabs).toHaveLength(3)
    expect(
      tabs.filter(t => t.getAttribute('tabindex') === '0'),
      'a tablist is ONE tab stop; the arrow keys move within it',
    ).toHaveLength(1)

    tabs[0].focus()
    await user.keyboard('{ArrowRight}')
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{End}')
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{ArrowRight}')
    expect(tabs[0].getAttribute('aria-selected'), 'End then Right should wrap').toBe('true')
  })
})

describe('the page stays readable', () => {
  /*
   * ── A TYPE SCALE, because the page had drifted into seven of them ──────
   *
   * Measured in the browser at 1440px before this landed: 183 of 201 text
   * elements rendered below 16px, using 9, 10, 11, 12, 13, 14 and 15.
   * Seven steps inside seven pixels is not a scale. Nothing was
   * deliberately smaller than anything else, so the page read as uniformly
   * quiet and the report was that it was hard to digest.
   *
   * ── Why this reads the DOM and not the source files ───────────────────
   *
   * jsdom applies no Tailwind, so `getComputedStyle().fontSize` returns the
   * default for everything and cannot see these at all. The class string IS
   * the size here, because an arbitrary value is literal.
   *
   * It still walks the RENDERED tree rather than grepping the files, which
   * is the part that matters: a component that stops rendering, or a size
   * that only exists in a dead branch, is invisible to this gate, where a
   * source regex would happily pass on code nothing mounts.
   */
  const SCALE = new Set([12, 14, 16, 17, 18, 20, 24])

  it('uses one type scale, with nothing under 12px', async () => {
    await renderConfigured()

    /*
     * `document.querySelectorAll('[class*="text-["]')` was here and matched
     * NOTHING, so this gate passed with an injected 11px paragraph on the
     * page — decoration, caught only because the injection was run.
     *
     * The unescaped `[` inside the attribute-selector value is the reason.
     * Walking every element and reading the class attribute has no such
     * trap, and the cost is irrelevant on a single page.
     */
    const found = new Map<number, string>()
    for (const el of document.querySelectorAll('*')) {
      for (const m of (el.getAttribute('class') ?? '').matchAll(/text-\[(\d+)px\]/g)) {
        const px = Number(m[1])
        if (!found.has(px)) {
          found.set(px, `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 36)}"`)
        }
      }
    }

    const tooSmall = [...found.entries()].filter(([px]) => px < 12)
    expect(
      tooSmall.map(([px, where]) => `${px}px: ${where}`),
      'nothing on a page for buyers should be under 12px',
    ).toEqual([])

    const offScale = [...found.entries()].filter(([px]) => !SCALE.has(px))
    expect(
      offScale.map(([px, where]) => `${px}px: ${where}`),
      `sizes outside the scale ${[...SCALE].join(', ')} — add a step deliberately or use an existing one`,
    ).toEqual([])
  })

  it('sets body copy at 16px or more, not 13 to 15', async () => {
    await renderConfigured()

    /*
     * The paragraphs that carry the argument, as opposed to captions and
     * chips. A `<p>` of more than ~80 characters is prose a buyer has to
     * read, and prose is the thing that was failing at 15px.
     *
     * Text INSIDE a `<figure>` is excluded, and this is a scoping decision
     * rather than a loophole: a caption explaining a drawing is secondary
     * to it by definition, and setting a caption at the same size as the
     * argument flattens the difference between them. The gate found three
     * of these and one real failure — the legal disclaimer at 14px, which
     * was raised to 16, because a disclaimer nobody can read is a
     * disclaimer that does not do its job.
     */
    const prose = [...document.querySelectorAll('p')]
      .filter(p => (p.textContent ?? '').trim().length > 80)
      .filter(p => !p.closest('figure'))

    expect(prose.length, 'the page must still have prose to check').toBeGreaterThan(8)

    const small = prose
      .map(p => {
        const px = Number(/text-\[(\d+)px\]/.exec(p.getAttribute('class') ?? '')?.[1] ?? 0)
        return { px, text: (p.textContent ?? '').trim().slice(0, 40) }
      })
      .filter(r => r.px > 0 && r.px < 16)

    expect(
      small.map(r => `${r.px}px: ${r.text}`),
      'body copy under 16px is what "hard to digest" means',
    ).toEqual([])
  })

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
   * ── Raised 1250 -> 1600 on 2026-11-27, by the page owner ───────────────
   *
   * The authorization was given to pay for a section naming the screens the
   * product opens. That section turned out to already exist, so the first
   * attempt spent nothing and the ceiling stayed at 1,250.
   *
   * It is spent now, on the screen browser: six drawn representations of
   * real screens, each carrying the field labels that make it legible as
   * that screen. The words it adds are LABELS INSIDE FIGURES, not more
   * argument, which is the opposite of what this ratchet was built to
   * catch. The page's prose did not grow.
   *
   * The ratchet is still a ratchet. It fails on sprawl, and the rule stands
   * that a later section is paid for by cutting, not by editing this line.
   */
  /*
   * ── RAISED 1600 -> 1700 ON 2026-11-27, AND THIS NEEDS DEFENDING ───────
   *
   * The rule above says a later section is paid for by cutting. It was,
   * four times, and the payments are real:
   *
   *   the hero's three-item dl          ~45 words  (shown by the canvas
   *                                                 and the reassess
   *                                                 figure instead)
   *   #research, six bullets to four    ~40 words  (two restated the
   *                                                 canvas)
   *   #memory, three items to two       ~20 words  ("it outlasts the
   *                                                 team" is now the CIO
   *                                                 role panel, with a
   *                                                 figure)
   *   "notes that belong to the name"   in the above
   *
   * What changed that cutting could not pay for is that the page went
   * from SIX sections to ELEVEN by explicit instruction: a product
   * introduction, a role section, a decision-review section and a trust
   * section were all added because the page did not answer what the
   * product is, who it is for, why it is different, or whether a firm can
   * trust it with proprietary research.
   *
   * A 1,600-word ceiling calibrated for a six-section page is not a
   * meaningful bound on an eleven-section one, and the dishonest way to
   * keep it would have been to shave adjectives until the number passed
   * while the page got no shorter to read.
   *
   * 1700 is 19 words of headroom over the current 1681, deliberately.
   * The ratchet is still a ratchet: the next section is paid for by
   * cutting, and the reason for any future rise belongs here in writing.
   */
  it('holds the total word count to a ratchet', async () => {
    await renderConfigured()
    const words = (pageText().match(/\S+/g) ?? []).length
    expect(words, `${words} words, ceiling 1700. Cut something before raising this.`)
      .toBeLessThan(1700)
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
      const p = h.parentElement?.querySelector('p')
      /*
       * A paragraph explicitly marked as a section lead is exempt, which
       * is the exemption this test's own description already claims to
       * make. The leads it was written against sit under an h2 and so
       * were never selected here; the role panels put a lead under an h3,
       * where the selector cannot tell a lead from a bullet. The marker
       * resolves that rather than widening what counts as a bullet.
       */
      if (!p || p.hasAttribute('data-section-lead')) continue
      const text = p.textContent ?? ''
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
    /*
     * Was /document their decisions a second time/. The copy was
     * deliberately generalised off the analyst, because the same claim
     * covers a PM writing a rationale and a committee leaving a note, and
     * scoping it to one seat made the section look like a feature for one
     * seat. The REQUIREMENT is unchanged and is the load-bearing half of
     * this test: the section must still promise that nothing is written
     * twice. "a second time" is that promise, and the words before it are
     * free to describe whoever is writing.
     */
    expect(research?.textContent).toMatch(/a second time/i)
    expect(research?.textContent).toMatch(/typed record rather than a document/i)
  })

  /*
   * ── RETARGETED 2026-11-27 when this section went from six items to four ─
   *
   * The count was incidental; the requirement is that this section names
   * CONCRETE surfaces rather than abstractions about "capture".
   *
   * "Notes that belong to the name" was dropped because the platform
   * canvas now SHOWS thesis, risks, valuation and coverage sitting on one
   * security, and a sentence restating a picture the reader just looked at
   * is the repetition this page keeps having to cut. The claim is not
   * lost, so the second assertion below follows it to where it went —
   * otherwise this retarget would quietly permit deleting it outright.
   */
  /*
   * ── RETARGETED AGAIN, 2026-11-27, four items to three ────────────────
   *
   * "Structured diligence" was dropped because the platform canvas now
   * draws a research-process pane carrying the open requirements on a
   * workflow. That pane and this cut landed in the same pass, so the
   * second assertion below FOLLOWS THE CLAIM to where it went: without
   * it, this retarget would silently permit deleting the capability
   * rather than relocating it, which is the move this file exists to
   * prevent.
   */
  it('names the capture surfaces an analyst actually touches', async () => {
    await renderConfigured()
    const research = document.getElementById('research')
    const headings = [...(research?.querySelectorAll('h3') ?? [])].map(h => h.textContent ?? '')
    expect(headings.length).toBeGreaterThanOrEqual(3)
    expect(headings.join(' | ')).toMatch(/versions instead of overwrites/i)
    expect(headings.join(' | ')).toMatch(/capture/i)

    /* The diligence claim, now shown rather than stated. */
    expect(
      document.getElementById('platform')?.textContent,
      'structured diligence moved into the canvas as a drawn pane, so it must be there',
    ).toMatch(/requirements? open/i)
  })

  it('still shows research living on the security, now in the canvas', async () => {
    await renderConfigured()
    const platform = document.getElementById('platform')
    expect(platform, 'the platform section carries the claim this test follows').toBeTruthy()
    const text = platform?.textContent ?? ''
    expect(text).toMatch(/not filed in a folder|on the security/i)
    expect(text).toMatch(/thesis/i)
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

    /*
     * ── THE WIDTH IS DERIVED NOW, NOT HARD-CODED ────────────────────────
     *
     * This asserted `max-w-7xl` literally. The page widened its text
     * column to `max-w-[82rem]` on 2026-11-27, because `max-w-7xl` is
     * 1280px and at 1920 that wasted 320px either side while capping every
     * product figure at the width of a paragraph.
     *
     * The literal assertion then failed, which was the gate doing its job
     * at the wrong altitude: the REQUIREMENT was never that the grid is
     * 1280px wide, it is that the grid and the text share one width so the
     * outer hairlines land on the text edge. Re-pinning a new literal
     * would have the same defect and would fail again the next time.
     *
     * So the expectation is read off the page's own content shell. The
     * nav is the reference because it is the element the grid is supposed
     * to line up with and it is always present.
     */
    const navShell = document.querySelector('nav[aria-label="Main"]')
    const expectedWidth = /(max-w-\[[^\]]+\]|max-w-\w+)/.exec(navShell?.className ?? '')?.[1]
    expect(expectedWidth, 'the nav must declare the shared content width').toBeTruthy()

    for (const rail of rails) {
      expect(rail.className).toMatch(/px-6/)
      expect(rail.className).toMatch(/sm:px-8/)
      expect(rail.className).toMatch(/lg:px-12/)
      expect(
        rail.className.split(/\s+/),
        `the grid must share the content width (${expectedWidth}) or the outer ` +
          'hairlines drift off the text edge',
      ).toContain(expectedWidth)
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

  /*
   * ── CHANGED DELIBERATELY on 2026-11-27, by the page owner ──────────────
   *
   * The rule above used to be "a figure carries no digit and no currency
   * symbol", and its own comment said: if a figure ever legitimately needs
   * a number, change this gate deliberately and say why; do not widen it to
   * go green. This is that change, and this is the why.
   *
   * The page showed the product zero times across 1,542 words. The owner
   * decided to show it, as representations drawn in code from the real
   * record shape, which is what the reference product on the market does.
   * Those cannot be digit-free: an idea has a conviction and an age, a
   * recommendation has sizing, and stripping the values empties the figure
   * of the only thing that makes it worth drawing.
   *
   * THE SAFETY PROPERTY IS UNCHANGED and is now enforced where it actually
   * lives. "Nothing may be mistaken for a capture of real data" never meant
   * "no numbers"; digits were a cheap proxy for it. The real risks are that
   * a visitor thinks they are seeing a real firm's book, or that the page
   * states a view on a real security while disclaiming that it gives
   * investment advice. So:
   *
   *   - still zero <img>, which remains the backstop against a screenshot
   *   - every figure still carries a <figcaption>
   *   - every illustrative figure is MARKED, visibly and in the DOM
   *   - NO REAL SECURITY is named in any figure, which is the assertion
   *     that actually protects the disclaimer, and which the old digit rule
   *     did not check at all
   *
   * That last check is strictly stronger than what it replaces: the old
   * gate would have passed a figure reading "NVDA, conviction High" because
   * it contains no digit.
   */
  /*
   * ── This gate was VACUOUS on its first draft. That is why it clicks. ───
   *
   * The screen browser renders ONE panel at a time, so a test that inspects
   * `getAllByRole('figure')` on the initial render sees the default tab's
   * figure and nothing else. Five of the six drawn screens were never
   * looked at.
   *
   * Proven, not assumed: with `NVDA` substituted into the Idea Pipeline
   * figure, the first version of this test PASSED, because Idea Pipeline is
   * not the default tab. A gate that checks one of six paths is decoration.
   *
   * So it walks every tab and re-reads the figures after each click.
   */
  /*
   * ── THE PROHIBITION ON REAL TICKERS IS GONE, AND WHAT REPLACED IT ──────
   *
   * This case used to assert that no `[data-security-name]` held a member
   * of a hard-coded `REAL_TICKERS` set, so the figures named NORTHWIND,
   * VERIDIAN, HALDEN and CALDERA. The page owner's judgement, which is
   * correct and is the reason this changed: eight-letter invented names
   * read as a toy to an investor, and a toy does not survive being shown
   * to a portfolio manager. The figures name MSFT, NVDA, AVGO, V, COST and
   * JPM now, with investment cases written to make sense for those
   * businesses.
   *
   * The ticker ban was never the safety property. It was one cheap way of
   * reaching the real one: a reader must not be able to mistake a drawn
   * case for a view on a security, for market data, or for evidence that
   * the company is a customer. That property is now enforced in three
   * places, all of them here:
   *
   *   1. Every figure that names a security carries the illustrative
   *      marker IN ITS CAPTION, so it arrives with the name rather than
   *      three sections away.
   *   2. No figure may contain anything that reads as market data: a
   *      currency amount, a percentage, or a year.
   *   3. The page carries the securities disclosure, naming the figures as
   *      invented and the companies as not customers, partners or
   *      endorsers. Without this, "comply by deleting the disclosure"
   *      would pass.
   *
   * ── This gate was VACUOUS on its first draft. That is why it clicks. ───
   *
   * The screen browser renders ONE panel at a time, so a test that
   * inspects `getAllByRole('figure')` on the initial render sees the
   * default tab's figure and nothing else. Five of the six drawn screens
   * were never looked at.
   *
   * Proven, not assumed: with `NVDA` substituted into the Idea Pipeline
   * figure, the first version of this test PASSED, because Idea Pipeline
   * is not the default tab. A gate that checks one of six paths is
   * decoration. So it walks every tab and re-reads the figures after each
   * click, and that remains the most load-bearing line in the file.
   */
  const MARKET_DATA: [RegExp, string][] = [
    [/[$€£]\s?\d/, 'Price target $540'],
    [/\d\s?%/, 'Up 12% since initiation'],
    [/\b(19|20)\d{2}\b/, 'Initiated March 2024'],
    [/\b(USD|EUR|GBP)\b/, 'Cost basis 410 USD'],
  ]

  it('has a market-data list that matches the copy it forbids', () => {
    for (const [pattern, sample] of MARKET_DATA) {
      expect(sample, `this pattern is inert, it cannot match ${JSON.stringify(sample)}`)
        .toMatch(pattern)
    }
  })

  it('marks every figure that names a security, and quotes no market data', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.length, 'there must be screens to walk').toBeGreaterThan(0)

    let illustrationsSeen = 0
    let namedSecuritiesSeen = 0

    for (const tab of tabs) {
      const which = tab.textContent?.trim() ?? '?'
      await user.click(tab)

      const figures = screen.getAllByRole('figure')
      expect(figures.length, `${which}: a figure must render`).toBeGreaterThan(0)

      for (const f of figures) {
        const caption = f.querySelector('figcaption')
        expect(caption, `${which}: every figure needs a caption`).not.toBeNull()

        const text = f.textContent ?? ''
        for (const [pattern] of MARKET_DATA) {
          expect(
            text,
            `${which}: a figure quotes something that reads as market data: ${pattern}`,
          ).not.toMatch(pattern)
        }

        /*
         * The name and the marker have to arrive together. Read off
         * `[data-security-name]` rather than the figure's textContent: the
         * first version of the old gate pattern-matched textContent and
         * missed `NVDA` entirely, because textContent concatenates
         * siblings with no separator ("NVDAReady to recommend") and the
         * trailing `\b` had no boundary to find against a letter.
         */
        if (f.querySelectorAll('[data-security-name]').length > 0) {
          namedSecuritiesSeen += 1
          expect(
            caption?.textContent ?? '',
            `${which}: this figure names a security without the illustrative marker beside it`,
          ).toMatch(/illustrative/i)
        }
      }

      for (const f of figures.filter(x => x.getAttribute('data-illustration') === 'true')) {
        illustrationsSeen += 1
        expect(
          f.querySelector('figcaption')?.textContent ?? '',
          `${which}: the marker belongs in the caption, where a screen reader meets it`,
        ).toMatch(/illustrative/i)
      }
    }

    /* One drawn screen per tab, at least, or a tab rendered no illustration. */
    expect(
      illustrationsSeen,
      'every screen must show a marked illustration',
    ).toBeGreaterThanOrEqual(tabs.length)

    /* And the security-name branch above must have actually run. */
    expect(
      namedSecuritiesSeen,
      'no figure named a security, so the marker requirement checked nothing',
    ).toBeGreaterThan(0)

    expect(
      document.querySelector('footer')?.textContent ?? '',
      'naming real companies obliges the page to say the cases are invented',
    ).toMatch(/are invented/i)
    expect(
      document.querySelector('footer')?.textContent ?? '',
      'and that the companies named are not customers of Tesseract',
    ).toMatch(/not customers, partners or endorsers/i)
  })

  it('keeps the schema diagrams free of invented data', async () => {
    await renderConfigured()
    /*
     * The ORIGINAL rule, still enforced, now scoped to the figures it was
     * written for: the structural diagrams that are not illustrations of a
     * screen. `RecordChain` is one of these. It must stay a schema.
     */
    const schemas = screen.getAllByRole('figure')
      .filter(f => f.getAttribute('data-illustration') !== 'true')
    expect(schemas.length, 'the schema diagrams must still exist').toBeGreaterThan(0)
    for (const f of schemas) {
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
  /*
   * ── The six became TABS on 2026-11-27, not headings ────────────────────
   *
   * The section is now a screen browser: picking a name shows a drawn
   * representation of that screen beside its description. The six names and
   * their six descriptions all survive, one per panel, so this assertion
   * moved from `heading` to `tab` rather than being weakened.
   */
  /*
   * ── And on 2026-11-27 they moved onto the LIFECYCLE stages ─────────────
   *
   * The tabs are now named for the stage (Research, Develop, ...) and carry
   * the screen they open as `data-screen`, so the lookup moved from the
   * tab's accessible name to that attribute. The requirement is the one
   * this test has always had: all six surfaces named, none dropped.
   */
  it('still names every product surface', async () => {
    await renderConfigured()
    const named = [...document.querySelectorAll('[data-screen]')]
      .map(el => el.getAttribute('data-screen'))
    for (const surface of [
      'Asset workspace',
      'Idea Pipeline',
      'Recommendation',
      'Decision Inbox',
      'Trade Book',
      'Outcomes',
    ]) {
      expect(named, surface).toContain(surface)
    }
    expect(named.length, 'six surfaces, re-formed but not reduced').toBe(6)
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
   * ── INVERTED 2026-11-28 ───────────────────────────────────────────────
   *
   * This required "own provider key" and "controls which model" in the ACT
   * AI section. The history is worth keeping: the line started life inside
   * a "Not yet built" column as the reason platform-provisioned AI was
   * missing, this gate was written to stop it reading as an apology, and
   * it succeeded at that.
   *
   * It is still the wrong thing to sell. Bringing your own provider
   * account is a procurement answer; a reader deciding whether this is
   * interesting does not care, and an administrator does not read a
   * landing page. Worse, anchoring the public pitch to the current
   * implementation means rewriting the section the day that changes.
   *
   * The capability is untouched. It is simply not a selling point, so the
   * gate now forbids the vocabulary and requires the capability that took
   * its place.
   */
  const PROCUREMENT: [RegExp, string][] = [
    [/bring your own (model|key)/i, 'You bring your own model'],
    [/\bown provider (key|account)\b/i, 'It runs on your own provider key'],
    [/\bAPI key\b/i, 'configured with your API key'],
    [/\bBYOK\b/, 'BYOK is supported'],
    [/\byour administrator\b/i, 'configured by your administrator'],
  ]

  it('has a procurement-copy list that matches the copy it forbids', () => {
    for (const [pattern, sample] of PROCUREMENT) {
      expect(sample, `this pattern is inert, it cannot match ${JSON.stringify(sample)}`)
        .toMatch(pattern)
    }
  })

  it('sells the assistant on what it reads, not on whose account it runs on', async () => {
    await renderConfigured()
    for (const [pattern] of PROCUREMENT) {
      expect(pageText(), `the page sells a procurement detail: ${pattern}`)
        .not.toMatch(pattern)
    }

    const actAi = document.getElementById('act-ai')?.textContent ?? ''
    expect(
      actAi,
      'what replaced it has to be present, or this is a deletion dressed as a refinement',
    ).toMatch(/grounded in the firm/i)
    expect(actAi).toMatch(/investment thesis/i)
    expect(actAi).toMatch(/decisions and their rationale/i)
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

/**
 * ── THE NAVIGATION BELOW `lg` ───────────────────────────────────────────
 *
 * What was shipped: below `lg` the header held the mark and a Sign in
 * link, and every section anchor was `hidden`. On a phone the page is
 * roughly 21,000px tall, so a visitor who wanted the trust section had to
 * scroll the whole page to find it, and the primary action was not in the
 * header at all. At `md` it was worse than absent: two of five links
 * showed, which reads as the whole menu rather than a fragment.
 *
 * jsdom applies no stylesheet, so NOTHING here can see a breakpoint, a
 * `hidden` class or a 48px row. These cases check the half jsdom can
 * model, which is the behaviour: the disclosure contract, the
 * destinations, focus movement and dismissal. The visual half (the button
 * appearing below `lg` and not above it, the panel's position, the row
 * height, no horizontal overflow) was measured in a real browser at 1920,
 * 1440, 1280, 768 and 390 and is recorded in the delivery notes.
 */
describe('the navigation a phone gets', () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    const button = screen.getByRole('button', { name: /open main menu/i })
    await user.click(button)
    return button
  }

  it('is a disclosure that names the panel it controls', async () => {
    const user = userEvent.setup()
    await renderConfigured()

    const button = screen.getByRole('button', { name: /open main menu/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const panelId = button.getAttribute('aria-controls')
    expect(panelId, 'a disclosure that controls nothing is a button').toBeTruthy()
    expect(
      document.getElementById(panelId!),
      'aria-controls must point at an element that exists',
    ).not.toBeNull()

    await user.click(button)
    expect(
      screen.getByRole('button', { name: /close main menu/i }).getAttribute('aria-expanded'),
      'the state has to be announced, not just drawn',
    ).toBe('true')
  })

  it('carries every destination the desktop bar carries, plus both actions', async () => {
    const user = userEvent.setup()
    await renderConfigured()
    const button = await openMenu(user)

    const panel = document.getElementById(button.getAttribute('aria-controls')!)!
    const hrefs = [...panel.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))

    /*
     * Read off the page rather than hard-coded: the desktop bar and the
     * panel both render `NAV_SECTIONS`, and the requirement is that they
     * cannot disagree. A literal list here would pass while the two
     * drifted apart.
     */
    const header = document.querySelector('header')!
    const sections = [
      ...new Set(
        [...header.querySelectorAll('a[href^="#"]')]
          .filter(a => !panel.contains(a))
          .map(a => a.getAttribute('href')!)
          // `#top` is the wordmark returning to the hero. It is the logo,
          // not a section, and it belongs in the bar rather than the menu.
          .filter(href => href !== '#top'),
      ),
    ]
    expect(sections.length, 'there must be sections to navigate to').toBeGreaterThanOrEqual(5)

    for (const href of sections) {
      expect(hrefs, `the phone menu cannot reach ${href}`).toContain(href)
    }

    expect(hrefs, 'someone with an account needs the way in').toContain('/login')
    expect(
      [...panel.querySelectorAll('button')].map(b => b.textContent ?? '').join(' '),
      'the primary action belongs in the menu, which is where it was missing',
    ).toMatch(/request a demo/i)
  })

  it('moves focus into the panel when it opens', async () => {
    const user = userEvent.setup()
    await renderConfigured()
    const button = await openMenu(user)

    const panel = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(
      panel.contains(document.activeElement),
      'opening a menu and leaving focus outside it strands a keyboard user',
    ).toBe(true)
  })

  it('closes on Escape and hands focus back to the button', async () => {
    const user = userEvent.setup()
    await renderConfigured()
    await openMenu(user)

    await user.keyboard('{Escape}')

    const button = screen.getByRole('button', { name: /open main menu/i })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(
      document.activeElement,
      'focus has to come back, or the next Tab starts from the top of the document',
    ).toBe(button)
  })

  it('closes when a destination is chosen', async () => {
    const user = userEvent.setup()
    await renderConfigured()
    const button = await openMenu(user)

    const panel = document.getElementById(button.getAttribute('aria-controls')!)!
    await user.click(panel.querySelector<HTMLElement>('a[href^="#"]')!)

    expect(
      screen.getByRole('button', { name: /open main menu/i }).getAttribute('aria-expanded'),
      'a menu left open over the section it just scrolled to is the whole screen on a phone',
    ).toBe('false')
  })

  it('keeps the panel out of the tab order while it is shut', async () => {
    await renderConfigured()
    const button = screen.getByRole('button', { name: /open main menu/i })
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!

    /*
     * `visibility: hidden` does this in a browser and jsdom cannot see it,
     * so the panel sets `tabIndex={-1}` on its own items as well. That is
     * the half this can check, and it is the half that would otherwise let
     * a visitor Tab through seven invisible links on the desktop site.
     */
    for (const a of panel.querySelectorAll('a')) {
      expect(a.getAttribute('tabindex'), `${a.textContent} is reachable while shut`).toBe('-1')
    }
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
